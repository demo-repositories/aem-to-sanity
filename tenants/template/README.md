# Tenant migration template

This folder is a starting point. **Scaffold a new tenant from it:**

```bash
pnpm -w migrate:init <your-tenant>     # works from any cwd in the repo
```

`<your-tenant>` is any short slug — `acme`, `tmobile`, `davids-bridal`. The new folder is gitignored (`tenants/*` is gitignored except this template) so each operator's working copy stays local.

The `-w` flag targets the root workspace, so this command works whether you're at the repo root or inside an existing `tenants/<tenant>/` folder. Drop the `-w` only when invoking from the repo root.

Existing tenant folders may lag the template as new env vars or scripts get added — run `pnpm -w migrate:doctor <your-tenant>` to detect drift, and `--fix` to auto-repair the `package.json` scripts block.

## What's in here

| File | What to fill in |
| --- | --- |
| `.env.example` | Copy to `.env` and set AEM source + Sanity destination credentials. See `docs/running-the-migration.md` § 1a-bis for the AEMaaCS authentication walkthrough. |
| `aem-component-paths` | One JCR path per line — the AEM components you want a Sanity schema for. Discover via `<AEM_AUTHOR_URL>/apps/<your-namespace>/components.1.json`. |
| `aem-content-roots` | The AEM page paths to walk (`@base` + slug syntax). See `aem-content-roots.example` for the full grammar. |
| `aem-component-containers.json` | Map `sling:resourceType` → `{childrenField}` for AEM containers whose drop-zone children should become a nested `pageBuilder` array. Empty until you find one. |
| `aem-component-hints.json` | Map `sling:resourceType` → list of `cq:*` authoring-hint keys to preserve. Empty by default. |
| `aem-page-components.json` | Map page-shell `sling:resourceType` → `{templates: [cq:template paths]}`. Each (resourceType, template) pair becomes one Sanity document type whose `pageProperties` lift from `jcr:content`. Empty by default — pages then use the generic `page` doc. |
| `aem-component-names.json` | Map `sling:resourceType` → explicit Sanity type name (string) or `{name, title, folder, file, icon}`, overriding the `MIGRATION_TYPE_NAMING` strategy per component (`name`/`title`), the emitted file's subfolder (`folder`), its exact basename + export const (`file`), and its Studio icon (`icon`, a `@sanity/icons` icon name like `ControlsIcon`). Empty by default. |
| `aem-dialog-overrides.json` | Map `sling:resourceType` → `{supplementaryTabs: [{path, insertAfter}]}` and/or `{dialogFile}`. Splices Sling-Resource-Merger-inherited dialog tabs the supertype walk can't see (fetched from the given JCR path), or replaces the whole dialog with a local JSON file. `pnpm eject-dialogs <paths…\|--all>` generates the `dialogFile`s for you (static, hand-editable snapshots under `dialog-overrides/`). Empty by default. |
| `aem-component-slots.json` | Map `sling:resourceType` → `{<slotField>: {visibleWhen}}` visibility rules for auto-discovered named slots (e.g. fold promocard's `buttonPrimary` behind its `enablePrimaryButton` toggle). Empty by default — slots stay always visible. |
| `aem-component-exceptions` | resource types / paths to skip during schema + transform. |
| `package.json` | Pre-wired scripts (`pnpm migrate:schema`, `extract`, `transform`, `assets`, `import`, `migrate`). Rename the `name` field after copying. |
| `studio/` | A per-tenant Sanity Studio (see `studio/README.md`). Scaffolded along with the tenant; point the tenant `.env`'s `SCHEMAS_OUT_DIR` at `./studio/schemas/generated` so emitted schemas land in it. Add one to an older tenant with `pnpm -w studio:init <your-tenant>`. |

## Bootstrapping a new tenant

```bash
# 1. Scaffold (copies the template, renames the workspace, seeds .env)
pnpm -w migrate:init <your-tenant>

# 2. Install (pnpm auto-discovers via tenants/* glob in pnpm-workspace.yaml)
pnpm install

# 3. Fill in credentials + component lists
$EDITOR tenants/<your-tenant>/.env
$EDITOR tenants/<your-tenant>/aem-component-paths
$EDITOR tenants/<your-tenant>/aem-content-roots
$EDITOR tenants/<your-tenant>/aem-tag-roots   # optional

# 4. Verify before running
pnpm -w migrate:doctor <your-tenant>

# 5. Run the pipeline
pnpm -F tenant-<your-tenant> migrate:schema   # AEM dialogs → Sanity schemas
pnpm -F tenant-<your-tenant> extract          # AEM pages → output/cache/aem/content/
pnpm -F tenant-<your-tenant> tags             # cq:Tag nodes → output/cache/categories/
pnpm -F tenant-<your-tenant> transform        # extract cache → output/cache/clean/
pnpm -F tenant-<your-tenant> assets           # DAM → Media Library + link
pnpm -F tenant-<your-tenant> import           # clean docs → Sanity dataset

# Or one shot (with destructive --discard-drafts at the end):
pnpm -F tenant-<your-tenant> migrate

# 6. Open the tenant's own Studio (fill studio/.env first;
#    set SCHEMAS_OUT_DIR=./studio/schemas/generated in the tenant .env
#    so migrate:schema emits into it)
pnpm -F tenant-<your-tenant>-studio dev
```

The `migrate` and `migrate:content` scripts tee their combined output to `output/execution-<timestamp>.log` (console output is unchanged — the file is for sharing post-run). Log path is banner'd at startup; files are gitignored under `output/`.

## Keeping a tenant in sync with the template

The template grows over time — new env vars, new pipeline stages, new defaults. To check whether an existing tenant folder lags behind:

```bash
pnpm -w migrate:doctor <your-tenant>          # report drift + missing env vars
pnpm -w migrate:doctor <your-tenant> --fix    # auto-repair the package.json scripts block
pnpm -w migrate:doctor --all                  # check every tenant under tenants/
```

Doctor checks:
- `package.json` scripts block matches the template (auto-fixable)
- `.env` contains every required var from `.env.example` with no leftover placeholder values
- At least one AEM authentication flow is configured (service credentials, developer token, or basic auth) — **skipped when `AEM_FIXTURES_DIR` is set** (offline fixture replay)
- When `AEM_FIXTURES_DIR` is set, validates the fixtures directory has path-mirror `content/` and `apps/` `.infinity.json` trees (warns if `assets/` is empty unless you use `--link-only`)
- `MIGRATION_DRY_RUN=false` runs have `SANITY_MEDIA_LIBRARY_ID` set
- Template files (`README.md`, `.env.example`, `aem-content-roots.example`) are not silently out of date

All five run in dry-run mode by default. Set `MIGRATION_DRY_RUN=false` in `.env` once the dry-run output looks right.

## Where to read more

- `docs/running-the-migration.md` — full operator runbook (env vars, per-stage flags, troubleshooting, AEMaaCS auth).
- `docs/overview.md` — architecture and stage-by-stage data flow.
- `docs/aem-to-sanity-mapping.md` — auto-generated mapping doc (regenerates from `mapping-table.ts` on each `migrate:schema` run).
