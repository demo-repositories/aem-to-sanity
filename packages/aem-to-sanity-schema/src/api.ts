import { join, dirname } from "node:path";
import { readFile, readdir, unlink } from "node:fs/promises";
import {
  AemFetchError,
  writeJson,
  writeTextFile,
  type DialogNode,
  type Logger,
} from "aem-to-sanity-core";
import {
  flattenSchemaFieldNames,
  mapDialog,
  type NodeFetcher,
} from "./mapper.ts";
import { emitSchemaFile } from "./emitter.ts";
import { componentPathToTypeName } from "./naming.ts";
import { Report } from "./report.ts";
import { auditUnmappedTypes } from "./audit.ts";
import {
  rewriteBarrelFromDisk,
  writePageBuilderArtifacts,
} from "./pagebuilder.ts";
import { writeContentRegistry } from "./content-registry.ts";

export interface MigrateSchemasOptions {
  /** AEM component paths (e.g. `/apps/<site>/components/promo`). */
  componentPaths: string[];
  /**
   * Fetches a JCR node as its validated dialog shape. Callers pass a raw JCR
   * path; for the component root, the api internally appends `/_cq_dialog`.
   * For includes, the exact `path` attribute is passed through unchanged.
   */
  fetcher: NodeFetcher;
  outputDir: string;
  concurrency?: number;
  logger?: Logger;
  /** Persist each component's raw dialog JSON to `{outputDir}/aem/components/`. Defaults to true. */
  writeAemSnapshot?: boolean;
  /** Run the unmapped-type audit after the main pass. Defaults to true. */
  runAudit?: boolean;
  /** Write regenerated docs to this path. Omit to skip. */
  docsOutputFile?: string;
  /** Override the regenerate command shown in emitted file headers. */
  regenerateCommand?: string;
  /**
   * Generate `page.ts` + `pageBuilder.ts` alongside the component schemas so a
   * Studio has a page document type with every block registered in
   * `pageBuilder.of[]`. Defaults to true.
   */
  emitPageBuilder?: boolean;
  /** Type names to exclude from `pageBuilder.of[]` (e.g. page-level components). */
  pageBuilderExclude?: string[];
  /**
   * Emit a `content-type-registry.json` alongside the schemas, mapping AEM
   * `sling:resourceType` → Sanity type + field names. Consumed by the content
   * migrator. Defaults to true. Preserves a hand-edited file (detected by the
   * absence of the `__generated` marker).
   */
  emitContentRegistry?: boolean;
  /** Path for the generated registry. Default: `{outputDir}/content-type-registry.json`. */
  contentRegistryFile?: string;
  /** JCR prefix to strip from component paths when deriving `sling:resourceType`. Default: `/apps/`. */
  jcrPrefix?: string;
}

export interface MigrateSchemasResult {
  report: Report;
  reportFile: string;
  auditPath?: string;
  pageBuilderFile?: string;
  pageFile?: string;
  contentRegistryFile?: string;
}

export async function migrateSchemas(
  opts: MigrateSchemasOptions,
): Promise<MigrateSchemasResult> {
  const {
    componentPaths,
    fetcher,
    outputDir,
    logger,
    writeAemSnapshot = true,
    runAudit = true,
    docsOutputFile,
    regenerateCommand,
    emitPageBuilder = true,
    pageBuilderExclude,
    emitContentRegistry = true,
    contentRegistryFile,
    jcrPrefix,
  } = opts;
  const concurrency = opts.concurrency ?? 4;

  const report = new Report();

  await runWithConcurrency(
    componentPaths,
    (p) =>
      processOne(p, {
        fetcher,
        outputDir,
        report,
        logger,
        writeAemSnapshot,
        regenerateCommand,
      }),
    concurrency,
    (r) => ({ shouldAbort: r.authFailure }),
  );

  const reportFile = join(outputDir, "migration-report.json");
  await report.write(reportFile);
  const successTypeNames = report.results
    .filter((r): r is Extract<typeof r, { status: "success" }> => r.status === "success")
    .map((r) => r.sanityTypeName);

  let pageBuilderFile: string | undefined;
  let pageFile: string | undefined;
  if (emitPageBuilder) {
    const pb = await writePageBuilderArtifacts({
      outputDir,
      componentTypeNames: successTypeNames,
      exclude: pageBuilderExclude,
      logger,
    });
    pageBuilderFile = pb.pageBuilderFile;
    pageFile = pb.pageFile;
  }

  await pruneGeneratedSchemaFiles(outputDir, successTypeNames, { emitPageBuilder, logger });

  if (emitPageBuilder) {
    // Prefer filenames on disk so `index.ts` never imports a missing `.ts`
    // (e.g. if a write races or a stale checkout diverges from the report).
    await rewriteBarrelFromDisk(outputDir);
  } else {
    await writeSchemasBarrel(outputDir, report, { emitPageBuilder: false });
  }

  if (docsOutputFile) {
    const { writeMappingDocs } = await import("./docs.ts");
    await writeMappingDocs(docsOutputFile);
  }

  let auditPath: string | undefined;
  if (runAudit) {
    const auditResult = await auditUnmappedTypes({
      report,
      dialogFetcher: fetcher,
      outputDir,
      logger,
    });
    auditPath = auditResult.examplesPath;
  }

  let registryFile: string | undefined;
  if (emitContentRegistry) {
    const file = contentRegistryFile ?? join(outputDir, "content-type-registry.json");
    const r = await writeContentRegistry({
      outputFile: file,
      report,
      jcrPrefix,
      logger,
    });
    registryFile = r.file;
  }

  return {
    report,
    reportFile,
    auditPath,
    pageBuilderFile,
    pageFile,
    contentRegistryFile: registryFile,
  };
}

interface ProcessOneDeps {
  fetcher: NodeFetcher;
  outputDir: string;
  report: Report;
  logger?: Logger;
  writeAemSnapshot: boolean;
  regenerateCommand?: string;
}

/**
 * AEM `.infinity.json` for a `cq:Component` usually nests the authoring dialog
 * under `cq:dialog`. When present, we avoid a second request to `/_cq_dialog`.
 */
function embeddedCqDialog(node: DialogNode): DialogNode | undefined {
  const embedded = node["cq:dialog"];
  if (
    embedded &&
    typeof embedded === "object" &&
    !Array.isArray(embedded) &&
    Object.keys(embedded as object).length > 0
  ) {
    return embedded as DialogNode;
  }
  return undefined;
}

async function processOne(
  componentPath: string,
  deps: ProcessOneDeps,
): Promise<{ authFailure: boolean }> {
  const { fetcher, outputDir, report, writeAemSnapshot, regenerateCommand } =
    deps;
  const typeName = componentPathToTypeName(componentPath);

  let dialog: DialogNode;
  let schemaTitle: string | undefined;
  try {
    const componentNode = await fetcher(componentPath);
    const rawTitle = componentNode["jcr:title"];
    if (typeof rawTitle === "string" && rawTitle.trim()) {
      schemaTitle = rawTitle.trim();
    }
    const embeddedDialog = embeddedCqDialog(componentNode);
    if (embeddedDialog) {
      dialog = embeddedDialog;
    } else {
      dialog = await fetcher(`${componentPath}/_cq_dialog`);
    }
  } catch (err) {
    if (err instanceof AemFetchError) {
      report.add({
        status: "failure",
        path: componentPath,
        kind: err.kind,
        message: err.message,
        bodyExcerpt: err.details?.bodyExcerpt,
      });
      return { authFailure: err.kind === "auth" };
    }
    report.add({
      status: "failure",
      path: componentPath,
      kind: "network",
      message: (err as Error).message,
    });
    return { authFailure: false };
  }

  if (writeAemSnapshot) {
    await saveDialogJson(outputDir, componentPath, dialog, deps.logger);
  }

  let mapped;
  try {
    mapped = await mapDialog(dialog, fetcher);
  } catch (err) {
    report.add({
      status: "failure",
      path: componentPath,
      kind: "mappingError",
      message: (err as Error).message,
    });
    return { authFailure: false };
  }

  let contents: string;
  try {
    contents = await emitSchemaFile({
      typeName,
      sourcePath: componentPath,
      fields: mapped.fields,
      groups: mapped.groups,
      schemaTitle,
      regenerateCommand,
    });
  } catch (err) {
    report.add({
      status: "failure",
      path: componentPath,
      kind: "mappingError",
      message: `emitter failed: ${(err as Error).message}`,
    });
    return { authFailure: false };
  }

  const outputFile = join(outputDir, "schemas", `${typeName}.ts`);
  try {
    await writeTextFile(outputFile, contents);
  } catch (err) {
    report.add({
      status: "failure",
      path: componentPath,
      kind: "writeError",
      message: (err as Error).message,
    });
    return { authFailure: false };
  }

  report.add({
    status: "success",
    path: componentPath,
    sanityTypeName: typeName,
    outputFile,
    fieldNames: flattenSchemaFieldNames(mapped.fields),
    unmapped: mapped.unmapped,
    renamed: mapped.renamed,
  });
  return { authFailure: false };
}

async function pruneGeneratedSchemaFiles(
  outputDir: string,
  componentTypeNames: string[],
  opts: { emitPageBuilder: boolean; logger?: Logger },
): Promise<void> {
  const schemasDir = join(outputDir, "schemas");
  let entries: string[];
  try {
    entries = await readdir(schemasDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }

  const keep = new Set(componentTypeNames);
  keep.add("index");
  if (opts.emitPageBuilder) {
    keep.add("page");
    keep.add("pageBuilder");
  }

  for (const file of entries) {
    if (!file.endsWith(".ts")) continue;
    const name = file.slice(0, -3);
    if (keep.has(name)) continue;
    const full = join(schemasDir, file);
    let contents = "";
    try {
      contents = await readFile(full, "utf8");
    } catch {
      continue;
    }
    const generated =
      contents.startsWith("// GENERATED by aem-to-sanity-schema") ||
      contents.includes("Generated from AEM component:");
    if (!generated) continue;
    await unlink(full);
    opts.logger?.info(`prune: removed stale generated schema ${full}`);
  }
}

/**
 * Emit `{outputDir}/schemas/index.ts`: a barrel that re-exports every
 * successfully generated schema plus an `allSchemaTypes` array suitable for
 * plugging directly into `defineConfig({ schema: { types: allSchemaTypes } })`.
 *
 * This is what lets `apps/studio` (and any downstream Studio) add one import
 * instead of 86. Regenerated on every run so the list stays in sync with the
 * schemas on disk.
 */
async function writeSchemasBarrel(
  outputDir: string,
  report: Report,
  opts: { emitPageBuilder: boolean },
): Promise<void> {
  const successNames = report.results
    .filter((r): r is Extract<typeof r, { status: "success" }> => r.status === "success")
    .map((r) => r.sanityTypeName)
    .sort();
  if (successNames.length === 0) return;

  const pageExtras = opts.emitPageBuilder ? ["pageBuilder", "page"] : [];
  const allNames = [...successNames, ...pageExtras];

  const imports = allNames
    .map((n) => `import { ${n} } from "./${n}.ts";`)
    .join("\n");
  const list = allNames.join(", ");

  const src = `// GENERATED by aem-to-sanity-schema. Do not edit by hand.
${imports}

export const allSchemaTypes = [${list}];
${allNames.map((n) => `export { ${n} };`).join("\n")}
`;

  const file = join(outputDir, "schemas", "index.ts");
  await writeTextFile(file, src);
}

async function saveDialogJson(
  outputDir: string,
  componentPath: string,
  dialog: DialogNode,
  logger?: Logger,
): Promise<void> {
  const rel = componentPath.replace(/^\/+/, "");
  const file = join(outputDir, "aem", "components", `${rel}.json`);
  try {
    await writeJson(file, dialog, { pretty: true });
  } catch (err) {
    logger?.warn(
      `failed to save dialog JSON for ${componentPath}: ${(err as Error).message}`,
      { path: file, parentDir: dirname(file) },
    );
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number,
  onResult?: (r: R) => { shouldAbort: boolean },
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  let abort = false;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (!abort) {
        const i = index++;
        if (i >= items.length) break;
        const item = items[i]!;
        const r = await worker(item);
        results.push(r);
        if (onResult && onResult(r).shouldAbort) {
          abort = true;
          break;
        }
      }
    },
  );
  await Promise.all(runners);
  return results;
}
