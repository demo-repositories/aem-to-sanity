# aem-to-sanity-schema — handover

Standalone extraction guide. Copy two package directories into another project, patch the workspace dep, build once, run.

## What this package does

Reads AEM Granite UI component dialog definitions (`cq:dialog` trees) and emits:

- One Sanity object schema per AEM component (`defineType` / `defineField` TypeScript files in `output/schemas/<componentName>.ts`)
- Matching TypeScript types via Sanity TypeGen (`output/schema.json`, `output/sanity.types.ts`)
- A `page` + `pageBuilder` pair that registers all emitted components as array members — drop-in for a pagebuilder Studio
- A content-type registry (`output/content-type-registry.json`) mapping `sling:resourceType` → `sanityType` (used by downstream tooling; safe to ignore)
- A migration report (`output/migration-report.json`) with per-component outcome and unmapped fields
- Optional audit pointing at concrete JSON examples of unmapped AEM resource types, to extend the mapping table

What it does **not** do: fetch page content, migrate assets, import documents. Those pieces live in `aem-to-sanity-content` and are intentionally excluded from this handover — the user has decided to discard them.

## Files to copy

Two directories from this monorepo:

```
packages/aem-to-sanity-core/         # ~400 LOC of shared primitives
packages/aem-to-sanity-schema/       # the actual schema generator
```

`aem-to-sanity-schema` imports a small surface from `aem-to-sanity-core`:

| From core | Used for |
|---|---|
| `createLogger`, `Logger` | log formatting |
| `createColors` | stderr color helpers |
| `writeTextFile`, `writeJson`, `ensureDir` | output-dir writes |
| `resolveConfig` (+ `EnvSchema`) | env var parsing |
| `childNodes`, `isTruthyAttr`, `DialogNode`, `DialogNodeSchema` | dialog tree helpers |
| `fetchInfinityJson`, `AemFetchError` | AEM `.infinity.json` fetcher |

Nothing else from core is referenced by the schema package.

## Restructuring for a non-monorepo project

Option A — **drop in as two local packages** (fastest):

1. Copy both directories into the target repo, e.g. `vendor/aem-to-sanity-core` and `vendor/aem-to-sanity-schema`.
2. In `vendor/aem-to-sanity-schema/package.json`, change `"aem-to-sanity-core": "workspace:*"` to `"aem-to-sanity-core": "file:../aem-to-sanity-core"` (or a relative path from wherever you drop them).
3. `npm install` / `pnpm install` from the target repo, then `pnpm --filter aem-to-sanity-core build && pnpm --filter aem-to-sanity-schema build`.
4. Call the CLIs via `node vendor/aem-to-sanity-schema/dist/cli.js` (or add them to your project `package.json` scripts).

Option B — **inline core into schema** (one package, zero internal deps):

1. Copy `packages/aem-to-sanity-core/src/**` into `packages/aem-to-sanity-schema/src/internal/`.
2. In every `.ts` under `src/`, rewrite `from "aem-to-sanity-core"` to `from "./internal/index.ts"` (or whatever relative path).
3. Remove the `aem-to-sanity-core` entry from `package.json` dependencies.
4. Move `zod` from core's deps into schema's deps.
5. Rebuild.

Option A takes 5 minutes; Option B is cleaner long-term but needs ~30 min of import-rewriting.

## Dependencies you will need at install time

Runtime (already in `package.json`):
- `zod` (comes from core — keep if using Option A, move to schema if Option B)
- `dotenv`
- `prettier` (for pretty-printing emitted schema files)

Peer (used by the output, not by the generator itself):
- `sanity >= 5` — the emitted `output/schemas/*.ts` files import from `sanity`. The generator also uses the Sanity CLI's `schema extract` + `typegen generate` commands for the TypeGen step. If you don't run typegen, you don't need the peer.

Dev:
- `tsup` (build), `typescript`, `tsx` (only if running from source)

## Runtime inputs

### `aem-component-paths` (one path per line)

```
# Absolute JCR paths to component dialog roots.
/apps/mysite/components/content/button
/apps/mysite/components/content/hero
/apps/mysite/components/structure/container
# Blank lines and # comments are ignored
```

Each path should point at a `cq:Component` node whose `cq:dialog` subtree will be fetched via `.infinity.json` and walked.

### Environment variables

```
AEM_ENV=author                                # or publish
AEM_AUTHOR_URL=https://author.example.com
AEM_AUTHOR_USERNAME=...
AEM_AUTHOR_PASSWORD=...
# or: AEM_TOKEN=...
AEM_PUBLISH_URL=...                           # if AEM_ENV=publish

AEM_COMPONENT_PATHS_FILE=./aem-component-paths   # default
OUTPUT_DIR=./output                              # default
CONCURRENCY=4                                    # default
```

Put them in a `.env` at the project root — the CLIs auto-load via `dotenv/config`.

## CLIs exposed

```sh
aem-to-sanity-schema              # 1. fetch dialogs, emit output/schemas/*.ts + migration-report.json
aem-to-sanity-typegen             # 2. run `sanity schema extract` + `sanity typegen generate` → sanity.types.ts
aem-to-sanity-pagebuilder         # 3. rebuild output/schemas/page.ts + pageBuilder.ts from disk
```

Typical sequence:

```sh
pnpm exec aem-to-sanity-schema
pnpm exec aem-to-sanity-pagebuilder
pnpm exec aem-to-sanity-typegen
```

The pagebuilder step is separate so you can hand-author `page.ts`, add custom array members, or run it standalone after hand-adding a schema file to `output/schemas/`. It preserves any `page.ts` that no longer has the `GENERATED` marker comment.

## Programmatic API

```ts
import {
  migrateSchemas,            // end-to-end: fetch + emit + report
  writePageBuilderArtifacts, // rebuild page.ts + pageBuilder.ts
  scanSchemaTypeNames,       // list type names under output/schemas/
  rewriteBarrelFromDisk,     // regenerate output/schemas/index.ts
  writeContentRegistry,      // emit content-type-registry.json (for content pipeline; optional)
  runTypegen,                // run sanity schema extract + typegen generate
  sanitizeSchemaTypes,       // strip Studio-incompatible bits from a SchemaTypeDefinition[]
  mapDialog,                 // turn a parsed DialogNode into SanityField[]
  MAPPING, lookup,           // the granite-ui → sanity field mapping table
  type NodeFetcher,
  type SanityField,
  type MigrateSchemasResult,
} from "aem-to-sanity-schema";
```

`migrateSchemas` is the canonical entry point — see `src/api.ts` for the full signature. Minimal usage:

```ts
import {
  DialogNodeSchema,
  fetchInfinityJson,
  resolveConfig,
  createLogger,
  type DialogNode,
} from "aem-to-sanity-core";
import { migrateSchemas } from "aem-to-sanity-schema";

const config = resolveConfig(process.env);
const logger = createLogger({ level: "info" });

const fetcher = (jcrPath: string): Promise<DialogNode> =>
  fetchInfinityJson({ config, logger }, jcrPath, (raw) => {
    const parsed = DialogNodeSchema.safeParse(raw);
    if (!parsed.success) throw new Error(parsed.error.message);
    return parsed.data;
  });

const { report, reportFile } = await migrateSchemas({
  componentPaths: ["/apps/mysite/components/content/hero"],
  fetcher,
  outputDir: "./output",
  concurrency: 4,
  logger,
});
```

The `fetcher` is injectable — if your AEM source isn't HTTP (cached JSON dumps, a proxy, a different endpoint), swap it.

## Output layout

```
output/
  schemas/
    index.ts                 # barrel: re-exports every type
    page.ts                  # generated (or preserved if hand-authored)
    pageBuilder.ts           # generated array of defineArrayMember(...)
    <componentName>.ts       # one per emitted AEM component
  schema.json                # produced by `sanity schema extract`
  sanity.types.ts            # produced by `sanity typegen generate`
  migration-report.json      # per-component outcome + unmapped fields
  content-type-registry.json # sling:resourceType → sanityType map (ignore if not migrating content)
```

Drop `output/schemas/` + `output/sanity.types.ts` into your Sanity Studio — the barrel `output/schemas/index.ts` exports every emitted type plus `page` and `pageBuilder`.

Wire into `sanity.config.ts`:

```ts
import { sanitizeSchemaTypes } from "aem-to-sanity-schema/sanitize";
import * as generated from "./output/schemas"; // or copy to src/schemas

export default defineConfig({
  // ...
  schema: {
    types: sanitizeSchemaTypes(Object.values(generated)),
  },
});
```

`sanitizeSchemaTypes` strips non-serializable / Studio-incompatible bits the generator may have produced. Keep it — it's a ~50-line helper and it's load-bearing.

## Mapping table

Granite UI → Sanity field mapping lives in `src/mapping-table.ts`. To extend:

```ts
// src/mapping-table.ts
export const MAPPING: MappingEntry[] = [
  // ...existing rows
  {
    xtype: "granite/ui/components/coral/foundation/form/customwidget",
    sanity: { kind: "string", options: { list: ["a", "b"] } },
  },
];
```

Rebuild, rerun — unmapped fields land in `migration-report.json` under `unmappedFields` with the dialog path, so it's straightforward to triage.

## What NOT to copy

Skip unless you actually want the content side:

- `packages/aem-to-sanity-content/` — content extract/transform/import pipeline
- `examples/davids-bridal/aem-content-roots*` — pages-to-fetch config
- All `aem-extract`/`aem-transform`/`aem-assets`/`aem-import` CLIs and their env vars (`AEM_CONTENT_ROOTS_FILE`, `SANITY_*`, `MIGRATION_DRY_RUN`)

## Smoke test in the new project

```sh
# in the target project, after copying both packages and installing
echo "/apps/wknd/components/content/byline" > aem-component-paths
cat > .env <<EOF
AEM_AUTHOR_URL=https://localhost:4502
AEM_AUTHOR_USERNAME=admin
AEM_AUTHOR_PASSWORD=admin
EOF
pnpm exec aem-to-sanity-schema
ls output/schemas/           # should contain byline.ts + index.ts
```

If byline.ts appears and `migration-report.json` says `successes: 1`, the extraction worked.
