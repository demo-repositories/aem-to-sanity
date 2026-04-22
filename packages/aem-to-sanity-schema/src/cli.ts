#!/usr/bin/env node
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  DialogNodeSchema,
  createColors,
  createLogger,
  fetchInfinityJson,
  resolveConfig,
  type DialogNode,
} from "aem-to-sanity-core";
import { migrateSchemas } from "./api.ts";

async function main(): Promise<void> {
  const config = resolveConfig(process.env);
  const logger = createLogger({ level: "info" });

  const componentPaths = await readComponentPaths(config.componentPathsFile);
  const exceptionsFile = resolve(
    process.env.AEM_COMPONENT_EXCEPTIONS_FILE ?? "./aem-component-exceptions",
  );
  const exceptions = await readExceptionList(exceptionsFile);
  const filtered = applyComponentExceptions(componentPaths, exceptions);

  if (filtered.length === 0) {
    logger.error(
      `No component paths in ${config.componentPathsFile} after applying exceptions.`,
    );
    process.exit(1);
  }

  if (exceptions.size > 0) {
    logger.info(
      `Applied ${exceptions.size} exception(s) from ${exceptionsFile}; ${
        componentPaths.length - filtered.length
      } component(s) ignored.`,
    );
  }

  logger.info(
    `Migrating ${filtered.length} component(s) from ${config.baseUrl} [env=${config.env}, auth=${config.auth.kind}]`,
  );

  const fetcher = (jcrPath: string): Promise<DialogNode> =>
    fetchInfinityJson({ config, logger }, jcrPath, (raw) => {
      const parsed = DialogNodeSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        );
      }
      return parsed.data;
    });

  const { report, reportFile } = await migrateSchemas({
    componentPaths: filtered,
    fetcher,
    outputDir: config.outputDir,
    concurrency: config.concurrency,
    logger,
    docsOutputFile: "./docs/aem-to-sanity-mapping.md",
  });

  const s = report.summary();
  const unmappedCount = Object.keys(s.unmappedTypes).length;
  const c = createColors({ stream: process.stderr });

  const ok = c.green(s.successes);
  const total = c.dim(`/ ${s.total}`);
  const failed = s.failures > 0 ? c.yellow(s.failures) : c.green(0);
  const unmapped = unmappedCount > 0 ? c.yellow(unmappedCount) : c.green(0);
  const sep = c.dim("────────────────────────────────────────");

  logger.info(sep);
  logger.info(`Emitted:             ${ok} ${total} component(s)`);
  logger.info(`Failed:              ${failed}`);
  logger.info(`Unmapped AEM types:  ${unmapped}`);
  logger.info(`Report:              ${c.dim(reportFile)}`);
  logger.info(sep);

  if (s.failures > 0) {
    const failures = report.results.filter(
      (r): r is Extract<typeof r, { status: "failure" }> =>
        r.status === "failure",
    );
    const pathWidth = Math.min(
      60,
      failures.reduce((w, f) => Math.max(w, f.path.length), 0),
    );
    const hasAuthFailure = failures.some((f) => f.kind === "auth");
    const headline = hasAuthFailure
      ? `${failures.length} component(s) failed (auth — aborting):`
      : s.successes === 0
        ? `${failures.length} component(s) failed (no successes — aborting):`
        : `${failures.length} component(s) skipped with errors:`;
    const level = hasAuthFailure || s.successes === 0 ? logger.error : logger.warn;

    level(headline);
    failures.forEach((f, i) => {
      const n = c.dim(String(i + 1).padStart(2, " ") + ".");
      const path = f.path.padEnd(pathWidth, " ");
      const kindPainted = hasAuthFailure || s.successes === 0 ? c.red : c.yellow;
      const kind = kindPainted(`[${f.kind}]`.padEnd(14, " "));
      const msg = c.dim(f.message.replace(/\s+/g, " ").slice(0, 140));
      level(`  ${n} ${path}  ${kind} ${msg}`);
    });
    level(`Full details in ${c.dim(reportFile)} under results[].`);

    if (hasAuthFailure || s.successes === 0) process.exit(1);
    logger.info(
      "Partial-success run. Drop failed paths from the component-paths file (or fix them in AEM) to clean this up.",
    );
  }
}

async function readComponentPaths(file: string): Promise<string[]> {
  const raw = await readFile(file, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

async function readExceptionList(file: string): Promise<Set<string>> {
  try {
    const raw = await readFile(file, "utf8");
    return new Set(
      raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"))
        .map(normalizeExceptionKey),
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw err;
  }
}

function normalizeExceptionKey(v: string): string {
  const trimmed = v.trim().replace(/^\/+/, "");
  if (trimmed.startsWith("apps/")) return trimmed.slice("apps/".length);
  return trimmed;
}

function toResourceTypeFromPath(componentPath: string): string {
  const noLead = componentPath.replace(/^\/+/, "");
  return noLead.startsWith("apps/") ? noLead.slice("apps/".length) : noLead;
}

function applyComponentExceptions(
  componentPaths: string[],
  exceptions: Set<string>,
): string[] {
  if (exceptions.size === 0) return componentPaths;
  return componentPaths.filter((p) => {
    const pathKey = normalizeExceptionKey(p);
    const resourceType = toResourceTypeFromPath(p);
    return !(exceptions.has(pathKey) || exceptions.has(resourceType));
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
