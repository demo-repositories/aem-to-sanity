#!/usr/bin/env node
import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createColors } from "aem-to-sanity-core";

interface AemNode {
  [key: string]: unknown;
  "sling:resourceType"?: string;
  "jcr:uuid"?: string;
}
interface SanityDoc {
  _id: string;
  _type: string;
  [key: string]: unknown;
}
interface RegistryEntry {
  resourceType: string;
  sanityType: string;
  fields?: string[];
}
interface RawFile {
  jcrPath: string;
  slug?: string;
  fetchedAt: string;
  tree: AemNode;
}

const JCR_METADATA = new Set<string>([
  "jcr:primaryType",
  "jcr:mixinTypes",
  "jcr:uuid",
  "jcr:created",
  "jcr:createdBy",
  "jcr:lastModified",
  "jcr:lastModifiedBy",
  "cq:lastModified",
  "cq:lastModifiedBy",
  "cq:lastReplicated",
  "cq:lastReplicatedBy",
  "cq:lastReplicationAction",
  "sling:resourceType",
  "sling:resourceSuperType",
]);

const MAX_DEPTH = 512;

function loadRegistry(path: string): Map<string, RegistryEntry> {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const entries = Array.isArray(raw)
    ? (raw as RegistryEntry[])
    : raw && typeof raw === "object" && Array.isArray((raw as { entries?: unknown }).entries)
      ? ((raw as { entries: RegistryEntry[] }).entries)
      : null;
  if (!entries) {
    throw new Error(`${path}: expected RegistryEntry[] or { entries: RegistryEntry[] }`);
  }
  const map = new Map<string, RegistryEntry>();
  for (const e of entries) map.set(e.resourceType, e);
  return map;
}

function pathToDocId(jcrPath: string): string {
  const normalized = jcrPath.replace(/^\/+/, "");
  const rawSlug = normalized.replace(/\//g, ".");
  const safeSlug = rawSlug.replace(/[^A-Za-z0-9_.-]/g, "-");
  if (safeSlug === rawSlug && safeSlug.length <= 80) return safeSlug;
  const hash = createHash("sha1").update(jcrPath).digest("hex").slice(0, 10);
  return `${safeSlug.slice(0, 60).replace(/[.-]+$/, "")}.${hash}`;
}

function stableKey(jcrUuid: string | undefined, jcrPath: string): string {
  if (jcrUuid && jcrUuid.length > 0) return jcrUuid.replace(/-/g, "").slice(0, 16);
  return createHash("sha1").update(jcrPath).digest("hex").slice(0, 16);
}

// Depth-first walk yielding every node with a `sling:resourceType`. Iterative
// to stay stack-safe on component-heavy pages.
function* walk(root: AemNode, rootPath: string): Generator<{ node: AemNode; jcrPath: string }> {
  const seen = new Set<string>();
  const stack: Array<{ node: AemNode; jcrPath: string }> = [{ node: root, jcrPath: rootPath }];
  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (seen.has(frame.jcrPath)) continue;
    seen.add(frame.jcrPath);
    if (typeof frame.node["sling:resourceType"] === "string") yield frame;
    const entries = Object.entries(frame.node);
    for (let i = entries.length - 1; i >= 0; i--) {
      const [key, value] = entries[i]!;
      if (isChildNode(value)) {
        stack.push({ node: value, jcrPath: `${frame.jcrPath}/${key}` });
      }
    }
  }
}

function isChildNode(value: unknown): value is AemNode {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value as { __truncated?: unknown }).__truncated
  );
}

interface TransformContext {
  visited: WeakSet<object>;
  depth: number;
  registry: Map<string, RegistryEntry>;
  slug: string | undefined;
  audit: Audit;
}

interface TransformResult {
  doc: SanityDoc;
  type: string | undefined;
  resourceType: string | undefined;
}

function transformNode(node: AemNode, jcrPath: string, ctx: TransformContext): TransformResult {
  const resourceType = asString(node["sling:resourceType"]);
  const entry = resourceType ? ctx.registry.get(resourceType) : undefined;
  const type = entry?.sanityType;

  const doc: SanityDoc = { _id: pathToDocId(jcrPath), _type: type ?? "aemUnmapped" };
  if (ctx.slug) doc.slug = { _type: "slug", current: ctx.slug };

  if (ctx.visited.has(node)) {
    ctx.audit.bail(jcrPath, "cycle", ctx.depth);
    doc.__truncated = { reason: "cycle", jcrPath };
    return { doc, type, resourceType };
  }
  ctx.visited.add(node);

  for (const [key, value] of Object.entries(node)) {
    if (JCR_METADATA.has(key)) continue;
    if (doc[key] !== undefined) continue;
    if (isChildNode(value)) {
      const childPath = `${jcrPath}/${key}`;
      if (ctx.depth + 1 > MAX_DEPTH) {
        ctx.audit.bail(childPath, "maxDepth", ctx.depth + 1);
        doc[key] = { __truncated: "maxDepth", jcrPath: childPath };
        continue;
      }
      const child = transformNode(value, childPath, { ...ctx, depth: ctx.depth + 1, slug: undefined });
      const { _id: _unused, ...inline } = child.doc;
      void _unused;
      doc[key] = { ...inline, _key: stableKey(asString(value["jcr:uuid"]), childPath) };
    } else {
      doc[key] = value;
    }
  }

  return { doc, type, resourceType };
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

// Slim audit. Tracks: unknown resource types (with a few example paths),
// unknown props per mapped component, transform bails. One JSON file per run.
interface Audit {
  tick(): void;
  unknownType(resourceType: string, path: string): void;
  unknownProps(component: string, path: string, props: Array<{ prop: string; value: unknown }>): void;
  bail(path: string, reason: "maxDepth" | "cycle", depth: number): void;
  report(): unknown;
}

function createAudit(maxExamples = 3): Audit {
  let totalDocs = 0;
  let totalFindings = 0;
  const unknownTypes = new Map<string, string[]>();
  const unknownProps = new Map<string, Map<string, Array<{ path: string; value: unknown }>>>();
  const bails: Array<{ path: string; reason: string; depth: number }> = [];

  function bump<T>(list: T[], item: T): void {
    if (list.length < maxExamples) list.push(item);
  }

  return {
    tick: () => void totalDocs++,
    unknownType(resourceType, path) {
      totalFindings++;
      let list = unknownTypes.get(resourceType);
      if (!list) {
        list = [];
        unknownTypes.set(resourceType, list);
      }
      bump(list, path);
    },
    unknownProps(component, path, props) {
      totalFindings++;
      let comp = unknownProps.get(component);
      if (!comp) {
        comp = new Map();
        unknownProps.set(component, comp);
      }
      for (const { prop, value } of props) {
        let examples = comp.get(prop);
        if (!examples) {
          examples = [];
          comp.set(prop, examples);
        }
        bump(examples, { path, value });
      }
    },
    bail(path, reason, depth) {
      totalFindings++;
      bump(bails, { path, reason, depth });
    },
    report() {
      return {
        summary: {
          totalDocs,
          totalFindings,
          unknownTypes: unknownTypes.size,
          componentsWithUnknownProps: unknownProps.size,
          transformBails: bails.length,
        },
        unknownResourceTypes: [...unknownTypes.entries()].map(([resourceType, examples]) => ({
          resourceType,
          examples,
        })),
        unknownPropsByComponent: Object.fromEntries(
          [...unknownProps.entries()].map(([component, props]) => [
            component,
            [...props.entries()].map(([prop, examples]) => ({ prop, examples })),
          ]),
        ),
        transformBails: bails,
      };
    },
  };
}

function diffProps(node: AemNode, entry: RegistryEntry | undefined): Array<{ prop: string; value: unknown }> {
  if (!entry?.fields) return [];
  const expected = new Set(entry.fields);
  const out: Array<{ prop: string; value: unknown }> = [];
  for (const [key, value] of Object.entries(node)) {
    if (JCR_METADATA.has(key)) continue;
    if (expected.has(key)) continue;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) continue;
    out.push({ prop: key, value });
  }
  return out;
}

function main(): void {
  const c = createColors({ stream: process.stderr });
  const outputDir = resolve(process.env.OUTPUT_DIR ?? "./output");
  const registryFile = resolve(getFlag("--registry") ?? "./content-type-registry.json");
  const include = getFlag("--include")?.split(",").filter(Boolean);
  const allowed = include ? new Set(include) : undefined;

  const registry = loadRegistry(registryFile);
  const rawDir = join(outputDir, "raw");
  const cleanDir = join(outputDir, "clean");
  mkdirSync(cleanDir, { recursive: true });

  const rawFiles = readdirSync(rawDir).filter((f) => f.endsWith(".json")).sort();
  if (rawFiles.length === 0) {
    console.error(`No raw files in ${rawDir}. Run \`aem-extract\` first.`);
    process.exit(2);
  }

  console.error(`[transform] ${rawFiles.length} raw file(s) → ${cleanDir}`);

  const audit = createAudit();
  let pagesWritten = 0;
  let docsEmitted = 0;

  for (const file of rawFiles) {
    let raw: RawFile;
    try {
      raw = JSON.parse(readFileSync(join(rawDir, file), "utf8")) as RawFile;
    } catch (err) {
      console.error(`[transform] skip ${file}: ${(err as Error).message}`);
      continue;
    }

    const { jcrPath, slug, tree } = raw;
    const slugByPath = slug
      ? new Map([[jcrPath, slug], [`${jcrPath}/jcr:content`, slug]])
      : undefined;

    const docs: SanityDoc[] = [];
    for (const { node, jcrPath: nodePath } of walk(tree, jcrPath)) {
      const resourceType = node["sling:resourceType"] as string;
      if (allowed && !allowed.has(resourceType)) continue;

      const ctx: TransformContext = {
        visited: new WeakSet(),
        depth: 0,
        registry,
        slug: slugByPath?.get(nodePath),
        audit,
      };

      let result: TransformResult;
      try {
        result = transformNode(node, nodePath, ctx);
      } catch (err) {
        console.error(`[transform] ${nodePath}: ${(err as Error).message}`);
        continue;
      }

      audit.tick();
      const entry = registry.get(resourceType);
      if (!result.type) audit.unknownType(resourceType, nodePath);
      const drift = diffProps(node, entry);
      if (drift.length > 0) audit.unknownProps(result.type ?? "aemUnmapped", nodePath, drift);

      if (!result.type) continue;
      docs.push(result.doc);
      docsEmitted++;
    }

    if (docs.length === 0) continue;
    const outFile = join(cleanDir, file);
    writeFileSync(outFile, JSON.stringify({ jcrPath, slug, docs }, null, 2) + "\n", "utf8");
    pagesWritten++;
  }

  const report = audit.report() as { summary: { totalFindings: number } };
  const reportFile = join(outputDir, "transform-report.json");
  writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.error(c.dim("────────────────────────────────────────"));
  console.error(`Pages:     ${c.green(pagesWritten)}`);
  console.error(`Docs:      ${c.green(docsEmitted)}`);
  console.error(
    `Findings:  ${report.summary.totalFindings > 0 ? c.yellow(report.summary.totalFindings) : c.green(0)}  ${c.dim(`→ ${reportFile}`)}`,
  );
}

function getFlag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
