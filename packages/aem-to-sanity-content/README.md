# aem-to-sanity-content

AEM → Sanity content migration as five flat scripts. Each step is inspectable on disk, so you can stop between phases and re-run just one.

```
aem-extract    AEM  → output/cache/aem/content/**/*.json          + output/cache/extract-report.json
aem-tags       AEM  → output/cache/categories/*.json + manifest.json + output/cache/tags-report.json   (optional)
aem-transform  cache/aem/content + categories manifest → output/cache/clean/**/*.json + output/cache/transform-report.json
aem-assets     DAM  → output/cache/assets/* + Sanity                + output/cache/assets/manifest.json           (resumable)
aem-import     clean + categories → Sanity (dry-run by default)
```

`aem-tags` is optional — skip it for migrations that don't use AEM taxonomy. When present, it produces Sanity `category` docs (parent-child taxonomy) that `aem-transform` resolves authored `cq:tags` strings against and that `aem-import` publishes ahead of pages.

## Configure

Env vars (can live in `.env`):

```
AEM_ENV=author                                # or publish
AEM_AUTHOR_URL=https://author.example.com
AEM_AUTHOR_USERNAME=...                       # on-prem / AMS only — AEMaaCS rejects basic auth
AEM_AUTHOR_PASSWORD=...
# or: AEM_TOKEN=...                           # AEMaaCS developer token (24h) or any pre-minted bearer
# or: AEM_SERVICE_CREDENTIALS_FILE=...        # AEMaaCS Service Credentials JSON (exchanged with Adobe IMS at startup)
# or: AEM_SERVICE_CREDENTIALS='{"CLIENT_ID":...}'  # same, inlined as JSON (for CI)

AEM_CONTENT_ROOTS_FILE=./aem-content-roots    # default
AEM_TAG_ROOTS_FILE=./aem-tag-roots            # default — only namespaces listed here are migrated
OUTPUT_DIR=./output                           # default

# Writes (import only)
SANITY_PROJECT_ID=...
SANITY_DATASET=production
SANITY_TOKEN=...
MIGRATION_DRY_RUN=false                       # opt-in to commit. Default: dry-run.

# aem-assets — Media Library
# Assets go to the org-level Media Library, NOT the dataset Content Lake.
SANITY_MEDIA_LIBRARY_ID=ml...                 # required when MIGRATION_DRY_RUN=false
SANITY_ML_LINK_TOKEN=...                      # personal auth token for /assets/media-library-link
                                              # (required when SANITY_TOKEN is a project robot token —
                                              #  the link API rejects non-global sessions).
                                              # Generate via `sanity login` + `sanity debug --secrets`,
                                              # or from sanity.io/manage → user → Personal access tokens.
                                              # See docs/running-the-migration.md § 4c-bis.
# SANITY_API_VERSION=2025-02-19               # pinned for aem-assets; ML endpoints require it

# Optional
# AEM_MAX_RESPONSE_MB=100                     # abort any single response larger than this
# MIGRATION_PAGE_BUILDER_NAME=pageBuilder     # field page blocks land under on emitted docs.
                                              # Must match the value migrate:schema ran with —
                                              # set once in the tenant .env, leave alone.
# MIGRATION_SLUG_STRATEGY=path                # slug.current per page doc: "segment" (default)
                                              # = last JCR path segment; "path" = base-relative
                                              # path as authored in aem-content-roots. Pick once.
```

## Roots files

`aem-content-roots` — pages to migrate, one per line:

```
@base /content/site/us/en
home
about-us
plans/consumer/phones/foo         # nested relatives share the @base
/content/other-site/top           # absolute path also fine
```

Each page doc's `slug.current` is the last segment of the resolved JCR path (`foo`), matching AEM's page-slug semantics. With `MIGRATION_SLUG_STRATEGY=path` it's the base-relative path exactly as authored above (`plans/consumer/phones/foo`) — for frontends that route nested pages off the full sub-path.

`aem-tag-roots` — AEM tag namespaces to migrate, one per line. Same format. Only namespaces (or subtrees) listed here are walked — there's no canonical "always skip" set in AEM, so sample-content namespaces like `wknd` are simply absent from this file.

```
@base /content/cq:tags
promotion
page-type
/content/cq:tags/wknd
```

## Run

```sh
pnpm aem-extract                                         # fetches everything in roots file
pnpm aem-tags                                            # walks /content/cq:tags/<each listed root>
pnpm aem-transform --registry ./content-type-registry.json
pnpm aem-assets                                          # dry run: downloads only
MIGRATION_DRY_RUN=false pnpm aem-assets                  # uploads to Sanity, rewrites clean docs
pnpm aem-import                                          # dry run
MIGRATION_DRY_RUN=false pnpm aem-import                  # commit docs (categories first, then pages)
```

`--overwrite` on `aem-extract` re-fetches roots that already exist on disk. `--overwrite` on `aem-tags` re-emits category doc files (the manifest is always rewritten). `--include <resourceTypes>` on `aem-transform` restricts the walk to a comma-separated allow-list. `aem-assets` processes one file at a time (sequential, low memory) and is resumable via `manifest.json`; flags:

- `--upload-only` — skip phase 1 (download from AEM); assumes local cache is populated.
- `--link-only` (or `MIGRATION_LINK_ONLY=true`) — skip phases 1 + 2 entirely. Phase 0's ML lookup finds assets already in the Media Library and links them into the dataset. Useful for re-runs, for iterating on link/rewrite logic without re-hitting AEM, or when assets were pushed out-of-band. Mutually exclusive with `--upload-only`. See § *aem-assets — Media Library flow* below for the caveat about the `aemSource` aspect.
- `--download-only` (or `MIGRATION_ASSETS_DOWNLOAD_ONLY=true`) — run phase 1 (download from AEM) for real, then stop: phase 0's ML dedup lookup, phase 2 upload, phase 3 link, and phase 4 rewrite are all skipped unconditionally, independent of `MIGRATION_DRY_RUN`. Needs no Sanity Media Library / token / project env vars at all. For operators without ML access, or who plan to hand the cached binaries in `output/cache/assets/` + `manifest.json` off to a different asset platform (e.g. Bynder) instead of the Sanity Media Library. Mutually exclusive with `--link-only` and `--upload-only`. See § *`--download-only` mode*.
- When `AEM_FIXTURES_DIR` is set, phase 1 copies DAM binaries from `{AEM_FIXTURES_DIR}/assets/` (offline demo tenant). See § *Fixture assets mode*.
- `--placeholders` (or `MIGRATION_ASSETS_PLACEHOLDERS=true`) — legacy: skip AEM download; copy SVG files from `./placeholders/` into the local cache (hashed to 12 slots). Mutually exclusive with `--link-only`, `--upload-only`, and `AEM_FIXTURES_DIR`. See § *`--placeholders` mode*.
- `--no-rewrite` — skip the in-place rewrite of `clean/*.json`.

`aem-import` flags:

- `--discard-drafts` (or `MIGRATION_DISCARD_DRAFTS=true`) — delete `drafts.{id}` alongside each published `createOrReplace`. Without this flag a stale draft from a prior run keeps shadowing freshly-imported content in the Studio. Opt-in; destroys authored in-progress edits.

## Type-aware coercion (transform)

AEM's JCR is schemaless on dialog inputs — every authored value arrives in `.infinity.json` as a JSON string, no matter what the dialog widget was. `aem-transform` reads each mapped block's `fields: [{name, type}]` from `content-type-registry.json` and coerces ingested string values into the Sanity-expected scalar:

- **`array-of-blocks`** (richtext) — converted to Portable Text via `@portabletext/block-tools` (parsed through `jsdom`). Decorators (`strong`, `em`, `underline`, `strike-through`, `code`), styles (`normal`, `h1`–`h4`, `blockquote`), lists (`bullet`, `number`), and `link` annotations are preserved. HTML `<table>` elements become Sanity's native Portable Text table blocks (`table → rows[] → cells[] → value`, Studio ≥ 6.6): `headerRows` comes from `<thead>` (or leading all-`<th>` rows), cell content goes through the same HTML pass so marks/links/lists survive, `colspan`/`rowspan` are dropped (content kept, rows padded rectangular), `<caption>` content is preserved as text block(s) before the table, nested tables flatten to text inside the parent cell, and malformed tables fall back to plain flattened blocks. Keys are derived from a SHA1 of `{jcrPath}::{field}:{counter}` so re-runs produce byte-identical clean docs.
- **`number`** — `Number(v)`; kept as-is on `NaN`.
- **`boolean`** — `"true"` / `"false"` literal strings, plus custom checkbox constants recorded in the registry (`checkedValue` / `uncheckedValue` — e.g. a link-target checkbox persisting `"_blank"` / `"_self"`); kept as-is otherwise so unrecognized values surface in Studio validation rather than being silently remapped.
- **`date` / `datetime`** — AEM datepickers persist whatever their `valueFormat` says (ISO-8601-with-offset when unset, display-style strings like `"May 23, 2024"` when set). The registry records the format; transform parses with it and re-emits `YYYY-MM-DD` (dates keep the literal date part — no timezone shifting) or UTC ISO (datetimes). ISO inputs and the common `MMM DD, YYYY` shape coerce even without a recorded format; anything unparseable keeps the original.
- **`array-of-string`** — multi-select buttongroup values. A bare string (JCR's serialization when exactly one value is picked on a multi-value property) is wrapped into a one-item array; other shapes are kept as-is.
- **`array-of-reference`** (AEM tagfield) — string array of tag ids (`promotion:payout/recurring-device-credits`) becomes `[{_type:"reference", _key:..., _ref:"category-..."}]` by lookup in `output/cache/categories/manifest.json` (produced by `aem-tags`). Follows `cq:movedTo` aliases. Page-level `cq:tags` on `jcr:content` are lifted onto the page doc's `tags` field via the same resolver. Tag ids not in the manifest get dropped and surfaced in `transform-report.json → unresolvedTagRefs`.

Before coercing, authored keys that differ from a declared field only by letter case are renamed onto the declared name (`linkURL` → `linkUrl`, `altValueFromDAM` → `altValueFromDam`) — the schema emitter camelCases dialog `name`s while the JCR persists them raw, and without the rename the value would surface as an "Unknown field" next to an empty declared one. Only case-only mismatches rename; genuinely different keys still pass through and show up in the drift report.

Coercion walks the registry tree recursively — nested `array-of-object` items (e.g. `variableColumn.columnContents[]` rows) get the same treatment as top-level fields via the `itemFields` entries. AEM stores multifield rows in two shapes: canonical ordered (`item0`/`item1`/…) and named-key (`colors: {weddingDresses: {...}, ...}`). Both are materialized into proper arrays — the ordered form by `deepCoerceAemMultifieldMapsToArrays` during `transformInline`, the named-key form by `coerceFieldTypes` when the registry declares the field as `array-of-object` but the value is a plain object. `Object.values` preserves authored order.

Legacy `fields: string[]` registry entries skip every coercion step (pass-through); regenerate the registry via `migrate:schema` to opt in.

## Container components

AEM "container" components (cq:isContainer=true) carry two shapes in one JCR node: authored dialog fields *plus* drop-zone children that are themselves full component instances (e.g. the keys on an `expander` include both `theme` / `singleExpansion` dialog values AND `item_1657754806454`-style child `box` components). Declare those resource types in `aem-component-containers.json` (override with `AEM_COMPONENT_CONTAINERS_FILE`):

```json
{
  "aem-integration/components/expander":     { "childrenField": "items" },
  "aem-integration/components/box":          { "childrenField": "items" },
  "aem-integration/components/column-layout":{ "childrenField": "items" },
  "aem-integration/components/container":    { "childrenField": "items" }
}
```

Transform then does the right thing: dialog fields go through the normal inline + coercion path, while direct child keys with `sling:resourceType` are recursively emitted as pageBuilder blocks under `childrenField`. Nesting works — expander > box > content roundtrips. On the schema side, `migrate:schema` appends a matching `type: "pageBuilder"` field so the Studio palette inside the container matches the top-level page builder (any block is droppable).

`flatten: true` (optional) drops the container's own block and hoists its items into the parent's pageBuilder array — for pure-layout containers like AEM's responsive grid. **Styled wrappers** (a dialog full of per-breakpoint layout config — padding, gap, height, background for mobile/tablet/desktop — around a drop zone) are just non-flatten containers: their layout fields survive with full coercion and their children land in `childrenField`, whether authored directly on the wrapper node or inside a nested responsive-grid container (a nested `flatten: true` container collapses into the wrapper's items; the wrapper's own block stays). A childless wrapper emits an empty array.

## AEM authoring hints (`cq:panelTitle` and friends)

Some AEM authoring metadata lives **outside** the dialog payload — the most common case is the panel heading on accordion / expander panels, which AEM writes as `cq:panelTitle` on each child node rather than as a dialog field. The transform's normal property iterator drops anything with a colon, so the value would be lost without an explicit lift step.

Per-project opt-ins are declared in `aem-component-hints.json` (override with `AEM_COMPONENT_HINTS_FILE`):

```json
{
  "aem-integration/components/box":     ["cq:panelTitle"],
  "aem-integration/components/content": ["cq:panelTitle"]
}
```

The rename vocabulary (which AEM key becomes which Sanity field) is global in `packages/aem-to-sanity-core/src/aem/authoring-hints.ts`:

| AEM key | Sanity field |
| --- | --- |
| `cq:panelTitle` | `panelTitle` |

Two layers, symmetric across stages:

- **Transform** consults the opt-in config keyed by the current node's `sling:resourceType`. If the node is opted in and the property is in its allowlist, the value is renamed via `AEM_AUTHORING_HINTS` and emitted under the Sanity field name. Otherwise colon-bearing keys drop as before. The drift report skips opted-in keys so they don't surface as "unknown props".
- **Schema** (`migrate:schema`) declares a `readOnly` `string` field per opted-in hint on the matching component schema. Read-only because authors don't edit it from the Studio dialog — it's runtime metadata preserved from AEM. Components not listed in this file get no extra fields.

To support a new hint: add the AEM-key → Sanity-field row to `AEM_AUTHORING_HINTS`, then add the AEM key to the relevant component's array in `aem-component-hints.json`. Re-run `pnpm migrate:schema` and `pnpm transform`.

Missing file → no hint behavior on any component. Malformed JSON or invalid entries are a hard error.

## Page-shell components and per-template documents (`aem-page-components.json`)

AEM stores page-level dialog values on the page's `jcr:content` node, and a sibling `cq:template` identifies which template the page was built from. Declare the page-shell `sling:resourceType` and the `cq:template` paths it's authored under in `aem-page-components.json` (override with `AEM_PAGE_COMPONENTS_FILE`):

```json
{
  "uxp/components/structure/page": {
    "templates": [
      "/conf/uxp/settings/wcm/templates/plan-details",
      "/conf/uxp/settings/wcm/templates/news-article"
    ]
  }
}
```

Or, instead of listing every template by hand, let the schema pass discover them from extracted content:

```json
{
  "uxp/components/structure/page": {
    "discover": true
  }
}
```

With `discover: true`, `migrate:schema` walks `output/cache/aem/content/` (populated by `aem-extract`) to enumerate every `cq:template` value on matching `jcr:content` nodes — so the doc-type list grows automatically as new templates appear in your AEM content. Explicit `templates` and `discover: true` can coexist (discovered values append to the explicit list, deduplicated).

`migrate:schema` emits one Sanity document type per (resourceType, template) pair (`planDetailsPage`, `newsArticlePage`, …) and writes an `output/cache/page-templates.json` manifest. `aem-transform` reads that manifest and, for each raw page whose `jcr:content` matches a declared pair, emits a document with:

- `_type` set to the per-template doc type (e.g. `"planDetailsPage"`).
- `title` from `jcr:content/jcr:title` (existing rule; unchanged).
- `pageProperties` — every authored value on `jcr:content` lifted via the same camelCase rule used for ordinary fields, then coerced against the page-shell's `cq:dialog` types (`"true"` → `true`, HTML → Portable Text, etc.). AEM bookkeeping (replication agents, versioning, ContextHub paths) is dropped via an explicit `JCR_CONTENT_BOOKKEEPING_KEYS` denylist so dialog drift surfaces but noise doesn't.
- `featuredImage` lifted from `jcr:content/cq:featuredimage`. The DAM path is moved to `fileReferenceAemPath` so `aem-assets` rewrites it to a real Sanity asset ref the same way it does for fileupload widgets.
- `cqTemplate` — the raw template path, retained for traceability.
- `pageBuilder` walked from `jcr:content/root` (unchanged; the field name follows `MIGRATION_PAGE_BUILDER_NAME` when set).

Pages with a declared page-shell `sling:resourceType` but an undeclared `cq:template` fall back to the generic `_type: "page"` document and surface in the transform report under `unknownPageTemplates`. Add the missing template to `aem-page-components.json`, re-run `migrate:schema`, then re-run `transform` + `import` to upgrade them.

**Child pages are never inlined.** A roots entry migrates only that page's own body. When the fetched tree contains nested `cq:Page` children (the entry points at a section root rather than a leaf), each child page's subtree is skipped and its path recorded in `transform-report.json → skippedChildPages` (full list, not example-capped); the run summary echoes the first few. Add each child page as its own `aem-content-roots` line and re-run `extract` → `transform` → `import` to migrate it as its own doc.

Missing / empty file → every page uses the generic `page` doc (today's behavior). Fully backwards compatible — existing tenants need no changes.

## Named-slot components (auto-detected)

A different AEM pattern shows up on components like `media-paragraph`: a nested child under a JCR key (e.g. `content`) whose value is itself a full component with its own `sling:resourceType`. Not a dialog field, not a drop-zone container — just a named slot.

Authors often drop **many** instances of the same child into one parent, and AEM auto-names the siblings (`content`, `content_1793623844`, `content_1893078103_c`, `content…_copy_copy`, `title_1967938466_cop_1581547696`, …). Treating each JCR key as its own field would emit one `defineField` per author-drop and blow past Sanity's per-dataset attribute limit, so siblings are collapsed by their **logical base** (timestamps, paste ids, and `_c`/`_co`/`_cop`/`_copy`/`C…` copy markers stripped — see `normalizeSlotBase` in `aem-to-sanity-core`).

- **Transform** groups a node's child components by logical base and emits them under the base field name (`mediaParagraph.content = [{_type:'content', text:[{_type:'block',...}], ...}, ...]`). Detection is structural: any direct child with `sling:resourceType` that isn't already claimed by container logic is a slot. Works on the first run with no config.
- **Schema** catches up on the next `migrate:schema`: that pass scans `output/cache/aem/content/` (extracted content) and appends one field per base — an **array of `<childType>`** for repeated/auto-named slots, a single typed reference for a lone hand-named slot. Until then the Studio shows a yellow "Unknown fields found" warning on the nested data but the data itself is preserved.

The array-vs-single decision is made once by the schema (from its global view of every page) and recorded in `content-type-registry.json`; the transform reads it back so both sides agree on the shape regardless of how many instances a given page carries. There's no config for named-slot *shape* — it's inferred from content. Container parents (listed in `aem-component-containers.json`) skip slot synthesis so their drop-zone children stay on the container-items path. The optional `aem-component-slots.json` adds schema-side visibility rules (`visibleWhen`) that fold a slot field behind its AEM enable-toggle in the Studio; the transform ignores that file — hidden or not, authored slot content always migrates.

## Timing

Every CLI appends an `Elapsed:` line to its summary. `aem-assets` also reports per-phase durations (`phase 0 (ML dedup)` / `phase 1 (download)` / `phase 2 (upload)` / `phase 3 (link)` / `phase 4 (rewrite)`), which lets you see at a glance whether a slow run is bottlenecked on AEM fetches, ML uploads, or the dataset link API.

## Parallelism in aem-assets

Phases 0, 1, 2, 3 run with a work-stealing pool sized by `ASSET_CONCURRENCY` (default `4`). Phase 0's ML dedup pre-pass resolves every DAM path that already lives in the Media Library, so the downstream phases only touch each DAM path with a single worker — the shared `manifest` is never contended at the same key, and no locks are needed. The manifest file is persisted via synchronous `writeFileSync` + `JSON.stringify`, both atomic relative to the single-threaded event loop. If that ever moves to async `writeFile`, a serial lock becomes mandatory. Output is logged in completion order so progress reflects actual throughput.

## Reports

- `output/cache/extract-report.json` — per-root outcome; HTTP 300/404/auth/too-large failures grouped by category.
- `output/cache/extract-404.log` — one `<jcrPath>\t<fullUrl>` per 404 (only written when 404s occur).
- `output/cache/transform-report.json` — unknown `sling:resourceType`s (with hit counts and example paths), unknown properties per mapped component, transform bails (max-depth or cycle), and `skippedChildPages` (nested child pages excluded from non-leaf roots — list them in `aem-content-roots` to migrate them). `aem-transform` also echoes unmapped types to the console at the end of the run as a paste-ready `/apps/...` list (the page root and `responsivegrid` wrapper are hidden — they're always passthroughs, never missing schemas). Add the listed paths to `aem-component-paths`, then re-run `migrate:schema` → `transform` → `import` so the new component's content stops being dropped.
- `output/cache/assets-report.json` — asset download/upload/link counts, failures.
- `output/cache/assets-failures.log` — one `<damPath>\t<status>\t<error>` per DAM path that failed download (e.g. `HTTP 404 Not Found`), upload, or link, plus paths left unresolved as raw `/content/dam/*` strings. Asset analog of `extract-404.log`; only written when something failed.
- `output/cache/assets/manifest.json` — per-asset state (damPath → cachedFile → mediaLibraryAssetId → linkedAssetInstanceId → linkedRef + sanityRef). Drives resumability for all four phases: download, upload to Media Library, GDR link to dataset, doc rewrite.

## aem-assets — Media Library flow (@shehjadkhan 2026-04-22)

`aem-assets` runs five phases. Dry-run default stops after phase 1 (local download).

0. **Dedup against the Media Library + manifest staleness check** — GROQ on `aspects.aemSource.damPath`. A hit populates the manifest with both ids so phases 1+2 skip entirely for that asset. When the lookup misses but the manifest claims an `mediaLibraryAssetId`, phase 0 verifies the doc still exists in the ML by id; if it's been deleted (e.g. ML wipe), the stale linkage is cleared so phases 2-3 re-upload + re-link for real. Transport errors are treated conservatively — manifest state is preserved and the next healthy-network run re-verifies. Requires the `aemSource` aspect to be deployed once per ML. Skipped on dry-run by default; `--link-only` forces it to run (safe, read-only).
1. **Download** AEM DAM binary → local cache in `output/cache/assets/`.
2. **Upload to Media Library** — `POST https://api.sanity.io/v{apiVersion}/media-libraries/{mlId}/upload`. Response `{asset: {_id}, assetInstance: {_id}}` captures the parent asset id and the versioned instance id (both needed for step 3). Uses `SANITY_TOKEN`. A project robot token historically worked here, but newer Media Library API versions reject project-scoped sessions with `401 SIO-401-ANF "Session not found"` — when that happens, swap in a **personal auth token** (see `docs/running-the-migration.md` § 4c-bis for how to mint one).
3. **Link to dataset** — `POST https://{projectId}.api.sanity.io/v{apiVersion}/assets/media-library-link/{dataset}` with body `{mediaLibraryId, assetInstanceId, assetId}`. Response `{document: {_id, media: {_ref}, ...}}` — `document._id` is the dataset-local asset ref that goes into docs. **Requires a personal auth token** (`SANITY_ML_LINK_TOKEN`) because the endpoint rejects project robot tokens with `401 Invalid non-global session`. See `docs/running-the-migration.md` § 4c-bis.
4. **Rewrite clean docs** in place — every `/content/dam/...` string becomes `{_type:'image'|'file', asset:{_ref:'<linked-ref>'}}`. Pattern A (Studio-compatible), matches existing doc shape.

### `--link-only` mode

Runs phase 0, skips phases 1 + 2, runs phases 3 + 4. Use when assets are already in the ML (from an earlier run or pushed out-of-band). Any DAM path that phase 0 can't find in the ML is reported up front and ends up in the phase-4 `unresolved` summary. Phase 0's lookup only finds assets that this pipeline previously stamped — assets uploaded through the Studio UI without the `aemSource` aspect won't resolve by DAM path.

### `--download-only` mode

Runs phase 1 for real (real AEM download, no ML dedup lookup beforehand) and stops — phases 0, 2, 3, 4 never run, and none of `SANITY_MEDIA_LIBRARY_ID` / `SANITY_TOKEN` / `SANITY_PROJECT_ID` / `SANITY_ML_LINK_TOKEN` need to be set. Unlike plain dry-run (which also stops after phase 1 but is meant as a preview before a real ML run), `--download-only` is an intentional terminal stage: the resulting `output/cache/assets/*` binaries and `manifest.json` (damPath → cachedFile → mimeType → fileSize) are a stable handoff point for a future non-Media-Library uploader — e.g. a Bynder integration that reads the manifest, uploads each `cachedFile`, and performs its own doc rewrite. Works the same whether `MIGRATION_DRY_RUN` is `true` or `false`. Mutually exclusive with `--link-only` and `--upload-only`; composable with `--placeholders` / `AEM_FIXTURES_DIR` (they only change where phase 1 sources binaries from).

### Fixture assets mode

When `AEM_FIXTURES_DIR` is set, phase 1 copies committed DAM binaries from `{AEM_FIXTURES_DIR}/assets/` into the local asset cache (same flatten naming as the asset cache: `/content/dam/foo/bar.jpg` → `foo--bar.jpg`). Phases 2–4 run unchanged. Used by the offline [`tenants/demo/`](../../tenants/demo/) tenant. Mutually exclusive with `--placeholders`.

### `--placeholders` mode (legacy)

Skips AEM download (phase 1). Copies SVG files from `./placeholders/` into the local asset cache — each DAM path hashes to one of 12 slots (`placeholder-slot-00.svg` … `placeholder-slot-11.svg`). Prefer fixture images for the demo tenant. Mutually exclusive with `--link-only`, `--upload-only`, and `AEM_FIXTURES_DIR`.

Manifest entry shape (`output/cache/assets/manifest.json`):

```ts
{
  damPath: "/content/dam/dbi/m1.png",
  cachedFile: "/path/to/output/cache/assets/dbi--m1.png",
  mimeType: "image/png", fileSize: 4049,
  mediaLibraryAssetId: "3CjO...",                // asset._id in ML
  linkedAssetInstanceId: "image-<sha1>-WxH-png", // assetInstance._id in ML
  linkedRef: "image-<sha1>-WxH-png",             // dataset-local ref — used as asset._ref
  mediaRef: "media-library:mlTnBi...:3CjO...",    // GDR reference
  sanityRef: {_type:"image", asset:{_type:"reference", _ref:"image-<sha1>-WxH-png"}},
  status: "linked",
  downloadedAt, uploadedAt, linkedAt
}
```

Re-runs are idempotent: a populated `linkedRef` skips upload + link; a populated `cachedFile` skips download.
