#!/usr/bin/env node
/**
 * aem-eject-dialogs — materialize effective dialogs into static local files.
 *
 * Runs the exact resolution `migrate:schema` uses (embedded `cq:dialog` /
 * `sling:resourceSuperType` walk / `aem-dialog-overrides.json` supplementary
 * tabs), bakes resolvable datasource options in as literal `items`, writes
 * one JSON file per component under `./dialog-overrides/<resourceType>.json`,
 * and rewrites `aem-dialog-overrides.json` so each ejected component uses
 * `{ "dialogFile": … }`. The files become the hand-editable source of truth.
 *
 *   aem-eject-dialogs /apps/<site>/components/foo [more paths…]
 *   aem-eject-dialogs --all              # every path in aem-component-paths
 *   aem-eject-dialogs --all --force      # refresh from AEM (discards hand edits)
 *   aem-eject-dialogs --all --out-dir ./my-dialogs
 *
 * Existing ejected files are skipped without --force, so hand edits are
 * never silently overwritten.
 */
import "./load-env.ts";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  DialogNodeSchema,
  applyFixturesFromEnv,
  createLogger,
  fetchInfinityJson,
  loadDialogOverrideConfig,
  logStartupBanner,
  resolveConfig,
  type DialogNode,
} from "aem-to-sanity-core";
import { ejectDialogs, parseLineList } from "./eject-dialogs.ts";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const verbose =
    argv.includes("--verbose") || argv.includes("-v") || process.env.AEM_VERBOSE === "true";
  const all = argv.includes("--all");
  const force = argv.includes("--force");
  const outDirIdx = argv.indexOf("--out-dir");
  const outDir = resolve(
    outDirIdx !== -1 && argv[outDirIdx + 1] ? argv[outDirIdx + 1]! : "./dialog-overrides",
  );
  // `--out-dir` consumes the next arg; guard the -1 sentinel so index 0
  // isn't excluded when the flag is absent.
  const outDirValueIdx = outDirIdx === -1 ? -1 : outDirIdx + 1;
  const positionals = argv.filter(
    (a, i) => !a.startsWith("-") && i !== outDirValueIdx,
  );

  const logger = createLogger({ level: verbose ? "debug" : "info" });
  const config = await resolveConfig(process.env);
  logStartupBanner(logger, config, { command: "aem-eject-dialogs", verbose });

  if (!all && positionals.length === 0) {
    logger.error(
      "Usage: aem-eject-dialogs </apps/...component paths | resource types> | --all  [--force] [--out-dir <dir>]",
    );
    process.exit(2);
  }

  let componentPaths: string[];
  if (all) {
    const listed = parseLineList(
      await readFile(config.componentPathsFile, "utf8"),
    );
    const exceptionsFile = resolve(
      process.env.AEM_COMPONENT_EXCEPTIONS_FILE ?? "./aem-component-exceptions",
    );
    let exceptions = new Set<string>();
    try {
      exceptions = new Set(
        parseLineList(await readFile(exceptionsFile, "utf8")).map(normalizeKey),
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    componentPaths = listed.filter((p) => !exceptions.has(normalizeKey(p)));
    if (positionals.length > 0) {
      logger.warn("--all set — ignoring positional component paths.");
    }
  } else {
    // Accept full JCR paths or bare resource types.
    componentPaths = positionals.map((p) =>
      p.startsWith("/") ? p : `/apps/${normalizeKey(p)}`,
    );
  }

  const overridesFile = resolve(
    process.env.AEM_DIALOG_OVERRIDES_FILE ?? "./aem-dialog-overrides.json",
  );
  const dialogOverrides = loadDialogOverrideConfig({ file: overridesFile });

  const fetcher = (jcrPath: string): Promise<DialogNode> =>
    fetchInfinityJson(applyFixturesFromEnv({ config, logger }), jcrPath, (raw) => {
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

  const result = await ejectDialogs({
    componentPaths,
    fetcher,
    dialogOverrides,
    overridesFile,
    outDir,
    force,
    logger,
  });

  logger.info("────────────────────────────────────────");
  logger.info(`Ejected:  ${result.ejected.length} dialog(s) → ${outDir}`);
  logger.info(`Skipped:  ${result.skipped.length}`);
  if (result.configUpdated) {
    logger.info(`Config:   ${overridesFile} updated (dialogFile entries)`);
  }
  logger.info("────────────────────────────────────────");
  for (const s of result.skipped) {
    logger.warn(`skipped ${s.componentPath}: ${s.reason}`);
  }
  if (result.ejected.length > 0) {
    logger.info(
      "The ejected files are now each component's dialog source of truth. " +
        "Hand-edit them to add/remove fields or pin select options, then re-run migrate:schema. " +
        "Re-eject with --force to refresh from AEM (discards hand edits).",
    );
  }
  if (result.skipped.length > 0 && result.ejected.length === 0) process.exit(1);
}

function normalizeKey(v: string): string {
  const trimmed = v.trim().replace(/^\/+/, "");
  return trimmed.startsWith("apps/") ? trimmed.slice("apps/".length) : trimmed;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
