#!/usr/bin/env node
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createLogger, resolveConfig } from "aem-to-sanity-core";
import { migrateContent } from "./api.ts";
import {
  createSchemaTypeRegistry,
  type RegistryEntry,
} from "./type-registry.ts";
import { writeAuditReport } from "./audit.ts";
import type { MinimalSanityClient } from "./writer.ts";

interface ParsedArgs {
  rootPaths: string[];
  registryFile: string;
  confirmWrite: boolean;
  includeResourceTypes?: string[];
  audit: boolean;
  auditOutputDir: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const rootPaths: string[] = [];
  let registryFile = "./content-type-registry.json";
  let confirmWrite = false;
  let includeResourceTypes: string[] | undefined;
  let audit = true;
  let auditOutputDir = process.env.OUTPUT_DIR ?? "./output";

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--root") rootPaths.push(args[++i] ?? "");
    else if (a === "--registry") registryFile = args[++i] ?? registryFile;
    else if (a === "--include")
      includeResourceTypes = (args[++i] ?? "").split(",").filter(Boolean);
    else if (a === "--confirm-write") confirmWrite = true;
    else if (a === "--no-audit") audit = false;
    else if (a === "--audit-output")
      auditOutputDir = args[++i] ?? auditOutputDir;
    else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      printHelp();
      process.exit(2);
    }
  }
  if (rootPaths.length === 0) {
    console.error("at least one --root /content/... is required");
    process.exit(2);
  }
  return {
    rootPaths,
    registryFile,
    confirmWrite,
    includeResourceTypes,
    audit,
    auditOutputDir,
  };
}

function printHelp(): void {
  console.log(`aem-to-sanity-content

Usage:
  aem-to-sanity-content --root /content/site/us/en [--root ...] \\
    [--registry ./content-type-registry.json] [--include type1,type2] \\
    [--confirm-write]

Options:
  --root <jcrPath>      AEM subtree to walk. Repeatable.
  --registry <file>     JSON file mapping sling:resourceType → Sanity type.
                        Shape: [{ "resourceType": "...", "sanityType": "..." }]
  --include <types>     Comma-separated allow-list of sling:resourceType.
  --confirm-write       Actually write to Sanity. Default: dry run (NDJSON to stdout).
  --no-audit            Disable the drift auditor (NDJSON to stderr + persisted report).
  --audit-output <dir>  Where to write audit/content-audit.json. Default: $OUTPUT_DIR or ./output.
`);
}

async function main(): Promise<void> {
  const logger = createLogger({ level: "info" });
  const {
    rootPaths,
    registryFile,
    confirmWrite,
    includeResourceTypes,
    audit,
    auditOutputDir,
  } = parseArgs(process.argv);

  const config = resolveConfig(process.env);
  const entries = parseRegistryFile(resolve(registryFile));
  const registry = createSchemaTypeRegistry(entries);

  const sanityClient = confirmWrite
    ? await createSanityClientFromEnv()
    : undefined;

  const result = await migrateContent({
    rootPaths,
    fetcher: { config, logger },
    registry,
    sanityClient,
    includeResourceTypes,
    dryRun: !confirmWrite,
    audit,
    onDoc: (item) => {
      // NDJSON so downstream tooling can pipe through jq / head / etc.
      process.stdout.write(JSON.stringify(item) + "\n");
    },
    logger,
  });

  let auditFile: string | undefined;
  if (result.auditReport) {
    auditFile = await writeAuditReport(resolve(auditOutputDir), result.auditReport);
  }

  logger.info(`migrateContent: done`, {
    extracted: result.extracted,
    written: result.written,
    dryRun: !confirmWrite,
    auditReport: auditFile,
    auditFindings: result.auditReport?.summary.totalFindings,
  });
}

function parseRegistryFile(path: string): RegistryEntry[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (Array.isArray(raw)) return raw as RegistryEntry[];
  if (raw && typeof raw === "object" && "entries" in raw) {
    const entries = (raw as { entries: unknown }).entries;
    if (Array.isArray(entries)) return entries as RegistryEntry[];
  }
  throw new Error(
    `${path}: expected an array of RegistryEntry or { entries: RegistryEntry[] }`,
  );
}

async function createSanityClientFromEnv(): Promise<MinimalSanityClient> {
  const projectId = process.env.SANITY_PROJECT_ID;
  const dataset = process.env.SANITY_DATASET;
  const token = process.env.SANITY_TOKEN;
  const apiVersion = process.env.SANITY_API_VERSION ?? "2024-01-01";
  const missing: string[] = [];
  if (!projectId) missing.push("SANITY_PROJECT_ID");
  if (!dataset) missing.push("SANITY_DATASET");
  if (!token) missing.push("SANITY_TOKEN");
  if (missing.length > 0) {
    throw new Error(
      `--confirm-write requires these env vars: ${missing.join(", ")}`,
    );
  }
  let mod: typeof import("@sanity/client");
  try {
    mod = await import("@sanity/client");
  } catch (err) {
    throw new Error(
      `--confirm-write requires @sanity/client to be installed. ${(err as Error).message}`,
    );
  }
  return mod.createClient({
    projectId,
    dataset,
    token,
    apiVersion,
    useCdn: false,
  }) as unknown as MinimalSanityClient;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
