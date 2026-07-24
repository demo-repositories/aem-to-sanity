#!/usr/bin/env node
import "./load-env.ts";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createColors, listCleanFiles, startTimer } from "aem-to-sanity-core";

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
  const timer = startTimer();
  const c = createColors({ stream: process.stderr });
  const outputDir = resolve(process.env.OUTPUT_DIR ?? "./output");
  const cleanDir = join(outputDir, "cache", "clean");
  const categoriesDir = join(outputDir, "cache", "categories");
  const dryRun = process.env.MIGRATION_DRY_RUN !== "false";

  // `--discard-drafts` (or `MIGRATION_DISCARD_DRAFTS=true`) deletes
  // `drafts.{id}` alongside each `createOrReplace({id})`. The Studio edits
  // a draft whenever one exists, so without this flag a stale draft from
  // a prior migration run keeps shadowing the newly-written published
  // doc — the user sees old data even though the import "succeeded".
  // Opt-in because it destroys authored-in-progress edits; the right
  // default is to leave drafts alone.
  const discardDrafts =
    process.argv.includes("--discard-drafts") ||
    process.env.MIGRATION_DISCARD_DRAFTS === "true";

  // `--recreate-on-type-change` (or `MIGRATION_RECREATE_ON_TYPE_CHANGE=true`)
  // handles the case where a doc's `_type` is changing between runs — most
  // commonly when an operator declares a page-shell in
  // `aem-page-components.json` and a page that previously imported as
  // `_type: "page"` is now `_type: "planDetailsPage"`. Sanity treats `_type`
  // as immutable, so a plain `createOrReplace` fails with "immutable
  // attribute _type may not be modified". With this flag we pre-fetch
  // existing `_type` values, and for docs whose type would change, do
  // `tx.delete(id).delete(draftId).create(doc)` so the old doc is replaced
  // atomically inside one transaction.
  //
  // Opt-in because it destroys the publish history (and any draft) of the
  // affected docs. Safe to use whenever you're confident the new schema
  // shape is correct; not safe to run on a populated dataset without
  // understanding what types are about to flip.
  const recreateOnTypeChange =
    process.argv.includes("--recreate-on-type-change") ||
    process.env.MIGRATION_RECREATE_ON_TYPE_CHANGE === "true";

  const files = listCleanFiles(outputDir);
  // Category docs come from `aem-tags`. They live in their own cache dir so
  // they don't get swept up by `clean/` operations that target pages, and
  // so we can guarantee a "categories first" import ordering — without that
  // ordering, references on page docs would commit pointing at category
  // docs that don't yet exist, and Sanity would (depending on validation
  // strength) either reject the page or fail the live ref count check.
  const categoryFiles = existsSync(categoriesDir)
    ? readdirSync(categoriesDir)
        .filter((f) => f.endsWith(".json") && f !== "manifest.json")
        .sort()
    : [];
  if (files.length === 0 && categoryFiles.length === 0) {
    console.error(
      `No clean files in ${cleanDir} and no category files in ${categoriesDir}. Run \`aem-transform\` (and \`aem-tags\` if migrating tags) first.`,
    );
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

  const mode = dryRun
    ? c.dim("(DRY RUN — set MIGRATION_DRY_RUN=false to commit)")
    : discardDrafts
      ? c.bold("→ Sanity") + c.dim(" (discarding drafts)")
      : c.bold("→ Sanity");
  console.error(
    `[import] ${categoryFiles.length} categor${categoryFiles.length === 1 ? "y" : "ies"}, ${files.length} page(s) ${mode}`,
  );

  let pages = 0;
  let categories = 0;
  let docs = 0;
  let draftsDiscarded = 0;
  let typeChangedDocs = 0;

  // Pre-load every clean file once so we can do a single GROQ pre-fetch for
  // existing `_type`s before we start committing. Otherwise the
  // recreate-on-type-change branch would need N round-trips, one per page.
  const cleanFiles: Array<{ file: string; clean: CleanFile }> = [];
  for (const { absPath, relPath } of files) {
    const clean = JSON.parse(readFileSync(absPath, "utf8")) as CleanFile;
    if (clean.docs.length > 0) cleanFiles.push({ file: relPath, clean });
  }

  // Map<docId, newType>. Used to decide which docs need a delete-then-create.
  const typeChangedIds = new Set<string>();
  if (recreateOnTypeChange && !dryRun && client && cleanFiles.length > 0) {
    const ids = cleanFiles.flatMap(({ clean }) => clean.docs.map((d) => d._id));
    if (ids.length > 0) {
      const existing = (await (client as SanityClientLike).fetch(
        '*[_id in $ids]{_id, _type}',
        { ids },
      )) as Array<{ _id: string; _type: string }>;
      const existingType = new Map(existing.map((e) => [e._id, e._type] as const));
      for (const { clean } of cleanFiles) {
        for (const doc of clean.docs) {
          const prev = existingType.get(doc._id);
          if (prev && prev !== doc._type) typeChangedIds.add(doc._id);
        }
      }
      if (typeChangedIds.size > 0) {
        console.error(
          `[import] ${typeChangedIds.size} doc(s) will be re-created (existing _type differs from new _type).`,
        );
      }
    }
  }

  // 1) Categories first. They're independent docs (only reference each
  // other via `parent`, never references on a page side). Committing them
  // upfront means every later page-side reference resolves immediately.
  if (categoryFiles.length > 0) {
    console.error(c.dim(`  categories →`));
    // Chunk into batches of 50 docs per transaction so a tenant with
    // thousands of tags doesn't try to commit them all in a single payload
    // (Sanity caps transaction size). 50 is well under the cap and matches
    // the order-of-magnitude `aem-import` already uses implicitly via the
    // one-tx-per-page model.
    const BATCH = 50;
    for (let i = 0; i < categoryFiles.length; i += BATCH) {
      const batch = categoryFiles.slice(i, i + BATCH);
      const batchDocs: SanityDoc[] = [];
      for (const file of batch) {
        const clean = JSON.parse(
          readFileSync(join(categoriesDir, file), "utf8"),
        ) as CleanFile;
        for (const doc of clean.docs) batchDocs.push(doc);
      }
      if (!dryRun && client && batchDocs.length > 0) {
        const tx = (client as SanityClientLike).transaction();
        for (const doc of batchDocs) {
          if (discardDrafts) {
            const draftId = doc._id.startsWith("drafts.")
              ? doc._id
              : `drafts.${doc._id}`;
            tx.delete(draftId);
            draftsDiscarded++;
          }
          tx.createOrReplace(doc);
        }
        await tx.commit();
      }
      categories += batchDocs.length;
      docs += batchDocs.length;
    }
    console.error(
      `    ${c.green(categories)} categor${categories === 1 ? "y" : "ies"} from ${c.dim(categoriesDir)}`,
    );
  }

  // 2) Pages — one transaction per page, same as before.
  for (const { clean } of cleanFiles) {
    if (!dryRun && client) {
      const tx = (client as SanityClientLike).transaction();
      for (const doc of clean.docs) {
        const draftId = doc._id.startsWith("drafts.") ? doc._id : `drafts.${doc._id}`;
        if (typeChangedIds.has(doc._id)) {
          // Sanity treats `_type` as immutable, so a re-import that changes
          // the type fails with "immutable attribute _type may not be
          // modified". Delete the published doc (and any draft, regardless
          // of `--discard-drafts` — drafts inherit the same constraint and
          // would otherwise shadow the freshly-created doc) before
          // re-creating it under the new type.
          tx.delete(doc._id);
          tx.delete(draftId);
          if (discardDrafts) draftsDiscarded++;
          tx.create(doc);
          typeChangedDocs++;
        } else {
          if (discardDrafts) {
            tx.delete(draftId);
            draftsDiscarded++;
          }
          tx.createOrReplace(doc);
        }
      }
      try {
        await tx.commit();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("immutable attribute") && msg.includes("_type")) {
          throw new Error(
            `${msg}\n\n` +
              `  This doc exists in Sanity with a different _type than what the migration is\n` +
              `  writing. Re-run with --recreate-on-type-change (or set\n` +
              `  MIGRATION_RECREATE_ON_TYPE_CHANGE=true) to delete + create the affected docs\n` +
              `  atomically. This destroys their publish history and any drafts, so opt in\n` +
              `  only when you're confident the new schema shape is correct.`,
          );
        }
        throw err;
      }
    }
    pages++;
    docs += clean.docs.length;
    console.error(
      `  ${c.dim(clean.jcrPath)} ${c.dim("→")} ${c.green(clean.docs.length)} doc(s)`,
    );
  }

  console.error(c.dim("────────────────────────────────────────"));
  console.error(
    `${dryRun ? c.dim("Would commit") : c.green("Committed")}: ${c.green(pages)} page(s), ${c.green(categories)} categor${categories === 1 ? "y" : "ies"}, ${c.green(docs)} doc(s)`,
  );
  if (discardDrafts && !dryRun) {
    console.error(`${c.dim("Drafts discarded:")} ${c.green(draftsDiscarded)}`);
  }
  if (typeChangedDocs > 0) {
    console.error(`${c.dim("Re-created (_type changed):")} ${c.green(typeChangedDocs)}`);
  }
  console.error(`${c.dim("Elapsed:         ")} ${c.dim(timer.elapsed())}`);
}

interface SanityTransactionLike {
  create(doc: SanityDoc): SanityTransactionLike;
  createOrReplace(doc: SanityDoc): SanityTransactionLike;
  delete(id: string): SanityTransactionLike;
  commit(): Promise<{ transactionId?: string; results?: Array<{ id: string; operation: string }> }>;
}
interface SanityClientLike {
  transaction(): SanityTransactionLike;
  fetch(query: string, params?: Record<string, unknown>): Promise<unknown>;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
