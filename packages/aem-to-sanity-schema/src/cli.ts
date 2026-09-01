#!/usr/bin/env node
import "./load-env.ts";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  DialogNodeSchema,
  applyFixturesFromEnv,
  createColors,
  createLogger,
  fetchInfinityJson,
  loadAuthoringHintConfig,
  loadComponentNameConfig,
  loadContainerConfig,
  loadDialogOverrideConfig,
  loadPageComponentConfig,
  loadSlotConfig,
  logStartupBanner,
  resolveAssetBackend,
  resolveConfig,
  resolvePageBuilderName,
  resolveSchemaLayout,
  startTimer,
  type DialogNode,
  type SanityRuntimeSummary,
} from "aem-to-sanity-core";
import { migrateSchemas } from "./api.ts";
import { VALID_TYPE_SUFFIX } from "./naming.ts";
import { scanSlotGraphFromExtractCache } from "./slots.ts";
import {
  mergeDiscoveredTemplates,
  scanTemplatesFromExtractCache,
} from "./template-discovery.ts";

async function main(): Promise<void> {
  const timer = startTimer();
  const config = await resolveConfig(process.env);

  // `--verbose` / `-v` elevates log level to `debug`, which surfaces the
  // per-request `GET <url>` line already emitted by the AEM fetcher
  // (`packages/aem-to-sanity-core/src/aem/fetcher.ts`). Also honor the
  // `AEM_VERBOSE=true` env var for CI pipelines that can't pass flags.
  const verbose =
    process.argv.includes("--verbose") ||
    process.argv.includes("-v") ||
    process.env.AEM_VERBOSE === "true";
  const logger = createLogger({ level: verbose ? "debug" : "info" });

  logStartupBanner(logger, config, {
    command: "migrate:schema",
    verbose,
    sanity: describeSanityEnv(process.env),
  });

  // Accept both the CLI flag and the env var. When true, per-component 401/403
  // failures are recorded as skips and the batch keeps going; the api-level
  // circuit breaker still bails if no component has succeeded after N auth
  // failures (signals credentials-wide failure, not per-path ACL).
  const continueOnAuth =
    process.argv.includes("--continue-on-auth") ||
    process.env.AEM_CONTINUE_ON_AUTH === "true";

  // Schemas are emitted under SCHEMAS_OUT_DIR when set, otherwise the legacy
  // `{outputDir}/schemas` path. Lets consumers (e.g. apps/studio) own the
  // generated schemas directly while `{outputDir}/cache/` still holds
  // regenerable artifacts.
  const schemasDir = process.env.SCHEMAS_OUT_DIR
    ? resolve(process.env.SCHEMAS_OUT_DIR)
    : undefined;

  // Type-name derivation strategy. `path` (default) names types from the
  // JCR path; `title` names them from each component's `jcr:title` (extra
  // fetch pass, collisions get a path-derived suffix). Renaming types after
  // content has been imported orphans the old `_type` values — pick once
  // before the first import.
  const typeNamingRaw = process.env.MIGRATION_TYPE_NAMING?.trim();
  if (typeNamingRaw && typeNamingRaw !== "path" && typeNamingRaw !== "title") {
    logger.error(
      `MIGRATION_TYPE_NAMING="${typeNamingRaw}" is invalid — use "path" (default) or "title".`,
    );
    process.exit(1);
  }
  const typeNaming = (typeNamingRaw as "path" | "title" | undefined) ?? "path";
  if (typeNaming === "title") {
    logger.info(
      `Type naming: title (MIGRATION_TYPE_NAMING) — component jcr:titles name the Sanity types; collisions fall back to path-derived suffixes.`,
    );
  }

  // Global suffix appended verbatim to every strategy-derived type name so
  // generated types can match an existing customer schema (`hero` →
  // `heroBlock`). Explicit names in aem-component-names.json are exempt.
  // Same set-once-before-first-import hazard as the strategy: changing the
  // suffix renames every emitted type and orphans ingested `_type` values.
  const typeSuffix = process.env.MIGRATION_TYPE_SUFFIX?.trim() || undefined;
  if (typeSuffix && !VALID_TYPE_SUFFIX.test(typeSuffix)) {
    logger.error(
      `MIGRATION_TYPE_SUFFIX="${typeSuffix}" is invalid — use letters/digits/underscore only (it must keep type names identifier-like).`,
    );
    process.exit(1);
  }

  // What the suffix decorates. "type" (default) bakes it into the Sanity
  // type name (ingested `_type` included — set-once hazard). "file" applies
  // it only to the generated file basename and its `export const`
  // (`accordionType.ts` exporting `accordionType`, `name: "accordion"`) —
  // the common Studio convention, safe to change between runs.
  const typeSuffixModeRaw = process.env.MIGRATION_TYPE_SUFFIX_MODE?.trim();
  if (typeSuffixModeRaw && typeSuffixModeRaw !== "type" && typeSuffixModeRaw !== "file") {
    logger.error(
      `MIGRATION_TYPE_SUFFIX_MODE="${typeSuffixModeRaw}" is invalid — use "type" (default; suffix is part of the Sanity type name) or "file" (suffix only on file names and export consts).`,
    );
    process.exit(1);
  }
  const typeSuffixMode = (typeSuffixModeRaw as "type" | "file" | undefined) ?? "type";
  if (typeSuffixModeRaw && !typeSuffix) {
    logger.warn(
      `MIGRATION_TYPE_SUFFIX_MODE is set but MIGRATION_TYPE_SUFFIX is not — no suffix will be applied.`,
    );
  }
  if (typeSuffix) {
    logger.info(
      typeSuffixMode === "file"
        ? `Type-name suffix: "${typeSuffix}" in file mode (MIGRATION_TYPE_SUFFIX_MODE=file) — file names and export consts get the suffix; defineType names and ingested _type values stay bare.`
        : `Type-name suffix: "${typeSuffix}" (MIGRATION_TYPE_SUFFIX) — appended to every derived type name; explicit names from aem-component-names.json are used as-is.`,
    );
  }

  // Page-builder array type / page-doc field name. Also read by
  // `aem-transform` so the emitted schemas and the ingested content agree —
  // set once in the tenant .env before the first run.
  const pageBuilderName = resolvePageBuilderName(process.env);
  if (pageBuilderName !== "pageBuilder") {
    logger.info(
      `Page-builder name: ${pageBuilderName} (MIGRATION_PAGE_BUILDER_NAME)`,
    );
  }

  // Layout of the generated schemas dir: flat (default) or kind (documents/
  // + objects/ subfolders). Safe to switch between runs — only file
  // locations move; type names and ingested `_type`s are untouched.
  const schemaLayout = resolveSchemaLayout(process.env);
  if (schemaLayout !== "flat") {
    logger.info(
      `Schema layout: ${schemaLayout} (MIGRATION_SCHEMA_LAYOUT) — generated files grouped under documents/ and objects/.`,
    );
  }

  // Asset backend — decides what image/file dialog fields emit as. Shared
  // with aem-assets (which rewrites the matching values into clean docs) —
  // set once in the tenant .env before the first run. Invalid values throw
  // in resolveAssetBackend with the allowed list.
  const assetBackend = resolveAssetBackend(process.env);
  if (assetBackend === "bynder") {
    logger.info(
      `Asset backend: bynder (MIGRATION_ASSET_BACKEND) — image/file dialog fields emit as bynder.asset; add sanity-plugin-bynder-input to the consuming Studio.`,
    );
  }

  const componentPaths = await readComponentPaths(config.componentPathsFile);
  const exceptionsFile = resolve(
    process.env.AEM_COMPONENT_EXCEPTIONS_FILE ?? "./aem-component-exceptions",
  );
  const exceptions = await readExceptionList(exceptionsFile);
  const filtered = applyComponentExceptions(componentPaths, exceptions);

  // AEM containers — components whose children are dropped in via the page
  // editor (cq:isContainer) rather than a dialog multifield. Optional file;
  // missing file → no container behavior.
  const containersFile = resolve(
    process.env.AEM_COMPONENT_CONTAINERS_FILE ?? "./aem-component-containers.json",
  );
  const containers = loadContainerConfig({ file: containersFile });
  if (containers.size > 0) {
    logger.info(
      `Applied ${containers.size} container entr${containers.size === 1 ? "y" : "ies"} from ${containersFile}`,
    );
  }

  // AEM authoring-hint opt-ins (e.g. `cq:panelTitle` on accordion children).
  // Each listed component gets the named hint(s) lifted at transform time
  // and declared as a read-only field on the emitted Sanity schema.
  // Non-listed components stay clean.
  const hintsFile = resolve(
    process.env.AEM_COMPONENT_HINTS_FILE ?? "./aem-component-hints.json",
  );
  const authoringHints = loadAuthoringHintConfig({ file: hintsFile });
  if (authoringHints.size > 0) {
    logger.info(
      `Applied authoring-hint opt-ins for ${authoringHints.size} component(s) from ${hintsFile}`,
    );
  }

  // Per-slot configuration (visibility rules) for auto-discovered named
  // slots — e.g. promocard's `buttonPrimary` child folding behind its
  // `enablePrimaryButton` toggle. Optional file; missing file → slots stay
  // always visible.
  const slotsFile = resolve(
    process.env.AEM_COMPONENT_SLOTS_FILE ?? "./aem-component-slots.json",
  );
  const slotVisibility = loadSlotConfig({ file: slotsFile });
  if (slotVisibility.size > 0) {
    logger.info(
      `Applied slot config for ${slotVisibility.size} component(s) from ${slotsFile}`,
    );
  }

  // Explicit type-name / Studio-title overrides. Optional file; missing
  // file → strategy naming only. Set-once-before-first-import: changing an
  // override later renames the emitted type and orphans ingested `_type`s.
  const componentNamesFile = resolve(
    process.env.AEM_COMPONENT_NAMES_FILE ?? "./aem-component-names.json",
  );
  const componentNames = loadComponentNameConfig({ file: componentNamesFile });
  if (componentNames.size > 0) {
    logger.info(
      `Applied name/title override(s) for ${componentNames.size} component(s) from ${componentNamesFile}`,
    );
  }

  // Dialog overrides — supplementary tabs merged in by AEM's Sling
  // Resource Merger that first-hit supertype resolution can't see, and/or
  // full local-dialog replacements. Optional file; missing file → dialogs
  // resolve from AEM as usual.
  const dialogOverridesFile = resolve(
    process.env.AEM_DIALOG_OVERRIDES_FILE ?? "./aem-dialog-overrides.json",
  );
  const dialogOverrides = loadDialogOverrideConfig({ file: dialogOverridesFile });
  if (dialogOverrides.size > 0) {
    logger.info(
      `Applied dialog override(s) for ${dialogOverrides.size} component(s) from ${dialogOverridesFile}`,
    );
  }

  // AEM page-shell components (the components used as `sling:resourceType`
  // on `jcr:content`) paired with the `cq:template` paths each is authored
  // under. For every (resourceType, template) pair the schema emitter
  // writes one Sanity document type and the page-shell type is excluded
  // from `pageBuilder.of[]`.
  const pageComponentsFile = resolve(
    process.env.AEM_PAGE_COMPONENTS_FILE ?? "./aem-page-components.json",
  );
  const declaredPageComponents = loadPageComponentConfig({ file: pageComponentsFile });
  if (declaredPageComponents.size > 0) {
    let templateCount = 0;
    let discoverCount = 0;
    let nameOverrideCount = 0;
    const restrictedComponents = new Set<string>();
    for (const v of declaredPageComponents.values()) {
      templateCount += v.templates.length;
      if (v.discover) discoverCount++;
      nameOverrideCount += Object.keys(v.names ?? {}).length;
      for (const rts of Object.values(v.components ?? {})) {
        for (const rt of rts) restrictedComponents.add(rt);
      }
    }
    logger.info(
      `Applied ${declaredPageComponents.size} page-component(s) (${templateCount} explicit template${templateCount === 1 ? "" : "s"}${discoverCount > 0 ? `, ${discoverCount} with auto-discover` : ""}${nameOverrideCount > 0 ? `, ${nameOverrideCount} name override${nameOverrideCount === 1 ? "" : "s"}` : ""}${restrictedComponents.size > 0 ? `, ${restrictedComponents.size} template-restricted component${restrictedComponents.size === 1 ? "" : "s"}` : ""}) from ${pageComponentsFile}`,
    );
  }

  const extractCacheDir = join(config.outputDir, "cache", "aem", "content");

  // Template discovery — scan extract/tag cache for `cq:template` values
  // on declared page-shells that opted into `discover: true`. First-ever
  // run has no content cache yet and this returns empty; a second run after
  // `aem-extract` picks up every template referenced in authored content.
  const pageComponents = (() => {
    const anyDiscover = [...declaredPageComponents.values()].some((v) => v.discover);
    if (!anyDiscover) return declaredPageComponents;
    const discovered = scanTemplatesFromExtractCache(config.outputDir, declaredPageComponents);
    let discoveredCount = 0;
    for (const set of discovered.values()) discoveredCount += set.size;
    if (discoveredCount > 0) {
      logger.info(
        `Discovered ${discoveredCount} cq:template value(s) from ${extractCacheDir} — emitting per-template doc types for each.`,
      );
    } else {
      logger.info(
        `Template discovery is enabled but no cq:template values found in ${extractCacheDir}. Run \`pnpm extract\` first, then re-run migrate:schema.`,
      );
    }
    return mergeDiscoveredTemplates(declaredPageComponents, discovered);
  })();

  // Slot discovery — scan extract/tag cache for named-slot child components
  // (plus the page-body type set that guards slot-only pageBuilder exclusion).
  const slotScan = scanSlotGraphFromExtractCache(config.outputDir);
  const discoveredSlots = slotScan.slots;
  if (discoveredSlots.size > 0) {
    let slotCount = 0;
    for (const m of discoveredSlots.values()) slotCount += m.size;
    logger.info(
      `Slot discovery: scanned ${extractCacheDir} — found ${slotCount} slot(s) across ${discoveredSlots.size} parent type(s).`,
    );
  }

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

  const { report, reportFile, missingPageComponentPaths } = await migrateSchemas({
    componentPaths: filtered,
    fetcher,
    outputDir: config.outputDir,
    schemasDir,
    concurrency: config.concurrency,
    logger,
    docsOutputFile: "./docs/aem-to-sanity-mapping.md",
    continueOnAuth,
    pageBuilderName,
    assetBackend,
    schemaLayout,
    typeNaming,
    typeSuffix,
    typeSuffixMode,
    containers,
    discoveredSlots,
    slotPageBodyTypes: slotScan.pageBodyTypes,
    slotVisibility,
    authoringHints,
    componentNames,
    dialogOverrides,
    pageComponents,
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
  logger.info(`Elapsed:             ${c.dim(timer.elapsed())}`);
  logger.info(sep);

  // Page-shells declared in `aem-page-components.json` but missing from
  // `aem-component-paths` get dropped silently inside the template-pages
  // emitter — its `logger.error` line is easy to miss in a long schema run.
  // Surface them again at the end with the exact paths to add.
  if (missingPageComponentPaths && missingPageComponentPaths.length > 0) {
    logger.error(
      `${missingPageComponentPaths.length} page-shell(s) skipped — declared in aem-page-components.json but missing from aem-component-paths. Add these lines and re-run migrate:schema:`,
    );
    for (const rt of missingPageComponentPaths) {
      logger.error(`    /apps/${rt}`);
    }
    logger.info(sep);
  }

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
    // With continueOnAuth, per-component auth failures are ACL skips as long
    // as at least one component succeeded. A full wipeout (0 successes) still
    // means credentials were wrong → hard abort.
    const treatAsFatal =
      (hasAuthFailure && !continueOnAuth) || s.successes === 0;
    const headline = treatAsFatal
      ? hasAuthFailure
        ? `${failures.length} component(s) failed (auth — aborting):`
        : `${failures.length} component(s) failed (no successes — aborting):`
      : hasAuthFailure
        ? `${failures.length} component(s) skipped (${failures.filter((f) => f.kind === "auth").length} auth / ${failures.length - failures.filter((f) => f.kind === "auth").length} other):`
        : `${failures.length} component(s) skipped with errors:`;
    const level = treatAsFatal ? logger.error : logger.warn;

    level(headline);
    failures.forEach((f, i) => {
      const n = c.dim(String(i + 1).padStart(2, " ") + ".");
      const path = f.path.padEnd(pathWidth, " ");
      const kindPainted = treatAsFatal ? c.red : c.yellow;
      const kind = kindPainted(`[${f.kind}]`.padEnd(14, " "));
      const msg = c.dim(f.message.replace(/\s+/g, " ").slice(0, 140));
      level(`  ${n} ${path}  ${kind} ${msg}`);
    });
    level(`Full details in ${c.dim(reportFile)} under results[].`);

    if (treatAsFatal) process.exit(1);
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

/**
 * Surface Sanity runtime env values for the startup banner. `migrate:schema`
 * never connects to Sanity — this is pre-flight context so the operator can
 * confirm their `.env` is loaded correctly for the downstream ingest step.
 * Secrets are not read, only presence (`tokenSet: boolean`).
 */
function describeSanityEnv(env: NodeJS.ProcessEnv): SanityRuntimeSummary {
  const projectId = env.SANITY_STUDIO_PROJECT_ID ?? env.SANITY_PROJECT_ID;
  const dataset = env.SANITY_STUDIO_DATASET ?? env.SANITY_DATASET;
  return {
    projectId,
    dataset,
    apiVersion: env.SANITY_API_VERSION,
    tokenSet: Boolean(env.SANITY_TOKEN),
  };
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
