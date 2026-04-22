#!/usr/bin/env node
import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createColors } from "aem-to-sanity-core";

interface SanityDoc {
  _id: string;
  _type: string;
  [key: string]: unknown;
}
interface CleanFile {
  jcrPath: string;
  slug?: string;
  docs: SanityDoc[];
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env var: ${name}`);
    process.exit(2);
  }
  return v;
}

async function main(): Promise<void> {
  const c = createColors({ stream: process.stderr });
  const outputDir = resolve(process.env.OUTPUT_DIR ?? "./output");
  const cleanDir = join(outputDir, "clean");
  const dryRun = process.env.MIGRATION_DRY_RUN !== "false";

  const files = readdirSync(cleanDir).filter((f) => f.endsWith(".json")).sort();
  if (files.length === 0) {
    console.error(`No clean files in ${cleanDir}. Run \`aem-transform\` first.`);
    process.exit(2);
  }

  let client: unknown = undefined;
  if (!dryRun) {
    const projectId = requireEnv("SANITY_PROJECT_ID");
    const dataset = requireEnv("SANITY_DATASET");
    const token = requireEnv("SANITY_TOKEN");
    const apiVersion = process.env.SANITY_API_VERSION ?? "2024-01-01";
    const mod = await import("@sanity/client").catch((err) => {
      throw new Error(`@sanity/client is required to import. ${(err as Error).message}`);
    });
    client = mod.createClient({ projectId, dataset, token, apiVersion, useCdn: false });
  }

  console.error(
    `[import] ${files.length} page(s) ${dryRun ? c.dim("(DRY RUN — set MIGRATION_DRY_RUN=false to commit)") : c.bold("→ Sanity")}`,
  );

  let pages = 0;
  let docs = 0;
  for (const file of files) {
    const clean = JSON.parse(readFileSync(join(cleanDir, file), "utf8")) as CleanFile;
    if (clean.docs.length === 0) continue;
    if (!dryRun && client) {
      const tx = (client as SanityClientLike).transaction();
      for (const doc of clean.docs) tx.createOrReplace(doc);
      await tx.commit();
    }
    pages++;
    docs += clean.docs.length;
    console.error(
      `  ${c.dim(clean.jcrPath)} ${c.dim("→")} ${c.green(clean.docs.length)} doc(s)`,
    );
  }

  console.error(c.dim("────────────────────────────────────────"));
  console.error(
    `${dryRun ? c.dim("Would commit") : c.green("Committed")}: ${c.green(pages)} page(s), ${c.green(docs)} doc(s)`,
  );
}

interface SanityTransactionLike {
  createOrReplace(doc: SanityDoc): SanityTransactionLike;
  commit(): Promise<unknown>;
}
interface SanityClientLike {
  transaction(): SanityTransactionLike;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
