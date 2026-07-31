# Running the AEM → Sanity migration end-to-end

This is the operator's guide: every env var, every command, and the order to run them in so you can go from a running AEM instance to content in Sanity.

The pipeline has three independent stages. Stage 3 is itself a four-step chain:

1. **Schemas** — read AEM component dialogs (`_cq_dialog`) → emit Sanity object types.
2. **TypeGen** — produce `sanity.types.ts` for typed GROQ clients.
3. **Content** — `aem-extract` → `aem-transform` → `aem-assets` → `aem-import`. Walks AEM `.infinity.json` trees, transforms JCR nodes into Sanity docs, uploads DAM assets, and commits via `@sanity/client`. **Dry-run by default**; set `MIGRATION_DRY_RUN=false` to write to Sanity.

A fourth, one-time step scaffolds the **Studio** that consumes the emitted schemas.

---

## 0. Prerequisites

- **Node** ≥ 22.12 (required by `sanity` v6, used in `apps/studio`)
- **pnpm** ≥ 9 (this repo is pnpm-only; npm/yarn will not resolve `workspace:*`)
- **AEM access** — an account that can `GET` both `*.infinity.json` on component paths and content paths, or an equivalent bearer token.
- **Sanity project** — create at [sanity.io/manage](https://www.sanity.io/manage). You need the project id, dataset name, and a write token (role: Editor or higher).

```bash
pnpm install
pnpm build   # builds all three packages into packages/*/dist
```

> **Shortcut for fresh projects:** `npm create @shehjad/aem-to-sanity <dir>` scaffolds a standalone single-tenant project (config + Studio at the root, toolkit installed from npm) — steps 0 and 1-pre in one command. In that layout the per-tenant commands below lose their `tenants/<slug>` prefix (`npx aem-to-sanity doctor`, `npm run migrate`) and toolkit updates are a plain `npm install` — walkthrough in [`docs/updating.md`](updating.md). See [`packages/create-aem-to-sanity`](../packages/create-aem-to-sanity/README.md) for flags, including `--clone` for a full monorepo checkout.

---

## 1. Configure environment variables

There are two `.env` files — one for the pipeline CLIs, one for the Studio. They can share values; they live in different directories because each tool loads `.env` from its own cwd.

### 1-pre. Bootstrap a tenant folder

Every migration runs from a tenant folder under `tenants/`. The only one tracked in git is `tenants/template/` — the template. **Scaffold a new tenant from it:**

```bash
pnpm -w migrate:init <your-tenant>   # works from any cwd in the repo
pnpm install                         # pnpm auto-discovers via the `tenants/*` glob in pnpm-workspace.yaml
```

`<your-tenant>` is any short slug — `acme`, `tmobile`, `davids-bridal`. The new folder is gitignored — only `tenants/template/` is committed, so each operator's working copy (with real credentials, customer-specific component lists, and per-run pipeline output) stays local.

Existing tenant folders may lag the template as new env vars, scripts, or pipeline stages get added. Run `pnpm -w migrate:doctor <your-tenant>` to detect drift and missing env, and `pnpm -w migrate:doctor <your-tenant> --fix` to auto-repair the `package.json` scripts block. Use `pnpm -w migrate:doctor --all` to scan every tenant under `tenants/` at once. When `AEM_FIXTURES_DIR` is set in `.env`, the doctor skips AEM auth checks and validates the fixtures layout instead.

### 1-pre-bis. Demo tenant (no AEM)

[`tenants/demo/`](../tenants/demo/) is a **committed** tenant with scrubbed AEM REST fixtures under `fixtures/aem/` — paths mirror AEM URLs (`content/...`, `apps/...`) plus `assets/` for DAM binaries. It runs the full pipeline without a live AEM instance — extract, tags, schema, transform, assets, and import all replay from disk via `AEM_FIXTURES_DIR`.

**Operator flow:**

```bash
cd tenants/demo
cp .env.example .env              # fill SANITY_* with your project
pnpm migrate:demo               # full offline pipeline
pnpm --filter studio dev        # verify in Studio
```

The demo `.env.example` ships dummy AEM auth (`AEM_AUTHOR_URL=http://demo.local`, `AEM_TOKEN=offline-fixtures`) plus `AEM_FIXTURES_DIR=./fixtures/aem`. No real AEM credentials are needed.

**Maintainer flow** (regenerate fixtures from source tenant caches):

```bash
pnpm build:demo-fixtures --capture-tags   # needs gitignored source tenants + live AEM for tags once
pnpm migrate:doctor demo
```

Use `--scratch` to write to `output/demo-scratch/` for review before promoting to `tenants/demo/`.

**Assets:** `migrate:demo` runs `aem-assets` with `AEM_FIXTURES_DIR` set, which copies committed DAM binaries from `fixtures/aem/assets/` instead of downloading from AEM (see § 4c-quater).

### 1a. Pipeline `.env` — `tenants/<your-tenant>/.env`

```bash
cp tenants/<your-tenant>/.env.example tenants/<your-tenant>/.env
```

| Variable | Required? | Purpose |
| --- | --- | --- |
| `AEM_ENV` | yes | `author` or `publish` — which of the URL/credential pairs below to use. Default: `author`. |
| `AEM_AUTHOR_URL` | conditional | Base URL of your author instance. Required when `AEM_ENV=author`. AEMaaCS URLs look like `https://author-pXXXX-eYYYY.adobeaemcloud.com`. |
| `AEM_AUTHOR_USERNAME` | conditional | Basic-auth user for author. **AMS / on-prem only** — AEMaaCS rejects basic auth. |
| `AEM_AUTHOR_PASSWORD` | conditional | Basic-auth password for author. **AMS / on-prem only.** |
| `AEM_PUBLISH_URL` / `USERNAME` / `PASSWORD` | conditional | Same, for publish. |
| `AEM_TOKEN` | optional | Bearer token. Use this for **AEMaaCS developer (local-development) tokens** generated in Cloud Manager → Environment → Developer Console → *Integrations* → *Get Local Development Token*. They expire after 24h. Overrides basic auth when set. |
| `AEM_SERVICE_CREDENTIALS_FILE` | optional | Path to a **Service Credentials JSON** downloaded from Adobe Developer Console. The migration exchanges these credentials with Adobe IMS at startup and uses the resulting short-lived access token as a bearer. Works for both modern OAuth Server-to-Server and legacy JWT shapes. **Resolved against the tenant folder when run via `pnpm` scripts** — drop the JSON file alongside `.env` and reference it as `./service-credentials.json`. Absolute paths also work. See § 1a-bis. Highest priority — overrides `AEM_TOKEN` and basic auth. |
| `AEM_SERVICE_CREDENTIALS` | optional | Same content as the file above, but inlined as a JSON string (useful for CI where you'd rather paste into a secret manager than mount a file). Mutually exclusive with `AEM_SERVICE_CREDENTIALS_FILE`. |
| `AEM_COMPONENT_PATHS_FILE` | optional | File listing component JCR paths to migrate (one per line, `#` for comments). Default: `./aem-component-paths`. |
| `AEM_CONTENT_ROOTS_FILE` | optional | File listing content roots to walk during extraction. Default: `./aem-content-roots`. See `aem-content-roots.example` for syntax. |
| `AEM_TAG_ROOTS_FILE` | optional | File listing AEM tag namespaces / subtrees to walk during `aem-tags`. Default: `./aem-tag-roots`. Same format as `aem-content-roots` (slug semantics are irrelevant for tags). Only listed namespaces are migrated — there's no canonical "always skip" set in AEM. See § 1c-sexies. |
| `AEM_COMPONENT_EXCEPTIONS_FILE` | optional | File listing `sling:resourceType` values to skip during transform. Default: `./aem-component-exceptions`. |
| `AEM_COMPONENT_CONTAINERS_FILE` | optional | JSON file mapping `sling:resourceType` → `{ childrenField }` for AEM container components whose drop-zone children should become a nested `pageBuilder` array. Default: `./aem-component-containers.json`. Missing file → no container behavior. |
| `AEM_COMPONENT_HINTS_FILE` | optional | JSON file mapping `sling:resourceType` → `["cq:hintKey", …]`, opting individual components into AEM authoring-hint lifting (e.g. `cq:panelTitle` on accordion children). Default: `./aem-component-hints.json`. Missing file → no hint behavior. See § 1c-quinquies. |
| `AEM_COMPONENT_NAMES_FILE` | optional | `migrate:schema` only. JSON file mapping `sling:resourceType` → explicit Sanity type name (string) or `{ "name", "title", "folder", "file" }`, overriding the `MIGRATION_TYPE_NAMING` strategy per component (`name`/`title`), the file's subfolder inside the generated schemas dir (`folder`), and its exact basename + export const (`file`, wins over `MIGRATION_TYPE_SUFFIX_MODE=file`). Default: `./aem-component-names.json`. Missing file → strategy naming only. Set-once-before-first-import hazard for `name` (not for `folder`/`file`, which never change type names), same as `MIGRATION_TYPE_NAMING`. See § 1c-octies. |
| `AEM_COMPONENT_SLOTS_FILE` | optional | `migrate:schema` only. JSON file declaring per-slot behavior for auto-discovered named slots — currently `visibleWhen` rules that mirror AEM enable-toggles (e.g. promocard's `enablePrimaryButton`) as conditional `hidden` callbacks on the synthesized slot fields. Default: `./aem-component-slots.json`. Missing file → slots stay always visible. See § 2, "Slot discovery". |
| `AEM_PAGE_COMPONENTS_FILE` | optional | JSON file declaring page-shell components and the `cq:template` paths each is authored under (either listed explicitly via `"templates": [...]` or auto-discovered from extracted content via `"discover": true`). Each (resourceType, template) pair becomes one Sanity document type; the page-shell dialog becomes the doc's `pageProperties` field. Default: `./aem-page-components.json`. Missing file → no per-template docs (every page falls back to the generic `page` type). See § 1c-septies. |
| `AEM_MAX_RESPONSE_MB` | optional | Cap per-fetch payload size during extract. Pages exceeding this are recorded as `tooLarge` failures. |
| `MIGRATION_DOC_ID_PREFIX_STRIP` | optional | `aem-transform` only. Path prefix(es) to strip from JCR paths before deriving Sanity document `_id`s. Typical value is the `@base` from `aem-content-roots` (e.g. `/content/uxp/us/en`). Multiple prefixes allowed comma-separated; longest match wins. Without this, `_id`s carry the full path (`content-uxp-us-en-customer-support-plans-...`). With it, you get the page-relative form (`customer-support-plans-...`). Changing this between runs orphans previously imported docs — set once, leave alone. |
| `MIGRATION_SLUG_STRATEGY` | optional | `aem-transform` only. How each page doc's `slug.current` is derived. `segment` (default) uses the last segment of the JCR path (`chapters`) — AEM's own page-slug semantics. `path` uses the path relative to the roots-file `@base`, exactly as authored in `aem-content-roots` (`us/en/company-culture/belonging/chapters`) — useful when the frontend routes nested pages off the full sub-path. With `path`, raw caches extracted before this option existed (and absolute roots entries outside any `@base`) fall back to the last segment with a warning — re-run `aem-extract --overwrite` to capture the base-relative paths. Switching strategy between runs rewrites `slug.current` on every page (doc `_id`s are unaffected, so re-imports overwrite in place) — pick once, and move frontend routing in the same deploy if you must change it. |
| `MIGRATION_TYPE_NAMING` | optional | `migrate:schema` only. How component Sanity type names (and therefore schema file names, registry `sanityType`s, and ingested `_type`s) are derived. `path` (default) uses the JCR path segments after `components/` (`proxy/content/cardcontainer` → `proxyContentCardcontainer`). `title` uses the component's `jcr:title` camelCased (`"Card Container"` → `cardContainer`); missing titles fall back to the path-derived name, and title collisions keep the first component (in `aem-component-paths` order) clean while later ones get a path-derived suffix (`teaserProxyContentTeaser`). Every fallback is logged. `title` adds one extra fetch pass to read titles before names resolve. **Pick once before the first import** — switching strategy (or renaming a component's `jcr:title` in AEM) renames the emitted types and orphans previously ingested `_type` values; recovering needs `--recreate-on-type-change` or a fresh dataset. Custom `_type` values must also be mirrored in the frontend's block dispatcher. Individual components can override the strategy explicitly via `aem-component-names.json` (§ 1c-octies). |
| `MIGRATION_TYPE_SUFFIX` | optional | `migrate:schema` only. Global suffix appended **verbatim** to every strategy-derived type name (`proxyContentHero` → `proxyContentHeroBlock` with `Block`) so generated types can match an existing customer schema's naming vocabulary. Applies on top of either `MIGRATION_TYPE_NAMING` strategy; collision and reserved-name checks run against the suffixed names, so e.g. a component named `image` emits as `imageBlock` without needing the `aem` prefix. Explicit names from `aem-component-names.json` (§ 1c-octies) are exempt — they emit exactly as written. Letters/digits/underscore only; casing is yours (`block` yields `heroblock`). **Pick once before the first import** — same hazard as `MIGRATION_TYPE_NAMING`: changing the suffix renames every emitted type and orphans previously ingested `_type` values. To suffix only the generated files and export consts (keeping `_type` values bare), see `MIGRATION_TYPE_SUFFIX_MODE`. |
| `MIGRATION_TYPE_SUFFIX_MODE` | optional | `migrate:schema` only. What `MIGRATION_TYPE_SUFFIX` decorates. `type` (default) bakes the suffix into the Sanity type name itself — everything downstream carries it, including ingested `_type` values (set-once hazard above). `file` applies the suffix only to each generated file's basename and its `export const` identifier — `accordionType.ts` exporting `accordionType`, but `defineType({ name: "accordion" })` — the common Studio convention. In `file` mode the type name, registry `sanityType`, `pageBuilder.of[]`, and ingested `_type` values all stay bare, so the knob is **safe to add, change, or drop between runs**: only file names move, and the pruner removes copies at the old basenames. Applies to every component file, explicit `aem-component-names.json` names included (the override pins the type name; the file convention still applies on disk) — pin an entry's `file` to control its basename exactly (§ 1c-octies). Toolkit-owned files (`page.ts`, `pageBuilder.ts`, table types, `contentFragment`) keep bare names in both modes. Ignored when `MIGRATION_TYPE_SUFFIX` is unset. |
| `MIGRATION_PAGE_BUILDER_NAME` | optional | Name of the generated page-builder array type and the field page blocks land under. Read by **both** `migrate:schema` (names `{name}.ts`, the `defineType({ name })`, the field on `page.ts` / per-template docs, and container drop-zone references) and `aem-transform` (the key page blocks are written under), so set it once in the tenant `.env` before the first run and leave it alone — changing it between a schema run and a transform run desyncs the schema from the ingested content. Must be a valid identifier (letters/digits/underscores, starting with a letter); `page` and `index` are rejected (file collisions in the schemas dir). Default: `pageBuilder`. Frontends query this field by name, so a custom value must be mirrored in the consuming app's GROQ queries. |
| `MIGRATION_SCHEMA_LAYOUT` | optional | `migrate:schema` only. On-disk layout of the generated schemas dir. `flat` (default) writes every `{type}.ts` at the top level — the legacy behavior. `kind` groups files into `documents/` (the `page` doc, per-template docs, `contentFragment`) and `objects/` (component schemas, the page-builder array, table types, `contentFragmentRef`). Individual components can additionally pin a custom subfolder via a `folder` entry in `aem-component-names.json` (§ 1c-octies) — overrides apply in **both** layouts. The `index.ts` barrel always stays at the root of the schemas dir and keeps its `allSchemaTypes` export, so Studio imports never change. **Not a set-once knob**: switching layouts (or a `folder` override) only moves files — type names and ingested `_type` values are untouched, and the next run prunes copies left at the old locations. |
| `OUTPUT_DIR` | optional | Where schemas, reports, and audit live. Default: `./output`. |
| `CONCURRENCY` | optional | Parallel AEM fetches. Default: `4`. |
| `MIGRATION_DRY_RUN` | optional | `aem-assets` and `aem-import` are dry-run unless this is explicitly set to `false`. Default (unset): dry-run. |
| `MIGRATION_LINK_ONLY` | optional | `aem-assets` only. `true` ⇔ passing `--link-only`. Skips phases 1 + 2 (download + upload) and relies on phase 0 to find assets already in the Media Library. See § 4c. |
| `MIGRATION_ASSETS_DOWNLOAD_ONLY` | optional | `aem-assets` only. `true` ⇔ passing `--download-only`. Runs phase 1 (real AEM download) then stops — no ML dedup, upload, link, or rewrite, regardless of `MIGRATION_DRY_RUN`. No Sanity env vars required. For operators without Media Library access or migrating to a different asset platform. See § 4c-quinquies. |
| `MIGRATION_ASSETS_PLACEHOLDERS` | optional | `aem-assets` only. `true` ⇔ passing `--placeholders`. Skips AEM download; copies local SVG placeholders instead. See § 4c-ter. |
| `AEM_FIXTURES_DIR` | optional | When set, all AEM fetch CLIs (`aem-extract`, `aem-tags`, `migrate:schema`) read captured responses from this directory instead of HTTP. Paths mirror AEM URLs (`content/foo/bar.infinity.json`, `apps/.../_cq_dialog.infinity.json`). `aem-assets` also reads `assets/` under this dir when set. Capture with `capture-fixtures.ts` or `pnpm build:demo-fixtures`. Legacy flat `__`-encoded files are still read. See § 1-pre-bis. |
| `ASSET_CONCURRENCY` | optional | `aem-assets` only. Number of parallel workers used across phases 0 (ML dedup), 1 (AEM download), 2 (ML upload), 3 (dataset link). Default: `4`. Dedup in phase 0 guarantees each DAM path is processed by exactly one worker, so the shared manifest is never contended at the same key. |
| `MIGRATION_DISCARD_DRAFTS` | optional | `aem-import` only. `true` ⇔ passing `--discard-drafts`. Deletes `drafts.{id}` alongside each published `createOrReplace` so the Studio shows the freshly-imported content instead of a stale draft from a prior run. Opt-in — destroys authored in-progress edits. |
| `MIGRATION_RECREATE_ON_TYPE_CHANGE` | optional | `aem-import` only. `true` ⇔ passing `--recreate-on-type-change`. When an existing doc's `_type` differs from what the migration wants to write (e.g. a `page` doc becoming `planDetailsPage` after declaring it in `aem-page-components.json`), Sanity rejects the `createOrReplace` because `_type` is immutable. With this flag, `aem-import` pre-fetches the existing types and uses `delete + create` (within one transaction) for the affected ids. Opt-in — destroys the publish history and any draft of the affected docs. |
| `AEM_VERBOSE` | optional | `true` ⇔ passing `--verbose`. Elevates the CLI logger to `debug` so every AEM GET is logged. |
| `SANITY_PROJECT_ID` | required for writes | Only read when `MIGRATION_DRY_RUN=false`. |
| `SANITY_DATASET` | required for writes | |
| `SANITY_TOKEN` | required for writes | API token. Used for `aem-import` and for the Media Library **upload** phase of `aem-assets`. A project robot token (Editor+) works for `aem-import` and historically worked for ML upload too, but newer Media Library API versions reject robot tokens with `401 SIO-401-ANF "Session not found"` — if you hit that on phase 2, use a personal token here. See § 4c-bis for how to generate one. |
| `SANITY_MEDIA_LIBRARY_ID` | required for `aem-assets` writes | Id of the org-level Sanity Media Library that assets go into (e.g. `mlTnBiUKRzfi`). Must belong to the same org as `SANITY_PROJECT_ID`. Not needed (and not checked by `migrate:doctor`) when `MIGRATION_ASSETS_DOWNLOAD_ONLY=true`. |
| `SANITY_ML_LINK_TOKEN` | conditional | Personal auth token used for the Media Library **link** step in `aem-assets`. Required when `SANITY_TOKEN` is a project robot token (the link API rejects non-global sessions with `401 SIO-401-ANF`). See § 4c-bis for how to generate one. |
| `SANITY_API_VERSION` | optional | Default: `2024-01-01` for import; `aem-assets` pins `2025-02-19` because Media Library endpoints require it. |

Auth precedence: `AEM_SERVICE_CREDENTIALS_FILE` / `AEM_SERVICE_CREDENTIALS` (AEMaaCS via IMS) > `AEM_TOKEN` (developer / pre-minted bearer) > (`*_USERNAME` + `*_PASSWORD`) (on-prem / AMS basic auth). If none are set for the active `AEM_ENV`, the CLI fails fast and lists all three options.

### 1a-bis. AEM as a Cloud Service — Service Credentials & developer tokens

AEMaaCS does not accept basic auth. Pick one of the three flows below; the resolver auto-detects which based on which env vars you set.

#### Service Credentials (recommended for migration runs)

The right choice for anything more than a quick local trial — the token Adobe IMS issues is valid for hours, doesn't need to be re-pasted between runs, and survives CI workflows.

1. In **Cloud Manager**, open the target environment (the one you want to migrate from).
2. Click the actions menu → **Developer Console** (opens `dev-console-ns-team-aem-cm-prd-nXXXXX.ethos05-prod-va6.dev.adobeaemcloud.com/...` or similar).
3. Go to **Integrations** → **Service Credentials** → **Get Service Credentials** → **Create new technical account**. Adobe IMS provisions a technical account, generates a private key, and downloads a JSON file. Save it somewhere outside the repo — it carries credentials.
4. Point the migration at the file. Drop the JSON alongside the tenant's `.env` and use a relative path (resolved against the tenant folder when run via `pnpm` scripts):
   ```bash
   AEM_SERVICE_CREDENTIALS_FILE=./service-credentials.json
   ```
   Absolute paths also work if you'd rather keep the file outside the repo.
   Or, for CI, inline the JSON:
   ```bash
   AEM_SERVICE_CREDENTIALS='{"CLIENT_ID":"...","CLIENT_SECRET":"...","SCOPES":["..."], ...}'
   ```
   Set only one — both is a configuration error.

The migration accepts both shapes Adobe currently emits:

- **OAuth Server-to-Server** (current, for new integrations): flat object with `CLIENT_ID`, `CLIENT_SECRET`, `SCOPES`, `TECHNICAL_ACCOUNT_ID`, `IMS_ORG_ID`. The resolver exchanges these via `POST {imsEndpoint}/ims/token/v3` with `grant_type=client_credentials`.
- **Legacy JWT** (still issued for some AEMaaCS environments — deprecated by Adobe but supported by IMS through their migration window): `{ok, integration:{...}}` wrapper with `imsEndpoint`, `technicalAccount.{clientId,clientSecret}`, `org`, `metascopes`, `id`, `privateKey`. The resolver signs an RS256 JWT and exchanges it via `POST {imsEndpoint}/ims/exchange/jwt/`.

If your file doesn't match either shape, the CLI fails at startup with a message naming the missing fields — no opaque 401s deep in the walker.

Token lifetime: IMS access tokens are typically valid for ~24h. The migration uses a single token for the whole run, so a single token easily covers even a multi-hour migration. The startup banner prints `auth ims access token (len=…, prefix=…) (expires <ISO8601>)` so you can see at a glance how long you have. If you hit an expired token mid-run, just re-run the stage — the resolver fetches a fresh token at startup.

#### Developer (local-development) token

For quick local trials or one-shot debugging. Generate one in Cloud Manager → Environment → Developer Console → *Integrations* → *Get Local Development Token*, then paste:

```bash
AEM_TOKEN=eyJhbGc...
```

Expires after 24h. If the migration takes longer, regenerate and re-run — the manifest-driven extract/transform/assets stages are resumable.

#### Basic auth — on-prem / AMS only

`AEM_AUTHOR_USERNAME` + `AEM_AUTHOR_PASSWORD` works against author + publish on-prem and on AMS. AEMaaCS rejects it with 401. If you see a 401 banner against an `*.adobeaemcloud.com` URL with these set, switch to one of the two flows above.

#### Where to read more

- [AEM Headless Authentication Overview](https://experienceleague.adobe.com/en/docs/experience-manager-learn/getting-started-with-aem-headless/authentication/overview) — Adobe's matrix of the three flows.
- [Service Credentials walkthrough](https://experienceleague.adobe.com/en/docs/experience-manager-learn/getting-started-with-aem-headless/authentication/service-credentials) — step-by-step screenshots of provisioning a Service Credential in Cloud Manager.

### 1b. Studio `.env` — `apps/studio/.env`

```bash
cp apps/studio/.env.example apps/studio/.env
```

Sanity CLI auto-loads variables with the `SANITY_STUDIO_` prefix from this file:

```
SANITY_STUDIO_PROJECT_ID=your-project-id
SANITY_STUDIO_DATASET=production
```

The studio config also accepts unprefixed `SANITY_PROJECT_ID` / `SANITY_DATASET` as a fallback, so if you already exported those in your shell for the content CLI you don't need to duplicate them.

### 1c. Component path list — `tenants/<your-tenant>/aem-component-paths`

One JCR path per line. Lines beginning with `#` are ignored. Example:

```
/apps/<your-namespace>/components/content/heroBanner
/apps/<your-namespace>/components/content/promo
# add or remove paths as you migrate in waves
```

The schema CLI fetches `{path}/_cq_dialog.infinity.json` for each entry.

### 1c-bis. Content roots list — `tenants/<your-tenant>/aem-content-roots`

Consumed by `aem-extract` (stage 3). Supports `@base` sections to avoid repeating long paths, nested relative entries (slashes allowed), and absolute JCR paths. Example:

```
@base /content/uxp/us/en

home
about-us
customer-support/plans/consumer/phones/experience-beyond-plan   # nested relatives share the @base
development-growth/news/magenta-accelerator-fall-2026
/content/other-site/top                                          # absolute paths work too
```

Each line becomes a Sanity page doc with its `slug` derived from the **last segment** of the resolved JCR path — matching AEM's own page-slug semantics. So the nested entry above produces `slug: experience-beyond-plan`, not the full sub-path. Set `MIGRATION_SLUG_STRATEGY=path` to instead use the base-relative path exactly as authored in this file (`slug: customer-support/plans/consumer/phones/experience-beyond-plan`) — useful when the frontend routes nested pages off the full sub-path. See `aem-content-roots.example` for the full syntax (comments, absolute paths, multiple `@base` blocks).

### 1c-ter. Component exceptions — `tenants/<your-tenant>/aem-component-exceptions`

Consumed by `aem-transform`. One `sling:resourceType` (or `apps/...` prefix) per line; matching nodes and their subtrees are skipped. Use this for decorative wrappers or AEM-only utilities that don't belong in Sanity.

### 1c-quater. Container components — `tenants/<your-tenant>/aem-component-containers.json`

Consumed by both `migrate:schema` and `aem-transform`. Declares which components are AEM "containers" — ones whose children are dropped in via the page editor (cq:isContainer=true) rather than declared as a dialog multifield. Example:

```json
{
  "aem-integration/components/expander": { "childrenField": "items" },
  "aem-integration/components/container": { "childrenField": "items" },
  "aem-integration/components/column-layout": { "childrenField": "items" },
  "aem-integration/components/box": { "childrenField": "items" }
}
```

For each listed resource type:

- **Schema emission** appends a synthetic `defineField({ name: childrenField, title: "Items", type: "pageBuilder" })` to the component so the Studio palette inside the container matches the top-level page builder — every block type is droppable. The field is appended last so dialog-authored fields keep their declared order. Name collisions with dialog fields (same-name field already declared) leave the dialog field untouched and skip the synthetic append.
- **Content transform** walks the container's subtree — including `nt:unstructured` layout-only wrappers (AEM's responsive-grid pattern that wraps drop-zones in nodes carrying just a `layout` field, no `sling:resourceType`) — and emits each resource-type-bearing descendant as a pageBuilder block (same `_type` / `_key` / coercion pipeline as top-level blocks) under `childrenField`. Containers nest: an expander containing boxes containing content paragraphs all roundtrip. Children without `sling:resourceType` stay inline on the container (that's how multifields keep working).

**`flatten: true`** (optional, default `false`) — drops the container's own block at transform time and hoists its items into the parent's pageBuilder array. Use this for **pure layout containers** like AEM's responsive grid (`proxy/content/container`) where the wrapping component has no authored content of its own. Without `flatten`, deeply nested layouts (container-in-container-in-container, common in responsive-grid content) produce nested-block trees that can hit Sanity's hard **20-level attribute-depth limit** at import time. With `flatten`, every responsive-grid layer collapses and the actual content blocks end up at a sane depth. Containers with their own dialog fields you want preserved (accordions, expanders, named panels) should stay non-flatten.

**Tabs / accordion panels.** AEM's tab and accordion components drop the *same* container resource type into their panels that responsive grids use for layout — distinguished only by the `cq:panelTitle` the panel editor stamps on the node. A `flatten: true` container carrying `cq:panelTitle` therefore keeps its block (the title and the panel boundary are authored content); title-less containers flatten as usual, including inside a kept panel. To migrate the pattern: register the tabs/accordion component as a plain (non-flatten) container and opt the panel container's resource type into the `cq:panelTitle` hint in `aem-component-hints.json` (§ 1c-quinquies) so the title lands on a `panelTitle` field. Nested tabs roundtrip recursively. Preserving panels costs two attribute levels each, so deeply nested tabs-in-tabs pages can exceed Sanity's hard 20-level attribute-depth limit. The limit is per **document**, so the transform repairs this losslessly: it cuts the offending subtree into a standalone `contentFragment` document (deterministic `_id` from the page id + block `_key`) and leaves a `contentFragmentRef` block in its place — cuts nest when needed. Fragment docs are written into the same clean file and imported in the same per-page transaction; each cut is listed in `transform-report.json → depthExtractedFragments`. `migrate:schema` emits both types on every run and registers the ref block in the page-builder palette. Frontends resolve the reference with one extra GROQ join. Degenerate shapes that can't be cut fall back to flattening the deepest titled panel (lossy, reported under `depthFlattenedPanels`).

```json
{
  "uxp/components/structure/page":          { "childrenField": "items" },
  "uxp/components/proxy/content/container": { "childrenField": "items", "flatten": true },
  "uxp/components/proxy/content/wrapper":   { "childrenField": "items" }
}
```

**Styled wrappers** — components whose dialog is all layout config (per-breakpoint padding / gap / height / background for mobile, tablet, desktop) around a drop zone — are just non-flatten containers. Register them with `{ "childrenField": "items" }` (no `flatten`): the layout fields survive as ordinary typed fields with full coercion, slot discovery is skipped for the component, and its children land in `items`. Both authored shapes work: children placed directly on the wrapper node, and children inside a nested responsive-grid `container` — a `flatten: true` container nested inside a wrapper collapses into the wrapper's `items` (the intermediate container block disappears; the wrapper's own block does not). A childless wrapper emits `items: []`.

**`document: true`** (optional, mutually exclusive with `flatten`) — extracts every instance of the component into its own `contentFragment` document, with a `contentFragmentRef` block left in the parent array. Use for recursive structural components (tabs, accordions): depth resets per document so nesting never approaches the 20-level limit, the Studio always shows one click-through reference shape, and the frontend needs exactly one join per configured type. Fragment ids derive from the page id + block `_key` (idempotent re-runs); a re-run that stops producing a fragment leaves the old document orphaned — reconcile against `transform-report.json → configExtractedFragments`. Titles come from the component's dialog, falling back to the nearest panel title + block type ("Get started — accordion").

**Querying fragments from the frontend.** A `contentFragmentRef` block has one field — `fragment`, a reference to a `contentFragment` document (`title`, read-only `sourcePath`, and a `content` array of the same page-builder shape as the page's own). Resolve it with GROQ's dereference operator wherever you project a page-builder array:

```groq
*[_type == "page" && slug.current == $slug][0]{
  title,
  pageBuilder[]{
    ...,
    _type == "contentFragmentRef" => {
      ...,
      fragment->{ _id, title, content }
    }
  }
}
```

Two shapes to plan for: **refs are not only top-level** (they appear anywhere a page-builder block can, including inside a container's `childrenField` array — repeat the conditional projection at every level you project, or centralize it in a shared projection string), and **fragments nest** (a fragment's `content` can itself contain refs — nested tabs, chained depth cuts). GROQ can't recurse unboundedly, so either build the join in code and inline it to a known maximum depth, or resolve lazily: render the ref block as a component that fetches its fragment on mount (`*[_type == "contentFragment" && _id == $id][0]{ title, content }`). Lazy resolution is depth-proof and cache-friendly (fragment ids are stable across re-runs) — the safer default when authors control nesting depth. Full write-up with the depth-N helper: `docs/aem-to-sanity-mapping.md` § "Container components". Like every block `_type`, `contentFragmentRef` needs a matching primitive in the frontend's block dispatcher (see [`aem-to-sanity-demo-web`](https://github.com/demo-repositories/aem-to-sanity-demo-web)) that pipes the fragment's `content` back through the same dispatcher.

Missing file → container behavior stays off. Malformed JSON or invalid entries are a hard error (fail loudly rather than silently drop child content).

### 1c-quinquies. Authoring hints — `tenants/<your-tenant>/aem-component-hints.json`

Consumed by both `migrate:schema` and `aem-transform`. Opts specific components into AEM authoring-hint lifting — JCR/CQ properties that carry meaningful content but live outside the dialog payload, like `cq:panelTitle` on accordion / expander panel children. Without this opt-in, the transform's normal property iterator drops anything with a colon and the value is lost.

```json
{
  "aem-integration/components/box":     ["cq:panelTitle"],
  "aem-integration/components/content": ["cq:panelTitle"]
}
```

Two layers, one source of truth each:

- **Rename vocabulary** (`AEM_AUTHORING_HINTS` in `packages/aem-to-sanity-core/src/aem/authoring-hints.ts`) — the migrator-wide map of AEM keys to canonical Sanity field names (`cq:panelTitle` → `panelTitle`). Stable across projects.
- **Per-project opt-in** (this file) — names which components apply which hints. Per-project, since which components act as accordion children depends on the AEM authoring conventions in that project.

For each listed resource type:

- **Schema emission** appends a `readOnly` `string` field per opted-in hint (translated through the rename vocabulary). Read-only because the value is preserved from AEM, not authored from the Studio. Components not listed in this file get no extra fields — the rest of the schema stays clean.
- **Content transform** consults the same map keyed by the current node's `sling:resourceType`. If the node is opted in and the property is in its allowlist, the value is renamed and emitted under the Sanity field name; otherwise colon-bearing keys drop as before. The drift report skips opted-in keys so they don't surface as "unknown props".

Missing file → no hint behavior on any component. Malformed JSON or invalid entries are a hard error.

### 1c-octies. Component name overrides — `tenants/<your-tenant>/aem-component-names.json`

Consumed by `migrate:schema`. Optional per-component overrides for the emitted Sanity **type name**, Studio **title**, and/or output **folder**, keyed by `sling:resourceType` (a leading `/apps/` on the key is accepted). Use it when the `MIGRATION_TYPE_NAMING` strategy produces names that don't match your vocabulary — e.g. AEM titles its `.../content/lists` component "List" and its `.../content/list` component "Page List", so title naming assigns the names backwards from what operators expect.

```json
{
  "uxp/components/proxy/content/list":  { "name": "list",  "title": "List" },
  "uxp/components/proxy/content/lists": "lists",
  "uxp/components/proxy/content/navbar": { "folder": "navigationObjects" },
  "uxp/components/proxy/content/table":  { "name": "tableData", "file": "tableDataSchema" }
}
```

- A plain string value is shorthand for `{ "name": ... }`. `title` alone is allowed (rename in the Studio without touching the type name), and so is `folder` or `file` alone.
- **`folder`** places the component's generated `{type}.ts` in a subfolder of the schemas dir (e.g. `generated/navigationObjects/navBar.ts`). It must be a single path segment (letters/digits/underscore/hyphen, starting with a letter — no `/` or `.`), applies in both `MIGRATION_SCHEMA_LAYOUT` layouts (§ 1a), and — unlike `name` — is **safe to change between runs**: moving a file never renames the type, and the pruner removes the copy at the old location.
- **`file`** pins the generated file's basename (no `.ts`) exactly, and with it the module's `export const` identifier — `"file": "tableDataSchema"` emits `tableDataSchema.ts` exporting `tableDataSchema` while `defineType({ name })` keeps the entry's type name. Wins over the global `MIGRATION_TYPE_SUFFIX_MODE=file` decoration (§ 1a), so one entry can control type name, title, folder, and file independently. Must be identifier-like (letters/digits/underscore, starting with a letter) and unique across components — a duplicate (in the config, or against another component's resolved basename) is a hard error. Like `folder`, **safe to change between runs**: a file rename never touches the type name.
- **Explicit names win over the strategy** (path- or title-derived) and are claimed first: another component whose derived name collides with an override gets the usual collision fallback (path-derived suffix). Every override and fallback is logged. Explicit names are also exempt from `MIGRATION_TYPE_SUFFIX` in `type` mode (§ 1a) — they emit exactly as written, no suffix appended. In `file` suffix mode the on-disk convention still decorates their file names (the `name` contract covers the type name, not the basename) — pin `file` to opt an entry out of that too.
- Names must be identifier-like (letters/digits/underscore, starting with a letter). Naming a Sanity built-in (`image`, `text`, …) or assigning the same name twice is a hard error — an explicit choice that can't be honored fails loudly instead of silently renaming.
- Entries matching no path in `aem-component-paths` are logged and ignored.

**Set once, before the first import** — same hazard as `MIGRATION_TYPE_NAMING`: changing an override after content is ingested renames the emitted type and orphans existing `_type` values (see § 1a). Missing file → strategy naming only. Override the path via `AEM_COMPONENT_NAMES_FILE`.

### 1c-septies. Page-shell components — `tenants/<your-tenant>/aem-page-components.json`

In AEM, the `jcr:content` node of every authored page carries its own `sling:resourceType` pointing at a "page" component (e.g. `/apps/uxp/components/structure/page`). That component's `cq:dialog` defines page-level properties (`pwaOrientation`, `disableCache`, `pinPage`, …), and a sibling `cq:template` (e.g. `/conf/uxp/settings/wcm/templates/plan-details`) identifies what kind of page it is.

Declare those pairings here so each (page-component, template) combination becomes its own Sanity document type — pages are then browsable by template in the Studio, and the page-component dialog's authored values are lifted into a `pageProperties` field on the doc instead of being silently dropped.

```json
{
  "uxp/components/structure/page": {
    "templates": [
      "/conf/uxp/settings/wcm/templates/plan-details",
      "/conf/uxp/settings/wcm/templates/news-article",
      "/conf/uxp/settings/wcm/templates/landing-page"
    ]
  }
}
```

**Auto-discovery.** Listing every template by hand is tedious for tenants with many of them. Set `"discover": true` instead, and `migrate:schema` scans `output/cache/aem/content/` (extracted content) to enumerate every `cq:template` value found on `jcr:content` nodes matching the declared page-shell resource type:

```json
{
  "uxp/components/structure/page": {
    "discover": true
  }
}
```

Because discovery reads from already-extracted content, the natural order is `extract` → `migrate:schema` (the chained `migrate` script already runs them in this order). On a brand-new tenant the first `migrate:schema` finds no extracted content yet and logs a hint to run `extract` first — re-running schema picks up everything on the second pass.

Both forms can coexist: explicit `templates` pin known names, `discover: true` auto-adds new ones as they appear in content:

```json
{
  "uxp/components/structure/page": {
    "templates": ["/conf/uxp/settings/wcm/templates/plan-details"],
    "discover": true
  }
}
```

Effect on `migrate:schema`:
- The page-component (`uxp/components/structure/page` here) must also be listed in `aem-component-paths` so its dialog is fetched and emitted as an object type.
- One Sanity document type per `cq:template` is emitted (e.g. `planDetailsPage.ts`, `newsArticlePage.ts`). Fields: `title`, `slug`, `tags`, `pageProperties` (typed against the page-component object), `featuredImage` (image), `cqTemplate` (string, hidden/read-only), `pageBuilder`.
- The page-component object is automatically excluded from `pageBuilder.of[]` (it lives on `jcr:content`, not in the body), so it never appears in the "+ Add" menu inside a page.
- A `page-templates.json` manifest is written to `output/cache/` so `aem-transform` can route each raw page to the right `_type`.

Effect on `aem-transform`:
- Each page whose `jcr:content` matches a declared (resourceType, template) pair is emitted as the matching document type with `pageProperties`, `featuredImage`, and `cqTemplate` populated.
- Bookkeeping properties on `jcr:content` (replication agents, versioning, ContextHub paths) are dropped; the schema's `JCR_CONTENT_BOOKKEEPING_KEYS` denylist is the source of truth.
- Pages with a declared resourceType but undeclared template fall back to the generic `_type: "page"` doc and surface as `unknownPageTemplates` findings in `transform-report.json`.

Empty file → no per-template docs; every page uses the generic `page` doc as before (this is fully backwards compatible — existing tenants need no changes).

**Re-importing pages that already exist as `_type: "page"`.** First time you add an `aem-page-components.json` entry to a tenant that's already been imported, `aem-import` will fail with `immutable attribute "_type" may not be modified` — Sanity won't let you change a doc's `_type` in place. Re-run with `--recreate-on-type-change` (or `MIGRATION_RECREATE_ON_TYPE_CHANGE=true`) so the import deletes the old `page` doc and creates the new per-template doc atomically. Destroys the doc's publish history and any draft, so opt in deliberately.

### 1c-sexies. Tag roots — `tenants/<your-tenant>/aem-tag-roots`

Consumed by `aem-tags`. Plain-text list of AEM tag namespaces (or subtrees) to walk under `/content/cq:tags/`. Same format as `aem-content-roots`:

```text
@base /content/cq:tags

promotion
page-type
/content/cq:tags/wknd     # absolute paths also OK
```

Only what's listed here is migrated. There is no canonical "always skip" set in AEM — sample-content namespaces like `wknd` or `we-retail` are simply absent from the file. Discovery tip: hit `<AEM_AUTHOR_URL>/content/cq:tags.1.json` while logged into AEM author to list every namespace under your tag root.

Missing file → `aem-tags` exits 2 with an instruction to create one. Migrations that don't use AEM taxonomy can skip the `tags` stage entirely (the rest of the pipeline doesn't depend on it; `aem-transform` runs without tag resolution and content with `cq:tags` surfaces as unresolved findings instead).

### 1d. Resource-type registry — `output/cache/content-type-registry.json`

**Generated** by `migrate:schema`; you don't hand-author it. Maps AEM `sling:resourceType` values to the Sanity type names that stage 1 emitted, plus each field's name + Sanity type (used by the drift auditor and by `aem-transform` for type-aware coercion — e.g. HTML → Portable Text on `array-of-blocks` fields):

```json
{
  "__generated": "GENERATED by aem-to-sanity-schema. Remove this field (or delete the file) to take ownership; the next run will preserve your edits.",
  "entries": [
    {
      "resourceType": "aem-integration/components/promo",
      "sanityType": "promo",
      "fields": [
        { "name": "headline1", "type": "string" },
        { "name": "description", "type": "array-of-blocks" },
        { "name": "fileReference", "type": "image" }
      ]
    }
  ]
}
```

- `resourceType` — derived by stripping `/apps/` from each component path. Override via `jcrPrefix` on the programmatic API if your install uses a different prefix.
- `sanityType` — the emitted schema's `name`.
- `fields` — tree-shaped `Array<{name, type, itemFields?}>` covering every field the emitted schema declares. `array-of-object` fields carry their members under `itemFields` so the content transform can coerce AEM scalars into the right Sanity shape at any depth — HTML strings on `array-of-blocks` fields become Portable Text (via `@portabletext/block-tools`) whether they sit at the top level or inside a `variableColumn.columnContents[]` multifield row.

Legacy `fields: string[]` registry files are still accepted. The transform falls back to pass-through behavior on fields without type info, so old registries keep working but don't get the richtext coercion — regenerate to opt in.

**Taking ownership:** if your AEM content uses `sling:resourceSuperType` chains or unusual mappings, delete the `__generated` marker (or rewrite the file as a bare `[...]` array). The next `migrate:schema` run will preserve it and log that it skipped regeneration. The content CLI accepts both shapes.

Anything outside this registry is still extracted but tagged `_type: "aemUnmapped"` and flagged in the audit.

### 1e. Local cache layout — `output/cache/`

Every pipeline stage reads and writes under `tenants/<your-tenant>/output/cache/` (override root via `OUTPUT_DIR`). Paths mirror AEM JCR URLs where possible so fixtures (`fixtures/aem/content/...`) and operator caches share the same mental model:

```
output/
├── cache/
│   ├── aem/
│   │   ├── content/.../*.json     ← aem-extract + aem-tags (mirrors /content/...)
│   │   └── apps/.../*.json        ← migrate:schema dialog snapshots (mirrors /apps/...)
│   ├── clean/.../*.json           ← aem-transform (mirrors page paths under /content/...)
│   ├── categories/*.json          ← Sanity category docs from aem-tags (+ manifest.json)
│   ├── assets/                    ← local DAM cache + manifest.json (aem-assets)
│   ├── content-type-registry.json ← sling:resourceType → Sanity type (migrate:schema)
│   ├── migration-report.json      ← per-component schema pass/fail
│   ├── page-templates.json        ← cq:template routing manifest (migrate:schema)
│   ├── extract-report.json        ← aem-extract summary
│   ├── extract-404.log            ← aem-extract: roots that returned 404 (path + URL)
│   ├── transform-report.json      ← aem-transform drift findings
│   ├── tags-report.json           ← aem-tags summary
│   ├── assets-report.json         ← aem-assets summary
│   ├── assets-failures.log        ← aem-assets: DAM paths that failed download/upload/link
│   └── audit/unmapped-examples.json
└── execution-*.log                ← combined migrate log (when using run-with-log.ts)
```

**Legacy fallbacks.** Downstream stages still read older layouts when present: flat `output/cache/raw/*.json` (pre-path-mirror extract) and `output/cache/aem/components/apps/...` (pre-unification dialog cache). New runs write only the canonical paths above.

---

## 2. Stage 1 — emit Sanity schemas

```bash
pnpm --filter tenant-<your-tenant> migrate:schema
pnpm --filter tenant-<your-tenant> migrate:schema --verbose  # + per-request AEM GET logs
```

On start-up the CLI prints a banner summarizing what it's connecting to: AEM env, base URL, auth kind (basic shows the username only; bearer is shown as `len=N, prefix=abcd…` so you can confirm the right token is loaded without it leaking into logs), paths / roots files, output dir, concurrency. A Sanity preflight block follows with project id, dataset, and token presence — schema generation never calls Sanity, it's a config confirmation for the downstream content ingest.

| Flag / env | Effect |
| --- | --- |
| `--verbose` / `-v` or `AEM_VERBOSE=true` | Elevates the logger to `debug` level. Surfaces every `GET {url}` the AEM fetcher issues plus Sling `.N.json` depth-fallback retries. |
| `--continue-on-auth` or `AEM_CONTINUE_ON_AUTH=true` | Treat per-component 401/403 as per-path ACL skips and keep going, as long as at least one component succeeds. A circuit breaker still aborts on `N` consecutive auth failures with zero successes (signals credentials-wide failure, not ACL). |

**Outputs:**

Schema files are written to `apps/studio/schemas/generated/` (relative to the repo root, not the tenant folder — they're consumed by `apps/studio`). Reports and dialog snapshots live under the tenant's `output/` directory.

By default every generated file sits flat in the schemas dir. With `MIGRATION_SCHEMA_LAYOUT=kind` (§ 1a) the same files are grouped into `documents/` and `objects/` subfolders, and per-component `folder` overrides from `aem-component-names.json` (§ 1c-octies) pin custom subfolders (e.g. `navigationObjects/`). The paths in the table below shift accordingly; `index.ts` always stays at the root and its `allSchemaTypes` export is unchanged, so nothing downstream moves.

| Path | What it is |
| --- | --- |
| `apps/studio/schemas/generated/*.ts` | One Sanity object type per AEM component, named `componentNameInCamelCase`. Each carries a `preview.prepare` that returns a guaranteed-non-empty title (AEM `jcr:title` → title-cased type name → raw type name fallback), so array/Page Builder rows never render as "Untitled" even before the row has any data. **Gitignored by default** — every operator regenerates their own from their own AEM. The `generated/index.ts` stub stays tracked so the Studio boots on bare clone; `migrate:schema` overwrites it locally. |
| `apps/studio/schemas/generated/pageBuilder.ts` | Array type with every emitted block in `of: [...]`. Each member is emitted as `defineArrayMember({ type, title })` so the "+ Add" menu and row previews carry friendly labels. Regenerated each run. File and type name follow `MIGRATION_PAGE_BUILDER_NAME` (default `pageBuilder`) — see § 1a. |
| `apps/studio/schemas/generated/page.ts` | Minimal document type (`title`, `slug`, `tags`, `pageBuilder`). Preserved if you hand-author it. The page-builder field carries the `MIGRATION_PAGE_BUILDER_NAME` value. |
| `apps/studio/schemas/generated/index.ts` | Barrel exporting `allSchemaTypes` — re-exported by `apps/studio/schemas/index.ts` (which also adds the hand-authored `category` type) and plugged into `defineConfig`. |
| `output/cache/content-type-registry.json` (under the tenant folder) | AEM `sling:resourceType` → Sanity type + field names, consumed by stage 3. Preserved if you hand-edit. |
| `output/cache/aem/apps/**/*.json` | Raw dialog snapshots — audit trail (path mirrors `/apps/...`). Legacy `output/cache/aem/components/apps/...` is still read. |
| `output/cache/migration-report.json` | Pass/fail per component (including the resolved `sanityTypeName` and friendly `schemaTitle`) + unmapped props inventory. |
| `output/cache/audit/unmapped-examples.json` | Real-world examples per unmapped AEM type. Feed these back into `mapping-table.ts` when adding new mappings. |

**Source-controlling the generated schemas (opt-in).** The default — schemas gitignored, regenerated per-operator — keeps multi-tenant clones clean. Single-tenant projects that want the emitted vocabulary checked in (so it doubles as documentation, or to review schema drift in PRs) should comment out the `apps/studio/schemas/generated/` line in `.gitignore` and `git add` the regenerated files after each `migrate:schema` run. Don't do this on a repo that's shared across tenant migrations — one tenant's component vocabulary will conflict with another's on every push.

Re-run any time — output is deterministic, so `git diff` shows only real changes. Each CLI appends an `Elapsed:` line to its summary (and `aem-assets` prints a `Per phase:` breakdown) so you can see where time is going across runs.

**Slot discovery runs automatically on every schema pass.** `migrate:schema` scans `output/cache/aem/content/` — the output of `aem-extract` and tag roots from `aem-tags` — for AEM components that nest other AEM components under a JCR key (e.g. `media-paragraph`'s `content` child is itself an `aem-integration/components/content` block). **Repeated instances collapse to one field:** authors drop many copies of the same child into a parent and AEM auto-names the siblings (`content`, `content_1793623844`, `content_1893078103_c`, `content…_copy_copy`, …), so the scan groups them by logical base (timestamps, paste ids, and `_c`/`_co`/`_cop`/`_copy`/`C…` copy markers stripped) and emits a single **array of `<childType>`** field for repeated/auto-named slots — or a single typed inline reference for a lone hand-named slot (rendered **collapsed** in the Studio: one row the author clicks to open, rather than the child's full field set expanded among the parent's own fields). Without this collapse, one `defineField` per author-drop would blow past Sanity's per-dataset attribute limit on content-heavy tenants. First-ever run has no content cache to scan yet (scan returns empty, no slot fields emitted); run `aem-extract` once and the next `migrate:schema` picks every slot up. The content transform groups sibling nodes by the same base and obeys the array-vs-single decision the schema recorded in `content-type-registry.json`, so data never gets dropped on the first pass — the schema upgrade only clears Studio warnings. Skipped cases: dialog-field name collisions (dialog wins), container parents (their drop-zone logic claims all resourceType-carrying children already), multi-type bases (logged, hand-author if you need the field), and slots whose child type isn't yet in `aem-component-paths` (add it, re-run).

**Slot-only components leave the page-builder menu.** A component type that only ever appears as a slot fill (e.g. a `button` authored exclusively under `promocard`'s `buttonPrimary` / `buttonSecondary` keys) is excluded from `pageBuilder.of[]` — its schema type still exists and the parents' slot fields still use it; it just stops cluttering the page-level "+ Add" menu. Any type seen even once directly in a page body or inside a container drop zone stays in the menu. Each exclusion is logged by `migrate:schema`; authoring the component at page level in AEM restores it on the next run. Driven by extracted content, so the first run (no extract cache) excludes nothing.

**Slot visibility (optional).** Components that gate each child slot behind an enable-toggle in their own dialog — e.g. `promocard`'s `buttonPrimary` / `buttonSecondary` / `image` children controlled by `enablePrimaryButton` / `enableSecondaryButton` / `enableForegroundImage` checkboxes — can declare that link in `aem-component-slots.json` (override via `AEM_COMPONENT_SLOTS_FILE`), keyed by parent `sling:resourceType`, then by the emitted slot field name:

```json
{
  "uxp/components/proxy/content/promocard": {
    "buttonPrimary":   { "visibleWhen": "enablePrimaryButton" },
    "buttonSecondary": { "visibleWhen": "enableSecondaryButton" },
    "image":           { "visibleWhen": "enableForegroundImage" }
  }
}
```

The string form names a sibling **boolean** field (visible while `true`); `{ "field": "cardStyle", "equals": "flood" }` matches a sibling **string** field against one or more values. The synthesized slot field then carries a Sanity `hidden: ({ parent }) => …` callback so the Studio folds the slot exactly like the AEM dialog does. On dialogs with field groups (tabs), slot fields and the container `childrenField` join the first (default) group so they're visible on the tab the Studio opens with — not stranded under "All fields". Hiding is display-only — authored slot content always migrates and persists regardless of the toggle. Rules whose controller field is missing or wrongly typed are logged and skipped (the slot stays visible), as are rules naming a slot that never synthesized. Missing file → no visibility behavior.

**Show/hide widgets become conditional Studio fields.** Dialogs using [ACS AEM Commons show/hide](https://adobe-consulting-services.github.io/acs-aem-commons/features/ui-widgets/show-hide-widgets/index.html) (`acs-cq-dialog-dropdown-checkbox-showhide-target` in `granite:data`) or core AEM's stock `cq-dialog-dropdown-showhide` pattern (`cq-dialog-dropdown-showhide-target` on the select, `showhidetargetvalue` on each target) — a controller widget toggling every node marked with the selector's class — emit `hidden: ({ parent }) => …` callbacks on the affected fields, so the Studio dialog folds the same way the AEM one did. Target containers (wells, tab items) condition every field inside them; nested targets AND together; an unset controller counts as its AEM default (the select's `selected` option, the checkbox's `checked` attribute), so documents where AEM never persisted the property show what a fresh AEM dialog shows. Visibility is display-only: authored values migrate whether or not the field is currently shown. Details in [docs/aem-to-sanity-mapping.md](./aem-to-sanity-mapping.md) § "Show/hide widgets".

### Type-name resolution (reserved-name handling)

Component type names are resolved up front via `resolveSanityTypeNames` (in `aem-to-sanity-schema/naming.ts`). The base name is the camelCased tail after `components/`; if that collides with a Sanity built-in (`image`, `file`, `slug`, `text`, `string`, `number`, `block`, `object`, `array`, etc.) or with another path, it's prefixed with `aem` and — only if still colliding — suffixed with a numeric counter.

Example: `/apps/aem-integration/components/image` → `aemImage.ts` on disk, `aemImage` in `pageBuilder.of[]`, `"sanityType": "aemImage"` in the content registry, and `_type: "aemImage"` on every ingested document. Keeping all four artifacts aligned up front is what prevents ingested data from later appearing as "Untitled" + unknown-type warnings in the Studio.

The Studio-side `sanitizeSchemaTypes` still exists and runs the same rename as a defense-in-depth pass for hand-authored schemas, but for the emitter path it's a no-op.

### Dialog inheritance via `sling:resourceSuperType`

`migrate:schema` resolves each component's Granite UI dialog using the same chain-walking AEM does at request time:

1. Try the component's own `cq:dialog` (either embedded in the component node or fetched at `{componentPath}/_cq_dialog.infinity.json`).
2. On 404, read `sling:resourceSuperType` off the component itself. Absent → the component is genuinely dialogless and `migrate:schema` records a `failure` for it.
3. Resolve the supertype:
   - **Absolute** (`/apps/...`, `/libs/...`) — used as-is.
   - **Relative** (`<namespace>/components/...`) — AEM's lookup order is `/apps/<rt>` first (project + AMS overrides take precedence), `/libs/<rt>` second (Adobe defaults).
4. Recurse with the resolved path. A 10-hop cap and per-component cycle guard prevent runaway walks.

Why this matters in practice: **proxy components are the norm in AEMaaCS.** A site at `/apps/<site>/components/proxy/content/pageinfo` typically has no `cq:dialog` of its own — it extends a versioned base under `/apps/<site>/components/content/pageinfo/v1/pageinfo` (or, for Adobe-shipped components, something under `/libs`). Without chain resolution, those proxies fail with a 404 and the operator has to hand-list the supertype path in `aem-component-paths` — losing the proxy's identity in the process. With chain resolution, you list the proxy and the migrator finds the inherited dialog automatically.

The resolved chain is recorded in `migration-report.json` under each successful component's `supertypeChain` field (omitted for direct hits). Operators auditing emitted schemas can see exactly which ancestor supplied the dialog fields. Each run also logs an `info` line per inherited dialog:

```
[info] /apps/uxp/components/proxy/content/pageinfo: dialog inherited via supertype — chain /apps/uxp/components/proxy/content/pageinfo → /apps/uxp/components/content/pageinfo/v1/pageinfo
```

Important: **the registry key remains the original proxy path's resource type**, not the supertype's. Authored content has `sling:resourceType: uxp/components/proxy/content/pageinfo`, so that's what the registry needs as a lookup key. Two proxy components sharing one supertype produce two distinct Sanity types with identical field sets — they render identically in the Studio but each has its own `_type` so ingestion stays unambiguous.

You can verify a single component's dialog resolution before kicking off a full schema run with `scripts/aem-probe.ts`:

```bash
cd tenants/<your-tenant>
pnpm exec tsx ../../scripts/aem-probe.ts /apps/<site>/components/proxy/foo
# → Prints the supertype chain + the dialog's top-level form fields.
```

The probe uses the same `resolveDialogViaSuperType` helper from `aem-to-sanity-core` that the migrator does, so the probe's output is exactly what the schema run will see.

### Registering new block types between migrations

If you hand-add a `schemas/myBlock.ts` without re-running the whole migration, refresh the page-builder registration with:

```bash
pnpm --filter tenant-<your-tenant> pagebuilder:refresh
# or
npx aem-to-sanity-pagebuilder --output-dir ./output --exclude xfPage
```

This rescans `schemas/`, rebuilds `pageBuilder.ts`, and refreshes `schemas/index.ts`. It preserves `page.ts` if you've removed the `GENERATED` marker comment.

---

## 3. Stage 2 — TypeGen

```bash
pnpm --filter tenant-<your-tenant> typegen
```

Produces `output/sanity.types.ts`. Runs in-process via tsx + `@sanity/schema` internals — **no network call**, no `sanity schema extract` required.

Consume it in a downstream Sanity client like:

```ts
import type { HeroBanner } from "./output/sanity.types";
const doc = await client.fetch<HeroBanner>(`*[_type == "heroBanner"][0]`);
```

---

## 4. Stage 3 — content migration

Stage 3 is five independent CLIs, run in order. The `migrate:content` pnpm script chains them (`extract && tags && transform && assets && import`), but you can run each step on its own — each reads from the output directory of the previous one, so re-running just one stage is cheap. `tags` is optional — skip it for migrations that don't use AEM taxonomy.

```bash
pnpm --filter tenant-<your-tenant> migrate:content
# equivalent to:
pnpm --filter tenant-<your-tenant> extract
pnpm --filter tenant-<your-tenant> tags         # optional — only when migrating AEM tags
pnpm --filter tenant-<your-tenant> transform
pnpm --filter tenant-<your-tenant> assets
pnpm --filter tenant-<your-tenant> import
```

**All writes to Sanity are dry-run unless `MIGRATION_DRY_RUN=false` is set.** The `extract`, `tags`, and `transform` stages are read/local-only regardless; only `assets` and `import` touch Sanity.

### 4a. `aem-extract` — AEM `.infinity.json` → `output/cache/aem/content/`

Reads every entry in `aem-content-roots`, fetches `{root}.infinity.json` from AEM, and writes one JSON file per page under `output/cache/aem/content/` (path mirrors the JCR path, e.g. `/content/demo/us/en/home` → `cache/aem/content/content/demo/us/en/home.json`). Transparently follows depth-5 truncation markers (AEM returns a string marker like `"...section_0": "...section_0"` at the depth boundary; the fetcher detects these plus suspiciously-empty nodes, issues follow-up fetches in parallel, and splices resolved subtrees back in).

| Flag / env | Effect |
| --- | --- |
| `--overwrite` | Re-fetch pages that already have a cached extract file. Default: skip. |
| `AEM_CONTENT_ROOTS_FILE` | Path to roots file. Default: `./aem-content-roots`. |
| `AEM_MAX_RESPONSE_MB` | Per-fetch payload cap. Oversized responses are recorded as `tooLarge` failures. |
| `AEM_MAX_DEPTH_EXPANSIONS` | How many rounds of depth-5 follow-up fetches to run per root. Default: 3. Raise only if a page is pathologically deep; leftover markers after the budget are replaced with `{__truncated: "maxDepth", jcrPath}` sentinels and the transform stage treats them as opaque. |
| `AEM_FIXTURES_DIR` | If set, reads captured AEM responses from this directory instead of issuing HTTP calls. Capture fixtures with `packages/aem-to-sanity-core/scripts/capture-fixtures.ts` — default output is `<cwd>/output/cache/fixtures/aem/`. Used by unit tests and CI; leave unset for live migrations. |

**Outputs:** `output/cache/aem/content/**/*.json`, `output/cache/extract-report.json` (counts, categorized failures, ambiguous-path resolutions, and a `depthExpansions` array with per-root `markersFound`/`markersResolved`/`markersTruncated`/`markersFailed`/`expansionsUsed` stats), and `output/cache/extract-404.log` if any roots weren't found. Legacy flat `output/cache/raw/*.json` is still read by downstream stages when present.

### 4a-bis. `aem-tags` — AEM `/content/cq:tags` → `output/cache/categories/`

Walks every namespace (or subtree) listed in `aem-tag-roots`, fetching each via `fetchInfinityTree` (same depth-5 follow-up splicing the page extractor uses). Each fetch is cached under `output/cache/aem/content/cq:tags/...` (same path-mirror layout as pages). The walker then emits one Sanity `category` document per `cq:Tag` node — implementing Sanity's [parent-child taxonomy pattern](https://www.sanity.io/docs/developer-guides/parent-child-taxonomy). The hand-authored `category` document type lives at `apps/studio/schemas/category.ts`.

ID derivation is deterministic on both sides — `aem-tags` and `aem-transform` compute the same Sanity `_id` from the same AEM tag id, without sharing state:

| AEM tag id | Sanity category `_id` |
| --- | --- |
| `promotion` (namespace) | `category-promotion` |
| `promotion:payout` | `category-promotion-payout` |
| `promotion:payout/recurring-device-credits` | `category-promotion-payout-recurring-device-credits` |
| `color/red` (default namespace, prefix dropped) | `category-color-red` |

Long ids (>80 chars) fall back to `{first-60-chars}-{sha1-10}` so they stay under Sanity's 128-char `_id` limit even for deep tag trees. Hyphen-separated (not `.`) so the docs stay readable via the public CDN — same rule as `pathToDocId`.

**Default-namespace asymmetry.** Adobe's reference syntax drops the `default:` prefix: a tag at `/content/cq:tags/default/color/red` is authored as `color/red`, not `default:color/red`. `aem-tags` records this in the manifest so `aem-transform` resolves both forms the same way.

**Namespaces are categories too.** A namespace in AEM is a `cq:Tag` whose parent is not a `cq:Tag` (i.e. direct child of `/content/cq:tags`). The walker emits a category doc for the namespace itself, since authors expect to see it in the Studio reference picker as a grouping. Namespaces have no `parent` reference.

**`cq:movedTo` aliases.** When a tag has been merged/moved in AEM, the tombstone node carries `cq:movedTo` pointing at the new tag id. The manifest records these as aliases (no category doc is emitted for the tombstone), and `aem-transform` follows the alias chain when resolving authored references. Cycle guard prevents pathological alias loops.

**Allowlist, not denylist.** Only namespaces listed in `aem-tag-roots` are walked. AEM sample-content namespaces like `wknd` or `we-retail` are simply absent — there's no canonical "always skip" set to ship.

| Flag / env | Effect |
| --- | --- |
| `--overwrite` | Re-emit category doc files even when they already exist on disk. The manifest is always rewritten. |
| `AEM_TAG_ROOTS_FILE` | Path to tag roots file. Default: `./aem-tag-roots`. |
| `AEM_MAX_RESPONSE_MB` / `AEM_MAX_DEPTH_EXPANSIONS` | Shared with `aem-extract` — same response cap and depth-splice budget. |

**Outputs:**
- `output/cache/aem/content/cq:tags/**/*.json` — cached AEM tag trees (path-mirror).
- `output/cache/categories/<sanityCategoryId>.json` — one Sanity category doc per `cq:Tag` node. Shape `{ jcrPath, docs: [categoryDoc] }` so `aem-import` ingests them via the same loader as pages.
- `output/cache/categories/manifest.json` — keyed by AEM tag id (`namespace:parent/child` or `parent/child` for default-namespace tags). Value: `{ sanityCategoryId, title, slug, parentTagId, isNamespace, movedTo? }`. Consumed by `aem-transform` to resolve `cq:tags` strings on pages and components.
- `output/cache/tags-report.json` — counts, failures, depth-splice stats, `aliases`, and `danglingParents` (tags whose parent namespace wasn't included in the listed roots).

### 4b. `aem-transform` — `output/cache/aem/content/` → `output/cache/clean/`

Walks each cached page tree under `cache/aem/content/` (skipping `/content/cq:tags` entries), maps `sling:resourceType` values via `content-type-registry.json`, and emits one `page` doc per input file with a `pageBuilder` array of typed blocks (field name follows `MIGRATION_PAGE_BUILDER_NAME`, default `pageBuilder` — must match the value the schema run used; see § 1a). Clean output mirrors the same relative paths under `cache/clean/`. Each doc gets a deterministic `_id` (from JCR path) and each block a stable `_key` (from `jcr:uuid` or path SHA1). Unknown resource types and nodes listed in `aem-component-exceptions` are skipped but noted in the audit.

**Non-leaf roots: child pages are never inlined.** A roots entry migrates only that page's own body. When the fetched tree contains nested `cq:Page` children (the roots entry points at a section root rather than a leaf page), each child page's subtree is skipped, counted, and listed in `transform-report.json → skippedChildPages`; the run summary echoes the first few paths. To migrate the children, add each one as its own line in `aem-content-roots` and re-run `extract` → `transform` → `import` — every page becomes its own Sanity doc with its own `_id` and slug.

**Type-aware coercion.** AEM's JCR is schemaless on dialog inputs — every authored value lands in `.infinity.json` as a JSON string regardless of what the dialog widget was. The emitted Sanity schemas declare proper types (`number`, `boolean`, `array-of-blocks`), so without coercion the Studio rejects ingested values with "Expected type X, got String". Transform reads the registry's tree-shaped `fields` (`Array<{name, type, itemFields?}>`) and coerces at every depth — top-level fields *and* members inside nested `array-of-object` multifields (e.g. `variableColumn.columnContents[].columnText`):

- **`array-of-blocks`** — AEM `cq/gui/components/authoring/dialog/richtext` / Coral richtext values arrive as HTML strings. Converted to Portable Text via `@portabletext/block-tools` (with `jsdom` as the DOM). Decorators (`strong`, `em`, `underline`, `strike-through`, `code`), styles (`normal`, `h1`–`h4`, `blockquote`), lists (`bullet`, `number`), and `<a href>` annotations are preserved. `_key`s are derived from a SHA1 of `{jcrPath}::{fieldName}:{counter}` so re-runs produce byte-identical clean docs. On parser failure the original string is kept intact.
  - **Tables** — `<table>` elements become Sanity's native Portable Text table blocks (Studio ≥ 6.6): `{_type: "table", headerRows, rows[].cells[].value}`. `migrate:schema` emits the `table`/`row`/`cell` type definitions into the generated barrel and richtext fields as `of: [{type: "block"}, {type: "table"}]`; the toolkit's `aemFormComponents` enables the Studio table plugin so ingested tables are editable in place. `headerRows` comes from `<thead>` (or leading all-`<th>` rows); cell content keeps marks/links/lists; `colspan`/`rowspan` are dropped (content kept, short rows padded with empty cells); `<caption>` content is preserved as text block(s) before the table; nested tables flatten to text inside the parent cell; malformed tables fall back to plain flattened blocks. Note: `table`, `row`, and `cell` are now reserved type names — an AEM component deriving one of them is renamed with the `aem` prefix (e.g. `aemTable`), which orphans previously ingested docs of that `_type`; re-run `migrate:schema` → `transform` → `import --discard-drafts` after upgrading if a component was affected.
- **`number`** — coerced via `Number(v)`; kept as-is on `NaN`. AEM numberfield values land as `"10"` etc.
- **`boolean`** — coerced when the value is the literal string `"true"` or `"false"`, or matches a custom checkbox constant recorded in the registry (`checkedValue` / `uncheckedValue` — AEM checkboxes persist their `value` / `uncheckedValue` attrs, e.g. a link-target checkbox storing `"_blank"` / `"_self"`); kept as-is otherwise.
- **`date` / `datetime`** — AEM datepickers persist whatever their `valueFormat` dialog attribute says: the standard ISO-8601-with-offset JCR date when unset, a display-style string when set (`valueFormat="MMM DD, yyyy"` persists `"May 23, 2024"`). `migrate:schema` records the format in the registry; transform parses authored values with it and re-emits `YYYY-MM-DD` for `date` (keeping the literal date part on ISO inputs — no timezone shifting) or UTC ISO for `datetime`. ISO inputs and the common `MMM DD, YYYY` month-name shape coerce even when the registry predates format capture; unparseable values keep the original and surface in Studio validation.
- **`array-of-string`** — multi-select buttongroup (`selectionMode="multiple"`) values. JCR persists a multi-value string property, serialized as a JSON array when several values are picked but as a bare string when exactly one is — the bare string is wrapped into a one-item array; any other shape keeps the original value so the mismatch surfaces in the Studio.
- **`array-of-object`** — recurses into nested multifield items. Handles both AEM shapes: the ordered `item0`/`item1` form (materialized earlier in `transformInline`) and the named-key form (e.g. `colorCarousel.colors: { weddingDresses: {...}, bridesmaidDresses: {...} }`) — materialized here by taking `Object.values` of the keyed map in authored order.
- **`array-of-reference`** — AEM `cq/gui/components/coral/common/form/tagfield` values arrive as string arrays of canonical tag ids (`["promotion:payout/recurring-device-credits", "promotion:status/in-market"]`). Resolved through `output/cache/categories/manifest.json` (from `aem-tags`) into `[{_type:"reference", _key:..., _ref:"category-..."}]`. Follows `cq:movedTo` aliases. Page-level `cq:tags` on the `jcr:content` node are lifted onto the page doc's `tags` field via the same resolver. Tag ids not in the manifest get dropped and surfaced in `transform-report.json → unresolvedTagRefs` (operator either missed a namespace in `aem-tag-roots` or AEM has stale references to a deleted tag).

Before coercing, authored keys that differ from a declared field only by letter case are renamed onto the declared name at every depth (`linkURL` → `linkUrl`, `altValueFromDAM` → `altValueFromDam`). The schema emitter camelCases dialog `name`s while the JCR persists them raw; without the rename those values would surface as "Unknown field" in the Studio next to an empty declared field. Only case-only mismatches rename — genuinely different keys (e.g. a dialog field renamed in AEM after content was authored) still pass through untouched and appear in the drift report.

Legacy `content-type-registry.json` files without `fields[].type` skip every coercion step — regenerate via `pnpm migrate:schema` to opt in.

| Flag / env | Effect |
| --- | --- |
| `--registry <file>` | Override the default `./content-type-registry.json`. |
| `--include type1,type2` | Restrict to a comma-separated allow-list of `sling:resourceType` values. |
| `AEM_COMPONENT_EXCEPTIONS_FILE` | Path to exceptions file. Default: `./aem-component-exceptions`. |
| `MIGRATION_SLUG_STRATEGY` | `segment` (default) or `path`. `path` sets each page's `slug.current` to the roots-file base-relative path (`us/en/company-culture/belonging`) instead of the last segment. Full semantics in § 1a. |

**Outputs:** `output/cache/clean/**/*.json` (one Sanity doc per page, path-mirror layout) and `output/cache/transform-report.json` (unknown resource types with hit counts, unknown props per component, transform bails — with first-N example paths per finding — plus `skippedChildPages`: the full list of nested child pages excluded from non-leaf roots).

**Unmapped components, surfaced in the console.** At the end of each `aem-transform` run, any `sling:resourceType` that doesn't resolve to a Sanity type is printed directly to stderr as a ranked list — `<hits>× <resourceType>  /apps/<resourceType>`, plus one example JCR path per type. Those `/apps/...` lines are paste-ready for `aem-component-paths`; add them, re-run `migrate:schema` to emit schemas, then rerun `transform` + `import` to pick up the content that was dropped. The page root (`aem-integration/components/page`) and `wcm/foundation/components/responsivegrid` wrapper are hidden from this list — they're structural passthroughs the walker recurses through, not missing schemas. (They still appear in `transform-report.json` for completeness.)

### 4c. `aem-assets` — upload DAM → Media Library → link to dataset

> **Scope decision (@shehjadkhan 2026-04-22):** assets go to the Sanity **Media Library** (org-scoped), NOT the dataset's Content Lake. Each asset is uploaded once into the Media Library and then **linked** into the target dataset via the Global Document Reference (GDR) endpoint. The dataset holds a small linked asset document whose `_id` becomes the `asset._ref` inside content docs.

#### One-time: deploy the `aemSource` aspect

`aem-assets` stamps every uploaded asset with an `aemSource` aspect (`damPath` + cached `assetInstanceId`) so subsequent runs can dedup by origin JCR path instead of re-uploading. Deploy the aspect schema once per Media Library before the first live run:

```bash
pnpm --filter studio exec sanity media deploy-aspect aemSource
```

If this step is skipped, uploads still succeed — the stamp mutations fail gracefully (logged, not fatal) and the dedup pre-check in phase 0 returns no hits. Once deployed, running `aem-assets` once backfills the aspect on any prior-uploaded assets whose ids are still in the local manifest.

Scans `output/cache/clean/` for `/content/dam/...` references, downloads each asset from AEM, and runs five phases:

0. **Dedup lookup + manifest staleness check** — GROQ `*[_type=="sanity.asset" && aspects.aemSource.damPath == $damPath][0]` against the Media Library. A hit populates the manifest with both ids so phases 1+2 skip that asset entirely — no re-download from AEM, no re-upload to ML. Same content reused across pages/runs links to the same ML asset. When the lookup misses but the manifest already claims an `mediaLibraryAssetId`, phase 0 verifies the asset doc still exists in the ML (separate ID-based query). If the ML says the doc is gone (e.g. `sanity media delete`, `wipe-media-library`), the stale `mediaLibraryAssetId` / `linkedAssetInstanceId` / `linkedRef` / `sanityRef` / `mediaRef` are cleared from the manifest, preserving only the local download cache. Phases 2-3 then re-upload + re-link for real instead of silently skipping on a dead id. Transport errors during the check (`unknown`) are treated conservatively — manifest state is preserved and the next healthy-network run re-verifies.
1. **Download** from AEM DAM → `output/cache/assets/<flattened-path>` (on-disk cache, resumable).
2. **Upload** to Media Library — `POST https://api.sanity.io/v{apiVersion}/media-libraries/{mlId}/upload` returns `{asset: {_id}, assetInstance: {_id}}`. The parent `asset._id` is recorded as `mediaLibraryAssetId`; the versioned `assetInstance._id` as `linkedAssetInstanceId`. Immediately after a successful upload (or when skipping an already-uploaded entry whose aspect isn't set yet), the pipeline patches `aspects.aemSource = {damPath, assetInstanceId}` onto the parent via `POST /media-libraries/{mlId}/mutate`.
3. **Link** to dataset — `POST https://{projectId}.api.sanity.io/v{apiVersion}/assets/media-library-link/{dataset}` with body `{mediaLibraryId, assetInstanceId, assetId}`. Returns `{document: {_id, media: {_ref}, ...}}`. `document._id` is the dataset-local `_ref` that goes into content docs (Pattern A: `{_type:'image', asset:{_ref:'<linked-ref>'}}` — Studio-compatible).
4. **Rewrite** clean docs in place so every `/content/dam/...` string becomes the linked asset ref object.

Phases 0, 1, 2, and 3 all run with a work-stealing pool sized by `ASSET_CONCURRENCY` (default `4`). Phase 0's ML dedup pre-pass guarantees each DAM path is only handled by one worker in phases 1–3, so the shared `manifest` is never contended at the same key. The manifest file is written via synchronous `writeFileSync` + `JSON.stringify`, which are atomic relative to the single-threaded event loop — no lock needed as long as this stays sync. Output is logged in completion order (`{done}/{total}`) rather than start order, so progress tracks actual throughput.

Maintains `output/cache/assets/manifest.json` — per-DAM-path record with `damPath → cachedFile → mediaLibraryAssetId → linkedAssetInstanceId → linkedRef`. Re-runs skip each phase that's already complete. Entry shape:

```ts
interface ManifestEntry {
  damPath: string;
  cachedFile?: string;             // local cache path
  mimeType?: string;
  fileSize?: number;
  mediaLibraryAssetId?: string;    // asset._id in the ML (parent sanity.asset doc)
  linkedAssetInstanceId?: string;  // assetInstance._id in the ML (versioned asset)
  linkedRef?: string;              // dataset-local ref — goes into asset._ref in docs
  mediaRef?: string;               // media-library:<mlId>:<assetId> — GDR reference
  sanityRef?: { _type: "image"|"file"; asset: { _type: "reference"; _ref: string } };
  status: "cached"|"downloaded"|"failed-download"|"uploaded"|"failed-upload"|"linked"|"failed-link"|"dry-run";
  error?: string;
  downloadedAt?: string; uploadedAt?: string; linkedAt?: string;
}
```

- **Dry-run default.** Without `MIGRATION_DRY_RUN=false`, assets are downloaded to local cache only — no Media Library API calls, no link calls, no doc rewrites.
- **Env vars:**
  - `SANITY_PROJECT_ID`, `SANITY_DATASET` — as before.
  - `SANITY_MEDIA_LIBRARY_ID` — **required** when not dry-running. Must be a Media Library in the same org as the project.
  - `SANITY_TOKEN` — used for phase 2 (upload). A project robot token historically worked here, but newer Media Library API versions reject project-scoped sessions with `401 SIO-401-ANF "Session not found"` on `/media-libraries/{mlId}/upload`. When that happens, swap in a personal auth token (the same kind § 4c-bis describes for the link phase). The token still needs write access on the project for the in-place doc rewrites in phase 4.
  - `SANITY_ML_LINK_TOKEN` — **required for phase 3 (link)** when `SANITY_TOKEN` is a project robot token. The `/assets/media-library-link` endpoint requires a *personal* authorization token with read/write on both the Media Library (org-level) and the project/dataset; a project-only robot token is rejected with `401 Invalid non-global session`. Falls back to `SANITY_TOKEN` if unset (works only if that token is already a personal/OAuth token). See § 4c-bis for how to generate one.
  - `SANITY_API_VERSION` — defaults to `2025-02-19`, which is when Media Library support landed.
- **Flags:**
  - `--upload-only` — skip phase 1 (download). Assumes the local cache already exists.
  - `--link-only` (or `MIGRATION_LINK_ONLY=true`) — skip phases 1 + 2 entirely. Phase 0's ML lookup resolves existing assets by `aemSource.damPath`; phases 3 + 4 run as normal. Dry-run + `--link-only` = preview of which DAM paths would be linked vs. missing from the ML. Mutually exclusive with `--upload-only`. Intended for re-runs against an ML that already holds the binaries (either from a prior pipeline run or stamped out-of-band). Any DAM path that phase 0 can't resolve stays in `/content/dam/*` form in clean docs and is listed in `output/cache/assets-report.json → rewrite.unresolved`. Caveat: phase 0 keys on the `aemSource` aspect stamped by this pipeline on upload, so assets uploaded through the Studio UI without that aspect will not be found by DAM path.
  - `--download-only` (or `MIGRATION_ASSETS_DOWNLOAD_ONLY=true`) — run phase 1 for real and stop; phases 0, 2, 3, 4 are skipped unconditionally (independent of `MIGRATION_DRY_RUN`). No Sanity env vars required at all. Mutually exclusive with `--link-only` and `--upload-only`. See § 4c-quinquies.
  - When `AEM_FIXTURES_DIR` is set, phase 1 copies DAM binaries from `{AEM_FIXTURES_DIR}/assets/` instead of downloading from AEM. Used by the offline demo tenant. See § 4c-quater.
  - `--placeholders` (or `MIGRATION_ASSETS_PLACEHOLDERS=true`) — legacy: skip AEM download (phase 1). Copies SVG files from `./placeholders/` into the local asset cache instead, hashing each DAM path to one of 12 slots. Mutually exclusive with `--link-only`, `--upload-only`, and `AEM_FIXTURES_DIR`. See § 4c-ter.
  - `--no-rewrite` — skip phase 4 (in-place rewrite of `clean/*.json`).

**Outputs:** `output/cache/assets/manifest.json` (per-DAM-path state, above), `output/cache/assets-report.json` (download/upload/link counts + `rewrite.unresolved`), and — when anything failed — `output/cache/assets-failures.log`: one tab-separated `<damPath>\t<status>\t<error>` line per DAM path that failed to download (e.g. `HTTP 404 Not Found` for assets missing from AEM), failed to upload/link, or stayed unresolved as a raw `/content/dam/*` string in clean docs. This is the asset analog of `extract-404.log` — grep it to see exactly which assets were skipped and why, without parsing the JSON report. The run summary prints its path and entry count.

Ordering contract: the link phase must complete before `aem-import` runs, because the clean docs only contain the linked `_ref` after phase 4. The `migrate:content` chain (`extract → transform → assets → import`) already enforces this.

### 4c-bis. Generating a personal Sanity auth token

The Sanity Media Library endpoints reject project-scoped robot tokens because they're tied to a non-global session (error code `SIO-401-ANF`, message `Session not found` / `Invalid non-global session`). They require a token tied to a **user account** with read/write access to both the Media Library (org-level) and the project/dataset. Two ways to mint one:

#### Option A — Sanity CLI (fastest)

```bash
# 1. Authenticate as your Sanity user (opens a browser).
sanity login

# 2. Print the resulting auth token.
sanity debug --secrets
```

Look for the `Authentication:` block in the output:

```
Authentication:
  Auth token: sk...redacted...
  User type:  normal
```

Copy the value after `Auth token:`. That token is tied to your user account, so it carries every grant you have — including org-level Media Library access. Paste it into `tenants/<your-tenant>/.env` as `SANITY_ML_LINK_TOKEN=…` (and, if phase 2 is also failing with `SIO-401-ANF`, replace `SANITY_TOKEN` with the same value).

**Note:** the token in `sanity debug --secrets` is the live session token used by the CLI. Logging in again from another machine, running `sanity logout`, or rotating credentials in your Sanity account will invalidate it. For a stable token that survives CLI re-logins, use Option B.

#### Option B — Sanity user UI (stable, long-lived)

1. Go to https://www.sanity.io/manage and sign in as the same user.
2. Top-right user menu → **User settings** → **Personal access tokens**.
3. Click **Add API token**, give it a descriptive label (e.g. `aem-to-sanity migration — local`), and copy the generated token. You'll only see it once.
4. The token inherits your user's grants, so make sure your user has:
   - **Editor (or higher) on the destination project** — required for `aem-import` writes and phase-4 doc rewrites.
   - **Read/write on the org-level Media Library** — required for phases 2 + 3. If your user can browse the ML in sanity.io/manage and upload through the UI, this is already satisfied.

#### Sanity check before re-running

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $SANITY_TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.sanity.io/v2025-02-19/media-libraries/$SANITY_MEDIA_LIBRARY_ID/query" \
  -d '{"query":"*[_type==\"sanity.asset\"][0]._id"}'
```

- `200` → token has Media Library access; if `aem-assets` still 401s, the issue is elsewhere (wrong `SANITY_MEDIA_LIBRARY_ID`, wrong org, etc.).
- `401` → token doesn't have Media Library access. Regenerate via Option A or check the user's grants per Option B.

After updating the token, re-run `pnpm assets`. Phase 0 picks up where you left off — already-uploaded assets in the manifest are reconciled against the ML by id, so no duplicate uploads.

### 4c-quater. Fixture assets mode (offline demo)

When `AEM_FIXTURES_DIR` is set, `aem-assets` phase 1 copies DAM binaries from `{AEM_FIXTURES_DIR}/assets/` into the local asset cache instead of downloading from AEM. The demo tenant uses twelve procedural animated GIFs under `/content/dam/demo/_generated/{layout}.gif` — content references are rewritten to these canonical paths at fixture build time. Phases 2–4 run unchanged.

- **Trigger:** `AEM_FIXTURES_DIR=./fixtures/aem` (no extra flag)
- **Mutually exclusive with:** `--placeholders`
- **Requires:** committed files under `fixtures/aem/assets/` (12 animated GIFs generated by `pnpm build:demo-fixtures`)

### 4c-ter. `--placeholders` mode (legacy)

`aem-assets --placeholders` skips AEM DAM download and copies SVG files from `./placeholders/` into the local asset cache — each unique DAM path hashes to one of 12 slots. Prefer fixture images (§ 4c-quater) for the demo tenant.

- **Flag:** `--placeholders` or `MIGRATION_ASSETS_PLACEHOLDERS=true`
- **Mutually exclusive with:** `--link-only`, `--upload-only`, `AEM_FIXTURES_DIR`
- **Requires:** `placeholders/` directory in the tenant cwd

### 4c-quinquies. `--download-only` mode (non-Media-Library asset platforms)

`aem-assets --download-only` runs phase 1 for real — a genuine AEM DAM download into `output/cache/assets/`, not a dry-run preview — then stops. Phases 0 (ML dedup), 2 (upload), 3 (link), and 4 (rewrite) never run, regardless of `MIGRATION_DRY_RUN`. None of `SANITY_MEDIA_LIBRARY_ID`, `SANITY_TOKEN`, `SANITY_PROJECT_ID`, or `SANITY_ML_LINK_TOKEN` are read.

This exists for two cases: operators whose Sanity project/plan doesn't have Media Library access, and future integrations with a different asset management platform (e.g. Bynder) instead of the Sanity ML. `output/cache/assets/manifest.json` still records `damPath → cachedFile → mimeType → fileSize` for every asset, so a separate uploader script can read the manifest, push each `cachedFile` to the target platform, and perform its own DAM-path → asset-ref rewrite over `output/cache/clean/*.json` (the same shape `rewriteDamRefs` produces — `{_type:'image'|'file', asset:{_ref:'<ref>'}}`). No such uploader ships today; this flag only produces the handoff artifacts.

- **Flag:** `--download-only` or `MIGRATION_ASSETS_DOWNLOAD_ONLY=true`
- **Mutually exclusive with:** `--link-only`, `--upload-only`
- **Composable with:** `--placeholders` / `AEM_FIXTURES_DIR` (they only change where phase 1 sources binaries from)

### 4d. `aem-import` — `output/cache/categories/` + `output/cache/clean/` → Sanity

Reads every file under `output/cache/categories/` (if present) and `output/cache/clean/` and commits the docs via `@sanity/client` using `transaction().createOrReplace(doc).commit()`. Because `_id` values are derived from JCR paths (pages) and AEM tag ids (categories), re-runs upsert rather than duplicate.

**Categories commit first**, batched 50 docs per transaction. That ordering matters: pages may reference categories via `tags` or via tagfield-mapped component fields, and Sanity's strong-ref validation would reject those refs if the target docs didn't yet exist when the page commit lands. Batching of 50 keeps each transaction well under Sanity's payload cap on tenants with thousands of tags.

- **Dry-run default.** With `MIGRATION_DRY_RUN` unset or truthy, the command only prints what it *would* write.
- **Requires** `SANITY_PROJECT_ID`, `SANITY_DATASET`, `SANITY_TOKEN` when writing.
- **Flags:**
  - `--discard-drafts` (or `MIGRATION_DISCARD_DRAFTS=true`) — delete `drafts.{id}` in the same transaction as each published `createOrReplace`. The Studio opens a draft whenever one exists, so without this flag a stale draft from a prior migration run keeps shadowing freshly-imported published data — you re-run `aem-import`, the terminal shows "Committed", and the Studio still shows the old content. Opt-in because it also destroys any authored in-progress edits; use it when re-running migrations against a dataset that only this pipeline writes to. Also applied to category docs.

### Depth-5 truncation — handled for you

AEM's `.infinity.json` truncates the tree at depth ~5, inserting path-string markers like `"/content/.../section_0": "/content/.../section_0"`. `aem-extract` detects these (and suspiciously-empty nodes at depth boundaries), issues follow-up fetches in parallel (concurrency 4 by default), and splices resolved subtrees back into the parent tree at the correct key. A cycle guard prevents re-fetching the same path twice within a root. Nothing to configure unless a page is pathologically deep — raise `AEM_MAX_DEPTH_EXPANSIONS` (default 3) or the `maxDepthExpansions` option on the programmatic `fetchInfinityTree` API in `aem-to-sanity-core`. Markers still present after the budget are replaced with `{__truncated: "maxDepth", jcrPath}` sentinels which the transform stage treats as opaque (no broken string-marker leaves ever reach the Sanity docs).

---

## 5. Orchestrated — one command for the full pipeline

```bash
pnpm --filter tenant-<your-tenant> migrate
```

Chains `extract` → `tags` → `migrate:schema` → `transform` → `assets` → `import --discard-drafts` in a single shell. Each stage's `Elapsed:` line surfaces as it runs, so timing breakdowns are visible without parsing logs after the fact. Use this for "blow away and re-run" workflows on datasets only the pipeline writes to — `--discard-drafts` is destructive of in-progress author edits.

**Execution log.** Both `migrate` and `migrate:content` are wrapped in `scripts/run-with-log.ts`, which tees combined stdout/stderr to a timestamped file under the tenant's `output/` folder — e.g. `tenants/<your-tenant>/output/execution-2026-05-22_00-51-45.log`. Console output is unchanged (you still see live progress); the file is for sharing post-run, attaching to bug reports, and `grep`-ing audit trails across runs. The wrapper banners the log path at startup so it's easy to find. Logs are gitignored (under `output/`) and not auto-rotated — delete old ones manually if they pile up.

More granular variants:

- `pnpm --filter tenant-<your-tenant> migrate:content` — content stages only, no `--discard-drafts`.
- `pnpm --filter tenant-<your-tenant> migrate:all` — schema + typegen only.

Or via Turbo with input-hash caching for the pure emit stages:

```bash
pnpm turbo run migrate:schema typegen migrate:content --filter=tenant-<your-tenant>
```

Turbo respects the ordering declared in `turbo.json`: schema → typegen → content. Network-dependent tasks are `"cache": false`; pure emit steps cache against input hashes.

---

## 6. Studio (visual verification)

Each tenant gets its **own Studio** under `tenants/<your-tenant>/studio/` — `migrate:init` scaffolds it along with the tenant, and `pnpm -w studio:init <your-tenant>` backfills one into a tenant created before the studio template existed. Fill `studio/.env` (`SANITY_STUDIO_PROJECT_ID`, `SANITY_STUDIO_DATASET`), set `SCHEMAS_OUT_DIR=./studio/schemas/generated` in the tenant `.env`, re-run `migrate:schema`, then:

```bash
pnpm -F tenant-<your-tenant>-studio dev
# Opens http://localhost:3333 with every emitted schema loaded.
```

Because the tenant folder is gitignored by this repo, the studio + tenant config can be source-controlled together in the client's own repository (`git init` inside `tenants/<your-tenant>/`) — commit the generated schemas there; with one Studio per tenant the cross-tenant merge-conflict concern doesn't apply. The monorepo ties are the `aem-to-sanity-schema` and `aem-to-sanity-studio` `workspace:*` dependencies (see `studio/README.md`).

**How Studio updates reach an existing tenant.** Migration-critical Studio surface — the `category` taxonomy type, the `aemSource` Media Library aspect, the AEM widget input components — ships in the **`aem-to-sanity-studio` package**, which tenant studios import rather than copy. Updating the toolkit (`pnpm -w toolkit:update`, or bumping a pinned release) delivers new/changed types and aspects automatically. For the thin file shell that *is* copied (config, aspect re-export, scripts), run:

```bash
pnpm -w studio:sync <your-tenant>          # report missing files/deps + drift vs the template
pnpm -w studio:sync <your-tenant> --fix    # copy missing files, add missing deps (never overwrites)
pnpm -w studio:sync --all                  # scan every tenant
```

Files that differ from the template are reported as drift but kept — operator customizations always win.

The shared example Studio still works as before:

```bash
pnpm --filter studio dev
# Opens http://localhost:3333 with every emitted schema loaded.
```

Or validate schema shape without booting the UI:

```bash
pnpm --filter studio exec sanity schema validate
# Expects: 0 errors, 0 warnings.
```

The studio's `schemas/index.ts` re-exports `allSchemaTypes` from `tenants/<your-tenant>/output/schemas/index.ts`, and `sanity.config.ts` runs them through `sanitizeSchemaTypes` (from `aem-to-sanity-schema/sanitize`) at import time — it's a real consumer of the pipeline output, not a toy fixture. If you change the emitted schemas, `sanity schema validate` is the gate that catches breakage.

### 6a. Attribute limit & the diagnostic script

Sanity's Content Lake caps how many **unique attributes** a dataset can hold, where an attribute is *a unique combination of path + datatype* (`obj[].pageBuilder[].theme → string` is one attribute). It's a **hard technical limit** that depends on your plan ([docs](https://www.sanity.io/docs/content-lake/attribute-limit)):

| Plan | Attribute limit |
| --- | --- |
| Free | 2,000 |
| Growth | 10,000 |
| Enterprise | custom |

Only paths that **hold content** count (schema definitions alone don't), each unique path counts once no matter how many documents use it, and a path only drops off the count when *every* document stops using it. When you exceed the limit the Studio refuses to open with `Total attribute count exceeds limit`.

AEM content is a prime way to blow past this: the page editor auto-names every authored instance of a component with a unique JCR key, and presentation-heavy dialogs (per-component `fontSize`, `color`, `mb`, `align`, …) multiply paths across every block. The pipeline already mitigates the biggest offender — **repeated named slots collapse into a single array field** (§ 2, "Slot discovery") instead of one path per author-drop, which is exactly Sanity's own first recommendation ("use arrays for page building"). If you're still close to the limit, lean on the rest of their guidance: prefer arrays over deeply nested objects, avoid recursive page-builder-in-page-builder nesting, and keep presentation out of the content model.

**Measure before and after.** `apps/studio/scripts/attributes.ts` is a self-contained diagnostic that streams the whole dataset (via the `/export` endpoint, or a local `.ndjson` file) and reports the live attribute count against your dataset's limit, broken down by document type and listing every path:

```bash
# Against the configured dataset (needs a personal token):
pnpm --filter studio exec sanity exec scripts/attributes.ts --with-user-token

# Target a specific project/dataset, or analyze an export offline:
pnpm --filter studio exec sanity exec scripts/attributes.ts --with-user-token -- --project=abc123 --dataset=production
pnpm --filter studio exec sanity exec scripts/attributes.ts -- --file=production.ndjson
```

The report excludes internal `sanity.*` / `system.*` types and prints the API's own `fields.count.value` / `fields.count.limit` (the same numbers Sanity enforces, also visible at `https://<projectId>.api.sanity.io/v1/data/stats/<dataset>`). The "attributes by type" table tells you which document types dominate — usually the page types whose `pageBuilder` carries the deepest blocks. Run it after a migration to confirm you're comfortably under the limit before importing the next wave of content.

---

## 7. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `AEM_AUTHOR_URL is required when AEM_ENV=author` | Either set the matching URL/creds, switch `AEM_ENV` to `publish`, or use `AEM_TOKEN`. |
| `Missing credentials. Set AEM_SERVICE_CREDENTIALS_FILE (AEMaaCS), AEM_TOKEN, or AEM_..._USERNAME and AEM_..._PASSWORD.` | No auth resolved for the active env. Pick one of the three flows in § 1a-bis. |
| `IMS OAuth Server-to-Server failed: HTTP 400 — invalid_client` | The Service Credentials JSON's client id / secret don't match what Adobe IMS has for that technical account. Re-download from Cloud Manager (Developer Console → Integrations → Service Credentials) — secrets rotate when you regenerate. |
| `IMS JWT exchange failed: HTTP 401` | The technical account was deleted, the metascopes don't include `ent_aem_cloud_api`, or the org id is wrong. Re-download Service Credentials from Cloud Manager. Adobe is also deprecating JWT — newly generated credentials will be OAuth Server-to-Server (the resolver picks the right flow automatically). |
| `AEM service credentials JSON is missing the fields needed for either flow` | Neither `SCOPES` (Server-to-Server) nor `privateKey + metascopes + technicalAccountId + org` (JWT) found. You likely pasted a half-edited file or a different Adobe integration's JSON. Re-export from Cloud Manager. |
| `401` or `403` on fetches | Creds valid but account lacks read access to the JCR paths. Verify in AEM's CRXDE — for AEMaaCS the technical account's product profile must include the right AEM environment + permissions. |
| `aem-import` prints `DRY RUN` and nothing lands in Sanity | That's the default. Export `MIGRATION_DRY_RUN=false` (also set `SANITY_PROJECT_ID`, `SANITY_DATASET`, `SANITY_TOKEN`) and re-run. |
| `aem-import` → `Missing env var: SANITY_TOKEN` | You set `MIGRATION_DRY_RUN=false` but the write token isn't in the env. Source it into `tenants/<your-tenant>/.env`. |
| `aem-assets` phase 2 → `HTTP 401 SIO-401-ANF "Session not found"` on every upload | The `/media-libraries/{mlId}/upload` endpoint rejected your `SANITY_TOKEN`. Newer Media Library API versions don't accept project robot tokens here. Replace `SANITY_TOKEN` (or just override for this run) with a **personal auth token** that has read/write on the Media Library. See § 4c-bis for how to generate one. Retries can't help — every request fails the same way. |
| `aem-assets` phase 3 → `401 Invalid non-global session for user id g-...` | The `/assets/media-library-link` endpoint rejected your `SANITY_TOKEN`. It requires a *personal* auth token, not a project robot token. Set `SANITY_ML_LINK_TOKEN` to a personal token with read/write on both the Media Library and the project. See § 4c-bis. |
| `aem-assets` phase 2 → `409 asset already exists` | Informational, not an error. The binary was already uploaded to the Media Library. The code recovers both IDs via a GROQ lookup and continues. |
| `aem-assets` → `Missing env var: SANITY_MEDIA_LIBRARY_ID` | Set it to the org-level ML id that the project belongs to. `sanity media library list` on the org shows available ids. |
| `aem-extract` fails with `HTTP 300` on a root | AEM returned an ambiguous-path response (the path may point at a folder). Check `output/cache/extract-report.json` → `ambiguous[]` for the resolution suggestion. |
| Fewer pages imported than roots listed | Roots that AEM 404'd were skipped at extract (not authored pages — often commerce/PLP URLs pulled from a sitemap). `summary.downloaded` + `summary.notFound` in `output/cache/extract-report.json` accounts for the gap; the full list of skipped paths is in `output/cache/extract-404.log`. Verify a sample at `<path>.infinity.json` in AEM, then prune them from `aem-content-roots` or point them at the real JCR path. |
| Images render broken / fewer assets linked than expected | DAM paths AEM 404'd (or that failed upload/link) are listed in `output/cache/assets-failures.log` (`<damPath>\t<status>\t<error>`). 404s mean the asset isn't in AEM at that path; upload/link failures usually mean a token-scope issue (see the `SIO-401-ANF` rows above). |
| `aem-transform` → `No extracted content in output/cache/aem/content` | Run `aem-extract` first. The transform stage only reads from disk — it never hits AEM. |
| Content authored on a child page is missing from the imported doc | The roots entry points at a section root; a roots entry migrates only that page's own body, and nested child pages are skipped (they belong in their own docs). The run summary and `transform-report.json → skippedChildPages` list every skipped page — add each one as its own line in `aem-content-roots`, then re-run `extract` → `transform` → `import`. |
| Studio boots but shows no schemas (only `category`) | `apps/studio/schemas/generated/index.ts` is the bare-clone stub (exports `[]`). Run `pnpm --filter tenant-<your-tenant> migrate:schema` to regenerate the real barrel locally. |
| `sanity schema validate` → `Type has property "fields", but is not an object/document type` | The sanitizer is injecting placeholder fields into a non-object type. Confirm you're on the latest schema package (this is fixed). |
| `ERR_PACKAGE_PATH_NOT_EXPORTED` when running sanity CLI | Rebuild: `pnpm build`. The bundled CJS loader the Sanity CLI uses needs the `default` export condition that `dist/` ships. |
| Depth-5 follow-ups never fire on a deep page | Make sure you're calling `aem-extract`, not hitting `.infinity.json` manually. Raise `maxDepthExpansions` if you have pages > 6 follow-up rounds deep. |
| Studio won't open: `Total attribute count exceeds limit` | The dataset exceeded Sanity's per-plan attribute limit (Free 2k / Growth 10k). Run the diagnostic in § 6a to see which types dominate, then reduce unique paths — confirm repeated slots are collapsing to arrays (§ 2), drop presentational dialog fields, and avoid nested page-builder structures. Export first (`sanity dataset export`) before deleting content to get back under the limit. |

---

## 8. What's **not** automated yet

- **`pathfield` → Sanity `reference`** — AEM path fields stay as strings. Resolving them to document references is still a follow-up.
- **Custom page document types** — the generator writes one generic `page` doc. Hand-author `landingPage` / `productPage` types under `apps/studio/schemas/` (alongside the hand-authored `category.ts`, NOT inside `generated/` which is gitignored + regenerated). Merge them into `allSchemaTypes` in `apps/studio/schemas/index.ts`. The generator won't touch the `page.ts` it produces if you remove the `GENERATED` marker comment.
- **CI publish** — `changeset publish` is wired but not yet triggered from GitHub Actions.
