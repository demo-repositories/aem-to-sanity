# AEM → Sanity: restructure to reusable monorepo + add content migration

## Context

Today, `aem-migration/` is a single-purpose Node/TypeScript CLI that reads AEM component dialog definitions (`.model.json` / `.infinity.json`) and emits Sanity object schemas. It works well for that narrow task, but the wider AEM-migration project needs:

1. The schema generator reusable as **published npm packages** so a Sanity Studio (and later, the frontend app) in a separate monorepo can depend on it, and the community can adopt it.
2. **TypeScript types** generated alongside the schemas so downstream apps get typed GROQ results.
3. A second workflow: **content migration** — fetch AEM content via `.infinity.json`, walk the JCR tree, transform to Sanity documents, and write them via `@sanity/client`. AEM's `.infinity.json` truncates at depth ~5 and returns path-string markers where deeper nodes would be; that has to be handled transparently.
4. A **content audit** that flags schema/content mismatches discovered at data-extraction time — written to `output/` and streamed to stderr during the run.

All of this should be laid out so external teams can consume only the bits they need.

Decisions taken with the user:
- **pnpm workspaces + Turborepo** for the monorepo
- **Unscoped, public** npm packages (`aem-to-sanity-core`, `aem-to-sanity-schema`, `aem-to-sanity-content`)
- **Official Sanity TypeGen** (`sanity schema extract` + `sanity typegen generate`) for types
- **Two packages + shared core**: schema and content migration are separate; `core` holds AEM fetcher, auth, config schema, logger

## Out of scope for v1

- Testing framework and CI setup (tracked as follow-ups, not planned here)
- DAM/asset migration from AEM to Sanity assets
- Resolving AEM `pathfield` → Sanity `reference` (already deferred in existing `docs/plan.md`)
- Automatic publication of releases from CI

## Target repo layout

```
aem-to-sanity/                              ← repo root (renamed from aem-migration)
├── package.json                            private: true, workspace scripts
├── pnpm-workspace.yaml                     packages: ["packages/*", "apps/*", "examples/*"]
├── turbo.json
├── tsconfig.base.json                      strict, ES2022, NodeNext
├── .changeset/config.json                  access: public
├── .gitignore                              dist, .turbo, output, .env
├── README.md
│
├── packages/
│   ├── aem-to-sanity-core/                 SHARED: AEM fetcher, auth, config, logger, types
│   │   ├── package.json                    exports dist/index.js + .d.ts
│   │   ├── tsconfig.json                   extends ../../tsconfig.base.json
│   │   └── src/
│   │       ├── index.ts                    barrel
│   │       ├── config/
│   │       │   ├── schema.ts               zod EnvSchema + Config type (moved from src/config.ts)
│   │       │   ├── resolve.ts              resolveConfig(env: NodeJS.ProcessEnv) — NO dotenv side-effect
│   │       │   └── index.ts
│   │       ├── aem/
│   │       │   ├── fetcher.ts              fetchInfinityJson<T>(deps, jcrPath, parse?) — AemFetchError
│   │       │   ├── dialog-types.ts         zod DialogNode, childNodes, isTruthyAttr
│   │       │   ├── infinity.ts             NEW: depth-truncation detection + follow-up walker
│   │       │   └── index.ts
│   │       ├── logger.ts                   createLogger({ level, stream })
│   │       └── fs/output-writer.ts         writeJson, writeFile helpers (swappable)
│   │
│   ├── aem-to-sanity-schema/               dialog → Sanity schema + types
│   │   ├── package.json                    bin: "aem-to-sanity-schema"; deps: core, prettier, sanity
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                    barrel
│   │       ├── api.ts                      migrateSchemas(opts): Promise<MigrationResult>
│   │       ├── cli.ts                      thin: loads dotenv, resolveConfig, calls api
│   │       ├── mapper.ts                   moved from src/sanity/mapper.ts (uses core DialogNode)
│   │       ├── emitter.ts                  moved from src/sanity/emitter.ts
│   │       ├── naming.ts                   moved from src/sanity/naming.ts
│   │       ├── mapping-table.ts            moved, unchanged
│   │       ├── docs.ts                     regenerates aem-to-sanity-mapping.md
│   │       ├── report.ts                   moved from src/report.ts
│   │       ├── audit.ts                    NEW: promotes scripts/collect-unmapped-examples.ts to first-class step
│   │       └── typegen/
│   │           ├── index.ts                runTypegen({ outputDir, projectId, dataset })
│   │           ├── synthesize-config.ts    writes throwaway sanity.config.ts into outputDir/.typegen
│   │           └── run.ts                  spawns `sanity schema extract` + `sanity typegen generate`
│   │
│   └── aem-to-sanity-content/              NEW package: AEM content → Sanity documents
│       ├── package.json                    bin: "aem-to-sanity-content"; deps: core, @sanity/client
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           ├── api.ts                      migrateContent(opts): Promise<ContentMigrationResult>
│           ├── cli.ts                      thin wrapper
│           ├── extractor.ts                async-iterable walk; yields ExtractedDoc
│           ├── walker.ts                   traverses jcr:content tree; surfaces sling:resourceType
│           ├── transformer.ts              AEM ContentNode → Sanity doc (_type, _key, _ref)
│           ├── id-strategy.ts              pathToDocId — deterministic, reversible
│           ├── key-strategy.ts             stable _key from jcr:uuid or SHA1(path)
│           ├── writer.ts                   @sanity/client transaction batches; createOrReplace
│           ├── audit.ts                    drift detector: streams to stderr + writes output/audit/
│           └── type-registry.ts            loads schema package's emitted metadata for expected shapes
│
├── apps/
│   └── studio/                             example Sanity Studio consuming emitted schemas
│       ├── package.json                    private: true
│       ├── sanity.config.ts
│       ├── sanity.cli.ts
│       └── schemas/index.ts                imports from ../../examples/davids-bridal/output/schemas
│
└── examples/
    └── davids-bridal/                      reference config — matches current repo state
        ├── aem-component-paths
        ├── .env.example
        └── package.json                    scripts: migrate:schema, migrate:content
```

## Key API signatures

**`core/aem/infinity.ts`** — transparent depth handling:

```ts
// Resolves a full content subtree by issuing follow-ups whenever AEM returns
// a string marker where a node was expected (depth-5 truncation).
export async function fetchContentTree(
  deps: FetchDeps,
  rootPath: string,
  opts?: {
    maxDepthExpansions?: number;     // default 6 rounds of follow-ups
    concurrency?: number;            // default 4 parallel per call
    onFollowUp?: (path: string, depth: number) => void;
    signal?: AbortSignal;
  },
): Promise<ContentNode>;

export function detectTruncations(node: unknown, basePath: string): string[];
export function isTruncationMarker(value: unknown, expectedAt: string): boolean;
```

Cycle guard: `Set<absolutePath>`. On follow-up failure, the marker is replaced with `{ __truncated: true, path, error }` and an audit finding is emitted — the run continues. AEM sometimes returns `{}` instead of a path string at a depth boundary; `detectTruncations` must treat a suspiciously empty node whose parent advertises children (e.g. `jcr:primaryType: "nt:unstructured"` with siblings present) as a truncation signal too.

**`schema/api.ts`**:

```ts
export interface MigrateSchemasOptions {
  componentPaths: string[];
  fetcher: (jcrPath: string) => Promise<DialogNode>;
  outputDir: string;
  concurrency?: number;
  logger?: Logger;
  emitTypegen?: boolean;             // run Sanity TypeGen after emit
}
export async function migrateSchemas(opts: MigrateSchemasOptions): Promise<{
  report: Report;
  typegenPath?: string;
}>;
```

**`content/extractor.ts`** — async iterable for back-pressure-friendly streaming:

```ts
export async function* extract(
  deps: FetchDeps,
  opts: {
    rootPaths: string[];             // e.g. /content/site/us/en
    includeResourceTypes?: string[]; // filter; default = all mapped types
    maxDepthExpansions?: number;
    concurrency?: number;
    signal?: AbortSignal;
  },
): AsyncIterable<ExtractedDoc>;
```

**`content/api.ts`**:

```ts
export interface MigrateContentOptions {
  rootPaths: string[];
  fetcher: FetchDeps;
  sanityClient: SanityClient;
  schemaTypes: SchemaTypeRegistry;   // from schema package's emitted metadata
  outputDir: string;
  dryRun?: boolean;                  // DEFAULT TRUE — opt in with --confirm-write
  concurrency?: number;
  onDoc?: (doc: SanityDoc) => void;
  onAudit?: (finding: AuditFinding) => void;
}
```

## Content audit

- **Streamed** to stderr as NDJSON during the run (`{"t":"drift","component":"promo","path":"/content/...","unknownProps":["newField"]}`) — pipeable.
- **Persisted** as `output/audit/content-audit.json` grouped by component type:
  ```
  { byComponent: { promo: { unknownProps, unexpectedShapes, unknownResourceTypes, examples } },
    summary: { totalDocs, totalFindings, componentsAffected } }
  ```
- For each finding, include the first example AEM path + literal value — the dev needs enough to decide "extend mapping-table", "ignore", or "content bug". Cap examples at N per (component, finding) pair so the file doesn't explode on a real site.
- Future: `--promote-audit` flag re-runs the schema package against the audit to extend schemas. Not in v1.

## TypeGen approach

Synthesized config inside the schema package, written to `outputDir/.typegen/sanity.config.ts` at runtime (build artifact, not source). Runs `sanity schema extract` + `sanity typegen generate` as child processes with `cwd = outputDir`, writing `sanity.types.ts` next to emitted schemas. Consumers can disable with `emitTypegen: false` and run typegen from their own Studio if they prefer.

Rationale: the schema package is the authoritative list of emitted types; forcing consumers to also run typegen in their Studio is poor DX. The content package's `type-registry.ts` reads these generated metadata files at load time.

## Turborepo pipeline (`turbo.json`)

```json
{
  "tasks": {
    "build":            { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "typecheck":        { "dependsOn": ["^build"] },
    "lint":             {},
    "migrate:schema":   { "dependsOn": ["^build", "build"], "cache": false,
                          "outputs": ["output/schemas/**", "output/migration-report.json"] },
    "typegen":          { "dependsOn": ["migrate:schema"],
                          "outputs": ["output/sanity.types.ts"] },
    "migrate:content":  { "dependsOn": ["^build", "build", "typegen"], "cache": false,
                          "outputs": ["output/audit/**"] },
    "docs":             { "dependsOn": ["^build"], "outputs": ["docs/**"] }
  }
}
```

Network-dependent tasks (`migrate:*`) have `"cache": false`. `typegen` depends on `migrate:schema`. `migrate:content` depends on `typegen` so it can load the type registry.

## Build strategy

**tsup** for all three packages (emits ESM + CJS + `.d.ts` in one pass; lets `allowImportingTsExtensions` stay off without rewriting imports). `tsc --noEmit` still runs for `typecheck`. `tsconfig.base.json` at root with strict + NodeNext; each package extends and sets only `outDir`/`rootDir`. Skip TS project references for v1 — Turbo orchestrates ordering.

## Critical files to modify or move

- `src/aem/fetcher.ts` → `packages/aem-to-sanity-core/src/aem/fetcher.ts` (already has `fetchInfinityJson` — generalize, inject deps)
- `src/aem/types.ts` → `packages/aem-to-sanity-core/src/aem/dialog-types.ts`
- `src/config.ts` → split: schema+resolver to `core/config/`, dotenv side-effect moves to each package's `cli.ts`
- `src/sanity/*` + `src/mapping-table.ts` + `src/docs.ts` + `src/report.ts` → `packages/aem-to-sanity-schema/src/`
- `scripts/collect-unmapped-examples.ts` → `packages/aem-to-sanity-schema/src/audit.ts` (first-class run step, not a side script)
- `src/index.ts` → split into `packages/aem-to-sanity-schema/src/api.ts` + `cli.ts`

## Risks and mitigations

1. **`.model.json` vs `.infinity.json` drift.** The current fetcher uses `.infinity.json`; the existing `docs/plan.md` mentions `.model.json`. They are not equivalent (Sling Models output vs raw JCR). **Lock `.infinity.json` as the canonical dialog source** and use `.model.json` only when explicitly requested.
2. **Depth truncation is not always a string.** Handle both the path-string marker and the suspiciously-empty-node case in `detectTruncations`.
3. **`_key` stability across re-runs.** Derive from `jcr:uuid` when present, else SHA1 of JCR path. Never from array index.
4. **`_id` collisions with existing drafts.** `dryRun: true` by default; CLI must require `--confirm-write` to flip it.
5. **Unscoped npm name squatting.** `npm view aem-to-sanity-core` / `-schema` / `-content` before first publish. Fallback pattern: `aem2sanity-*`. Check in step 1.
6. **Changesets config for public unscoped packages.** Must explicitly set `"access": "public"`.
7. **Workspace protocol.** Dependent packages must use `"aem-to-sanity-core": "workspace:*"` — pnpm rewrites on publish.
8. **Studio app schema imports.** `apps/studio` imports from `examples/davids-bridal/output/schemas` (the generated artifact), NOT from `packages/aem-to-sanity-schema/dist`. That way the Studio is a real consumer test, and `studio#build` depends on `migrate:schema`.
9. **`noUncheckedIndexedAccess` inherits** into every package via `tsconfig.base.json` — the mapper already assumes this; keep it on.

## Recommended order of work

1. **Scaffold monorepo skeleton** — root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `turbo.json`, `.changeset/`. Verify `pnpm install` + `turbo run typecheck` on empty packages. `npm view` name availability check.
2. **Extract `aem-to-sanity-core`.** Move `src/aem/*` and pure parts of `src/config.ts`. Remove dotenv side-effect. Add `logger.ts`. `pnpm --filter aem-to-sanity-core build` works.
3. **Extract `aem-to-sanity-schema`.** Move `src/sanity/*`, mapping-table, docs, report, collect-unmapped-examples → audit. Split `api.ts` / `cli.ts`. **Regression gate:** `pnpm --filter aem-to-sanity-schema migrate:schema` must reproduce current output byte-for-byte against the same `aem-component-paths` list.
4. **Add TypeGen pipeline** inside schema package. Verify emitted `sanity.types.ts` compiles when imported.
5. **Build `aem-to-sanity-content` scaffolding** — extractor + walker + transformer + writer against *fakes*. Get a dry-run end-to-end on one AEM page BEFORE adding depth handling or audit.
6. **Add depth handling** in `core/aem/infinity.ts`, wire into content extractor. Highest-risk piece — isolate with recorded JSON fixtures.
7. **Add content audit** — streaming + persisted artifact.
8. **Scaffold `apps/studio`** consuming emitted schemas — smoke test + docs-by-example.
9. **Add `examples/davids-bridal`** — proves the whole thing works on a real project shape.
10. **`changeset version` + `pnpm publish --dry-run`.** Fix package metadata. Real publish only after dry-run passes on all three packages.

## Verification

- **After step 2:** `pnpm --filter aem-to-sanity-core typecheck` passes; barrel export surface is callable from a scratch script.
- **After step 3 (regression gate):** `pnpm --filter aem-to-sanity-schema migrate:schema` produces `output/schemas/*.ts` and `output/migration-report.json` identical to the pre-refactor output (diff must be empty or trivially cosmetic).
- **After step 4:** `output/sanity.types.ts` exists and a throwaway `.ts` file importing from it typechecks.
- **After step 5:** dry-run content migration on one `/content/...` path prints transformed Sanity docs to stdout (NDJSON). No writes to Sanity.
- **After step 6:** the same run handles a deliberately deep-nested AEM page (>5 levels) without missing data; `onFollowUp` is called with the expected deep paths.
- **After step 7:** deliberately introducing an unknown AEM prop on a test page surfaces a streamed stderr finding AND a grouped entry in `output/audit/content-audit.json`.
- **After step 8:** `pnpm --filter studio dev` boots a Sanity Studio that renders the migrated schemas; `npx sanity schema validate` exits 0.
- **End-to-end:** `turbo run migrate:schema typegen migrate:content --filter=examples/davids-bridal` runs the whole pipeline; the examples dir shows how a new consumer wires it up.

## Files to write this plan to

- Final plan also copied to `docs/monorepo-refactor-plan.md` once approved, so it lives alongside the existing `docs/plan.md` (which covered the original one-shot CLI design).
