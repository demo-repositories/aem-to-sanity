#!/usr/bin/env node
import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  AemFetchError,
  createColors,
  fetchInfinityJson,
  resolveConfig,
  type AmbiguousResolution,
} from "aem-to-sanity-core";

// Roots file format:
//   @base /content/site/us/en   → sets base for lines that follow
//   home                        → relative slug, resolved to <base>/home
//   /content/other/top          → absolute, slug = last segment
//   # ...                       → comment (inline after `#` also ignored)

interface RootEntry {
  jcrPath: string;
  slug?: string;
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
      out.push({ jcrPath, slug: lastSegment(jcrPath) });
      continue;
    }
    if (!base) {
      throw new Error(`Relative slug ${JSON.stringify(line)} needs an @base above it.`);
    }
    if (line.includes("/")) {
      throw new Error(`Slugs cannot contain "/" (got ${JSON.stringify(line)}). Use an absolute path instead.`);
    }
    out.push({ jcrPath: `${base}/${line}`, slug: line });
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

function encodeFilename(jcrPath: string): string {
  return jcrPath.replace(/^\/+/, "").replace(/[^A-Za-z0-9_-]/g, "_") + ".json";
}

function categorize(message: string): "notFound" | "ambiguous" | "auth" | "tooLarge" | "other" {
  const m = message.toLowerCase();
  if (m.includes("http 404")) return "notFound";
  if (m.includes("http 300")) return "ambiguous";
  if (m.includes("http 401") || m.includes("http 403")) return "auth";
  if (m.includes("too large")) return "tooLarge";
  return "other";
}

async function main(): Promise<void> {
  const c = createColors({ stream: process.stderr });
  const config = resolveConfig(process.env);
  const outputDir = resolve(process.env.OUTPUT_DIR ?? "./output");
  const rootsFile = resolve(process.env.AEM_CONTENT_ROOTS_FILE ?? "./aem-content-roots");
  const overwrite = process.argv.includes("--overwrite");
  const maxBytes = numEnv("AEM_MAX_RESPONSE_MB", (mb) => mb * 1024 * 1024);

  const entries = parseRoots(readFileSync(rootsFile, "utf8"));
  if (entries.length === 0) {
    console.error(`No roots in ${rootsFile}.`);
    process.exit(2);
  }

  const rawDir = join(outputDir, "raw");
  mkdirSync(rawDir, { recursive: true });

  console.error(`[extract] ${entries.length} root(s) from ${config.baseUrl} → ${rawDir}`);

  const ambiguous: Array<{ rootPath: string; resolution: AmbiguousResolution }> = [];
  const failures: Array<{ rootPath: string; message: string; category: ReturnType<typeof categorize> }> = [];
  let downloaded = 0;
  let skipped = 0;

  for (const entry of entries) {
    const file = join(rawDir, encodeFilename(entry.jcrPath));
    if (!overwrite && existsSync(file)) {
      skipped++;
      continue;
    }
    try {
      const tree = await fetchInfinityJson({ config }, entry.jcrPath, undefined, {
        maxResponseBytes: maxBytes,
        onAmbiguous: (resolution) => ambiguous.push({ rootPath: entry.jcrPath, resolution }),
      });
      writeFileSync(
        file,
        JSON.stringify({
          jcrPath: entry.jcrPath,
          slug: entry.slug,
          fetchedAt: new Date().toISOString(),
          tree,
        }) + "\n",
        "utf8",
      );
      downloaded++;
    } catch (err) {
      const message = err instanceof AemFetchError ? err.message : (err as Error).message;
      failures.push({ rootPath: entry.jcrPath, message, category: categorize(message) });
    }
  }

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
    },
    ambiguous,
    failures,
  };
  const reportFile = join(outputDir, "extract-report.json");
  mkdirSync(dirname(reportFile), { recursive: true });
  writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n", "utf8");

  const notFound = failures.filter((f) => f.category === "notFound");
  const notFoundLog = join(outputDir, "extract-404.log");
  if (notFound.length > 0) {
    const lines = notFound.map((f) => `${f.rootPath}\t${config.baseUrl}${f.rootPath}.infinity.json`);
    writeFileSync(notFoundLog, lines.join("\n") + "\n", "utf8");
  }

  console.error(c.dim("────────────────────────────────────────"));
  console.error(`Downloaded:  ${c.green(downloaded)}   Skipped: ${c.dim(skipped)}   Failed: ${failures.length > 0 ? c.yellow(failures.length) : c.green(0)}`);
  if (ambiguous.length > 0) console.error(`Ambiguous:   ${c.yellow(ambiguous.length)} ${c.dim("(HTTP 300 — see extract-report.json)")}`);
  console.error(`Report:      ${c.dim(reportFile)}`);
  if (notFound.length > 0) console.error(`404 log:     ${c.dim(notFoundLog)} ${c.dim(`(${notFound.length} entries)`)}`);

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
