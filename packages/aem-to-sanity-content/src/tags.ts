#!/usr/bin/env node
/**
 * Export the AEM tag tree (rooted at `/content/cq:tags`) into Sanity
 * `category` documents that match the parent-child taxonomy pattern from
 * https://www.sanity.io/docs/developer-guides/parent-child-taxonomy.
 *
 * Pipeline ordering:
 *
 *   aem-extract   → cache/aem/content page trees
 *   aem-tags      → cache/aem/content tag trees + category docs + manifest
 *   aem-transform → rewrites authored `cq:tags` strings on pages into
 *                   `_type:"reference"` arrays using the manifest
 *   aem-assets    → DAM uploads
 *   aem-import    → publishes pages + categories
 *
 * Outputs:
 *
 *   output/cache/categories/<sanityCategoryId>.json   — one Sanity category
 *     doc per `cq:Tag` node, shaped `{ jcrPath, docs: [categoryDoc] }` so
 *     `aem-import` can ingest it through the same code path that handles
 *     page docs.
 *   output/cache/categories/manifest.json             — keyed by AEM tag id
 *     (`namespace:parent/child` or `parent/child` for default namespace).
 *     Value: `{ sanityCategoryId, title, slug, parentTagId, isNamespace,
 *     movedTo? }`. The transform stage reads this to resolve content-side
 *     tag references; we never re-walk AEM during transform.
 *   output/cache/tags-report.json                     — summary mirroring
 *     `extract-report.json` (totals, failures, depth-splicing stats).
 *
 * Allowlist: only namespaces (and subtrees) listed in `./aem-tag-roots` are
 * walked. There is no canonical "always skip" set in AEM — sample-content
 * namespaces like `wknd` or `we-retail` are simply absent from the roots
 * file. Documented this way to avoid a denylist that drifts out of date.
 *
 * Depth handling: AEM's `.infinity.json` on the tag tree often returns
 * namespaces without their children (we saw this on `/content/cq:tags`
 * against the davids-bridal AEMaaCS instance — 42 namespaces came back but
 * each one had no nested `cq:Tag` children, even though they exist).
 * `fetchInfinityTree` walks the depth-5 markers with follow-up requests, so
 * we get the full tree regardless of where AEM truncates. Operators list
 * namespaces or specific subtrees — the walker fetches each independently
 * and gets the entire descendant chain from there.
 */
import "./load-env.ts";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  AemFetchError,
  applyFixturesFromEnv,
  createColors,
  ensureExtractedContentFile,
  extractedContentExists,
  aemCacheContentRoot,
  resolveExtractedContentFile,
  fetchInfinityTree,
  resolveConfig,
  startTimer,
} from "aem-to-sanity-core";

const TAGS_ROOT = "/content/cq:tags";
const DEFAULT_NAMESPACE = "default";

interface SanityCategoryDoc {
  _id: string;
  _type: "category";
  title: string;
  slug: { _type: "slug"; current: string };
  tagId: string;
  parent?: { _type: "reference"; _ref: string };
  description?: string;
}

interface CategoryFile {
  jcrPath: string;
  docs: [SanityCategoryDoc];
}

interface ManifestEntry {
  sanityCategoryId: string;
  title: string;
  slug: string;
  parentTagId: string | null;
  isNamespace: boolean;
  /**
   * When AEM has redirected this tag id to another (`cq:movedTo`), the
   * transform stage follows the alias chain to resolve content-side
   * references. We don't emit a Sanity category for moved tags — the
   * tombstone exists only to bridge stale references.
   */
  movedTo?: string;
}

type Manifest = Record<string, ManifestEntry>;

/**
 * Roots file format mirrors `aem-content-roots`:
 *   @base /content/cq:tags
 *   promotion
 *   page-type
 *   /content/cq:tags/wknd       # absolute paths also OK
 *
 * Unlike content roots, we don't care about slugs — only the absolute path.
 */
function parseTagRoots(raw: string): string[] {
  const out: string[] = [];
  let base: string | undefined;
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;
    if (line.startsWith("@base")) {
      const rest = line.slice(5).trim();
      if (!rest.startsWith("/")) {
        throw new Error(`@base must be an absolute path, got ${JSON.stringify(rest)}`);
      }
      base = rest.replace(/\/+$/, "");
      continue;
    }
    if (line.startsWith("/")) {
      out.push(line.replace(/\/+$/, ""));
      continue;
    }
    if (!base) {
      throw new Error(
        `Relative tag root ${JSON.stringify(line)} needs an @base above it.`,
      );
    }
    const cleaned = line.replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "");
    out.push(`${base}/${cleaned}`);
  }
  return out;
}

function stripComment(line: string): string {
  const i = line.indexOf("#");
  return i === -1 ? line : line.slice(0, i);
}

/**
 * `/content/cq:tags/promotion/payout/recurring-device-credits`
 *   → `promotion:payout/recurring-device-credits`
 * `/content/cq:tags/promotion`
 *   → `promotion`                       (namespace node)
 * `/content/cq:tags/default/color/red`
 *   → `color/red`                       (default-namespace tags omit the prefix)
 * `/content/cq:tags/default`
 *   → `default`                         (the namespace node itself keeps its name)
 *
 * Adobe's canonical model: a namespace is a `cq:Tag` whose parent is not a
 * `cq:Tag` (i.e. direct child of `/content/cq:tags`). The default namespace
 * is the same kind of node, but content references under it drop the
 * `default:` prefix per AEM's reference syntax.
 */
export function tagPathToAemId(jcrPath: string): string {
  if (!jcrPath.startsWith(`${TAGS_ROOT}/`)) {
    throw new Error(`Tag path ${jcrPath} does not live under ${TAGS_ROOT}`);
  }
  const rel = jcrPath.slice(TAGS_ROOT.length + 1);
  if (!rel) {
    throw new Error(`Refusing to emit a category for the tag root itself`);
  }
  const parts = rel.split("/");
  const ns = parts[0]!;
  const rest = parts.slice(1).join("/");
  if (ns === DEFAULT_NAMESPACE) {
    return rest || DEFAULT_NAMESPACE;
  }
  if (!rest) return ns;
  return `${ns}:${rest}`;
}

/**
 * AEM tag id → deterministic Sanity `_id`. Same long-path strategy as
 * `pathToDocId` in `transform.ts`: hyphenate, lowercase, hash-truncate if
 * >80 chars so we stay under Sanity's 128-char id limit even for deep tag
 * trees. Hyphen separator (not `.`) keeps the doc publicly readable on the
 * CDN — same reasoning as `pathToDocId`'s rule.
 *
 * Idempotency: this function is the contract between the tag-export phase
 * and the content-transform phase. Both compute the id from the same AEM
 * tag id string, so they always agree without coordination.
 */
export function aemIdToSanityCategoryId(aemId: string): string {
  const sanitized = aemId
    .replace(/:/g, "-")
    .replace(/\//g, "-")
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const id = `category-${sanitized}`;
  if (id.length <= 80) return id;
  const hash = createHash("sha1").update(aemId).digest("hex").slice(0, 10);
  return `${id.slice(0, 60).replace(/-+$/, "")}-${hash}`;
}

function parentJcrPath(jcrPath: string): string | undefined {
  const i = jcrPath.lastIndexOf("/");
  if (i <= 0) return undefined;
  const parent = jcrPath.slice(0, i);
  if (parent === TAGS_ROOT) return undefined; // namespace; no category parent
  return parent;
}

function lastSegment(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

interface CqTagNode {
  "jcr:primaryType"?: unknown;
  "jcr:title"?: unknown;
  "jcr:description"?: unknown;
  "cq:movedTo"?: unknown;
  [key: string]: unknown;
}

function isCqTag(node: CqTagNode): boolean {
  return node["jcr:primaryType"] === "cq:Tag";
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  // `fetchInfinityTree` replaces unresolved descendants with this sentinel
  // shape; treat them as opaque so we don't try to walk into them.
  if ((value as { __truncated?: unknown }).__truncated !== undefined) {
    return false;
  }
  return true;
}

interface CollectedTag {
  jcrPath: string;
  aemId: string;
  sanityCategoryId: string;
  title: string;
  description?: string;
  slug: string;
  parentAemId: string | null;
  parentSanityCategoryId: string | null;
  isNamespace: boolean;
  movedTo?: string;
}

/**
 * Walk a tag subtree (rooted at the path the operator put in
 * `aem-tag-roots`) and collect one `CollectedTag` per `cq:Tag` node. The
 * root node itself is included if it's a `cq:Tag` — operators usually point
 * at a namespace (e.g. `/content/cq:tags/promotion`) and expect that
 * namespace to appear as a category too, so authors get the whole tree in
 * the Studio reference picker.
 */
function collectTags(tree: unknown, rootPath: string): CollectedTag[] {
  const out: CollectedTag[] = [];
  if (!isPlainObject(tree)) return out;
  const stack: Array<{ node: Record<string, unknown>; jcrPath: string }> = [
    { node: tree, jcrPath: rootPath },
  ];
  while (stack.length > 0) {
    const frame = stack.pop()!;
    const node = frame.node as CqTagNode;
    if (isCqTag(node)) {
      const aemId = tagPathToAemId(frame.jcrPath);
      const parentPath = parentJcrPath(frame.jcrPath);
      const parentAemId = parentPath ? tagPathToAemId(parentPath) : null;
      out.push({
        jcrPath: frame.jcrPath,
        aemId,
        sanityCategoryId: aemIdToSanityCategoryId(aemId),
        title:
          asString(node["jcr:title"]) ?? deriveFallbackTitle(lastSegment(frame.jcrPath)),
        description: asString(node["jcr:description"]),
        slug: lastSegment(frame.jcrPath),
        parentAemId,
        parentSanityCategoryId: parentAemId
          ? aemIdToSanityCategoryId(parentAemId)
          : null,
        isNamespace: parentPath === undefined,
        movedTo: asString(node["cq:movedTo"]),
      });
    }
    // Recurse into children regardless of whether the parent is a cq:Tag —
    // namespace nodes are themselves cq:Tag, and the tag root (cq:Folder) is
    // not. Either way we want to descend.
    for (const [key, value] of Object.entries(node)) {
      if (!isPlainObject(value)) continue;
      if (key.startsWith("jcr:") || key.startsWith("cq:") || key.startsWith("sling:")) {
        // JCR/Sling metadata buckets (mixin types, replication status, etc.).
        // Never tag children.
        continue;
      }
      stack.push({ node: value, jcrPath: `${frame.jcrPath}/${key}` });
    }
  }
  return out;
}

/**
 * Fallback title for a `cq:Tag` with no `jcr:title`. AEM tag picker shows
 * the node name in that case; we title-case it so the Studio reference
 * picker is readable. Conservative — just replaces `-`/`_` with spaces and
 * uppercases each word. Not trying to be cute about acronyms.
 */
function deriveFallbackTitle(name: string): string {
  return name
    .replace(/[-_]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

function toCategoryDoc(t: CollectedTag): SanityCategoryDoc {
  const doc: SanityCategoryDoc = {
    _id: t.sanityCategoryId,
    _type: "category",
    title: t.title,
    slug: { _type: "slug", current: t.slug },
    tagId: t.aemId,
  };
  if (t.description) doc.description = t.description;
  if (t.parentSanityCategoryId) {
    doc.parent = { _type: "reference", _ref: t.parentSanityCategoryId };
  }
  return doc;
}

function encodeFilename(sanityCategoryId: string): string {
  return `${sanityCategoryId}.json`;
}

type FailureCategory = "notFound" | "auth" | "tooLarge" | "other";

function categorize(err: unknown): FailureCategory {
  if (err instanceof AemFetchError) {
    if (err.kind === "auth") return "auth";
    if (err.kind === "tooLarge") return "tooLarge";
    const status = err.details?.status;
    if (status === 404) return "notFound";
    if (status === 401 || status === 403) return "auth";
  }
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (m.includes("http 404")) return "notFound";
  if (m.includes("http 401") || m.includes("http 403")) return "auth";
  if (m.includes("too large")) return "tooLarge";
  return "other";
}

function numEnv(name: string, transform: (n: number) => number = (n) => n): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`${name} must be a positive number, got ${JSON.stringify(raw)}`);
    process.exit(2);
  }
  return transform(n);
}

async function main(): Promise<void> {
  const timer = startTimer();
  const c = createColors({ stream: process.stderr });
  const config = await resolveConfig(process.env);
  const outputDir = resolve(process.env.OUTPUT_DIR ?? "./output");
  const rootsFile = resolve(process.env.AEM_TAG_ROOTS_FILE ?? "./aem-tag-roots");
  const overwrite = process.argv.includes("--overwrite");
  const maxBytes = numEnv("AEM_MAX_RESPONSE_MB", (mb) => mb * 1024 * 1024);
  const maxDepthExpansions = numEnv("AEM_MAX_DEPTH_EXPANSIONS");

  // Tags are an opt-in stage. When the tenant hasn't configured a roots
  // file (or has one with zero entries), exit 0 with a friendly skip
  // message — never block the chained `pnpm migrate` script. Operators who
  // want tag migration will see the skip notice and add the file; everyone
  // else gets a no-op.
  if (!existsSync(rootsFile)) {
    console.error(
      `[tags] No tag roots file at ${rootsFile} — skipping. To migrate AEM tags, create the file (see tenants/template/aem-tag-roots) or set AEM_TAG_ROOTS_FILE.`,
    );
    process.exit(0);
  }
  const roots = parseTagRoots(readFileSync(rootsFile, "utf8"));
  if (roots.length === 0) {
    console.error(`[tags] No tag roots in ${rootsFile} — skipping.`);
    process.exit(0);
  }

  const categoriesDir = join(outputDir, "cache", "categories");
  const contentDir = aemCacheContentRoot(outputDir);
  mkdirSync(categoriesDir, { recursive: true });
  mkdirSync(contentDir, { recursive: true });

  console.error(
    `[tags] ${roots.length} root(s) from ${config.baseUrl} → ${categoriesDir} (cache ${contentDir})`,
  );

  const manifest: Manifest = {};
  const failures: Array<{ rootPath: string; message: string; category: FailureCategory }> = [];
  const depthExpansions: Array<{
    rootPath: string;
    markersFound: number;
    markersResolved: number;
    markersTruncated: number;
    markersFailed: number;
    expansionsUsed: number;
  }> = [];
  let docsWritten = 0;
  let docsSkipped = 0;
  const aliases: Array<{ from: string; to: string }> = [];

  for (const rootPath of roots) {
    try {
      let tree: Record<string, unknown>;
      if (!overwrite && extractedContentExists(outputDir, rootPath)) {
        const cached = JSON.parse(
          readFileSync(resolveExtractedContentFile(outputDir, rootPath), "utf8"),
        ) as { tree?: unknown };
        if (!cached.tree || typeof cached.tree !== "object" || Array.isArray(cached.tree)) {
          throw new Error(`tag cache at ${rootPath} is missing a tree object`);
        }
        tree = cached.tree as Record<string, unknown>;
      } else {
        const fetched = await fetchInfinityTree(
          applyFixturesFromEnv({ config }),
          rootPath,
          { maxResponseBytes: maxBytes, maxDepthExpansions },
        );
        tree = fetched.tree as Record<string, unknown>;
        if (
          fetched.stats.markersFound > 0 ||
          fetched.stats.markersResolved > 0 ||
          fetched.stats.markersTruncated > 0 ||
          fetched.stats.markersFailed > 0
        ) {
          depthExpansions.push({
            rootPath,
            markersFound: fetched.stats.markersFound,
            markersResolved: fetched.stats.markersResolved,
            markersTruncated: fetched.stats.markersTruncated,
            markersFailed: fetched.stats.markersFailed,
            expansionsUsed: fetched.stats.expansionsUsed,
          });
        }
        writeFileSync(
          ensureExtractedContentFile(outputDir, rootPath),
          JSON.stringify(
            {
              jcrPath: rootPath,
              fetchedAt: new Date().toISOString(),
              tree,
            },
            null,
            2,
          ) + "\n",
          "utf8",
        );
      }
      const tags = collectTags(tree, rootPath);
      console.error(
        `  ${c.dim(rootPath)} ${c.dim("→")} ${c.green(tags.length)} tag(s)`,
      );
      for (const t of tags) {
        // Moved tags are tombstones — record them in the manifest as
        // aliases so the transform stage can follow `cq:movedTo`, but
        // don't emit a category doc. AEM rewrites references on move,
        // so this is defensive.
        if (t.movedTo) {
          manifest[t.aemId] = {
            sanityCategoryId: t.sanityCategoryId,
            title: t.title,
            slug: t.slug,
            parentTagId: t.parentAemId,
            isNamespace: t.isNamespace,
            movedTo: t.movedTo,
          };
          aliases.push({ from: t.aemId, to: t.movedTo });
          continue;
        }
        manifest[t.aemId] = {
          sanityCategoryId: t.sanityCategoryId,
          title: t.title,
          slug: t.slug,
          parentTagId: t.parentAemId,
          isNamespace: t.isNamespace,
        };
        const file = join(categoriesDir, encodeFilename(t.sanityCategoryId));
        if (!overwrite && existsSync(file)) {
          docsSkipped++;
          continue;
        }
        const wire: CategoryFile = {
          jcrPath: t.jcrPath,
          docs: [toCategoryDoc(t)],
        };
        writeFileSync(file, JSON.stringify(wire, null, 2) + "\n", "utf8");
        docsWritten++;
      }
    } catch (err) {
      const message = err instanceof AemFetchError ? err.message : (err as Error).message;
      failures.push({ rootPath, message, category: categorize(err) });
    }
  }

  // Sanity check: every parent ref in the manifest should resolve to a tag
  // we also emitted. If a parent's namespace wasn't listed in aem-tag-roots,
  // we'd have a dangling ref. The walker already emits namespaces (since
  // they're cq:Tag too) when they're encountered as the root, but if
  // someone lists `/content/cq:tags/promotion/payout` as a root, the
  // `promotion` namespace itself isn't visited. Log that case so the
  // operator either adds the parent root or accepts the partial tree.
  const danglingParents: Array<{ tagId: string; missingParent: string }> = [];
  for (const [aemId, entry] of Object.entries(manifest)) {
    if (entry.movedTo) continue;
    if (entry.parentTagId && !manifest[entry.parentTagId]) {
      danglingParents.push({ tagId: aemId, missingParent: entry.parentTagId });
    }
  }

  // Manifest is written *after* the doc files so a partial crash doesn't
  // leave operators with an authoritative manifest pointing at files that
  // weren't actually emitted. Same invariant aem-assets relies on.
  const manifestFile = join(categoriesDir, "manifest.json");
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    summary: {
      roots: roots.length,
      categories: Object.values(manifest).filter((e) => !e.movedTo).length,
      aliases: aliases.length,
      docsWritten,
      docsSkipped,
      danglingParents: danglingParents.length,
      failed: failures.length,
      markersFound: depthExpansions.reduce((a, d) => a + d.markersFound, 0),
      markersResolved: depthExpansions.reduce((a, d) => a + d.markersResolved, 0),
      markersTruncated: depthExpansions.reduce((a, d) => a + d.markersTruncated, 0),
      markersFailed: depthExpansions.reduce((a, d) => a + d.markersFailed, 0),
    },
    danglingParents,
    aliases,
    depthExpansions,
    failures,
  };
  const reportFile = join(outputDir, "cache", "tags-report.json");
  writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.error(c.dim("────────────────────────────────────────"));
  console.error(
    `Categories: ${c.green(report.summary.categories)}   Aliases: ${c.dim(aliases.length)}   Failed: ${failures.length > 0 ? c.yellow(failures.length) : c.green(0)}`,
  );
  console.error(
    `Files:      ${c.green(docsWritten)} written, ${c.dim(docsSkipped)} skipped ${c.dim("(use --overwrite to refresh)")}`,
  );
  if (report.summary.markersFound > 0) {
    const truncatedOrFailed =
      report.summary.markersTruncated + report.summary.markersFailed;
    const colorFn = truncatedOrFailed === 0 ? c.green : c.yellow;
    console.error(
      `Depth splice: ${colorFn(report.summary.markersResolved)}/${report.summary.markersFound} markers resolved` +
        (report.summary.markersTruncated > 0
          ? `, ${c.yellow(report.summary.markersTruncated)} truncated`
          : "") +
        (report.summary.markersFailed > 0
          ? `, ${c.yellow(report.summary.markersFailed)} failed`
          : ""),
    );
  }
  if (danglingParents.length > 0) {
    console.error(
      c.yellow(
        `Dangling parent refs: ${danglingParents.length} — the listed tag roots don't cover the full ancestry. ` +
          `Add the missing namespace(s) to ${rootsFile} so the Studio reference picker can render the full tree.`,
      ),
    );
    for (const d of danglingParents.slice(0, 5)) {
      console.error(`  ${c.dim(d.tagId)} ${c.dim("→ parent")} ${c.yellow(d.missingParent)}`);
    }
    if (danglingParents.length > 5) {
      console.error(`  ${c.dim(`(+${danglingParents.length - 5} more — see ${reportFile})`)}`);
    }
  }
  console.error(`Manifest:   ${c.dim(manifestFile)}`);
  console.error(`Report:     ${c.dim(reportFile)}`);
  console.error(`Elapsed:    ${c.dim(timer.elapsed())}`);

  if (failures.length > 0) {
    console.error("");
    const byCat = new Map<string, typeof failures>();
    for (const f of failures) {
      const list = byCat.get(f.category) ?? [];
      list.push(f);
      byCat.set(f.category, list);
    }
    const LABEL: Record<string, string> = {
      auth: "Authentication (check AEM credentials)",
      tooLarge: "Response too large (raise AEM_MAX_RESPONSE_MB or split the root)",
      notFound: "Not found (remove from aem-tag-roots or fix the path)",
      other: "Other",
    };
    for (const [cat, list] of byCat) {
      console.error(c.bold(LABEL[cat] ?? cat) + c.dim(` (${list.length})`));
      for (const f of list) {
        console.error(
          `  ${f.rootPath}  ${c.dim(f.message.replace(/\s+/g, " ").slice(0, 140))}`,
        );
      }
    }
    if (docsWritten === 0 && docsSkipped === 0) process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

/**
 * Load the manifest for downstream consumers (transform, import). Returns
 * an empty object when the file is missing so a tags-less migration still
 * runs — content with `cq:tags` will then surface as unresolved in the
 * transform audit, which is the correct signal.
 */
export function loadCategoryManifest(outputDir: string): Manifest {
  const file = join(outputDir, "cache", "categories", "manifest.json");
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Manifest;
  } catch {
    return {};
  }
}

/**
 * Read every emitted category file (used by `aem-import` to publish them
 * alongside pages). Empty array when the directory doesn't exist yet.
 */
export function readCategoryFiles(outputDir: string): CategoryFile[] {
  const dir = join(outputDir, "cache", "categories");
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "manifest.json")
    .sort();
  return files.map(
    (f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as CategoryFile,
  );
}

export type { Manifest, ManifestEntry, SanityCategoryDoc, CategoryFile };
