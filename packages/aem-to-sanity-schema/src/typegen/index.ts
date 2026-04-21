import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { writeTextFile, type Logger } from "aem-to-sanity-core";
import { synthesizeSanityConfig } from "./synthesize-config.ts";
import { runSanityCli, runExternalCli } from "./run.ts";
import { EXTRACT_SCRIPT_SRC } from "./extract-script.ts";

export interface RunTypegenOptions {
  /** Root output directory (where `schemas/*.ts` already live). */
  outputDir: string;
  /** Optional real project id — otherwise a placeholder is used. */
  projectId?: string;
  /** Optional dataset — otherwise "production". */
  dataset?: string;
  /** Workspace name for the synthesized config. */
  workspaceName?: string;
  /** Directory to search from when resolving the `sanity` binary; defaults to outputDir then cwd. */
  binCwd?: string;
  /**
   * Directory whose `node_modules/` should be linked into `.typegen/`. This
   * ensures the synthesized `sanity.config.ts`'s `import "sanity"` resolves.
   * Defaults to `binCwd` (the same place we find the `sanity` binary).
   */
  nodeModulesSource?: string;
  logger?: Logger;
}

export interface RunTypegenResult {
  typesFile: string;
  schemaJsonFile: string;
  synthesizedConfig: string;
}

/**
 * Runs the TypeGen pipeline:
 *   1. Synthesize a throwaway `sanity.config.ts` + `.typegen/node_modules`
 *      symlink so the schema TS files can resolve `sanity`.
 *   2. Extract a `schema.json` by importing each emitted schema and running
 *      `createSchema` + `@sanity/schema/_internal.extractSchema` in-process
 *      via `tsx`. This intentionally avoids `sanity schema extract`, which
 *      triggers Studio workspace resolution (a network call to validate the
 *      project id).
 *   3. Run `sanity typegen generate` against the extracted schema.json to
 *      produce `sanity.types.ts`.
 */
export async function runTypegen(
  opts: RunTypegenOptions,
): Promise<RunTypegenResult> {
  const { outputDir, projectId, dataset, workspaceName, logger } = opts;
  const binCwd = opts.binCwd ?? outputDir;

  const synthesized = await synthesizeSanityConfig({
    outputDir,
    projectId,
    dataset,
    workspaceName,
    nodeModulesSource: opts.nodeModulesSource ?? binCwd,
  });

  const schemaJsonFile = join(outputDir, "schema.json");
  const typesFile = join(outputDir, "sanity.types.ts");

  // --- Step 2: in-process schema extraction via tsx -----------------------
  const extractScriptPath = join(synthesized.typegenDir, "extract.mts");
  await writeTextFile(extractScriptPath, EXTRACT_SCRIPT_SRC);
  const schemasDir = join(outputDir, "schemas");

  await runExternalCli({
    cwd: synthesized.typegenDir,
    args: [
      extractScriptPath,
      schemasDir,
      schemaJsonFile,
      JSON.stringify({ enforceRequiredFields: false }),
    ],
    binName: "tsx",
    binSearchCwd: binCwd,
    logger,
  });

  if (!existsSync(schemaJsonFile)) {
    throw new Error(
      `extract worker did not produce ${schemaJsonFile}`,
    );
  }

  // --- Step 3: sanity typegen generate ------------------------------------
  const typegenConfig = {
    path: toPosix(relative(synthesized.typegenDir, outputDir)) + "/**/*.ts",
    schema: toPosix(relative(synthesized.typegenDir, schemaJsonFile)),
    generates: toPosix(relative(synthesized.typegenDir, typesFile)),
  };
  const typegenConfigFile = join(synthesized.typegenDir, "sanity-typegen.json");
  await writeTextFile(typegenConfigFile, JSON.stringify(typegenConfig, null, 2));

  await runSanityCli({
    cwd: synthesized.typegenDir,
    args: ["typegen", "generate", "--config-path", "sanity-typegen.json"],
    binName: "sanity",
    binSearchCwd: binCwd,
    logger,
  });

  logger?.info(`typegen: wrote ${typesFile}`);
  return {
    typesFile,
    schemaJsonFile,
    synthesizedConfig: synthesized.configFile,
  };
}

function toPosix(p: string): string {
  return p.split(/[\\/]/).join("/");
}

export { synthesizeSanityConfig } from "./synthesize-config.ts";
export { runSanityCli } from "./run.ts";
