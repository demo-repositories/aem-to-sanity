#!/usr/bin/env node
import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import {
  AemFetchError,
  applyFixturesFromEnv,
  createColors,
  ensureExtractedContentFile,
  extractedContentExists,
  aemCacheContentRoot,
  fetchInfinityTree,
  resolveConfig,
  startTimer,
  type AmbiguousResolution,
} from "aem-to-sanity-core";

// Roots file format:
//   @base /content/site/us/en   → sets base for lines that follow
//   home                        → relative, resolved to <base>/home
//   plans/consumer/phones/foo   → relative + nested, resolved to <base>/plans/consumer/phones/foo
//   /content/other/top          → absolute, slug = last segment
//   # ...                       → comment (inline after `#` also ignored)
//
// For both relative and absolute entries, `slug` is the last segment of the
// resolved JCR path. So `plans/consumer/phones/experience-beyond-plan` joined
// onto `@base /content/uxp/us/en` yields jcrPath
// `/content/uxp/us/en/plans/consumer/phones/experience-beyond-plan` with
// slug `experience-beyond-plan` — matching AEM's own page-slug semantics.
//
// Each entry also records `relativePath` — the path relative to its `@base`,
// exactly as authored in the roots file (`plans/consumer/phones/...`).
// Absolute entries get one too when they sit under the active `@base`.
// `aem-transform` uses it as `slug.current` when
// `MIGRATION_SLUG_STRATEGY=path`, so nested pages keep their full sub-path
// in the slug instead of collapsing to the last segment.

interface RootEntry {
  jcrPath: string;
  slug?: string;
  relativePath?: string;
}

function parseRoots(raw: string): RootEntry[] {
  const out: RootEntry[] = [];
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
      const jcrPath = line.replace(/\/+$/, "");
      const relativePath =
        base && jcrPath.startsWith(`${base}/`) ? jcrPath.slice(base.length + 1) : undefined;
      out.push({ jcrPath, slug: lastSegment(jcrPath), relativePath });
      continue;
    }
    if (!base) {
      throw new Error(`Relative slug ${JSON.stringify(line)} needs an @base above it.`);
    }
    // Relative — may be a single slug (`home`) or a nested path
    // (`customer-support/plans/consumer/phones/foo`). Tolerate a leading
    // `./` and trim surrounding slashes so the join produces exactly one
    // separator between base and tail.
    const cleaned = line
      .replace(/^\.\//, "")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");
    if (!cleaned) {
      throw new Error(`Empty relative entry under @base ${JSON.stringify(base)}.`);
    }
    const jcrPath = `${base}/${cleaned}`;
    out.push({ jcrPath, slug: lastSegment(jcrPath), relativePath: cleaned });
  }
  return out;
}

function stripComment(line: string): string {
  const i = line.indexOf("#");
  return i === -1 ? line : line.slice(0, i);
}

function lastSegment(path: string): string | undefined {
  const i = path.lastIndexOf("/");
  return i < 0 || i === path.length - 1 ? undefined : path.slice(i + 1);
}

type FailureCategory = "notFound" | "ambiguous" | "auth" | "tooLarge" | "other";

function categorize(err: unknown): FailureCategory {
  // Prefer structured fields when we have them — message text is a fragile
  // signal. AemFetchError("auth") comes with details.status=401|403 and a
  // message like "Authentication failed (401) for ..." which the old
  // string-sniffing regex (`http 401`) missed entirely.
  if (err instanceof AemFetchError) {
    if (err.kind === "auth") return "auth";
    if (err.kind === "tooLarge") return "tooLarge";
    const status = err.details?.status;
    if (status === 404) return "notFound";
    if (status === 300) return "ambiguous";
    if (status === 401 || status === 403) return "auth";
  }
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (m.includes("http 404")) return "notFound";
  if (m.includes("http 300")) return "ambiguous";
  if (m.includes("http 401") || m.includes("http 403")) return "auth";
  if (m.includes("too large")) return "tooLarge";
  return "other";
}

async function main(): Promise<void> {
  const timer = startTimer();
  const c = createColors({ stream: process.stderr });
  const config = await resolveConfig(process.env);
  const outputDir = resolve(process.env.OUTPUT_DIR ?? "./output");
  const rootsFile = resolve(process.env.AEM_CONTENT_ROOTS_FILE ?? "./aem-content-roots");
  const overwrite = process.argv.includes("--overwrite");
  const maxBytes = numEnv("AEM_MAX_RESPONSE_MB", (mb) => mb * 1024 * 1024);

  const entries = parseRoots(readFileSync(rootsFile, "utf8"));
  if (entries.length === 0) {
    console.error(`No roots in ${rootsFile}.`);
    process.exit(2);
  }

  const contentDir = aemCacheContentRoot(outputDir);
  mkdirSync(contentDir, { recursive: true });

  console.error(`[extract] ${entries.length} root(s) from ${config.baseUrl} → ${contentDir}`);

  const ambiguous: Array<{ rootPath: string; resolution: AmbiguousResolution }> = [];
  const failures: Array<{ rootPath: string; message: string; category: FailureCategory }> = [];
  const depthExpansions: Array<{
    rootPath: string;
    markersFound: number;
    markersResolved: number;
    markersTruncated: number;
    markersFailed: number;
    expansionsUsed: number;
  }> = [];
  let downloaded = 0;
  let skipped = 0;

  const maxDepthExpansions = numEnv("AEM_MAX_DEPTH_EXPANSIONS");

  for (const entry of entries) {
    if (!overwrite && extractedContentExists(outputDir, entry.jcrPath)) {
      skipped++;
      continue;
    }
    try {
      const { tree, stats } = await fetchInfinityTree(applyFixturesFromEnv({ config }), entry.jcrPath, {
        maxResponseBytes: maxBytes,
        onAmbiguous: (resolution) => ambiguous.push({ rootPath: entry.jcrPath, resolution }),
        maxDepthExpansions,
      });
      if (
        stats.markersFound > 0 ||
        stats.markersResolved > 0 ||
        stats.markersTruncated > 0 ||
        stats.markersFailed > 0
      ) {
        depthExpansions.push({
          rootPath: entry.jcrPath,
          markersFound: stats.markersFound,
          markersResolved: stats.markersResolved,
          markersTruncated: stats.markersTruncated,
          markersFailed: stats.markersFailed,
          expansionsUsed: stats.expansionsUsed,
        });
      }
      const file = ensureExtractedContentFile(outputDir, entry.jcrPath);
      writeFileSync(
        file,
        JSON.stringify(
          {
            jcrPath: entry.jcrPath,
            slug: entry.slug,
            relativePath: entry.relativePath,
            fetchedAt: new Date().toISOString(),
            tree,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      downloaded++;
    } catch (err) {
      const message = err instanceof AemFetchError ? err.message : (err as Error).message;
      failures.push({ rootPath: entry.jcrPath, message, category: categorize(err) });
    }
  }

  const totalMarkersFound = depthExpansions.reduce((a, d) => a + d.markersFound, 0);
  const totalMarkersResolved = depthExpansions.reduce((a, d) => a + d.markersResolved, 0);
  const totalMarkersTruncated = depthExpansions.reduce((a, d) => a + d.markersTruncated, 0);
  const totalMarkersFailed = depthExpansions.reduce((a, d) => a + d.markersFailed, 0);

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    summary: {
      total: entries.length,
      downloaded,
      skipped,
      failed: failures.length,
      ambiguous: ambiguous.length,
      notFound: failures.filter((f) => f.category === "notFound").length,
      auth: failures.filter((f) => f.category === "auth").length,
      tooLarge: failures.filter((f) => f.category === "tooLarge").length,
      other: failures.filter((f) => f.category === "other").length,
      markersFound: totalMarkersFound,
      markersResolved: totalMarkersResolved,
      markersTruncated: totalMarkersTruncated,
      markersFailed: totalMarkersFailed,
    },
    ambiguous,
    depthExpansions,
    failures,
  };
  const reportFile = join(outputDir, "cache", "extract-report.json");
  mkdirSync(dirname(reportFile), { recursive: true });
  writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n", "utf8");

  const notFound = failures.filter((f) => f.category === "notFound");
  const notFoundLog = join(outputDir, "cache", "extract-404.log");
  if (notFound.length > 0) {
    const lines = notFound.map((f) => `${f.rootPath}\t${config.baseUrl}${f.rootPath}.infinity.json`);
    writeFileSync(notFoundLog, lines.join("\n") + "\n", "utf8");
  }

  console.error(c.dim("────────────────────────────────────────"));
  console.error(`Downloaded:  ${c.green(downloaded)}   Skipped: ${c.dim(skipped)}   Failed: ${failures.length > 0 ? c.yellow(failures.length) : c.green(0)}`);
  if (ambiguous.length > 0) console.error(`Ambiguous:   ${c.yellow(ambiguous.length)} ${c.dim("(HTTP 300 — see extract-report.json)")}`);
  if (totalMarkersFound > 0) {
    const resolvedColor = totalMarkersTruncated === 0 && totalMarkersFailed === 0 ? c.green : c.yellow;
    console.error(
      `Depth splice: ${resolvedColor(totalMarkersResolved)}/${totalMarkersFound} markers resolved` +
        (totalMarkersTruncated > 0 ? `, ${c.yellow(totalMarkersTruncated)} truncated (maxDepth)` : "") +
        (totalMarkersFailed > 0 ? `, ${c.yellow(totalMarkersFailed)} failed` : ""),
    );
  }
  console.error(`Report:      ${c.dim(reportFile)}`);
  if (notFound.length > 0) console.error(`404 log:     ${c.dim(notFoundLog)} ${c.dim(`(${notFound.length} entries)`)}`);
  console.error(`Elapsed:     ${c.dim(timer.elapsed())}`);

  if (failures.length > 0) {
    console.error("");
    const byCat = new Map<string, typeof failures>();
    for (const f of failures) {
      const list = byCat.get(f.category) ?? [];
      list.push(f);
      byCat.set(f.category, list);
    }
    const LABEL: Record<string, string> = {
      auth: "Authentication (check AEM_AUTHOR_USERNAME / AEM_AUTHOR_PASSWORD or AEM_TOKEN)",
      tooLarge: "Response too large (raise AEM_MAX_RESPONSE_MB or skip page)",
      notFound: "Not found (remove from roots file or fix @base)",
      ambiguous: "Ambiguous path (HTTP 300 — path may point at a folder)",
      other: "Other",
    };
    for (const [cat, list] of byCat) {
      console.error(c.bold(LABEL[cat] ?? cat) + c.dim(` (${list.length})`));
      // 404s go to extract-404.log; other categories get listed inline since they need attention.
      if (cat === "notFound") continue;
      for (const f of list) console.error(`  ${f.rootPath}  ${c.dim(f.message.replace(/\s+/g, " ").slice(0, 140))}`);
    }
    if (downloaded === 0) process.exit(1);
  }
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

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
