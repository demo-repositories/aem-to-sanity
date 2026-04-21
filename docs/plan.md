# AEM Component Dialog → Sanity Schema Migrator

## Context

David's Bridal has AEM components whose dialog definitions are exposed via `{host}/{componentPath}.model.json` (authenticated). We need a deterministic, one-shot Node/TypeScript script that:

1. Reads a list of AEM component paths (one per line) from `aem-component-paths`.
2. Fetches each `.model.json` using credentials from `.env` (switchable between author and publish environments).
3. Maps AEM Granite UI resource types → Sanity field types.
4. Emits a TypeScript schema file per component using `defineType`/`defineField` as an **object** type (to be embedded in pages as a block/module).
5. Logs every per-component outcome (success, failure reason, unmapped fields) to a JSON report.

Starting scope: two components (`/apps/aem-integration/components/promo`, `/apps/aem-integration/components/variable-column`). The script must scale to more without code changes.

The AEM→Sanity type mapping is the hard part and will iterate with user feedback, so the mapping table lives in a single, well-documented module and is re-exported as human-readable markdown at each run.

## Stack

- Node.js 20+, TypeScript, run via `tsx`
- `zod` — runtime validation of fetched AEM JSON (catches payload drift early)
- `dotenv` — env loading
- Native `fetch` — no HTTP client dependency
- `prettier` — formats emitted schema files
- No test framework initially; verification is by running against live AEM and inspecting output

## Project layout

```
aem-migration/
├── .env                          (existing; user supplies real creds)
├── .env.example                  NEW — committed template
├── .gitignore                    NEW — ignores .env, node_modules, output/
├── aem-component-paths           (existing input)
├── package.json                  NEW
├── tsconfig.json                 NEW
├── src/
│   ├── index.ts                  one-shot runner
│   ├── config.ts                 loads + validates env; picks author vs publish
│   ├── aem/
│   │   ├── fetcher.ts            GET .model.json with Basic auth (or Bearer)
│   │   └── types.ts              zod schemas for the dialog JSON shape
│   ├── sanity/
│   │   ├── mapper.ts             AEM field → Sanity field tree (recursive)
│   │   ├── emitter.ts            renders defineType/defineField TS file
│   │   └── naming.ts             component path → Sanity type name
│   ├── mapping-table.ts          single source of truth for the type map
│   └── report.ts                 accumulates and writes migration-report.json
├── docs/
│   └── aem-to-sanity-mapping.md  auto-generated from mapping-table.ts
└── output/
    ├── schemas/                  generated .ts files (one per component)
    └── migration-report.json     per-component result log
```

## Runner flow (`src/index.ts`)

1. Load `.env`. Select env with `AEM_ENV` (`author` | `publish`, default `author`).
2. Read `aem-component-paths`. Skip blank lines and `#` comments.
3. For each path (small concurrency, default 4):
   1. `GET {host}{path}.model.json` with `Authorization: Basic base64(user:pass)`.
   2. Parse + validate JSON with zod. On shape mismatch → record `parseError` with a short body excerpt.
   3. Walk the dialog tree; call the mapper per node. Containers (`tabs`, `well`, `fixedcolumns`, `container`) flatten; their children hoist up with an optional `fieldset` group for tab titles.
   4. Build the Sanity `defineType({ name, type: 'object', title, fields })` structure.
   5. Format with prettier; write to `output/schemas/{typeName}.ts`.
   6. Record `{ path, status, sanityTypeName, unmappedFields, error? }` to the report.
4. Write `output/migration-report.json`. Print a one-line summary. Exit non-zero if any `status === 'failure'`.
5. Regenerate `docs/aem-to-sanity-mapping.md` from `mapping-table.ts`.

## AEM → Sanity mapping (first pass — iterate from here)

Keyed by Granite UI `sling:resourceType`.

| AEM resource type | Sanity `type` | Notes |
|---|---|---|
| `.../form/textfield` | `string` | `fieldLabel`→`title`, `required`→`Rule.required()` |
| `.../form/textarea` | `text` | `rows` preserved |
| `.../form/richtext`, `cq/gui/.../richtext` | `array` of `block` | Minimal PortableText config |
| `.../form/numberfield` | `number` | `min`/`max` → validation |
| `.../form/checkbox` | `boolean` | `value`→`initialValue` |
| `.../form/select` | `string` + `options.list` | `items` children → list |
| `.../form/radiogroup` | `string` + `options.list` (`layout: 'radio'`) | |
| `.../form/datepicker` (type=date) | `date` | |
| `.../form/datepicker` (type=datetime) | `datetime` | |
| `.../form/pathfield` | `string` | Keep as string for now; reference resolution is future work |
| `cq/gui/.../fileupload` (image mimeTypes) | `image` | |
| `cq/gui/.../fileupload` (other) | `file` | |
| `.../form/multifield` | `array` of inline `object` | Walks its `field` child as the item shape |
| `.../foundation/container`, `tabs`, `well`, `fixedcolumns` | flattened | Tab titles → `fieldsets` / `group` |
| `.../form/hidden` | skipped | Logged as `skipped` in unmappedFields |
| anything else | placeholder `string` | Logged in `unmappedFields` with original resource type so mapping table can be extended |

Common attributes applied everywhere: `name` (strip leading `./`), `fieldLabel`→`title`, `description`, `required`→validation.

All of the above lives in `mapping-table.ts` as a typed record so `docs/aem-to-sanity-mapping.md` can be regenerated from it — docs never drift from code.

## Config surface (`src/config.ts`)

Validated via zod:

- `AEM_ENV` — `author` | `publish` (default `author`)
- `AEM_AUTHOR_URL`, `AEM_AUTHOR_USERNAME`, `AEM_AUTHOR_PASSWORD`
- `AEM_PUBLISH_URL`, `AEM_PUBLISH_USERNAME`, `AEM_PUBLISH_PASSWORD`
- `AEM_TOKEN` — optional; if set, Bearer auth used instead of Basic
- `AEM_COMPONENT_PATHS_FILE` — default `./aem-component-paths`
- `OUTPUT_DIR` — default `./output`
- `CONCURRENCY` — default `4`

The existing `.env` already has the right shape (author/publish split) but with localhost/admin placeholders — user will update to real values; `.env` stays untracked.

## Failure handling

Per-component failure modes, each captured to the report:

- `network` — fetch rejected or non-2xx
- `auth` — 401/403 → **fail fast**, abort the whole run (no point continuing)
- `parseError` — JSON invalid or zod validation failed (first 500 chars of body logged)
- `mappingError` — unexpected exception during the mapper walk
- `writeError` — filesystem failure

**Unknown AEM field types are not failures.** They're recorded in the component's `unmappedFields` list with the original `sling:resourceType` so you can review the report and extend `mapping-table.ts`. The emitted file still compiles — those fields become `string` placeholders with a `// TODO: mapping needed` comment and a description noting the original type.

## Verification

1. `npm install`
2. Update `.env` with real `AEM_AUTHOR_URL`, `AEM_AUTHOR_USERNAME`, `AEM_AUTHOR_PASSWORD`.
3. `npm run migrate`
4. Inspect `output/schemas/promo.ts` and `output/schemas/variableColumn.ts` — they should be valid TS importing from `sanity`.
5. Check `output/migration-report.json` — expect `{ successes: 2, failures: 0, unmapped: [...] }`. Any entries under `unmapped` are the next round of mapping-table work.
6. Drop one generated file into a Sanity Studio `schemaTypes` array and run `npx sanity schema validate` to confirm it loads.
7. Flip `AEM_ENV=publish` and re-run to confirm environment switching works.

## Files to create

- Root: `package.json`, `tsconfig.json`, `.env.example`, `.gitignore`
- `src/index.ts`, `src/config.ts`, `src/report.ts`, `src/mapping-table.ts`
- `src/aem/fetcher.ts`, `src/aem/types.ts`
- `src/sanity/mapper.ts`, `src/sanity/emitter.ts`, `src/sanity/naming.ts`
- `docs/aem-to-sanity-mapping.md` (auto-regenerated)

## Files to modify

- `.env` — add `AEM_ENV=author` line; user to replace placeholder creds with real values. Not committed.

## Out of scope (future iterations)

- Converting AEM `pathfield` → Sanity `reference` (needs a target document model).
- Fetching actual content instances (this project handles *definitions* only).
- Deploying schemas via `mcp__Sanity__deploy_schema` — user can add a `--deploy` flag later once the TS output is reviewed.
- Automated tests — will add once mapping table stabilizes after first user feedback pass.
