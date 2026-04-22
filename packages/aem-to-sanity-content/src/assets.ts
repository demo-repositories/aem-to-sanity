#!/usr/bin/env node
import "dotenv/config";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { createColors, resolveConfig, type AuthMode } from "aem-to-sanity-core";

interface SanityRef {
  _type: "image" | "file";
  asset: { _type: "reference"; _ref: string };
}

interface ManifestEntry {
  damPath: string;
  cachedFile?: string;
  fileSize?: number;
  mimeType?: string;
  downloadedAt?: string;
  uploadedAt?: string;
  sanityAssetId?: string;
  sanityRef?: SanityRef;
  status: "cached" | "downloaded" | "failed-download" | "uploaded" | "failed-upload" | "dry-run";
  error?: string;
}

type Manifest = Record<string, ManifestEntry>;

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

function authHeader(auth: AuthMode): string {
  if (auth.kind === "bearer") return `Bearer ${auth.token}`;
  return `Basic ${Buffer.from(`${auth.username}:${auth.password}`, "utf8").toString("base64")}`;
}

async function withRetry<T>(
  label: string,
  attempts: number,
  fn: () => Promise<T>,
): Promise<T> {
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
    const buffer = await withRetry(`download ${damPath}`, 3, async () => {
      const res = await fetch(`${baseUrl}${damPath}`, {
        headers: { Authorization: authHeader(auth) },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return Buffer.from(await res.arrayBuffer());
    });
    writeFileSync(cachedFile, buffer);
    return {
      damPath,
      cachedFile,
      fileSize: buffer.length,
      mimeType: mimeFor(damPath),
      downloadedAt: new Date().toISOString(),
      status: "downloaded",
    };
  } catch (err) {
    return {
      damPath,
      status: "failed-download",
      error: (err as Error).message,
    };
  }
}

async function uploadOne(
  entry: ManifestEntry,
  projectId: string,
  dataset: string,
  token: string,
  apiVersion: string,
): Promise<ManifestEntry> {
  if (!entry.cachedFile) return entry;
  const mimeType = entry.mimeType ?? mimeFor(entry.damPath);
  const kind: "image" | "file" = mimeType.startsWith("image/") ? "image" : "file";
  const route = kind === "image" ? "images" : "files";
  const filename = basename(entry.damPath);
  const url = `https://${projectId}.api.sanity.io/v${apiVersion}/assets/${route}/${dataset}?filename=${encodeURIComponent(filename)}`;

  try {
    const result = await withRetry(`upload ${entry.damPath}`, 3, async () => {
      const body = readFileSync(entry.cachedFile!);
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": mimeType },
        body,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return (await res.json()) as { document: { _id: string } };
    });
    return {
      ...entry,
      status: "uploaded",
      sanityAssetId: result.document._id,
      sanityRef: {
        _type: kind,
        asset: { _type: "reference", _ref: result.document._id },
      },
      uploadedAt: new Date().toISOString(),
    };
  } catch (err) {
    return { ...entry, status: "failed-upload", error: (err as Error).message };
  }
}

// Walk the clean doc, collect every string value that starts with /content/dam/.
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

// Walk the clean doc and replace DAM-path strings with the Sanity asset ref
// object (when we have one). Operates in place.
// Keys ending with `AemPath` hold read-only migrated paths — never replace.
function rewriteDamRefs(
  value: unknown,
  manifest: Manifest,
  /** Object key when `value` is a direct property of a record. */
  propKey?: string,
): unknown {
  if (typeof value === "string") {
    if (value.startsWith("/content/dam/")) {
      if (propKey?.endsWith("AemPath")) return value;
      const hit = manifest[value];
      if (hit?.sanityRef) return hit.sanityRef;
    }
    return value;
  }
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++)
      value[i] = rewriteDamRefs(value[i], manifest, undefined);
    return value;
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj))
    obj[key] = rewriteDamRefs(obj[key], manifest, key) as unknown;
  return obj;
}

function loadManifest(file: string): Manifest {
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf8")) as Manifest;
}

async function main(): Promise<void> {
  const c = createColors({ stream: process.stderr });
  const config = resolveConfig(process.env);
  const outputDir = resolve(process.env.OUTPUT_DIR ?? "./output");
  const cleanDir = join(outputDir, "clean");
  const assetsDir = join(outputDir, "assets");
  const manifestFile = join(assetsDir, "manifest.json");
  const dryRun = process.env.MIGRATION_DRY_RUN !== "false";
  const uploadOnly = process.argv.includes("--upload-only");
  const skipRewrite = process.argv.includes("--no-rewrite");

  mkdirSync(assetsDir, { recursive: true });

  const cleanFiles = readdirSync(cleanDir).filter((f) => f.endsWith(".json")).sort();
  if (cleanFiles.length === 0) {
    console.error(`No clean files in ${cleanDir}. Run \`aem-transform\` first.`);
    process.exit(2);
  }

  // Collect every unique DAM path across every clean doc.
  const damPaths = new Set<string>();
  for (const file of cleanFiles) {
    const doc = JSON.parse(readFileSync(join(cleanDir, file), "utf8")) as unknown;
    collectDamPaths(doc, damPaths);
  }
  const sortedPaths = [...damPaths].sort();

  console.error(
    `[assets] ${c.green(sortedPaths.length)} unique asset(s) across ${c.green(cleanFiles.length)} page(s)`,
  );
  if (dryRun) console.error(c.dim("DRY RUN — set MIGRATION_DRY_RUN=false to upload to Sanity"));

  const manifest = loadManifest(manifestFile);

  // Phase 1: download (sequential — one asset in memory at a time).
  if (!uploadOnly) {
    console.error(c.bold("\n── Download from AEM DAM ──"));
    let n = 0;
    for (const damPath of sortedPaths) {
      n++;
      const existing = manifest[damPath];
      if (existing?.cachedFile && existsSync(existing.cachedFile)) {
        console.error(`  ${c.dim(`${n}/${sortedPaths.length}`)} ${c.dim("cached")}   ${damPath}`);
        continue;
      }
      console.error(`  ${c.dim(`${n}/${sortedPaths.length}`)} ${c.dim("→ ")}       ${damPath}`);
      const entry = await downloadOne(damPath, assetsDir, config.baseUrl, config.auth);
      manifest[damPath] = { ...existing, ...entry };
      writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
    }
  }

  // Phase 2: upload. Dry-run stops here, after manifest reflects local cache.
  console.error(c.bold("\n── Upload to Sanity ──"));
  if (dryRun) {
    console.error(c.dim("  skipped (dry run)"));
  } else {
    const projectId = mustEnv("SANITY_PROJECT_ID");
    const dataset = process.env.SANITY_DATASET ?? "production";
    const token = mustEnv("SANITY_TOKEN");
    const apiVersion = process.env.SANITY_API_VERSION ?? "2024-01-01";
    let n = 0;
    for (const damPath of sortedPaths) {
      n++;
      const entry = manifest[damPath];
      if (!entry?.cachedFile) {
        console.error(`  ${c.dim(`${n}/${sortedPaths.length}`)} ${c.yellow("skip ")} ${damPath}  ${c.dim("(no local file)")}`);
        continue;
      }
      if (entry.sanityAssetId) {
        console.error(`  ${c.dim(`${n}/${sortedPaths.length}`)} ${c.dim("up✓  ")} ${damPath}`);
        continue;
      }
      console.error(`  ${c.dim(`${n}/${sortedPaths.length}`)} ${c.dim("↑ ")}       ${damPath}`);
      manifest[damPath] = await uploadOne(entry, projectId, dataset, token, apiVersion);
      writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
    }
  }

  // Phase 3: rewrite clean docs in place. Safe to re-run; idempotent because
  // once a string is replaced by `{ _type: 'image', ... }` it no longer matches
  // the `/content/dam/` prefix.
  let patched = 0;
  if (!skipRewrite && !dryRun) {
    console.error(c.bold("\n── Rewrite clean docs ──"));
    for (const file of cleanFiles) {
      const filePath = join(cleanDir, file);
      const doc = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
      rewriteDamRefs(doc, manifest);
      writeFileSync(filePath, JSON.stringify(doc, null, 2) + "\n");
      patched++;
    }
  }

  const downloads = Object.values(manifest);
  const stats = {
    totalAssets: sortedPaths.length,
    downloaded: downloads.filter((e) => e.status === "downloaded").length,
    cached: downloads.filter((e) => e.status === "cached").length,
    failedDownload: downloads.filter((e) => e.status === "failed-download").length,
    uploaded: downloads.filter((e) => e.sanityAssetId).length,
    failedUpload: downloads.filter((e) => e.status === "failed-upload").length,
  };

  writeFileSync(
    join(outputDir, "assets-report.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), dryRun, summary: stats }, null, 2) + "\n",
  );

  console.error(c.dim("\n────────────────────────────────────────"));
  console.error(`Downloaded: ${c.green(stats.downloaded)}   Cached: ${c.dim(stats.cached)}   Failed: ${stats.failedDownload > 0 ? c.yellow(stats.failedDownload) : c.green(0)}`);
  console.error(`Uploaded:   ${c.green(stats.uploaded)}   Failed: ${stats.failedUpload > 0 ? c.yellow(stats.failedUpload) : c.green(0)}`);
  if (patched > 0) console.error(`Rewrote:    ${c.green(patched)} clean file(s)`);
  console.error(`Manifest:   ${c.dim(manifestFile)}`);
}

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}`);
    process.exit(2);
  }
  return v;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
