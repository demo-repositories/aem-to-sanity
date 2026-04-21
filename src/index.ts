import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { loadConfig } from "./config.ts";
import { AemFetchError, fetchComponentDialog, fetchInfinityJson } from "./aem/fetcher.ts";
import type { DialogNode } from "./aem/types.ts";
import { mapDialog } from "./sanity/mapper.ts";
import { emitSchemaFile } from "./sanity/emitter.ts";
import { componentPathToTypeName } from "./sanity/naming.ts";
import { Report } from "./report.ts";
import { writeMappingDocs } from "./docs.ts";

async function readPaths(file: string): Promise<string[]> {
  const raw = await readFile(file, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

async function processOne(
  config: Awaited<ReturnType<typeof loadConfig>>,
  componentPath: string,
  report: Report,
): Promise<{ authFailure: boolean }> {
  const typeName = componentPathToTypeName(componentPath);

  let dialog;
  try {
    dialog = await fetchComponentDialog(config, componentPath);
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

  await saveDialogJson(config.outputDir, componentPath, dialog);

  let mapped;
  try {
    mapped = await mapDialog(dialog, (jcrPath) =>
      fetchInfinityJson(config, jcrPath),
    );
  } catch (err) {
    report.add({
      status: "failure",
      path: componentPath,
      kind: "mappingError",
      message: (err as Error).message,
    });
    return { authFailure: false };
  }

  let contents;
  try {
    contents = await emitSchemaFile({
      typeName,
      sourcePath: componentPath,
      fields: mapped.fields,
      groups: mapped.groups,
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

  const outputFile = join(config.outputDir, "schemas", `${typeName}.ts`);
  try {
    await mkdir(join(config.outputDir, "schemas"), { recursive: true });
    await writeFile(outputFile, contents, "utf8");
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
    unmapped: mapped.unmapped,
    renamed: mapped.renamed,
  });
  return { authFailure: false };
}

async function saveDialogJson(
  outputDir: string,
  componentPath: string,
  dialog: DialogNode,
): Promise<void> {
  const rel = componentPath.replace(/^\/+/, "");
  const file = join(outputDir, "aem", "components", `${rel}.json`);
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(dialog, null, 2), "utf8");
  } catch (err) {
    console.warn(
      `warn: failed to save dialog JSON for ${componentPath}: ${(err as Error).message}`,
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

async function main(): Promise<void> {
  const config = loadConfig();
  const paths = await readPaths(config.componentPathsFile);
  if (paths.length === 0) {
    console.error(`No component paths in ${config.componentPathsFile}`);
    process.exit(1);
  }

  console.log(
    `Migrating ${paths.length} component(s) from ${config.baseUrl} [env=${config.env}, auth=${config.auth.kind}]`,
  );

  const report = new Report();
  await runWithConcurrency(
    paths,
    (p) => processOne(config, p, report),
    config.concurrency,
    (r) => ({ shouldAbort: r.authFailure }),
  );

  const reportFile = join(config.outputDir, "migration-report.json");
  await report.write(reportFile);
  await writeMappingDocs("./docs/aem-to-sanity-mapping.md");

  const s = report.summary();
  console.log(
    `Done. successes=${s.successes} failures=${s.failures} unique-unmapped-types=${Object.keys(s.unmappedTypes).length}`,
  );
  console.log(`Report: ${reportFile}`);
  if (s.failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
