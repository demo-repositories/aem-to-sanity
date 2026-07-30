import { join, dirname } from "node:path";
import { readFile, readdir, rmdir, unlink } from "node:fs/promises";
import {
  AEM_AUTHORING_HINTS,
  AemFetchError,
  aemCacheAppsFile,
  normalizeSlotBase,
  resolveDialogViaSuperType,
  writeJson,
  writeTextFile,
  type AuthoringHintConfig,
  type ComponentNameConfig,
  type ContainerConfig,
  type DialogNode,
  type Logger,
  type PageComponentConfig,
  type SchemaLayout,
  type SlotConfig,
  type SlotConfigEntry,
} from "aem-to-sanity-core";
import {
  collectSlotOnlyResourceTypes,
  resolveSlotVisibilityCondition,
} from "./slots.ts";
import {
  describeSchemaFields,
  flattenSchemaFieldNames,
  mapDialog,
  type NodeFetcher,
  type SanityField,
} from "./mapper.ts";
import { emitSchemaFile, resolveSchemaTitle } from "./emitter.ts";
import {
  RESERVED_SANITY_TYPE_NAMES,
  resolveSanityTypeNames,
  toCamelCase,
  toTitleCase,
  type TypeNamingStrategy,
} from "./naming.ts";
import { Report } from "./report.ts";
import { auditUnmappedTypes } from "./audit.ts";
import {
  rewriteBarrelFromDisk,
  writePageBuilderArtifacts,
} from "./pagebuilder.ts";
import {
  PT_TABLE_TYPE_NAMES,
  writePortableTextTableArtifacts,
} from "./pt-table.ts";
import {
  CONTENT_FRAGMENT_TYPE_NAMES,
  writeContentFragmentArtifacts,
} from "./content-fragment.ts";
import { writeContentRegistry } from "./content-registry.ts";
import { writeTemplatePageArtifacts } from "./template-pages.ts";
import {
  createSchemaPathPlanner,
  type EmittedKind,
  type SchemaPathPlanner,
} from "./layout.ts";

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
  /** Persist each component's raw dialog JSON to `{outputDir}/cache/aem/apps/...`. Defaults to true. */
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
   * Name of the generated page-builder array type. Names the emitted
   * `{name}.ts` file, its `defineType({ name })`, the field on the generic
   * page + per-template documents, and the type container drop-zones
   * reference. The content transform must emit page blocks under the same
   * name — the CLI reads both sides from `MIGRATION_PAGE_BUILDER_NAME`.
   * Default: `"pageBuilder"`.
   */
  pageBuilderName?: string;
  /**
   * How component type names (and therefore schema file names, registry
   * `sanityType`s, and ingested `_type`s) are derived. `"path"` (default)
   * uses the JCR path segments after `components/`; `"title"` uses the
   * component's `jcr:title` camelCased (`"Card Container"` →
   * `cardContainer`), falling back to the path-derived name when the title
   * is missing and disambiguating title collisions with a path-derived
   * suffix. `"title"` requires an extra fetch pass to read titles before
   * names are resolved. See {@link TypeNamingStrategy} for the stability
   * caveats — changing this (or a component's title in AEM) after content
   * has been imported orphans previously ingested `_type` values.
   */
  typeNaming?: TypeNamingStrategy;
  /**
   * Emit a `content-type-registry.json` alongside the schemas, mapping AEM
   * `sling:resourceType` → Sanity type + field names. Consumed by the content
   * migrator. Defaults to true. Preserves a hand-edited file (detected by the
   * absence of the `__generated` marker).
   */
  emitContentRegistry?: boolean;
  /** Path for the generated registry. Default: `{outputDir}/cache/content-type-registry.json`. */
  contentRegistryFile?: string;
  /** JCR prefix to strip from component paths when deriving `sling:resourceType`. Default: `/apps/`. */
  jcrPrefix?: string;
  /**
   * Where the generated schema .ts files (component schemas + page.ts +
   * pageBuilder.ts + index.ts barrel) are written. Defaults to
   * `{outputDir}/schemas`. Set this when the consumer (e.g. a Sanity Studio
   * app) wants the schemas under its own tree — keeps schema emission
   * decoupled from `outputDir`, which holds only regenerable cache state.
   */
  schemasDir?: string;
  /**
   * On-disk layout of `schemasDir`. `"flat"` (default) writes every file at
   * the top level; `"kind"` groups them into `documents/` (page docs,
   * per-template docs, `contentFragment`) and `objects/` (everything else).
   * Per-component `folder` overrides from `aem-component-names.json` win in
   * both layouts. The barrel `index.ts` always stays at the root, so Studio
   * imports are unaffected. Safe to switch between runs — file locations
   * change but type names don't, and stale copies are pruned.
   */
  schemaLayout?: SchemaLayout;
  /**
   * Treat per-component 401/403 failures as skips (logged + reported) rather
   * than aborting the whole batch. Matches the "unknown shapes are audit
   * findings, not failures" invariant for components that exist in AEM but
   * whose dialog is ACL-denied to the caller.
   *
   * Circuit breaker: if no component succeeds within the first
   * `authCircuitBreakerThreshold` auth failures (default 5), the batch still
   * aborts — that pattern signals credentials-wide failure (wrong password,
   * expired token) rather than per-path ACL denial, and continuing just
   * hammers AEM toward an account lockout.
   *
   * Default: false (existing behaviour — any auth failure aborts).
   */
  continueOnAuth?: boolean;
  /** Threshold for the `continueOnAuth` circuit breaker. Default: 5. */
  authCircuitBreakerThreshold?: number;
  /**
   * Map of `sling:resourceType` → `{ childrenField }` for AEM container
   * components whose children are dropped in via the editor (not via a
   * dialog multifield). For each listed component, the emitter appends a
   * synthetic `childrenField`-named `pageBuilder` array so authors can nest
   * blocks inside the container, and the content transform descends into
   * its child nodes with `sling:resourceType` at migration time.
   *
   * Empty / omitted → no container behavior (current default).
   */
  containers?: ContainerConfig;
  /**
   * Discovered named-slot map: `parentResourceType → slotKey → childTypes`.
   * Produced by {@link scanSlotsFromRawDir} (or {@link discoverSlots} for
   * tests). When present, the emitter appends a `defineField({ name:
   * slotKey, type: childTypeName })` per discovered slot so nested
   * dialog-less child components (e.g. `media-paragraph`'s `content`
   * child) become first-class typed fields instead of Studio "Unknown
   * field" warnings.
   *
   * Empty / omitted → no slot behavior. The transform still emits nested
   * components under their JCR keys regardless, so data never gets
   * dropped; the schema side is what upgrades warning → typed field on
   * the next `migrate:schema` run.
   */
  discoveredSlots?: Map<string, Map<string, { childTypes: Map<string, unknown> }>>;
  /**
   * Resource types seen as **direct page-body blocks** during the slot scan
   * (children of structural wrappers — page root / responsive grid). Guards
   * the slot-only page-builder exclusion: a component type that only ever
   * fills slots (e.g. promocard's button children) is dropped from
   * `pageBuilder.of[]` so it doesn't clutter the page-level "+ Add" menu,
   * but any type listed here stays — excluding it would orphan the page-body
   * blocks that already use it.
   *
   * Omitted / empty → no slot-only exclusion (every mapped component stays
   * in the page builder, the previous behavior).
   */
  slotPageBodyTypes?: Set<string>;
  /**
   * Per-slot configuration from `aem-component-slots.json`, keyed by parent
   * `sling:resourceType` → emitted slot field name. Currently carries
   * `visibleWhen` rules that mirror AEM enable-toggles (e.g. promocard's
   * `enablePrimaryButton` child gate) as Sanity conditional `hidden`
   * callbacks on the synthesized slot fields. Display-only: authored slot
   * content migrates regardless of the toggle's value.
   *
   * Empty / omitted → slots are always visible (current default).
   */
  slotVisibility?: SlotConfig;
  /**
   * Per-component opt-in for AEM authoring hints (e.g. `cq:panelTitle` on
   * accordion children). Listed components get the hint lifted at
   * transform time and a corresponding read-only Sanity field declared
   * on the emitted schema. Non-listed components stay clean — no
   * hint-related fields are added, no transform-time renames happen.
   *
   * The rename vocabulary (which AEM key becomes which Sanity field) is
   * defined globally in `AEM_AUTHORING_HINTS` (in core); this map only
   * controls which components opt in.
   *
   * Empty / omitted → no hint behavior on any component.
   */
  authoringHints?: AuthoringHintConfig;
  /**
   * Explicit type-name / Studio-title / folder overrides keyed by
   * `sling:resourceType` (from `aem-component-names.json`). Names win over
   * the `typeNaming` strategy; titles replace the component's `jcr:title`;
   * folders place the emitted file in a subfolder of `schemasDir` (in any
   * `schemaLayout`). Entries matching no listed component path are logged
   * and ignored.
   */
  componentNames?: ComponentNameConfig;
  /**
   * Per-tenant declaration of "page-shell" components — AEM components used as
   * the `sling:resourceType` of `jcr:content` rather than as page-body
   * blocks — paired with the `cq:template` paths each one is authored under.
   *
   * For every (resourceType, template) pair, the emitter renders one Sanity
   * **document type** whose fields are: title / slug / tags / pageBuilder
   * + an inline `pageProperties` object whose type is the Sanity object
   * already emitted for the page-shell dialog. The page-shell object type
   * is automatically added to `pageBuilderExclude` so it doesn't appear as
   * a block in `pageBuilder.of[]`.
   *
   * Empty / omitted → no per-template documents; the generic `page` doc is
   * the only page type, current behavior.
   */
  pageComponents?: PageComponentConfig;
}

export interface MigrateSchemasResult {
  report: Report;
  reportFile: string;
  auditPath?: string;
  pageBuilderFile?: string;
  pageFile?: string;
  contentRegistryFile?: string;
  /** Per-template doc type manifest (`{outputDir}/cache/page-templates.json`). */
  pageTemplatesFile?: string;
  /** Per-template document .ts files written under `schemasDir`. */
  templatePageFiles?: string[];
  /**
   * Resource types listed in `aem-page-components.json` but missing from
   * `aem-component-paths`. Their declared (or discovered) templates are
   * dropped silently — re-add them to `aem-component-paths` and re-run.
   */
  missingPageComponentPaths?: string[];
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
    pageComponents,
  } = opts;
  const concurrency = opts.concurrency ?? 4;
  const continueOnAuth = opts.continueOnAuth ?? false;
  const authCircuitBreakerThreshold = opts.authCircuitBreakerThreshold ?? 5;
  const schemasDir = opts.schemasDir ?? join(outputDir, "schemas");
  const pageBuilderName = opts.pageBuilderName ?? "pageBuilder";
  const typeNaming = opts.typeNaming ?? "path";
  const containers = opts.containers ?? new Map();
  const effectiveJcrPrefix = opts.jcrPrefix ?? "/apps/";
  const discoveredSlots = opts.discoveredSlots ?? new Map();
  const slotVisibility = opts.slotVisibility ?? new Map();
  const authoringHints = opts.authoringHints ?? new Map();

  const report = new Report();

  // Title-based naming needs each component's `jcr:title` BEFORE names can
  // be resolved, and names must be resolved before any schema is emitted.
  // Pre-fetch the component nodes concurrently and hand them to processOne
  // so the main pass doesn't fetch the same node twice. Pre-pass failures
  // are non-fatal here: the affected path just falls back to path-derived
  // naming, and the main pass re-fetches and reports the failure through
  // the normal per-component error handling. A circuit breaker stops the
  // pre-pass when nothing succeeds so wrong credentials don't hammer AEM
  // with a doomed second round of requests.
  const prefetchedNodes = new Map<string, DialogNode>();
  if (typeNaming === "title") {
    let preAuthFailures = 0;
    let preSuccesses = 0;
    await runWithConcurrency(
      componentPaths,
      async (p) => {
        try {
          prefetchedNodes.set(p, await fetcher(p));
          return { ok: true, auth: false };
        } catch (err) {
          return {
            ok: false,
            auth: err instanceof AemFetchError && err.kind === "auth",
          };
        }
      },
      concurrency,
      (r) => {
        if (r.ok) preSuccesses++;
        else if (r.auth) preAuthFailures++;
        return {
          shouldAbort:
            preSuccesses === 0 &&
            preAuthFailures >= (opts.authCircuitBreakerThreshold ?? 5),
        };
      },
    );
  }
  const titleByPath = new Map<string, string>();
  for (const [p, node] of prefetchedNodes) {
    const t = node["jcr:title"];
    if (typeof t === "string" && t.trim()) titleByPath.set(p, t.trim());
  }

  // Explicit name / title / folder overrides from `aem-component-names.json`.
  // Names are re-keyed from resource type to component path for the resolver;
  // titles are consumed per-component in processOne; folders feed the path
  // planner once names are resolved. Config entries that match no listed path
  // are logged and dropped (operator typo, or a component removed from
  // `aem-component-paths`).
  const componentNames = opts.componentNames ?? new Map();
  const nameOverrideByPath = new Map<string, string>();
  const titleOverrideByPath = new Map<string, string>();
  const folderOverrideByPath = new Map<string, string>();
  if (componentNames.size > 0) {
    const pathByResourceType = new Map<string, string>();
    for (const p of componentPaths) {
      pathByResourceType.set(resourceTypeFromPath(p, effectiveJcrPrefix), p);
    }
    for (const [rt, override] of componentNames) {
      const p = pathByResourceType.get(rt);
      if (!p) {
        logger?.warn(
          `component-names: "${rt}" matches no listed component path — entry ignored. Add /apps/${rt} to aem-component-paths or remove the entry.`,
        );
        continue;
      }
      if (override.name) nameOverrideByPath.set(p, override.name);
      if (override.title) titleOverrideByPath.set(p, override.title);
      if (override.folder) folderOverrideByPath.set(p, override.folder);
    }
  }

  // Resolve every component path to its final Sanity type name up front. This
  // is the single source of truth for naming across every downstream artifact
  // (emitted schema file, pageBuilder.of[], content registry, ingested
  // document `_type`). Doing it here — rather than leaving the Studio's
  // `sanitizeSchemaTypes` to rename reserved names at import time — is what
  // prevents ingested data from showing up as "Untitled" with an unknown-type
  // warning because its `_type` no longer matches the live schema.
  const typeNameByPath = resolveSanityTypeNames(componentPaths, {
    strategy: typeNaming,
    titleByPath,
    overrides: nameOverrideByPath,
    onFallback: (path, reason, finalName) =>
      logger?.info(`type-naming: ${path} → "${finalName}" (${reason})`),
  });

  // Layout planner: single source of truth for where each generated file
  // lands inside schemasDir. Folder overrides are keyed by resolved type
  // name, so this must come after resolveSanityTypeNames.
  const schemaLayout = opts.schemaLayout ?? "flat";
  const folderByTypeName = new Map<string, string>();
  for (const [p, folder] of folderOverrideByPath) {
    const typeName = typeNameByPath.get(p);
    if (typeName) folderByTypeName.set(typeName, folder);
  }
  const planner = createSchemaPathPlanner({
    layout: schemaLayout,
    folderByTypeName,
  });
  if (schemaLayout !== "flat") {
    logger?.info(
      `schema-layout: "${schemaLayout}" — grouping generated files under documents/ and objects/ (folder overrides win).`,
    );
  } else if (folderByTypeName.size > 0) {
    logger?.info(
      `schema-layout: flat, with ${folderByTypeName.size} folder override(s) from aem-component-names.json still applied.`,
    );
  }

  // The page-builder name doubles as a Sanity type name and a schema file
  // name, so it must not shadow a built-in type or a resolved component —
  // either would silently overwrite / desync the generated artifacts.
  if (emitPageBuilder && pageBuilderName !== "pageBuilder") {
    if (RESERVED_SANITY_TYPE_NAMES.has(pageBuilderName)) {
      throw new Error(
        `pageBuilderName "${pageBuilderName}" collides with a built-in Sanity type — pick a different MIGRATION_PAGE_BUILDER_NAME.`,
      );
    }
    for (const [path, name] of typeNameByPath) {
      if (name === pageBuilderName) {
        throw new Error(
          `pageBuilderName "${pageBuilderName}" collides with the Sanity type generated for ${path} — pick a different MIGRATION_PAGE_BUILDER_NAME.`,
        );
      }
    }
  }
  // Reverse index: slot children reference each other by AEM `sling:resourceType`,
  // but a Sanity `defineField({ type })` needs the Sanity type name. Build this
  // once so slot emission stays O(1) per lookup.
  const typeNameByResourceType = new Map<string, string>();
  for (const p of componentPaths) {
    const rt = resourceTypeFromPath(p, effectiveJcrPrefix);
    const n = typeNameByPath.get(p);
    if (n) typeNameByResourceType.set(rt, n);
  }

  // Slot config keyed to a resource type that isn't a listed component
  // would never reach processOne — surface the mismatch instead of
  // silently ignoring the entry (operator typo, or component removed from
  // `aem-component-paths`).
  for (const rt of slotVisibility.keys()) {
    if (!typeNameByResourceType.has(rt)) {
      logger?.warn(
        `slot-visibility: aem-component-slots.json entry "${rt}" matches no listed component path — ignored. Add ${effectiveJcrPrefix}${rt} to aem-component-paths or fix the key.`,
      );
    }
  }

  let authFailures = 0;
  let successes = 0;

  // Child resource types that land on a synthesized slot field — collected
  // across every processed component, then reconciled against page-body and
  // container appearances to decide which types are slot-only (and can drop
  // out of `pageBuilder.of[]`). Page-shell components don't feed the sink:
  // their direct children sit on `jcr:content`, so "slot child of a page
  // shell" says nothing about whether the type belongs in the page builder.
  const synthesizedSlotChildTypes = new Set<string>();

  await runWithConcurrency(
    componentPaths,
    (p) => {
      const rt = resourceTypeFromPath(p, effectiveJcrPrefix);
      return processOne(p, {
        fetcher,
        outputDir,
        schemasDir,
        planner,
        report,
        logger,
        writeAemSnapshot,
        regenerateCommand,
        typeName: typeNameByPath.get(p)!,
        titleOverride: titleOverrideByPath.get(p),
        pageBuilderName,
        prefetchedComponentNode: prefetchedNodes.get(p),
        containerEntry: containers.get(rt),
        slotMap: discoveredSlots.get(rt),
        slotVisibility: slotVisibility.get(rt),
        slotChildTypeSink: pageComponents?.has(rt)
          ? undefined
          : synthesizedSlotChildTypes,
        hintKeys: authoringHints.get(rt),
        typeNameByResourceType,
      });
    },
    concurrency,
    (r) => {
      if (r.success) successes++;
      if (r.authFailure) authFailures++;
      if (!continueOnAuth) return { shouldAbort: r.authFailure };
      // continueOnAuth: only abort if we've seen N auth failures in a row with
      // zero successes — signals credentials-wide failure, not per-path ACL.
      if (successes === 0 && authFailures >= authCircuitBreakerThreshold) {
        logger?.error(
          `continueOnAuth: ${authFailures} consecutive auth failures with 0 successes — circuit breaker tripped, aborting to avoid account lockout.`,
        );
        return { shouldAbort: true };
      }
      if (r.authFailure) {
        logger?.warn(
          `Auth failure on a component — treating as per-path ACL denial and continuing (continueOnAuth=true).`,
        );
      }
      return { shouldAbort: false };
    },
  );

  const reportFile = join(outputDir, "cache", "migration-report.json");
  await report.write(reportFile);
  const successResults = report.results.filter(
    (r): r is Extract<typeof r, { status: "success" }> => r.status === "success",
  );
  const successTypeNames = successResults.map((r) => r.sanityTypeName);
  const successMembers = successResults.map((r) => ({
    name: r.sanityTypeName,
    title: r.schemaTitle,
  }));

  // Page-shell components and per-template documents. Compute the exclusion
  // set first so it can feed into `writePageBuilderArtifacts.exclude` —
  // page-shells live on `jcr:content`, not in the page body, and would
  // otherwise show up in the "+ Add" menu inside pages.
  const pageShellExclude: string[] = [];
  if (pageComponents && pageComponents.size > 0) {
    for (const resourceType of pageComponents.keys()) {
      const sanityType = typeNameByResourceType.get(resourceType);
      if (sanityType) pageShellExclude.push(sanityType);
    }
  }
  // Slot-only components: types whose every observed appearance is as the
  // fill of a synthesized slot field (promocard's buttons, media-paragraph's
  // lone content child). Their schema types stay emitted and referenced by
  // the parents' slot fields; they just don't belong in the page-level
  // "+ Add" menu. Types also seen in a page body or a container drop zone
  // are kept — pulling those out of `pageBuilder.of[]` would orphan blocks.
  const slotOnlyResourceTypes = collectSlotOnlyResourceTypes({
    synthesizedSlotChildTypes,
    pageBodyTypes: opts.slotPageBodyTypes ?? new Set(),
    discoveredSlots,
    containerParents: new Set(containers.keys()),
  });
  const slotOnlyExclude: string[] = [];
  for (const rt of slotOnlyResourceTypes) {
    const typeName = typeNameByResourceType.get(rt);
    if (typeName) slotOnlyExclude.push(typeName);
  }
  if (slotOnlyExclude.length > 0) {
    logger?.info(
      `pagebuilder: excluding ${slotOnlyExclude.length} slot-only component type(s) from pageBuilder.of[] — ` +
        `${slotOnlyExclude.join(", ")}. They appear only inside parent slot fields (never directly in a page body or container drop zone); ` +
        `authoring them at page level somewhere in AEM would bring them back on the next run.`,
    );
  }

  const effectivePageBuilderExclude = [
    ...(pageBuilderExclude ?? []),
    ...pageShellExclude,
    ...slotOnlyExclude,
  ];

  // Canonical Portable Text table types (table/row/cell) — always emitted so
  // the `{ type: "table" }` member every richtext field now declares resolves
  // in any Studio consuming the generated barrel.
  await writePortableTextTableArtifacts({ schemasDir, planner });

  let pageBuilderFile: string | undefined;
  let pageFile: string | undefined;
  if (emitPageBuilder) {
    // Depth-limit escape hatch: `contentFragment` document + the
    // `contentFragmentRef` block aem-transform swaps in when a subtree is
    // cut. The ref block joins the page-builder palette so ingested refs
    // validate; the fragment document itself is not a droppable block.
    await writeContentFragmentArtifacts({
      schemasDir,
      pageBuilderTypeName: pageBuilderName,
      planner,
    });
    const pb = await writePageBuilderArtifacts({
      schemasDir,
      planner,
      componentMembers: [
        ...successMembers,
        { name: "contentFragmentRef", title: "Content Fragment" },
      ],
      exclude: effectivePageBuilderExclude,
      pageBuilderTypeName: pageBuilderName,
      logger,
    });
    pageBuilderFile = pb.pageBuilderFile;
    pageFile = pb.pageFile;
  }

  let pageTemplatesFile: string | undefined;
  let templatePageFiles: string[] | undefined;
  let templatePageTypeNames: string[] = [];
  let missingPageComponentPaths: string[] | undefined;
  if (emitPageBuilder && pageComponents && pageComponents.size > 0) {
    const tp = await writeTemplatePageArtifacts({
      schemasDir,
      planner,
      manifestOutputDir: outputDir,
      pageComponentsConfig: pageComponents,
      typeNameByResourceType,
      pageBuilderTypeName: pageBuilderName,
      logger,
    });
    pageTemplatesFile = tp.manifestFile;
    templatePageFiles = tp.documentFiles;
    // From the manifest (not documentFiles): hand-authored template pages
    // are preserved rather than rewritten, but they're still document types
    // for layout purposes.
    templatePageTypeNames = tp.manifest.entries.map((e) => e.sanityType);
    missingPageComponentPaths = tp.missingComponentPaths.length > 0
      ? tp.missingComponentPaths
      : undefined;
  }

  // Per-template document files count as "expected" — protect them from the
  // generated-file pruner that runs next, which otherwise nukes any .ts file
  // not in the component success list.
  const protectedTypeNames =
    pageComponents && pageComponents.size > 0
      ? [
          ...successTypeNames,
          ...(templatePageFiles?.map((f) => {
            const base = f.split("/").pop() ?? "";
            return base.endsWith(".ts") ? base.slice(0, -3) : base;
          }) ?? []),
        ]
      : successTypeNames;

  // Document-kind names for the pruner's expected-path check: everything
  // else generated is an object (components, pt-table, pageBuilder, refs).
  const documentTypeNames = new Set<string>(templatePageTypeNames);
  if (emitPageBuilder) {
    documentTypeNames.add("page");
    documentTypeNames.add("contentFragment");
  }

  await pruneGeneratedSchemaFiles(schemasDir, protectedTypeNames, {
    emitPageBuilder,
    pageBuilderName,
    planner,
    documentTypeNames,
    logger,
  });

  if (emitPageBuilder) {
    // Prefer filenames on disk so `index.ts` never imports a missing `.ts`
    // (e.g. if a write races or a stale checkout diverges from the report).
    await rewriteBarrelFromDisk(schemasDir, "page", pageBuilderName);
  } else {
    await writeSchemasBarrel(schemasDir, report, {
      emitPageBuilder: false,
      pageBuilderName,
      planner,
    });
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
    const file = contentRegistryFile ?? join(outputDir, "cache", "content-type-registry.json");
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
    pageTemplatesFile,
    templatePageFiles,
    missingPageComponentPaths,
  };
}

interface ProcessOneDeps {
  fetcher: NodeFetcher;
  outputDir: string;
  schemasDir: string;
  /** Layout planner deciding subfolder placement inside `schemasDir`. */
  planner: SchemaPathPlanner;
  report: Report;
  logger?: Logger;
  writeAemSnapshot: boolean;
  regenerateCommand?: string;
  /** Final Sanity type name resolved by `resolveSanityTypeNames` for this path. */
  typeName: string;
  /** Studio title override from `aem-component-names.json`; wins over `jcr:title`. */
  titleOverride?: string;
  /** Page-builder array type name container drop-zones reference. */
  pageBuilderName: string;
  /**
   * Component node already fetched by the title-naming pre-pass. When set,
   * processOne reuses it instead of re-fetching `componentPath`.
   */
  prefetchedComponentNode?: DialogNode;
  /** Container behavior opted in for this component (via `containers` config). */
  containerEntry?: { childrenField: string };
  /** Discovered named-slot keys for this resource type → set of child resource types. */
  slotMap?: Map<string, { childTypes: Map<string, unknown> }>;
  /** Per-slot config (visibility rules) for this resource type, keyed by emitted field name. */
  slotVisibility?: Map<string, SlotConfigEntry>;
  /**
   * Collects the child resource type of every slot field this component
   * synthesizes. Shared across the whole run; feeds the slot-only
   * page-builder exclusion. Omitted for page-shell components.
   */
  slotChildTypeSink?: Set<string>;
  /**
   * AEM authoring-hint keys (e.g. `cq:panelTitle`) opted in for this component
   * via the per-project hints config. Translated through `AEM_AUTHORING_HINTS`
   * to the corresponding Sanity field name and injected as a read-only field.
   */
  hintKeys?: ReadonlySet<string>;
  /** Reverse index: AEM resource type → Sanity type name, for slot child references. */
  typeNameByResourceType: Map<string, string>;
}

/**
 * Strip `jcrPrefix` (default `/apps/`) from a component path to derive the
 * AEM `sling:resourceType` key used by the container config map and the
 * content-type registry. Mirrors the same logic in `content-registry.ts`.
 */
function resourceTypeFromPath(componentPath: string, jcrPrefix: string): string {
  return componentPath.startsWith(jcrPrefix)
    ? componentPath.slice(jcrPrefix.length)
    : componentPath.replace(/^\/+/, "");
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
): Promise<{ authFailure: boolean; success: boolean }> {
  const {
    fetcher,
    outputDir,
    schemasDir,
    report,
    writeAemSnapshot,
    regenerateCommand,
    typeName,
  } = deps;

  let dialog: DialogNode;
  let schemaTitle: string | undefined = deps.titleOverride;
  // Populated when the dialog came from a `sling:resourceSuperType` ancestor
  // rather than the component's own `cq:dialog`. Reported so operators can
  // see inheritance in the schema report (and so audit reasons like "field
  // came from supertype X" remain inspectable later).
  let supertypeChain: string[] | undefined;
  try {
    const componentNode =
      deps.prefetchedComponentNode ?? (await fetcher(componentPath));
    const rawTitle = componentNode["jcr:title"];
    if (!schemaTitle && typeof rawTitle === "string" && rawTitle.trim()) {
      schemaTitle = rawTitle.trim();
    }
    const embeddedDialog = embeddedCqDialog(componentNode);
    if (embeddedDialog) {
      dialog = embeddedDialog;
    } else {
      // Try direct, then walk `sling:resourceSuperType` across /apps + /libs.
      // Mirrors AEM's runtime dialog-resolution so proxy components
      // (`/apps/<site>/components/foo` extending Adobe Core or a versioned
      // base) migrate without operators having to flatten the inheritance
      // by hand.
      const resolution = await resolveDialogViaSuperType(componentPath, fetcher);
      dialog = resolution.dialog;
      if (resolution.chain.length > 1) {
        supertypeChain = resolution.chain;
        deps.logger?.info(
          `${componentPath}: dialog inherited via supertype — chain ${resolution.chain.join(" → ")}`,
        );
      }
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
      return { authFailure: err.kind === "auth", success: false };
    }
    report.add({
      status: "failure",
      path: componentPath,
      kind: "network",
      message: (err as Error).message,
    });
    return { authFailure: false, success: false };
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
    return { authFailure: false, success: false };
  }

  if (deps.containerEntry) {
    const { childrenField } = deps.containerEntry;
    // If the dialog already declared a field by this name (unlikely but
    // possible if a component author reused the name), skip the synthetic
    // append — the dialog-declared field wins. Otherwise tack it on the
    // end so dialog-authored fields come first in the Studio UI.
    const clashes = mapped.fields.some((f) => f.name === childrenField);
    if (!clashes) {
      const container: SanityField = {
        name: childrenField,
        title: "Items",
        type: "container-children",
        pageBuilderTypeName: deps.pageBuilderName,
      };
      // When the dialog declares field groups, the Studio auto-selects the
      // first group tab (sanity 6.6: group with `default: true`, else first
      // non-hidden group) — an ungrouped synthesized field would only
      // surface under "All fields", which authors read as the field being
      // missing. Join the default tab instead.
      if (mapped.groups.length > 0) container.group = mapped.groups[0]!.name;
      mapped.fields.push(container);
    }
  }

  // Named-slot synthesis. Discovered slots are grouped by their logical base
  // (`normalizeSlotBase`) so the many author-generated JCR keys AEM stamps
  // onto repeated instances of one child (`content`, `content_1793623844`,
  // `content_1893078103_c`, …) collapse into ONE field instead of one
  // defineField per instance.
  // Priority rules:
  //   - Dialog field with the same name wins (skip).
  //   - Container parents skip slot synthesis entirely: their drop-zone
  //     children are already handled by `childrenField`.
  //   - Repeated / auto-named base → one `slot-array` (array of childType);
  //     a lone hand-named base (key === base, seen once) → one
  //     `slot-reference` (single inline block).
  //   - Multiple child resource types observed under one base → skip +
  //     warn; author tooling would need to pick one and we don't want to
  //     guess. Transform still emits under the JCR keys, so data isn't lost;
  //     the Studio just keeps flagging "Unknown field" until the operator
  //     hand-authors a field.
  //   - Child resource type without a known Sanity mapping (not in
  //     componentPaths) → skip + warn; can't reference a type that doesn't
  //     exist yet.
  // Track which `aem-component-slots.json` entries actually land on a
  // synthesized field. Leftovers get a warning below — a config key that
  // matches nothing is either a typo or a slot that no longer synthesizes
  // (dialog field took the name, container parent, no extract cache yet),
  // and silently ignoring it would leave the operator wondering why the
  // Studio still shows the field.
  const unusedSlotConfig = new Set(deps.slotVisibility?.keys() ?? []);
  if (!deps.containerEntry && deps.slotMap && deps.slotMap.size > 0) {
    const existingNames = new Set(mapped.fields.map((f) => f.name));

    // Group the discovered slot keys by their logical base. AEM auto-names
    // repeated authored instances of the same child (`content`,
    // `content1732069919C`, `content…CopyCopy`, `item_1657754806454`), so a
    // single logical slot surfaces under many JCR keys. Emitting one field
    // per key produces one `defineField` per author-drop — on content-heavy
    // tenants that blows past Sanity's per-dataset attribute limit. Collapse
    // each base to ONE field instead: an array when the base was authored
    // more than once or under an auto-generated key, a single reference when
    // it's a lone, hand-named slot.
    interface SlotBaseGroup {
      /** First raw key seen for this base — used for the field title. */
      sampleKey: string;
      childTypes: Set<string>;
      keyCount: number;
      /** True once any observed key differs from its base (auto-named). */
      autoNamed: boolean;
    }
    const byBase = new Map<string, SlotBaseGroup>();
    for (const [slotKey, slotEntry] of deps.slotMap) {
      if (slotEntry.childTypes.size === 0) continue;
      const base = normalizeSlotBase(slotKey);
      let group = byBase.get(base);
      if (!group) {
        group = { sampleKey: slotKey, childTypes: new Set(), keyCount: 0, autoNamed: false };
        byBase.set(base, group);
      }
      for (const ct of slotEntry.childTypes.keys()) group.childTypes.add(ct);
      group.keyCount += 1;
      if (slotKey !== base) group.autoNamed = true;
    }

    for (const [base, group] of byBase) {
      // A dialog field already owns this name → dialog wins, skip synthesis.
      const fieldName = toCamelCase(base);
      if (!fieldName) {
        deps.logger?.warn(
          `slot-discovery: ${componentPath} slot base "${base}" camelCased to empty string — skipping.`,
        );
        continue;
      }
      if (existingNames.has(fieldName)) continue;
      // Mixed child types under one base — can't pick a single member type
      // to declare. Leave it to the operator (dialog or custom wrapper);
      // transform still emits the data under the raw key so nothing is lost.
      if (group.childTypes.size > 1) {
        deps.logger?.warn(
          `slot-discovery: ${componentPath} slot "${base}" carries ${group.childTypes.size} child types — ` +
            `${[...group.childTypes].join(", ")}. Skipping synthesis; hand-author this field in the dialog or in a custom wrapper if you need it typed.`,
        );
        continue;
      }
      const childResourceType = [...group.childTypes][0]!;
      const childTypeName = deps.typeNameByResourceType.get(childResourceType);
      if (!childTypeName) {
        deps.logger?.warn(
          `slot-discovery: ${componentPath} slot "${base}" references unmapped child type "${childResourceType}". ` +
            `Add /apps/${childResourceType} to aem-component-paths and re-run migrate:schema to pick it up.`,
        );
        continue;
      }
      // Array when authored repeatedly or under an auto-generated key
      // (`content1732069919C`); a single inline reference only when it's a
      // lone, hand-named slot (key === base, seen once).
      const isArray = group.keyCount > 1 || group.autoNamed;
      const slotField: SanityField = isArray
        ? {
            name: fieldName,
            title: base,
            type: "slot-array",
            slotTypeName: childTypeName,
          }
        : {
            name: fieldName,
            title: base,
            type: "slot-reference",
            slotTypeName: childTypeName,
          };
      // Same default-group rule as the container-children field above:
      // without a group, a slot field on a tabbed dialog hides behind
      // "All fields" and authors never find it.
      if (mapped.groups.length > 0) slotField.group = mapped.groups[0]!.name;
      // Config-declared visibility (`aem-component-slots.json` →
      // `visibleWhen`): mirror the AEM enable-toggle as a conditional
      // `hidden` callback via the same ShowHideCondition machinery the
      // dialog show/hide mapper uses. A failed resolution (missing or
      // wrongly-typed controller) warns and leaves the slot visible.
      const slotEntry = deps.slotVisibility?.get(fieldName);
      if (slotEntry) {
        unusedSlotConfig.delete(fieldName);
        if (slotEntry.visibleWhen) {
          const condition = resolveSlotVisibilityCondition(
            slotEntry.visibleWhen,
            mapped.fields,
            (msg) =>
              deps.logger?.warn(
                `slot-visibility: ${componentPath} slot "${fieldName}" — ${msg}`,
              ),
          );
          if (condition) slotField.hiddenConditions = [condition];
        }
      }
      mapped.fields.push(slotField);
      existingNames.add(fieldName);
      deps.slotChildTypeSink?.add(childResourceType);
    }
  }
  for (const configuredSlot of unusedSlotConfig) {
    deps.logger?.warn(
      `slot-visibility: ${componentPath} configures slot "${configuredSlot}" in aem-component-slots.json, but no such slot field was synthesized — check the spelling against the emitted field name, and make sure content containing the slot has been extracted (slots are discovered from the extract cache).`,
    );
  }

  // AEM authoring hints (e.g. `cq:panelTitle` lifted to `panelTitle` at
  // transform time) — declared only for components that opted in via
  // `aem-component-hints.json`. Read-only because the value is preserved
  // from AEM, not authored from the Studio dialog. Components without a
  // hint config entry stay clean — no extra field on every component.
  if (deps.hintKeys && deps.hintKeys.size > 0) {
    const declaredNames = new Set(mapped.fields.map((f) => f.name));
    for (const aemKey of deps.hintKeys) {
      const sanityFieldName = AEM_AUTHORING_HINTS.get(aemKey);
      if (!sanityFieldName) {
        deps.logger?.warn(
          `authoring-hints: ${componentPath} opts into "${aemKey}" but it has no entry in AEM_AUTHORING_HINTS — skipping. Add a row to packages/aem-to-sanity-core/src/aem/authoring-hints.ts to extend the rename vocabulary.`,
        );
        continue;
      }
      if (declaredNames.has(sanityFieldName)) continue;
      const hintField: SanityField = {
        name: sanityFieldName,
        title: toTitleCase(sanityFieldName),
        description: `AEM authoring hint preserved from migration (\`${aemKey}\`). Read-only.`,
        type: "string",
        readOnly: true,
      };
      mapped.fields.push(hintField);
      declaredNames.add(sanityFieldName);
    }
  }

  let contents: string;
  try {
    contents = await emitSchemaFile({
      typeName,
      sourcePath: componentPath,
      fields: mapped.fields,
      groups: mapped.groups,
      fieldsets: mapped.fieldsets,
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
    return { authFailure: false, success: false };
  }

  const outputFile = join(schemasDir, deps.planner.relPath(typeName, "object"));
  try {
    await writeTextFile(outputFile, contents);
  } catch (err) {
    report.add({
      status: "failure",
      path: componentPath,
      kind: "writeError",
      message: (err as Error).message,
    });
    return { authFailure: false, success: false };
  }

  report.add({
    status: "success",
    path: componentPath,
    sanityTypeName: typeName,
    schemaTitle: resolveSchemaTitle(typeName, schemaTitle),
    outputFile,
    fieldNames: flattenSchemaFieldNames(mapped.fields),
    fields: describeSchemaFields(mapped.fields),
    unmapped: mapped.unmapped,
    renamed: mapped.renamed,
    supertypeChain,
  });
  return { authFailure: false, success: true };
}

async function pruneGeneratedSchemaFiles(
  schemasDir: string,
  componentTypeNames: string[],
  opts: {
    emitPageBuilder: boolean;
    pageBuilderName: string;
    /** Where each kept type is EXPECTED to live this run. */
    planner: SchemaPathPlanner;
    /** Type names emitted as Sanity documents (everything else is an object). */
    documentTypeNames: ReadonlySet<string>;
    logger?: Logger;
  },
): Promise<void> {
  // Recursive walk — subfolder layouts put generated files below the root,
  // and a layout/folder-override switch leaves same-named copies at the old
  // location that only a full-tree pass can find.
  const files: string[] = []; // POSIX rel paths
  const subdirs: string[] = []; // rel paths, parents before children
  async function walk(dir: string, relPrefix: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    for (const entry of entries) {
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        subdirs.push(rel);
        await walk(join(dir, entry.name), rel);
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        files.push(rel);
      }
    }
  }
  await walk(schemasDir, "");

  const keep = new Set(componentTypeNames);
  for (const name of PT_TABLE_TYPE_NAMES) keep.add(name);
  if (opts.emitPageBuilder) {
    keep.add("page");
    keep.add(opts.pageBuilderName);
    for (const name of CONTENT_FRAGMENT_TYPE_NAMES) keep.add(name);
  }

  for (const rel of files) {
    if (rel === "index.ts") continue; // the barrel, rewritten after pruning
    const name = rel.split("/").pop()!.slice(0, -3);
    if (keep.has(name)) {
      // Kept type, but only at the path the current layout plans for it —
      // a copy left behind by a previous layout / folder override is stale.
      const kind: EmittedKind = opts.documentTypeNames.has(name)
        ? "document"
        : "object";
      if (rel === opts.planner.relPath(name, kind)) continue;
    }
    const full = join(schemasDir, rel);
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

  // Children before parents so nested empties collapse in one pass. rmdir
  // only removes empty dirs; anything still holding files (hand-authored
  // schemas, non-.ts assets) survives.
  for (const rel of subdirs.reverse()) {
    try {
      await rmdir(join(schemasDir, rel));
    } catch {
      // ENOTEMPTY / ENOENT — keep it.
    }
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
  schemasDir: string,
  report: Report,
  opts: {
    emitPageBuilder: boolean;
    pageBuilderName: string;
    planner: SchemaPathPlanner;
  },
): Promise<void> {
  const successNames = report.results
    .filter((r): r is Extract<typeof r, { status: "success" }> => r.status === "success")
    .map((r) => r.sanityTypeName)
    .sort();
  if (successNames.length === 0) return;

  const pageExtras = opts.emitPageBuilder
    ? [opts.pageBuilderName, "page", ...CONTENT_FRAGMENT_TYPE_NAMES]
    : [];
  const allNames = [...PT_TABLE_TYPE_NAMES, ...successNames, ...pageExtras];
  const relPathFor = (n: string): string => {
    const kind: EmittedKind =
      n === "page" || n === "contentFragment" ? "document" : "object";
    return opts.planner.relPath(n, kind);
  };

  const imports = allNames
    .map((n) => `import { ${n} } from "./${relPathFor(n)}";`)
    .join("\n");
  const list = allNames.join(", ");

  const src = `// GENERATED by aem-to-sanity-schema. Do not edit by hand.
${imports}

export const allSchemaTypes = [${list}];
${allNames.map((n) => `export { ${n} };`).join("\n")}
`;

  const file = join(schemasDir, "index.ts");
  await writeTextFile(file, src);
}

async function saveDialogJson(
  outputDir: string,
  componentPath: string,
  dialog: DialogNode,
  logger?: Logger,
): Promise<void> {
  const file = aemCacheAppsFile(outputDir, componentPath);
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
