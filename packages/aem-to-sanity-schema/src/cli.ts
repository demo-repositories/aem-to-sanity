#!/usr/bin/env node
import "dotenv/config";
import { readFile } from "node:fs/promises";
import {
  DialogNodeSchema,
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
  if (componentPaths.length === 0) {
    logger.error(`No component paths in ${config.componentPathsFile}`);
    process.exit(1);
  }

  logger.info(
    `Migrating ${componentPaths.length} component(s) from ${config.baseUrl} [env=${config.env}, auth=${config.auth.kind}]`,
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
    componentPaths,
    fetcher,
    outputDir: config.outputDir,
    concurrency: config.concurrency,
    logger,
    docsOutputFile: "./docs/aem-to-sanity-mapping.md",
  });

  const s = report.summary();
  const unmappedCount = Object.keys(s.unmappedTypes).length;

  logger.info("────────────────────────────────────────");
  logger.info(`Emitted:             ${s.successes} / ${s.total} component(s)`);
  logger.info(`Failed:              ${s.failures}`);
  logger.info(`Unmapped AEM types:  ${unmappedCount}`);
  logger.info(`Report:              ${reportFile}`);
  logger.info("────────────────────────────────────────");

  if (s.failures > 0) {
    const failures = report.results.filter(
      (r): r is Extract<typeof r, { status: "failure" }> =>
        r.status === "failure",
    );
    const pathWidth = Math.min(
      60,
      failures.reduce((w, f) => Math.max(w, f.path.length), 0),
    );
    logger.error(`${failures.length} component(s) failed:`);
    failures.forEach((f, i) => {
      const n = String(i + 1).padStart(2, " ");
      const path = f.path.padEnd(pathWidth, " ");
      const kind = `[${f.kind}]`.padEnd(14, " ");
      const msg = f.message.replace(/\s+/g, " ").slice(0, 140);
      logger.error(`  ${n}. ${path}  ${kind} ${msg}`);
    });
    logger.error(
      `Full details (including response bodies) in ${reportFile} under results[].`,
    );
    process.exit(1);
  }
}

async function readComponentPaths(file: string): Promise<string[]> {
  const raw = await readFile(file, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
