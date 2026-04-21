#!/usr/bin/env node
import "dotenv/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createLogger } from "aem-to-sanity-core";
import { runTypegen } from "./typegen/index.ts";

async function main(): Promise<void> {
  const outputDir = resolve(process.env.OUTPUT_DIR ?? "./output");
  const logger = createLogger({ level: "info" });

  logger.info(`typegen: synthesizing config under ${outputDir}/.typegen`);
  // Resolve `sanity` from this package's own node_modules first — that way the
  // CLI works regardless of where the user ran it from.
  const selfDir = dirname(fileURLToPath(import.meta.url));
  const result = await runTypegen({
    outputDir,
    projectId: process.env.SANITY_PROJECT_ID,
    dataset: process.env.SANITY_DATASET,
    binCwd: selfDir,
    logger,
  });
  logger.info(`typegen: done`, {
    types: result.typesFile,
    schemaJson: result.schemaJsonFile,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
