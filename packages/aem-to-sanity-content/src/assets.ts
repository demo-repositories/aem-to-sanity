#!/usr/bin/env node
/**
 * aem-assets — download AEM DAM binaries, upload to Sanity **Media Library**,
 * link each asset into the project dataset via the GDR endpoint, and rewrite
 * clean docs so image/file fields carry the linked asset ref.
 *
 * Scope decision (@shehjadkhan 2026-04-22): assets MUST go to the Media Library
 * (org-scoped), NOT the dataset Content Lake. See spec vT6pVpbH, task cd8YOXWC.
 *
 * Flow per asset:
 *   1.  AEM GET `{damPath}`                               → local cache
 *   2.  POST /media-libraries/{mlId}/upload                → {asset, assetInstance}
 *   3.  POST /assets/media-library-link/{dataset}          → {document} linked in dataset
 *   4.  Rewrite `{_type:'image'|'file', asset:{_ref:'<linked-ref>'}}` in clean docs
 *
 * Manifest (`output/assets/manifest.json`) tracks both IDs so re-runs skip
 * whichever steps already completed.
 *
 * Dry-run by default. Set `MIGRATION_DRY_RUN=false` to upload + link + rewrite.
 */
import "./load-env.ts";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { createColors, formatDuration, listCleanFiles, resolveConfig, startTimer, type AuthMode } from "aem-to-sanity-core";

// ── Types ────────────────────────────────────────────────────────────────

interface SanityRef {
  _type: "image" | "file";
  asset: { _type: "reference"; _ref: string };
}

/**
 * Per-asset state. Re-runs check `mediaLibraryAssetId` (skip upload) and
 * `linkedAssetInstanceId` (skip link). `linkedRef` is what ends up in docs.
 */
interface ManifestEntry {
  damPath: string;
  cachedFile?: string;
  fileSize?: number;
  mimeType?: string;
  downloadedAt?: string;
  uploadedAt?: string;
  linkedAt?: string;
  /** `asset._id` from the ML upload response (parent sanity.asset doc id). */
  mediaLibraryAssetId?: string;
  /** `assetInstance._id` from the ML upload response (versioned asset id). */
  linkedAssetInstanceId?: string;
  /** Dataset-local asset document `_id`, returned by the link endpoint. Used as `asset._ref` in docs. */
  linkedRef?: string;
  /** Optional GDR `media._ref` (e.g. `media-library:<mlId>:<assetId>`) for reference. */
  mediaRef?: string;
  sanityRef?: SanityRef;
  status:
    | "cached"
    | "downloaded"
    | "failed-download"
    | "uploaded"
    | "failed-upload"
    | "linked"
    | "failed-link"
    | "dry-run";
  error?: string;
}

type Manifest = Record<string, ManifestEntry>;

interface MlUploadResponse {
  asset: { _id: string; _type: string };
  assetInstance: {
    _id: string;
    _type: string;
    mimeType?: string;
    size?: number;
    url?: string;
    originalFilename?: string;
  };
}

interface LinkResponse {
  document: {
    _id: string;
    _type: string;
    url?: string;
    mimeType?: string;
    size?: number;
    media?: { _ref?: string; _type?: string; _weak?: boolean };
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Work-stealing pool. Each runner grabs the next index off a shared cursor
 * until the list is drained. Keeps concurrency exactly at `concurrency`
 * (newer workers don't outstrip stragglers — the slowest one just holds
 * its slot until done). No unbounded fan-out and no `Promise.all` over
 * every item, which matters for large lists.
 *
 * Safety under parallel AEM/ML/Sanity I/O:
 *   1. Phase 0's dedup pre-pass populates the manifest for every damPath
 *      already in the ML — so phases 1-3 never see a duplicate.
 *   2. Each damPath is owned by exactly one worker at a time (the pool
 *      hands each index out once), so the two shared mutable structures
 *      (`manifest` and `aspectStamped`) only see writes to distinct keys
 *      across workers. No lock needed.
 *   3. Persistence uses `writeFileSync` + `JSON.stringify`, both of which
 *      run synchronously relative to the single-threaded event loop, so
 *      manifest file contents are always consistent — a worker's full
 *      snapshot always lands atomically between other workers' async
 *      awaits. If this ever moves to async `writeFile`, a serial lock
 *      becomes mandatory.
 */
async function runInParallel<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number, workerId: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const n = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;
  const runners: Promise<void>[] = [];
  // Worker ids are 1-indexed and stable for the whole phase so operators
  // can track a single worker's run of tasks through the log — same id
  // tag shows up on every line that worker emits.
  for (let id = 1; id <= n; id++) {
    runners.push(
      (async () => {
        while (true) {
          const i = cursor++;
          if (i >= items.length) return;
          await worker(items[i]!, i, id);
        }
      })(),
    );
  }
  await Promise.all(runners);
}

/**
 * Short, fixed-width worker label for log lines (`w1`, `w2`, … `w12`).
 * Padded so the columns after it stay aligned regardless of 1- or 2-digit
 * ids; picked up from `ASSET_CONCURRENCY` so higher counts still render
 * neatly.
 */
function workerLabel(id: number, total: number): string {
  const width = String(total).length;
  return `w${String(id).padStart(width, "0")}`;
}

function assetConcurrency(): number {
  const raw = process.env.ASSET_CONCURRENCY;
  const n = raw ? Number(raw) : 4;
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 4;
}

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
};

function mimeFor(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function flatten(damPath: string): string {
  return damPath.replace(/^\/content\/dam\//, "").replace(/\//g, "--");
}

function fixtureAssetsDir(fixturesRoot: string): string {
  const assetsDir = join(fixturesRoot, "assets");
  if (existsSync(assetsDir)) return assetsDir;
  const legacyImagesDir = join(fixturesRoot, "images");
  if (existsSync(legacyImagesDir)) return legacyImagesDir;
  return assetsDir;
}

function fixtureAssetPath(fixturesRoot: string, damPath: string): string {
  return join(fixtureAssetsDir(fixturesRoot), flatten(damPath));
}

/**
 * Copy a committed DAM binary from `{AEM_FIXTURES_DIR}/assets/` into the asset cache.
 * Used when `AEM_FIXTURES_DIR` is set (offline demo tenant).
 */
function cacheFromFixtures(
  damPath: string,
  cacheDir: string,
  fixturesRoot: string,
): ManifestEntry {
  const src = fixtureAssetPath(fixturesRoot, damPath);
  if (!existsSync(src)) {
    return {
      damPath,
      status: "failed-download",
      error: `fixture image missing: ${src} (re-run pnpm build:demo-fixtures)`,
    };
  }
  const cachedFile = join(cacheDir, flatten(damPath));
  mkdirSync(dirname(cachedFile), { recursive: true });
  if (!existsSync(cachedFile)) {
    copyFileSync(src, cachedFile);
  }
  return {
    damPath,
    cachedFile,
    fileSize: statSync(cachedFile).size,
    mimeType: mimeFor(cachedFile),
    downloadedAt: new Date().toISOString(),
    status: "cached",
  };
}

const PLACEHOLDER_SLOT_COUNT = 12;

/** Deterministic slot for a DAM path — matches demo tenant placeholder SVGs. */
function slotForDamPath(damPath: string): number {
  const hash = createHash("sha1").update(damPath).digest("hex");
  return parseInt(hash.slice(0, 8), 16) % PLACEHOLDER_SLOT_COUNT;
}

function placeholderSvgPath(slot: number): string {
  const slug = `slot-${String(slot).padStart(2, "0")}`;
  return resolve(process.cwd(), "placeholders", `placeholder-${slug}.svg`);
}

/**
 * Copy a local placeholder SVG into the asset cache instead of downloading
 * from AEM. Used by the offline demo tenant (`--placeholders`).
 */
function cachePlaceholder(damPath: string, cacheDir: string): ManifestEntry {
  const slot = slotForDamPath(damPath);
  const src = placeholderSvgPath(slot);
  if (!existsSync(src)) {
    return {
      damPath,
      status: "failed-download",
      error: `placeholder missing: ${src} (run build:demo-fixtures or add placeholders/)`,
    };
  }
  const cachedFile = join(cacheDir, `${flatten(damPath)}.svg`);
  mkdirSync(dirname(cachedFile), { recursive: true });
  if (!existsSync(cachedFile)) {
    copyFileSync(src, cachedFile);
  }
  return {
    damPath,
    cachedFile,
    fileSize: statSync(cachedFile).size,
    mimeType: "image/svg+xml",
    downloadedAt: new Date().toISOString(),
    status: "cached",
  };
}

function aemAuthHeader(auth: AuthMode): string {
  if (auth.kind === "bearer") return `Bearer ${auth.token}`;
  return `Basic ${Buffer.from(`${auth.username}:${auth.password}`, "utf8").toString("base64")}`;
}

async function withRetry<T>(label: string, attempts: number, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts) break;
      const delay = 2 ** i * 1000;
      console.error(`    retry ${i}/${attempts} ${label} in ${delay}ms (${(err as Error).message})`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env var: ${name}`);
    process.exit(2);
  }
  return v;
}

// ── Phase 1: download from AEM ───────────────────────────────────────────

async function downloadOne(
  damPath: string,
  cacheDir: string,
  baseUrl: string,
  auth: AuthMode,
): Promise<ManifestEntry> {
  const cachedFile = join(cacheDir, flatten(damPath));
  if (existsSync(cachedFile)) {
    return {
      damPath,
      cachedFile,
      fileSize: statSync(cachedFile).size,
      mimeType: mimeFor(damPath),
      status: "cached",
    };
  }
  try {
    const { buffer, mimeType } = await withRetry(`download ${damPath}`, 3, async () => {
      const res = await fetch(`${baseUrl}${damPath}`, {
        headers: { Authorization: aemAuthHeader(auth) },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const m = res.headers.get("content-type")?.split(";")[0]?.trim() ?? mimeFor(damPath);
      return { buffer: Buffer.from(await res.arrayBuffer()), mimeType: m };
    });
    writeFileSync(cachedFile, buffer);
    return {
      damPath,
      cachedFile,
      fileSize: buffer.length,
      mimeType,
      downloadedAt: new Date().toISOString(),
      status: "downloaded",
    };
  } catch (err) {
    return { damPath, status: "failed-download", error: (err as Error).message };
  }
}

// ── Phase 2: upload to Media Library (raw HTTP POST) ─────────────────────

/**
 * We use raw HTTP POST rather than `@sanity/client` `client.assets.upload()`
 * because the latter (v7.21.0 with `resource:{type:'media-library'}`) drops
 * the `{asset, assetInstance}` payload and returns `undefined`. We need
 * both IDs — parent and versioned — to complete the link step.
 *
 * Endpoint: POST https://api.sanity.io/v{apiVersion}/media-libraries/{mlId}/upload
 */
async function uploadToMediaLibrary(
  entry: ManifestEntry,
  mlId: string,
  token: string,
  apiVersion: string,
): Promise<ManifestEntry> {
  if (!entry.cachedFile) return entry;
  const mimeType = entry.mimeType ?? mimeFor(entry.damPath);
  const filename = basename(entry.damPath);
  const url = `https://api.sanity.io/v${apiVersion}/media-libraries/${mlId}/upload?filename=${encodeURIComponent(filename)}`;

  try {
    const result = await withRetry(`ml-upload ${entry.damPath}`, 3, async () => {
      const body = readFileSync(entry.cachedFile!);
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": mimeType },
        body,
      });
      const text = await res.text();
      if (!res.ok) {
        // 409 `asset already exists` is informational: recover IDs via GROQ.
        if (res.status === 409) {
          let body: any;
          try { body = JSON.parse(text); } catch { body = {}; }
          if (body?.error?.existingAssetId) {
            const existing = await lookupExistingAsset(mlId, token, apiVersion, body.error.existingAssetId as string);
            if (existing) return { recovered: true as const, ...existing };
          }
        }
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
      }
      const json = JSON.parse(text) as MlUploadResponse;
      return { recovered: false as const, assetId: json.asset._id, assetInstanceId: json.assetInstance._id };
    });

    const assetId = result.assetId;
    const assetInstanceId = result.assetInstanceId;
    return {
      ...entry,
      mediaLibraryAssetId: assetId,
      linkedAssetInstanceId: assetInstanceId,
      status: "uploaded",
      uploadedAt: new Date().toISOString(),
    };
  } catch (err) {
    return { ...entry, status: "failed-upload", error: (err as Error).message };
  }
}

/**
 * Verify an asset still exists in the Media Library by id. Returns `true`
 * if the doc is there, `false` if the ML confirmed it's missing, and
 * `unknown` on any transport error — callers treat `unknown` conservatively
 * (don't clobber local state on a network blip).
 *
 * Used by phase 0's staleness gate: when the aspect-based dedup can't find
 * a damPath but the manifest claims an `mediaLibraryAssetId`, we need a
 * second signal before deciding the manifest is stale (the aspect might
 * simply not be stamped on an asset that still exists).
 */
async function assetDocExists(
  mlId: string,
  token: string,
  apiVersion: string,
  assetId: string,
): Promise<"exists" | "missing" | "unknown"> {
  const url = `https://api.sanity.io/v${apiVersion}/media-libraries/${mlId}/query`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `defined(*[_id == $id][0]._id)`,
        params: { id: assetId },
      }),
    });
    if (!res.ok) return "unknown";
    const body = (await res.json()) as { result?: unknown };
    return body.result === true ? "exists" : "missing";
  } catch {
    return "unknown";
  }
}

/**
 * Dedup lookup: find an asset previously uploaded by this pipeline via its
 * `aspects.aemSource.damPath` stamp. The aspect also caches `assetInstanceId`
 * so we don't have to probe the parent's versions field to find a linkable
 * instance. Returns null if the aspect isn't deployed yet, no asset matches,
 * or the stamp is missing the cached instance id (older uploads).
 */
async function findExistingByAemPath(
  mlId: string,
  token: string,
  apiVersion: string,
  damPath: string,
): Promise<{ assetId: string; assetInstanceId: string } | null> {
  const url = `https://api.sanity.io/v${apiVersion}/media-libraries/${mlId}/query`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `*[_type == "sanity.asset" && aspects.aemSource.damPath == $damPath][0]{_id, "assetInstanceId": aspects.aemSource.assetInstanceId}`,
        params: { damPath },
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: { _id?: string; assetInstanceId?: string } };
    const hit = body.result;
    if (!hit?._id || !hit.assetInstanceId) return null;
    return { assetId: hit._id, assetInstanceId: hit.assetInstanceId };
  } catch {
    return null;
  }
}

/**
 * Stamp `aspects.aemSource = {damPath, assetInstanceId}` on the parent asset
 * doc so future runs can dedup via `findExistingByAemPath`. Best-effort: logs
 * and returns on failure (typically because the aspect hasn't been deployed
 * yet via `sanity media deploy-aspect aemSource`).
 */
async function stampAemSourceAspect(
  mlId: string,
  token: string,
  apiVersion: string,
  assetId: string,
  damPath: string,
  assetInstanceId: string,
): Promise<void> {
  const url = `https://api.sanity.io/v${apiVersion}/media-libraries/${mlId}/mutate`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        mutations: [
          {
            patch: {
              id: assetId,
              setIfMissing: { aspects: {} },
              set: { "aspects.aemSource": { damPath, assetInstanceId } },
            },
          },
        ],
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(
        `    aspect-stamp failed for ${damPath}: HTTP ${res.status} — ${text.slice(0, 200)}`,
      );
    }
  } catch (err) {
    console.error(`    aspect-stamp error for ${damPath}: ${(err as Error).message}`);
  }
}

async function lookupExistingAsset(
  mlId: string,
  token: string,
  apiVersion: string,
  assetInstanceId: string,
): Promise<{ assetId: string; assetInstanceId: string } | null> {
  // `sanity.asset` parent references the `sanity.imageAsset` / `sanity.fileAsset` instance.
  // Uses the JS client for resource-routing; dynamic import keeps the module
  // loadable when `@sanity/client` isn't installed (tests, dry runs).
  try {
    const mod = await import("@sanity/client");
    const client = mod.createClient({
      resource: { type: "media-library", id: mlId },
      apiVersion,
      token,
      useCdn: false,
    });
    const parent = (await client.fetch(
      `*[_type=="sanity.asset" && references($id)][0]{_id}`,
      { id: assetInstanceId },
    )) as { _id: string } | null;
    if (!parent?._id) {
      console.error(
        `    ml-lookup: no sanity.asset parent found for instance ${assetInstanceId} (mlId=${mlId}) — treating as new upload`,
      );
      return null;
    }
    return { assetId: parent._id, assetInstanceId };
  } catch (err) {
    // Don't swallow — operators need to know why the 409 recovery failed
    // (auth scope, network, @sanity/client missing) to decide whether the
    // failed-upload status represents a real failure or a retrieval gap.
    console.error(
      `    ml-lookup failed for instance ${assetInstanceId}: ${(err as Error).message}`,
    );
    return null;
  }
}

// ── Phase 3: link into project dataset ───────────────────────────────────

/**
 * POST https://{projectId}.api.sanity.io/v{apiVersion}/assets/media-library-link/{dataset}
 * body: {mediaLibraryId, assetInstanceId, assetId}
 *
 * Returns `{document: {_id, _type, url, media:{_ref}, ...}}` — `document._id`
 * is the dataset-local ref we store in docs as `asset._ref`.
 *
 * Per Sanity docs: this endpoint requires a **personal authorization token**
 * with read/write on both the Media Library and the project/dataset. A
 * project-scoped robot token produces `401 Invalid non-global session`.
 * We read the token from `SANITY_ML_LINK_TOKEN` (falling back to
 * `SANITY_TOKEN`) so operators can plug in a personal token without
 * disturbing the robot token used elsewhere.
 */
async function linkToDataset(
  entry: ManifestEntry,
  projectId: string,
  dataset: string,
  mlId: string,
  linkToken: string,
  apiVersion: string,
): Promise<ManifestEntry> {
  if (!entry.mediaLibraryAssetId || !entry.linkedAssetInstanceId) return entry;
  const url = `https://${projectId}.api.sanity.io/v${apiVersion}/assets/media-library-link/${dataset}`;
  const body = JSON.stringify({
    mediaLibraryId: mlId,
    assetInstanceId: entry.linkedAssetInstanceId,
    assetId: entry.mediaLibraryAssetId,
  });
  try {
    const linkJson = await withRetry(`link ${entry.damPath}`, 3, async () => {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${linkToken}`, "Content-Type": "application/json" },
        body,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
      return JSON.parse(text) as LinkResponse;
    });
    const mimeType = entry.mimeType ?? mimeFor(entry.damPath);
    const kind: "image" | "file" = mimeType.startsWith("image/") ? "image" : "file";
    const linkedRef = linkJson.document._id;
    return {
      ...entry,
      linkedRef,
      mediaRef: linkJson.document.media?._ref,
      sanityRef: {
        _type: kind,
        asset: { _type: "reference", _ref: linkedRef },
      },
      status: "linked",
      linkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return { ...entry, status: "failed-link", error: (err as Error).message };
  }
}

// ── Phase 4: rewrite clean docs ──────────────────────────────────────────

function collectDamPaths(value: unknown, out: Set<string>): void {
  if (typeof value === "string") {
    if (value.startsWith("/content/dam/")) out.add(value);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const v of value) collectDamPaths(v, out);
    return;
  }
  for (const v of Object.values(value as Record<string, unknown>)) collectDamPaths(v, out);
}

/**
 * In-place rewrite: `/content/dam/...` strings become `{_type:'image', asset:{_ref}}`
 * (Pattern A — matches the existing doc shape, Studio-compatible).
 * Keys ending in `AemPath` hold read-only provenance — never replaced.
 *
 * Tracks both successful rewrites and DAM paths that could not be rewritten
 * (asset failed-upload / failed-link / missing from manifest). The caller
 * surfaces `unresolved` in the summary — leaving `/content/dam/*` strings
 * in "clean" docs is a silent data-loss path that must not ship quietly.
 */
interface RewriteStats {
  rewrites: number;
  unresolved: Set<string>;
}

function rewriteDamRefs(
  value: unknown,
  manifest: Manifest,
  stats: RewriteStats,
  propKey?: string,
): unknown {
  if (typeof value === "string") {
    if (value.startsWith("/content/dam/")) {
      // `*AemPath` fields are preserved provenance, not references.
      if (propKey?.endsWith("AemPath")) return value;
      const hit = manifest[value];
      if (hit?.sanityRef) {
        stats.rewrites++;
        return hit.sanityRef;
      }
      stats.unresolved.add(value);
    }
    return value;
  }
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = rewriteDamRefs(value[i], manifest, stats, undefined);
    return value;
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) obj[key] = rewriteDamRefs(obj[key], manifest, stats, key) as unknown;
  // Transform parks DAM paths at `{base}AemPath` and clears `{base}` so the
  // asset field stays empty until we fill it here (see transform.ts `splitAemFileUploadDamPaths`).
  for (const key of Object.keys(obj)) {
    if (!key.endsWith("AemPath")) continue;
    const base = key.slice(0, -"AemPath".length);
    if (!base || obj[base] !== undefined) continue;
    const provenance = obj[key];
    if (typeof provenance !== "string" || !provenance.startsWith("/content/dam/")) continue;
    const hit = manifest[provenance];
    if (hit?.sanityRef) {
      obj[base] = hit.sanityRef;
      stats.rewrites++;
    } else {
      stats.unresolved.add(provenance);
    }
  }
  return obj;
}

function loadManifest(file: string): Manifest {
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf8")) as Manifest;
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const totalTimer = startTimer();
  const c = createColors({ stream: process.stderr });
  const config = await resolveConfig(process.env);
  const outputDir = resolve(process.env.OUTPUT_DIR ?? "./output");
  const cleanDir = join(outputDir, "cache", "clean");
  const assetsDir = join(outputDir, "cache", "assets");
  const manifestFile = join(assetsDir, "manifest.json");
  const dryRun = process.env.MIGRATION_DRY_RUN !== "false";
  const uploadOnly = process.argv.includes("--upload-only");
  // `--link-only` is for re-runs where assets already live in the Sanity
  // Media Library. Phase 0's aspect lookup (`aspects.aemSource.damPath`)
  // recovers the ML ids; download (phase 1) and upload (phase 2) are skipped
  // entirely. Useful when AEM is slow, when the operator has already pushed
  // assets out-of-band, or when iterating on link/rewrite logic without
  // re-hitting AEM every run.
  const linkOnly =
    process.argv.includes("--link-only") ||
    process.env.MIGRATION_LINK_ONLY === "true";
  // `--download-only` is for operators without Media Library access, or who
  // plan to hand cached binaries off to a different asset platform (Bynder,
  // etc.) instead of the ML. Runs phase 1 for real, then stops — no ML dedup
  // lookup, no upload, no link, no rewrite. Independent of `MIGRATION_DRY_RUN`.
  const downloadOnly =
    process.argv.includes("--download-only") ||
    process.env.MIGRATION_ASSETS_DOWNLOAD_ONLY === "true";
  const usePlaceholders =
    process.argv.includes("--placeholders") ||
    process.env.MIGRATION_ASSETS_PLACEHOLDERS === "true";
  const fixturesRoot = process.env.AEM_FIXTURES_DIR?.trim() || "";
  const useFixtureImages = fixturesRoot.length > 0;
  if (linkOnly && uploadOnly) {
    console.error("--link-only and --upload-only are mutually exclusive.");
    process.exit(2);
  }
  if (downloadOnly && (linkOnly || uploadOnly)) {
    console.error("--download-only is mutually exclusive with --link-only and --upload-only.");
    process.exit(2);
  }
  if (usePlaceholders && (linkOnly || uploadOnly)) {
    console.error("--placeholders is mutually exclusive with --link-only and --upload-only.");
    process.exit(2);
  }
  if (usePlaceholders && useFixtureImages) {
    console.error(
      "--placeholders is not used with AEM_FIXTURES_DIR — read DAM binaries from fixtures/aem/assets/ instead.",
    );
    process.exit(2);
  }
  const skipRewrite = process.argv.includes("--no-rewrite");

  mkdirSync(assetsDir, { recursive: true });

  const cleanFiles = listCleanFiles(outputDir);
  if (cleanFiles.length === 0) {
    console.error(`No clean files in ${cleanDir}. Run \`aem-transform\` first.`);
    process.exit(2);
  }

  // Collect unique DAM paths across all clean docs.
  const damPaths = new Set<string>();
  for (const { absPath } of cleanFiles) {
    const doc = JSON.parse(readFileSync(absPath, "utf8")) as unknown;
    collectDamPaths(doc, damPaths);
  }
  const sortedPaths = [...damPaths].sort();

  const modeLabel = useFixtureImages
    ? " [fixture images: skip AEM download]"
    : usePlaceholders
      ? " [placeholders: local SVGs, skip AEM download]"
      : linkOnly
        ? " [link-only: skip download + upload]"
        : uploadOnly
          ? " [upload-only: skip download]"
          : downloadOnly
            ? " [download-only: skip ML dedup + upload + link + rewrite]"
            : "";
  console.error(
    `[assets] ${c.green(sortedPaths.length)} unique asset(s) across ${c.green(cleanFiles.length)} page(s)${c.dim(modeLabel)}`,
  );
  if (downloadOnly) {
    console.error(c.dim("DOWNLOAD ONLY — no Media Library upload/link, no doc rewrite"));
  } else if (dryRun) {
    console.error(c.dim("DRY RUN — set MIGRATION_DRY_RUN=false to upload + link + rewrite"));
  } else {
    console.error(c.dim("Target Media Library + dataset link — MIGRATION_DRY_RUN=false"));
  }

  const manifest = loadManifest(manifestFile);

  // ── Phase 0: dedup via aemSource aspect ──────────────────────────────
  // For damPaths not already resolved by the local manifest, query the ML for
  // `aspects.aemSource.damPath == $damPath`. A hit populates the manifest
  // with both ids so phases 1 (download) and 2 (upload) skip the asset
  // entirely. Misses (no match or aspect undeployed) fall through.
  // `aspectStamped` tracks which paths already carry the aspect stamp, so
  // phase 2 only backfills the ones that don't.
  //
  // Normally skipped under dry-run (no creds assumed). Under `--link-only`
  // we always run it: the whole point of that mode is to discover which DAM
  // paths already live in the ML, so dry-run + link-only becomes "preview
  // which assets would be linked" — still read-only against Sanity, but
  // now useful.
  const aspectStamped = new Set<string>();
  const phaseTimings: Record<string, number> = {};
  if (!downloadOnly && (!dryRun || linkOnly)) {
    const mlId = mustEnv("SANITY_MEDIA_LIBRARY_ID");
    const token = mustEnv("SANITY_TOKEN");
    const apiVersion = process.env.SANITY_API_VERSION ?? "2025-02-19";
    const concurrency = assetConcurrency();
    console.error(
      c.bold("\n── 0. Check Media Library for existing assets ──") +
        c.dim(` (concurrency: ${concurrency})`),
    );
    const phase0 = startTimer();
    let hits = 0;
    let done = 0;
    let staleCleared = 0;
    await runInParallel(sortedPaths, concurrency, async (damPath, _i, workerId) => {
      const w = c.dim(workerLabel(workerId, concurrency));
      const existing = manifest[damPath];
      const hit = await findExistingByAemPath(mlId, token, apiVersion, damPath);
      if (hit) {
        done++;
        hits++;
        aspectStamped.add(damPath);
        manifest[damPath] = {
          ...(existing ?? { damPath }),
          damPath,
          mediaLibraryAssetId: hit.assetId,
          linkedAssetInstanceId: hit.assetInstanceId,
          status: "uploaded",
          uploadedAt: existing?.uploadedAt ?? new Date().toISOString(),
        };
        writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
        console.error(`  ${c.dim(`${done}/${sortedPaths.length}`)} ${w} ${c.green("reuse ")} ${damPath}  ${c.dim(hit.assetId)}`);
        return;
      }
      // No aspect hit. If the manifest claims an assetId, verify it — a
      // stale ID (ML wiped, manual delete, etc.) would otherwise cause
      // phase 2 to short-circuit "already uploaded" and phase 3 to trust
      // a dead linkedRef. Both lead to a successful-looking run that
      // writes nothing to the ML.
      if (existing?.mediaLibraryAssetId) {
        const check = await assetDocExists(
          mlId,
          token,
          apiVersion,
          existing.mediaLibraryAssetId,
        );
        done++;
        if (check === "missing") {
          staleCleared++;
          // Preserve the local download cache; drop every ML/dataset ref.
          manifest[damPath] = {
            damPath,
            cachedFile: existing.cachedFile,
            mimeType: existing.mimeType,
            fileSize: existing.fileSize,
            downloadedAt: existing.downloadedAt,
            status: "cached",
          };
          writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
          console.error(
            `  ${c.dim(`${done}/${sortedPaths.length}`)} ${w} ${c.yellow("stale ")} ${damPath}  ${c.dim("(cleared — asset gone from ML)")}`,
          );
          return;
        }
        if (check === "exists") {
          // Asset is in the ML but missing the aspect stamp — likely an
          // older upload that predated the aspect. Keep the manifest's
          // IDs so phase 2 skips upload; phase 2 will attempt to backfill
          // the stamp.
          console.error(
            `  ${c.dim(`${done}/${sortedPaths.length}`)} ${w} ${c.dim("present")} ${damPath}  ${c.dim("(aspect stamp missing)")}`,
          );
          return;
        }
        // `unknown`: transport error. Err on the side of preserving state;
        // a later run on a healthy network will re-check.
        console.error(
          `  ${c.dim(`${done}/${sortedPaths.length}`)} ${w} ${c.yellow("probe? ")} ${damPath}  ${c.dim("(ML check failed; keeping manifest state)")}`,
        );
        return;
      }
      done++;
      console.error(`  ${c.dim(`${done}/${sortedPaths.length}`)} ${w} ${c.dim("new   ")} ${damPath}`);
    });
    const summary = staleCleared > 0
      ? c.dim(`  ${hits}/${sortedPaths.length} reused, `) + c.yellow(`${staleCleared} stale manifest entry(ies) cleared`) + c.dim(" — phases 2-3 will re-upload + re-link.")
      : c.dim(`  ${hits}/${sortedPaths.length} reused from existing Media Library aspects`);
    console.error(summary);
    if (linkOnly && hits < sortedPaths.length) {
      // In link-only mode, a phase-0 miss means the asset has no counterpart
      // in the ML — there's nothing for phases 3-4 to link. Call it out up
      // front so the operator can decide to re-run without `--link-only` or
      // to stamp the missing aspects out-of-band.
      console.error(
        c.yellow(
          `  ${sortedPaths.length - hits} asset(s) are not in the Media Library — they'll be left unresolved in clean docs.`,
        ),
      );
    }
    phaseTimings.phase0 = phase0.elapsedMs();
  }

  // ── Phase 1: download ────────────────────────────────────────────────
  if (!uploadOnly && !linkOnly) {
    const concurrency = assetConcurrency();
    console.error(
      c.bold(
        useFixtureImages
          ? "\n── 1. Cache fixture DAM images ──"
          : usePlaceholders
            ? "\n── 1. Cache local placeholder assets ──"
            : "\n── 1. Download from AEM DAM ──",
      ) + c.dim(` (concurrency: ${concurrency})`),
    );
    const phase1 = startTimer();
    let done = 0;
    await runInParallel(sortedPaths, concurrency, async (damPath, _i, workerId) => {
      const w = c.dim(workerLabel(workerId, concurrency));
      const existing = manifest[damPath];
      if (existing?.cachedFile && existsSync(existing.cachedFile)) {
        done++;
        console.error(`  ${c.dim(`${done}/${sortedPaths.length}`)} ${w} ${c.dim("cached ")} ${damPath}`);
        return;
      }
      if (existing?.mediaLibraryAssetId && existing.linkedAssetInstanceId) {
        done++;
        console.error(`  ${c.dim(`${done}/${sortedPaths.length}`)} ${w} ${c.dim("skip  ")} ${damPath}  ${c.dim("(already in ML)")}`);
        return;
      }
      const entry = useFixtureImages
        ? cacheFromFixtures(damPath, assetsDir, fixturesRoot)
        : usePlaceholders
          ? cachePlaceholder(damPath, assetsDir)
          : await downloadOne(damPath, assetsDir, config.baseUrl, config.auth);
      manifest[damPath] = { ...existing, ...entry };
      writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
      done++;
      const marker =
        entry.status === "failed-download"
          ? c.yellow("fail  ")
          : c.dim(useFixtureImages ? "fx    " : usePlaceholders ? "ph    " : "↓      ");
      console.error(`  ${c.dim(`${done}/${sortedPaths.length}`)} ${w} ${marker} ${damPath}`);
    });
    phaseTimings.phase1 = phase1.elapsedMs();
  }

  // ── Phase 2: upload to Media Library ────────────────────────────────
  if (linkOnly || downloadOnly) {
    console.error(
      c.bold("\n── 2. Upload to Sanity Media Library ──") +
        c.dim(linkOnly ? " (skipped: --link-only)" : " (skipped: --download-only)"),
    );
  } else {
  const uploadConcurrency = assetConcurrency();
  console.error(
    c.bold("\n── 2. Upload to Sanity Media Library ──") +
      c.dim(` (concurrency: ${uploadConcurrency})`),
  );
  const phase2 = startTimer();
  if (dryRun) {
    const toUpload = sortedPaths.filter((p) => manifest[p]?.cachedFile && !manifest[p]?.mediaLibraryAssetId);
    console.error(c.dim(`  would upload ${toUpload.length} asset(s) — skipped (dry run)`));
  } else {
    const mlId = mustEnv("SANITY_MEDIA_LIBRARY_ID");
    const uploadToken = mustEnv("SANITY_TOKEN");
    const apiVersion = process.env.SANITY_API_VERSION ?? "2025-02-19";
    let done = 0;
    await runInParallel(sortedPaths, uploadConcurrency, async (damPath, _i, workerId) => {
      const w = c.dim(workerLabel(workerId, uploadConcurrency));
      const entry = manifest[damPath];
      if (!entry?.cachedFile) {
        done++;
        console.error(`  ${c.dim(`${done}/${sortedPaths.length}`)} ${w} ${c.yellow("skip  ")} ${damPath}  ${c.dim("(no local file)")}`);
        return;
      }
      if (entry.mediaLibraryAssetId && entry.linkedAssetInstanceId) {
        done++;
        console.error(`  ${c.dim(`${done}/${sortedPaths.length}`)} ${w} ${c.dim("up✓   ")} ${damPath}  ${c.dim(entry.mediaLibraryAssetId)}`);
        if (!aspectStamped.has(damPath)) {
          await stampAemSourceAspect(
            mlId,
            uploadToken,
            apiVersion,
            entry.mediaLibraryAssetId,
            damPath,
            entry.linkedAssetInstanceId,
          );
          aspectStamped.add(damPath);
        }
        return;
      }
      manifest[damPath] = await uploadToMediaLibrary(entry, mlId, uploadToken, apiVersion);
      writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
      const uploaded = manifest[damPath];
      done++;
      const marker = uploaded.status === "failed-upload" ? c.yellow("fail  ") : c.dim("↑     ");
      console.error(`  ${c.dim(`${done}/${sortedPaths.length}`)} ${w} ${marker} ${damPath}`);
      if (uploaded.mediaLibraryAssetId && uploaded.linkedAssetInstanceId && !aspectStamped.has(damPath)) {
        await stampAemSourceAspect(
          mlId,
          uploadToken,
          apiVersion,
          uploaded.mediaLibraryAssetId,
          damPath,
          uploaded.linkedAssetInstanceId,
        );
        aspectStamped.add(damPath);
      }
    });
  }
  phaseTimings.phase2 = phase2.elapsedMs();
  } // end of !linkOnly upload block

  // ── Phase 3: link to project dataset ────────────────────────────────
  if (downloadOnly) {
    console.error(
      c.bold("\n── 3. Link to project dataset ──") + c.dim(" (skipped: --download-only)"),
    );
  } else {
  const linkConcurrency = assetConcurrency();
  console.error(
    c.bold("\n── 3. Link to project dataset ──") +
      c.dim(` (concurrency: ${linkConcurrency})`),
  );
  const phase3 = startTimer();
  if (dryRun) {
    const toLink = sortedPaths.filter((p) => manifest[p]?.mediaLibraryAssetId && !manifest[p]?.linkedRef);
    console.error(c.dim(`  would link ${toLink.length} asset(s) — skipped (dry run)`));
  } else {
    const projectId = mustEnv("SANITY_PROJECT_ID");
    const dataset = process.env.SANITY_DATASET ?? "production";
    const mlId = mustEnv("SANITY_MEDIA_LIBRARY_ID");
    // SANITY_ML_LINK_TOKEN takes precedence — it must be a personal auth token
    // because the /assets/media-library-link endpoint rejects project robot tokens.
    const linkToken = process.env.SANITY_ML_LINK_TOKEN ?? process.env.SANITY_TOKEN;
    if (!linkToken) {
      console.error("Missing SANITY_ML_LINK_TOKEN (or SANITY_TOKEN)");
      process.exit(2);
    }
    const apiVersion = process.env.SANITY_API_VERSION ?? "2025-02-19";
    let done = 0;
    await runInParallel(sortedPaths, linkConcurrency, async (damPath, _i, workerId) => {
      const w = c.dim(workerLabel(workerId, linkConcurrency));
      const entry = manifest[damPath];
      if (!entry?.mediaLibraryAssetId || !entry.linkedAssetInstanceId) {
        done++;
        console.error(`  ${c.dim(`${done}/${sortedPaths.length}`)} ${w} ${c.yellow("skip  ")} ${damPath}  ${c.dim("(no ML ids)")}`);
        return;
      }
      if (entry.linkedRef && entry.sanityRef) {
        done++;
        console.error(`  ${c.dim(`${done}/${sortedPaths.length}`)} ${w} ${c.dim("ln✓   ")} ${damPath}  ${c.dim(entry.linkedRef)}`);
        return;
      }
      manifest[damPath] = await linkToDataset(entry, projectId, dataset, mlId, linkToken, apiVersion);
      writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
      done++;
      const linked = manifest[damPath];
      const marker = linked.status === "failed-link" ? c.yellow("fail  ") : c.dim("⚭     ");
      const suffix = linked.linkedRef ? `  ${c.dim(linked.linkedRef)}` : "";
      console.error(`  ${c.dim(`${done}/${sortedPaths.length}`)} ${w} ${marker} ${damPath}${suffix}`);
    });
  }
  phaseTimings.phase3 = phase3.elapsedMs();
  } // end of !downloadOnly link block

  // ── Phase 4: rewrite clean docs in place ────────────────────────────
  let patched = 0;
  const rewriteStats: RewriteStats = { rewrites: 0, unresolved: new Set() };
  if (!skipRewrite && !dryRun && !downloadOnly) {
    console.error(c.bold("\n── 4. Rewrite clean docs ──"));
    const phase4 = startTimer();
    for (const { absPath } of cleanFiles) {
      const doc = JSON.parse(readFileSync(absPath, "utf8")) as unknown;
      rewriteDamRefs(doc, manifest, rewriteStats);
      writeFileSync(absPath, JSON.stringify(doc, null, 2) + "\n");
      patched++;
    }
    phaseTimings.phase4 = phase4.elapsedMs();
  }

  // ── Summary ─────────────────────────────────────────────────────────
  const all = Object.values(manifest);
  const stats = {
    totalAssets: sortedPaths.length,
    downloaded: all.filter((e) => e.status === "downloaded").length,
    cached: all.filter((e) => e.status === "cached").length,
    failedDownload: all.filter((e) => e.status === "failed-download").length,
    uploaded: all.filter((e) => e.mediaLibraryAssetId).length,
    failedUpload: all.filter((e) => e.status === "failed-upload").length,
    linked: all.filter((e) => e.linkedRef).length,
    failedLink: all.filter((e) => e.status === "failed-link").length,
  };
  const unresolvedList = [...rewriteStats.unresolved].sort();
  writeFileSync(
    join(outputDir, "cache", "assets-report.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        dryRun,
        summary: stats,
        rewrite: {
          rewrites: rewriteStats.rewrites,
          unresolvedCount: unresolvedList.length,
          unresolved: unresolvedList,
        },
      },
      null,
      2,
    ) + "\n",
  );

  // Human-readable log of every DAM path that didn't make it all the way into
  // the dataset — the asset analog of `extract-404.log`. Tab-separated
  // `damPath <TAB> status <TAB> error` so operators can grep which assets were
  // skipped and why (download 404s, upload/link failures) without parsing JSON.
  // `unresolved` (raw `/content/dam/*` strings still in clean docs) are folded
  // in too, since those are the paths import will render as broken refs.
  const failureStatuses = new Set(["failed-download", "failed-upload", "failed-link"]);
  const failureRows = new Map<string, string>();
  for (const [damPath, entry] of Object.entries(manifest)) {
    if (failureStatuses.has(entry.status)) {
      const err = (entry.error ?? "").replace(/\s+/g, " ").trim();
      failureRows.set(damPath, `${damPath}\t${entry.status}\t${err}`);
    }
  }
  for (const damPath of unresolvedList) {
    if (failureRows.has(damPath)) continue;
    const entry = manifest[damPath];
    const status = entry?.status ?? "missing-from-manifest";
    const err = (entry?.error ?? "left as raw DAM string in clean docs").replace(/\s+/g, " ").trim();
    failureRows.set(damPath, `${damPath}\t${status}\t${err}`);
  }
  const assetFailuresLog = join(outputDir, "cache", "assets-failures.log");
  if (failureRows.size > 0) {
    const lines = [...failureRows.values()].sort();
    writeFileSync(assetFailuresLog, lines.join("\n") + "\n", "utf8");
  }

  console.error(c.dim("\n────────────────────────────────────────"));
  console.error(`Downloaded: ${c.green(stats.downloaded)}   Cached: ${c.dim(stats.cached)}   Failed: ${stats.failedDownload > 0 ? c.yellow(stats.failedDownload) : c.green(0)}`);
  console.error(`Uploaded:   ${c.green(stats.uploaded)}   Failed: ${stats.failedUpload > 0 ? c.yellow(stats.failedUpload) : c.green(0)}`);
  console.error(`Linked:     ${c.green(stats.linked)}   Failed: ${stats.failedLink > 0 ? c.yellow(stats.failedLink) : c.green(0)}`);
  if (patched > 0) {
    console.error(`Rewrote:    ${c.green(rewriteStats.rewrites)} ref(s) across ${c.green(patched)} clean file(s)`);
  }
  if (unresolvedList.length > 0) {
    // Every `/content/dam/*` string left in clean docs is a silent data-loss
    // path at import time (the import CLI won't upload them again, and Studio
    // renders them as broken strings in image/file fields). Surface loudly.
    console.error(
      c.yellow(
        `\n⚠  ${unresolvedList.length} DAM path(s) remain as raw strings in clean docs — import will render them as broken refs.`,
      ),
    );
    for (const p of unresolvedList.slice(0, 5)) {
      const hit = manifest[p];
      const reason = hit?.status ?? "missing-from-manifest";
      const err = hit?.error ? ` — ${hit.error.slice(0, 80)}` : "";
      console.error(`    ${c.dim(reason)} ${p}${c.dim(err)}`);
    }
    if (unresolvedList.length > 5) {
      console.error(c.dim(`    … and ${unresolvedList.length - 5} more (full list in assets-report.json)`));
    }
  }
  console.error(`Manifest:   ${c.dim(manifestFile)}`);
  if (failureRows.size > 0) {
    console.error(`Failures:   ${c.dim(assetFailuresLog)} ${c.dim(`(${failureRows.size} DAM path(s) — download 404s / upload / link / unresolved)`)}`);
  }
  const phaseLabels: Record<string, string> = {
    phase0: "phase 0 (ML dedup)",
    phase1: "phase 1 (download)",
    phase2: "phase 2 (upload)",
    phase3: "phase 3 (link)",
    phase4: "phase 4 (rewrite)",
  };
  const phaseLines = Object.entries(phaseTimings)
    .filter(([, ms]) => ms !== undefined)
    .map(([k, ms]) => `${phaseLabels[k] ?? k} ${formatDuration(ms)}`)
    .join("  ");
  if (phaseLines) {
    console.error(c.dim(`Per phase:  ${phaseLines}`));
  }
  console.error(`Elapsed:    ${c.dim(totalTimer.elapsed())}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
