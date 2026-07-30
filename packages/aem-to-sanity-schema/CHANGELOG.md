# aem-to-sanity-schema

## 2.4.0

### Minor Changes

- [#91](https://github.com/demo-repositories/aem-to-sanity/pull/91) [`63e5133`](https://github.com/demo-repositories/aem-to-sanity/commit/63e5133ac26ee991f24c4e0da56aff1a8896d79d) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Configurable folder layout for the generated schemas directory.

  - New env var `MIGRATION_SCHEMA_LAYOUT` — `flat` (default, current behavior) or `kind`, which groups generated files into `documents/` (the `page` doc, per-template docs, `contentFragment`) and `objects/` (component schemas, the page-builder array, table types, `contentFragmentRef`) subfolders.
  - Entries in `aem-component-names.json` accept a new optional `folder` key that pins a component's generated file to a custom subfolder (e.g. `{"folder": "navigationObjects"}`). Overrides apply in both layouts. An entry may carry `folder` alone.
  - The `index.ts` barrel always stays at the root of the schemas dir with an identical `allSchemaTypes` export — Studio imports need no changes.
  - Unlike the naming knobs, layout and `folder` are safe to change between runs: files move but type names and ingested `_type` values don't, and the pruner removes copies left at old locations (and now-empty subfolders) on the next `migrate:schema` run.
  - The `aem-to-sanity-pagebuilder` CLI gained a `--layout <flat|kind>` flag (defaults to `MIGRATION_SCHEMA_LAYOUT`).
  - Typegen now scans the schemas dir recursively and no longer feeds the barrel `index.ts` itself into the synthesized config.

  No action needed to keep the current flat layout.

### Patch Changes

- [#89](https://github.com/demo-repositories/aem-to-sanity/pull/89) [`5749d10`](https://github.com/demo-repositories/aem-to-sanity/commit/5749d10ec744798666966b0e1c98aa3b9003f7fe) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Document how frontends query `contentFragmentRef` blocks: the generated mapping doc (and the operator guide) now include the GROQ dereference pattern (`fragment->{ _id, title, content }`), a note that refs appear at any page-builder depth (including container `items`), and two strategies for nested fragments — a depth-N inline join helper or lazy per-fragment fetching. No behavior change; docs only.

- Updated dependencies [[`63e5133`](https://github.com/demo-repositories/aem-to-sanity/commit/63e5133ac26ee991f24c4e0da56aff1a8896d79d)]:
  - aem-to-sanity-core@2.4.0

## 2.3.0

### Patch Changes

- Updated dependencies [[`2230cad`](https://github.com/demo-repositories/aem-to-sanity/commit/2230cadcd7f3b72e77e7fbbcb46d82e55ec7b509)]:
  - aem-to-sanity-core@2.3.0

## 2.2.0

### Minor Changes

- [`b8843f1`](https://github.com/demo-repositories/aem-to-sanity/commit/b8843f1462a1d3384eaddc11226f56e4240ac982) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - New generated types `contentFragment` (document) and `contentFragmentRef` (page-builder block): the escape hatch for Sanity's 20-level attribute-depth limit. When `aem-transform` cuts a too-deep subtree, the fragment document holds it (title + a page-builder `content` array) and the ref block replaces it in the parent. Both types are emitted on every `migrate:schema` run, the ref block joins the page-builder palette, and both names are reserved (an AEM component deriving one of them gets the `aem` prefix). Frontends need a `contentFragmentRef` resolver — one extra GROQ join to render the referenced fragment's `content`.

### Patch Changes

- Updated dependencies []:
  - aem-to-sanity-core@2.2.0

## 2.1.3

### Patch Changes

- [#84](https://github.com/demo-repositories/aem-to-sanity/pull/84) [`8315257`](https://github.com/demo-repositories/aem-to-sanity/commit/83152572b40a2cbb36fa865a1caf70f02fc3fd42) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - The AEM core-image alt pattern no longer produces false "Required" validation errors in the Studio. AEM marks the `./alt` textfield required but only enforces it while the field is editable — the `isDecorative` / `altValueFromDAM` / `altValueFromPageImage` toggles hide it and store no alt on the page node (the runtime inherits it from the DAM asset or page instead). Emitted schemas now render a conditional rule that passes when any of those toggles is on (tolerating legacy uncoerced `"true"` strings on already-imported documents) and requires a non-empty value only when the author was expected to type one. Re-run `migrate:schema` to regenerate affected component schemas (e.g. image, promocard, wrapper).

- Updated dependencies []:
  - aem-to-sanity-core@2.1.3

## 2.1.2

### Patch Changes

- [#81](https://github.com/demo-repositories/aem-to-sanity/pull/81) [`121bae5`](https://github.com/demo-repositories/aem-to-sanity/commit/121bae5a3b8b0e6cc462320387da7853a4cbef51) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Two fixes surfaced by AEM quick-links-style components:

  - **Granite UI v1 sections are now walked.** `granite/ui/components/foundation/section` (the pre-Coral container, still common in older dialogs' tab layouts) is mapped as a container: a titled section directly under `tabs` becomes a Studio group and its child widgets become real fields; untitled layout sections flatten. Previously the section itself was emitted as a single placeholder string field and every field inside it was silently dropped from the schema. Re-run `migrate:schema` to pick up newly surfaced fields.
  - **Case-only field-name mismatches are canonicalized at transform.** The schema emitter camelCases dialog names (`./linkURL` → `linkUrl`) while the JCR persists the raw key; `aem-transform` now renames authored keys that case-insensitively match a declared field onto the declared name (at every depth, including multifield items) so values land in the typed field instead of surfacing as "Unknown field" next to an empty declared one. Case-only mismatches no longer appear in the drift report. Re-run `transform` + `import` to repair affected documents.

- Updated dependencies []:
  - aem-to-sanity-core@2.1.2

## 2.1.1

### Patch Changes

- Updated dependencies []:
  - aem-to-sanity-core@2.1.1

## 2.1.0

### Minor Changes

- [#75](https://github.com/demo-repositories/aem-to-sanity/pull/75) [`de5efdb`](https://github.com/demo-repositories/aem-to-sanity/commit/de5efdbce3b9900454298b55d1970cf478550e97) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Slot-fill components stop cluttering the page-level "+ Add" menu, and single-slot fields render as a click-to-open row.

  Two Studio-facing refinements to auto-discovered named slots (e.g. `promocard`'s `buttonPrimary` / `buttonSecondary` children):

  - **Slot-only types leave `pageBuilder.of[]`.** A component type whose every observed appearance in extracted content is as a slot fill is now excluded from the page-builder array — its schema type is still emitted and the parents' slot fields still reference it, so nothing about the migrated data changes; it just no longer appears as an insertable page-level block. A type authored even once directly in a page body (under the page root / responsive grid) or inside a container drop zone stays in the menu, so no existing block is ever orphaned. `migrate:schema` logs each exclusion. Like slot discovery, this is driven by the extract cache: a first run without one excludes nothing, and authoring the component at page level in AEM brings it back on the next run.
  - **Lone hand-named slot fields render collapsed** (`options: { collapsible: true, collapsed: true }`): the Studio shows one row the author clicks to open — the closest native equivalent of AEM's edit-child-in-its-own-dialog flow — instead of the child's full field set expanded inline among the parent's own fields.

  **What you must do:** nothing — re-run `migrate:schema` and both changes apply to the regenerated schemas. If a slot-only component disappears from the "+ Add" menu that you still want insertable at page level, author one instance at page level in AEM (any page in your content roots) and re-run.

- [#75](https://github.com/demo-repositories/aem-to-sanity/pull/75) [`de5efdb`](https://github.com/demo-repositories/aem-to-sanity/commit/de5efdbce3b9900454298b55d1970cf478550e97) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - New optional tenant config `aem-component-slots.json`: per-slot visibility rules for auto-discovered named slots.

  Components that embed direct child components under fixed JCR keys (e.g. `promocard` carrying `buttonPrimary` / `buttonSecondary` / `image` children) were already auto-discovered and emitted as typed slot fields. This release lets you mirror the AEM enable-toggles that gate those children — `enablePrimaryButton`, `enableSecondaryButton`, `enableForegroundImage`, … — so the Studio hides a slot field exactly when AEM would hide the child:

  ```json
  {
    "uxp/components/proxy/content/promocard": {
      "buttonPrimary": { "visibleWhen": "enablePrimaryButton" },
      "buttonSecondary": { "visibleWhen": "enableSecondaryButton" },
      "image": { "visibleWhen": "enableForegroundImage" }
    }
  }
  ```

  - Keys: parent `sling:resourceType` (leading `/apps/` accepted) → emitted slot field name.
  - `"visibleWhen": "<field>"` — visible while the sibling **boolean** field is `true`.
  - `"visibleWhen": { "field": "...", "equals": "v" | ["v1", "v2"] }` — visible while the sibling **string** field matches.
  - Emitted as a Sanity `hidden: ({ parent }) => …` callback via the same machinery as the dialog show/hide idioms, including controller defaults.
  - Display-only: authored slot content migrates and persists regardless of the toggle. Rules with a missing/wrongly-typed controller, or naming a slot that never synthesized, warn and are skipped — nothing is ever hidden by accident.
  - Override the file path with `AEM_COMPONENT_SLOTS_FILE` (default `./aem-component-slots.json`); a missing file means no visibility behavior, as before.

  Also fixed: on dialogs with field groups (tabs), synthesized slot fields and the container drop-zone `childrenField` now join the first (default) group. Previously they carried no group, so the Studio — which auto-selects the first group tab — only showed them under "All fields", where authors couldn't find them. Re-run `migrate:schema` to pick up the regenerated schemas.

  **What you must do:** nothing, unless you want the behavior — then add `aem-component-slots.json` next to your other `aem-component-*` config and re-run `migrate:schema`. New tenants get an empty file scaffolded by `migrate:init`; on existing tenants `aem-to-sanity doctor` now points out when it's absent.

### Patch Changes

- Updated dependencies [[`de5efdb`](https://github.com/demo-repositories/aem-to-sanity/commit/de5efdbce3b9900454298b55d1970cf478550e97)]:
  - aem-to-sanity-core@2.1.0

## 2.0.0

### Major Changes

- [#73](https://github.com/demo-repositories/aem-to-sanity/pull/73) [`2936331`](https://github.com/demo-repositories/aem-to-sanity/commit/2936331b642180513ced8ee7198af6d109f81a6b) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Rich-text HTML tables now migrate to Sanity's native Portable Text tables (Studio ≥ 6.6).

  **What's new**

  - `aem-transform` converts `<table>` elements inside AEM richtext HTML into the canonical Portable Text table block (`{_type: "table", headerRows, rows[].cells[].value}`) instead of flattening them into loose paragraphs. `headerRows` is derived from `<thead>` (or leading all-`<th>` rows); marks, links, and lists inside cells are preserved; `colspan`/`rowspan` are dropped with content kept and rows padded rectangular; `<caption>` content is preserved as text block(s) before the table; nested or malformed tables fall back to flattened text — content is never dropped.
  - `migrate:schema` emits the `table`/`row`/`cell` type definitions into the generated schemas barrel on every run and widens richtext fields to `of: [{type: "block"}, {type: "table"}]`, so existing tenants pick everything up on their next schema run with no manual registration.
  - `aemFormComponents` (aem-to-sanity-studio) now enables the Studio's built-in table plugin, so ingested tables render as editable tables with row/column controls and a header-row toggle.
  - `sanitizeSchemaTypes` now renames only genuine Sanity built-ins (`SANITY_BUILTIN_TYPE_NAMES`) — the toolkit's `table`/`row`/`cell` types load as-is.

  **Fixes**

  - `--recreate-on-type-change` / `MIGRATION_RECREATE_ON_TYPE_CHANGE` actually works now: the content lake validates `_type` immutability against pre-transaction state, so the previous delete + create inside one transaction still failed with "immutable attribute `_type` may not be modified". Deletes for type-changed docs (published + shadowing draft) now commit in their own transaction before the page transactions.

  **Breaking**

  - `table`, `row`, and `cell` are now reserved type names. An AEM component that previously derived one of them (e.g. `/apps/.../components/table`) is renamed with the `aem` prefix (`aemTable`), which orphans previously ingested documents using the old `_type`. If a component of yours is affected: re-run `migrate:schema` → `transform` → `import --discard-drafts` (optionally `unpublishDocuments` the old-`_type` docs first).
  - Explicit `aem-component-names.json` overrides claiming `table`, `row`, or `cell` (and `MIGRATION_PAGE_BUILDER_NAME=table`) are now hard errors.
  - Hand-authored Studio types named `table`, `row`, or `cell` will collide with the generated barrel exports — rename or remove them.
  - `aem-to-sanity-studio` now requires `sanity >= 6.6.0` (peer dependency bump; the table plugin and the `form.components.portableText` hook don't exist earlier).

  Frontends rendering migrated Portable Text need a serializer for the new `table` block type.

### Patch Changes

- Updated dependencies []:
  - aem-to-sanity-core@2.0.0

## 1.11.1

### Patch Changes

- Updated dependencies []:
  - aem-to-sanity-core@1.11.1

## 1.11.0

### Minor Changes

- [#67](https://github.com/demo-repositories/aem-to-sanity/pull/67) [`e559707`](https://github.com/demo-repositories/aem-to-sanity/commit/e559707d2e60d4c39e436525c14113dfc0037847) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - npm distribution. All toolkit packages are now published to npm on every release — client projects install them as regular dependencies and update with `npm install <pkg>@latest` instead of git merges. New `aem-to-sanity-cli` package carries the operator CLI (`aem-to-sanity doctor | studio-sync | run | wipe-media-library`, all workspace-mode aware: they work both in the monorepo and in standalone scaffolds) and embeds the project template that `create-aem-to-sanity` scaffolds from. The repo scripts `migrate-doctor`, `studio-sync`, `run-with-log`, and `wipe-media-library` moved into the package (root `pnpm -w migrate:doctor` / `studio:sync` are now thin wrappers over the `aem-to-sanity` bin).

- [#67](https://github.com/demo-repositories/aem-to-sanity/pull/67) [`2cadb47`](https://github.com/demo-repositories/aem-to-sanity/commit/2cadb47c4746cfb285eaf0bdbf3cb5517b12f979) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Dependency majors: `zod` 4.4.3 in core (config error output unchanged; `z.string().url()` → `z.url()`) and `dotenv` 17.4.2 in the schema/content CLIs — v17's startup log line is silenced via a `load-env` module with `quiet: true`, so CLI stdout stays script-consumable. TypeScript is pinned to 5.9 with a workspace `pnpm.overrides` entry: TypeScript 7 (the native port) doesn't expose the compiler API tsup's declaration bundler needs, and without the pin sanity's optional `typescript` peer resolves to 7.x inside tenant workspaces. Remove the override when the toolchain supports TS 7.

### Patch Changes

- Updated dependencies [[`e559707`](https://github.com/demo-repositories/aem-to-sanity/commit/e559707d2e60d4c39e436525c14113dfc0037847), [`2cadb47`](https://github.com/demo-repositories/aem-to-sanity/commit/2cadb47c4746cfb285eaf0bdbf3cb5517b12f979)]:
  - aem-to-sanity-core@1.11.0

## 1.10.1

### Patch Changes

- [#63](https://github.com/demo-repositories/aem-to-sanity/pull/63) [`f70ee6e`](https://github.com/demo-repositories/aem-to-sanity/commit/f70ee6e364ddd164df4f192e4eb041d5cc042451) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Dependency refresh across the toolkit: Sanity Studio to 6.6.0 (`@sanity/ui` 3.4.3, `@sanity/schema` 6.6.0, `@sanity/client` 7.24.0), `zod` 4.4.3, `dotenv` 17.4.2 (with its new startup log line silenced — CLI stdout stays clean), `@portabletext/block-tools` 5.1.12, `@portabletext/schema` 2.2.3, `jsdom` 29.1.1, `prettier` 3.9.6, React 19.2.8, `styled-components` 6.4.4, plus dev tooling (tsx 4.23, turbo 2.10, vitest 4). TypeScript stays pinned to 5.9 via a workspace override — TypeScript 7 (the native port) doesn't expose the compiler API that tsup's declaration bundler needs; remove the override once the toolchain supports it. No CLI or output behavior changes.

- Updated dependencies [[`f70ee6e`](https://github.com/demo-repositories/aem-to-sanity/commit/f70ee6e364ddd164df4f192e4eb041d5cc042451)]:
  - aem-to-sanity-core@1.10.1

## 1.10.0

### Minor Changes

- [#58](https://github.com/demo-repositories/aem-to-sanity/pull/58) [`1cb19da`](https://github.com/demo-repositories/aem-to-sanity/commit/1cb19da5f0e19717b5a5b21955e1d5f8492d7e85) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - New `aem-to-sanity-studio` package: migration-critical Studio surface (the `category` taxonomy type, `aemFormComponents` AEM-widget input routing, the `aemSource` Media Library aspect) now ships as an importable package instead of files copied into each tenant Studio — toolkit updates deliver Studio changes to existing tenants automatically. The Studio template and `apps/studio` import from it; existing tenant studios adopt it via the new `pnpm -w studio:sync <slug> --fix` (copies template file additions and missing deps, never overwrites operator customizations).

### Patch Changes

- Updated dependencies [[`1cb19da`](https://github.com/demo-repositories/aem-to-sanity/commit/1cb19da5f0e19717b5a5b21955e1d5f8492d7e85)]:
  - aem-to-sanity-core@1.10.0

## 1.9.0

### Minor Changes

- [#54](https://github.com/demo-repositories/aem-to-sanity/pull/54) [`8217136`](https://github.com/demo-repositories/aem-to-sanity/commit/8217136172272ae21d37d453329084bf126add69) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - New optional tenant config `aem-component-names.json` (path override: `AEM_COMPONENT_NAMES_FILE`): pin the emitted Sanity type name and/or Studio title per component, keyed by `sling:resourceType`. Value is the type name as a string, or `{ "name", "title" }`. Explicit names win over the `MIGRATION_TYPE_NAMING` strategy and are claimed first — another component whose derived name collides takes the usual collision fallback. Reserved built-in names and duplicate override names are hard errors; entries matching no listed component path are logged and ignored. Same set-once-before-first-import hazard as the naming strategy: changing an override after content is ingested renames the type and orphans existing `_type` values.

### Patch Changes

- [#54](https://github.com/demo-repositories/aem-to-sanity/pull/54) [`fe48e06`](https://github.com/demo-repositories/aem-to-sanity/commit/fe48e06624f6d7cd633e11c31680ece6254cd14a) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Multifields whose inner field(s) map to nothing authorable (e.g. AEM core components' hidden bookkeeping multifield — the list editor's `./pages` wrapping a single `form/hidden` input) no longer emit an array of a zero-field object, which Sanity's schema validation rejects (`Object should have at least one field`). The field is skipped and surfaced in `migration-report.json → results[].unmapped` with reason `hidden`. Re-run `migrate:schema` if a previously generated schema fails `sanity schema validate` with that error.

- Updated dependencies [[`8217136`](https://github.com/demo-repositories/aem-to-sanity/commit/8217136172272ae21d37d453329084bf126add69)]:
  - aem-to-sanity-core@1.9.0

## 1.8.1

### Patch Changes

- [#50](https://github.com/demo-repositories/aem-to-sanity/pull/50) [`7d7b81b`](https://github.com/demo-repositories/aem-to-sanity/commit/7d7b81bf31791e4e87120d49bcc3a41c02dc1db2) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Boolean fields backed by AEM checkboxes with custom persisted constants no longer land as strings. AEM checkboxes persist their `value` attribute when checked and `uncheckedValue` when not — usually `"true"` / `"false"`, but dialogs are free to pick any constant (a link-target checkbox stores `"_blank"` / `"_self"`), which the Studio then rejected with `Expected type "Boolean", got "String"`.

  `migrate:schema` now records such constants in `content-type-registry.json` as `checkedValue` / `uncheckedValue` on the field (additive; old registries still load), and `aem-transform` coerces exact matches to `true` / `false` alongside the standard `"true"` / `"false"` literals. Works at any nesting depth, including multifield items.

  To pick up the fix on an existing migration: re-run `migrate:schema` (regenerates the registry with the constants), then `transform` + `import`.

- [#53](https://github.com/demo-repositories/aem-to-sanity/pull/53) [`e649102`](https://github.com/demo-repositories/aem-to-sanity/commit/e6491022e6535978aecb618947c9da683cbb0fb2) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Date and datetime fields no longer fail Studio validation with `Invalid date. Must be on the format "YYYY-MM-DD"`. AEM datepickers persist whatever their `valueFormat` dialog attribute says — the standard ISO-8601-with-offset JCR date when unset, but a display-style string when set (`valueFormat="MMM DD, yyyy"` persists `"May 23, 2024"`), which Sanity's strict `date` / `datetime` types rejected.

  `migrate:schema` now records the datepicker's `valueFormat` in `content-type-registry.json` (additive; old registries still load), and `aem-transform` parses authored values with it, re-emitting `YYYY-MM-DD` for `date` fields and UTC ISO for `datetime`. ISO inputs coerce even without a recorded format, and a `MMM DD, YYYY` month-name fallback covers the most common display format on registries that predate the capture. Dates parsed from ISO-with-time inputs keep the literal date part (no timezone conversion), and unparseable values keep the original so they surface in Studio validation instead of being silently remapped.

  To pick up the fix on an existing migration: re-run `migrate:schema`, then `transform` + `import`.

- Updated dependencies []:
  - aem-to-sanity-core@1.8.1

## 1.8.0

### Patch Changes

- Updated dependencies []:
  - aem-to-sanity-core@1.8.0

## 1.7.0

### Minor Changes

- [#44](https://github.com/demo-repositories/aem-to-sanity/pull/44) [`e279947`](https://github.com/demo-repositories/aem-to-sanity/commit/e2799479e9c44c79cc7aae7048f0805f4d3a090c) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Title-based type naming via `MIGRATION_TYPE_NAMING=title`.

  By default, component Sanity type names (and schema file names, registry `sanityType`s, and ingested `_type`s) derive from the JCR path after `components/` — `proxy/content/cardcontainer` → `proxyContentCardcontainer`. Setting `MIGRATION_TYPE_NAMING=title` derives them from each component's `jcr:title` instead: `"Card Container"` → `cardContainer`, with the redundant trailing " component" stripped the same way Studio labels are.

  Behavior in title mode:
  - `migrate:schema` runs an extra pre-pass fetching component nodes so titles are known before names resolve; the main pass reuses the fetched nodes (no double fetch).
  - Missing/blank `jcr:title` falls back to the path-derived name.
  - Title collisions keep the first component (in `aem-component-paths` order) clean; later ones get their path-derived name as a suffix (`teaser`, `teaserProxyContentTeaser`). Reserved Sanity built-ins still get the `aem` prefix.
  - Every fallback is logged at info level.

  Operator notes:
  - Default is unchanged (`path`) — existing tenants need no changes.
  - **Pick the strategy once, before the first import.** Switching later — or renaming a component's `jcr:title` in AEM — renames the emitted types and orphans previously ingested `_type` values; recovering requires `--recreate-on-type-change` or a fresh dataset.
  - Custom `_type` values must be mirrored in the consuming frontend's block dispatcher.

### Patch Changes

- Updated dependencies []:
  - aem-to-sanity-core@1.7.0

## 1.6.0

### Minor Changes

- [#41](https://github.com/demo-repositories/aem-to-sanity/pull/41) [`40dfac7`](https://github.com/demo-repositories/aem-to-sanity/commit/40dfac77d7380531c665aef5710474a03b66298d) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Configurable page-builder name via `MIGRATION_PAGE_BUILDER_NAME` ([#40](https://github.com/demo-repositories/aem-to-sanity/issues/40)).

  The generated page-builder array type and the field page blocks land under — previously hardcoded to `pageBuilder` — can now be renamed (e.g. `sections`). One env var names everything that must agree: the emitted `{name}.ts` file and its `defineType({ name })`, the field on `page.ts` and per-template documents, the type container drop-zones reference, and the key `aem-transform` writes page blocks under on ingested documents. The standalone `aem-to-sanity-pagebuilder` CLI also defaults to it (`--pagebuilder-type` still overrides).

  Operator notes:
  - Default is unchanged (`pageBuilder`) — existing tenants need no changes.
  - Set the value once in the tenant `.env` before the first run and leave it alone. `migrate:schema` and `aem-transform` both read the same env var; changing it between stages desyncs the schema from the ingested content.
  - The name must be a valid identifier (letters/digits/underscores, starting with a letter). `page` and `index` are rejected (file collisions in the schemas dir), as are names shadowing a built-in Sanity type or a generated component type.
  - Frontends query the page-builder field by name — mirror a custom value in the consuming app's GROQ queries.

### Patch Changes

- Updated dependencies [[`40dfac7`](https://github.com/demo-repositories/aem-to-sanity/commit/40dfac77d7380531c665aef5710474a03b66298d)]:
  - aem-to-sanity-core@1.6.0

## 1.5.0

### Minor Changes

- [#37](https://github.com/demo-repositories/aem-to-sanity/pull/37) [`d23d24b`](https://github.com/demo-repositories/aem-to-sanity/commit/d23d24b1eb0f2479581786bc362c1f9bbc77b114) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Core AEM's stock `cq-dialog-dropdown-showhide` pattern now emits conditional Studio fields, same as the ACS Commons show/hide support: a select whose `granite:data` carries `cq-dialog-dropdown-showhide-target` (a `.class` selector) conditions every field under nodes marked with that class and `granite:data.showhidetargetvalue` — they emit `hidden: ({ parent }) => …` callbacks so the Studio dialog folds like the AEM one. Both vocabularies resolve through the same machinery (same scoping, default-value fallbacks, and AND-ing of nested targets). Re-run `pnpm migrate:schema` to pick it up; persisted content is unaffected.

### Patch Changes

- Updated dependencies []:
  - aem-to-sanity-core@1.5.0

## 1.4.0

### Minor Changes

- [#34](https://github.com/demo-repositories/aem-to-sanity/pull/34) [`e6beb8a`](https://github.com/demo-repositories/aem-to-sanity/commit/e6beb8aa7d2d05e7c84c73545f15c77310dbd934) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Coral wells (`granite/ui/components/coral/foundation/well`) now emit as non-collapsible Sanity fieldsets instead of flattening invisibly. The fieldset title comes from the well's `jcr:title` when present, otherwise from the `text` of the first `heading` widget (`granite/ui/components/coral/foundation/heading`) rendered inside the well — wrapper containers between the well and the heading are searched through, matching the common AEM authoring pattern (a trailing colon is stripped, e.g. "Overlay Options:" → "Overlay Options"). Wells with neither keep the old behavior: fields hoist up ungrouped. Re-run `pnpm migrate:schema` to pick up the new grouping; persisted content is unaffected (fieldsets are a Studio display concern).

### Patch Changes

- Updated dependencies []:
  - aem-to-sanity-core@1.4.0

## 1.3.0

### Minor Changes

- [#29](https://github.com/demo-repositories/aem-to-sanity/pull/29) [`59766b5`](https://github.com/demo-repositories/aem-to-sanity/commit/59766b52e3c2dc84dbc24f9ef40be9fc3aa3c0da) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Support ACS Commons [show/hide widgets](https://adobe-consulting-services.github.io/acs-aem-commons/features/ui-widgets/show-hide-widgets/index.html) — dialog fields toggled by a select or checkbox now emit as Sanity conditional fields:
  - A select / radio group / button group or checkbox / switch whose `granite:data` carries `acs-cq-dialog-dropdown-checkbox-showhide-target` (a `.class` selector) is detected as a **controller**; any dialog node whose `granite:class` includes that class and whose `granite:data` names `acs-dropdownshowhidetargetvalue` (space-separated select values) or `acs-checkboxshowhidetargetvalue` (`"true"` → visible when checked, `""` → visible when unchecked) is a **target**.
  - Every field mapped from or under a target emits `hidden: ({ parent }) => …` reading the controller off its sibling scope, so the Studio dialog folds the same way the AEM one did. Target containers (wells, tab items) condition all fields inside them; nested targets AND together; a target carrying both attributes combines dropdown + checkbox conditions.
  - An unset controller counts as its AEM default — matching what an author sees opening a fresh AEM dialog: dropdown conditions fall back to the controller's default (`selected`) option, checkbox conditions to the widget's `checked` attribute (absent or Granite EL `${...}` defaults count as unchecked).
  - Resolution is scoped per object: a controller and its targets must be siblings in the emitted Sanity object (same rule inside multifield rows, mirroring ACS's row-local semantics). Unmatched targets stay unconditionally visible.

  Visibility is a Studio display concern only — authored values migrate and import regardless of whether their field is currently shown. Re-run `migrate:schema` to pick up the conditional callbacks (previously these fields were always visible).

### Patch Changes

- [#29](https://github.com/demo-repositories/aem-to-sanity/pull/29) [`3e9d897`](https://github.com/demo-repositories/aem-to-sanity/commit/3e9d8974cfa87b32f2bffda938a36a677f94d276) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Fix boolean `initialValue` emission: checkbox / switch defaults now come from the AEM `checked` attribute (the widget's actual default state) instead of `value` (the constant persisted when checked — `"true"` on virtually every widget). Previously nearly every generated boolean field carried `initialValue: true`, so documents created fresh in the Studio got toggles flipped on that AEM would have defaulted off. Literal `checked` values map directly (`true`/`"true"` → `true`, `false`/`"false"` → `false`); when `checked` is absent or a Granite EL expression (`${...}`, resolved server-side against design config and unresolvable offline), no `initialValue` is emitted — the Studio's unset boolean behaves as unchecked, matching AEM.

  Migrated documents are unaffected (`initialValue` only applies at Studio document creation). Re-run `migrate:schema` to regenerate.

- Updated dependencies []:
  - aem-to-sanity-core@1.3.0

## 1.2.0

### Minor Changes

- [#26](https://github.com/demo-repositories/aem-to-sanity/pull/26) [`c6bd779`](https://github.com/demo-repositories/aem-to-sanity/commit/c6bd779f5422d1c7e47235fed9d2030d7c022937) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Support AEM's Coral text widget (`granite/ui/components/coral/foundation/text`) — the static author-facing copy dialogs use for instructions and inline warnings. It now emits a display-only note: a read-only `string` field carrying the message in its `description`, marked `options.aemWidget: "note"`. The example Studio renders marked fields as a caution-toned banner replacing the whole field (label and input included) via a new `form.components.field` resolver; Studios without the resolver fall back to an empty read-only input with the message as its description. Nothing is persisted for these fields. Previously Coral text surfaced as an unmapped placeholder field with a TODO description. Re-run `pnpm migrate:schema` to regenerate schemas.

### Patch Changes

- Updated dependencies []:
  - aem-to-sanity-core@1.2.0

## 1.1.0

### Minor Changes

- [#24](https://github.com/demo-repositories/aem-to-sanity/pull/24) [`4073b7d`](https://github.com/demo-repositories/aem-to-sanity/commit/4073b7d427e58c550f95dd3a78c14f056998d1f7) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Support AEM's Coral accordion container (`granite/ui/components/coral/foundation/accordion`) in dialogs. Accordion panels flatten into the parent field list, and each panel's `jcr:title` becomes a **collapsible Sanity fieldset** (collapsed unless the panel carries a truthy `active` attribute). Fields inside the panel keep the surrounding tab's group, so an accordion nested inside a dialog tab renders as a fold-out section within that tab — matching AEM — instead of being promoted to a top-level Studio tab. Previously accordions surfaced as an unmapped placeholder field and their nested fields were dropped. Re-run `pnpm migrate:schema` to regenerate schemas with the fieldsets.

- [#22](https://github.com/demo-repositories/aem-to-sanity/pull/22) [`b4361e4`](https://github.com/demo-repositories/aem-to-sanity/commit/b4361e42f0400b9c2beb840f5107eb04ea0b3871) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Support AEM's Coral buttongroup widget (`granite/ui/components/coral/foundation/form/buttongroup`):
  - **Single selection mode** → Sanity `string` with `options.list` built from the dialog's literal `items`; an item flagged `selected` becomes the field's `initialValue`. Fields carry an `options.aemWidget: "buttonGroup"` marker that the example Studio routes to a new toggle-button-group input (`apps/studio/components/inputs/StringToggleGroupInput.tsx`, adapted from sanity-io/sanetti-3), so authors keep the one-click row of buttons they had in AEM. Studios without the resolver fall back to the default dropdown.
  - **Multiple selection mode** → Sanity `array` of `string` with the same `options.list` (built-in checkbox rendering). `aem-transform` coerces the bare-string shape JCR produces when exactly one value is picked into a one-item array.
  - **Datasource-driven items** (ACS Commons generic lists etc.) are opaque over `.infinity.json`; those fields fall back to a plain field without options — authored values still migrate.

  No action needed for existing migrations; re-run `migrate:schema` + `transform` to pick up the new mapping (previously these dialogs emitted TODO placeholder strings).

### Patch Changes

- [`c94a85f`](https://github.com/demo-repositories/aem-to-sanity/commit/c94a85fc425915183eeb178edac0f4c03150e637) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Fix widget-rooted granite includes: a dialog fragment referenced via `granite/ui/components/coral/foundation/include` whose fetched root node is itself a form widget (e.g. a shared buttongroup dialog like uxp textstyle's `textAlignment`) now maps as that single field. Previously the mapper only walked the fragment's children, so the widget's option items leaked out as placeholder string fields (`inherit`, `left`, `center`, `right`) and the real field was never emitted. Structural fragments whose fields are child nodes are unaffected. Re-run `migrate:schema` (then transform + import) to pick up the corrected fields.

- Updated dependencies []:
  - aem-to-sanity-core@1.1.0

## 1.0.0

### Major Changes

- [`1614ea4`](https://github.com/demo-repositories/aem-to-sanity/commit/1614ea4204bbcbfa742a60f0eb34ea509218b926) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Initial stable release (1.0.0) of the AEM → Sanity migration toolkit:
  - `aem-to-sanity-core`: shared AEM fetcher, config resolver, logger, and `.infinity.json` depth-truncation walker.
  - `aem-to-sanity-schema`: AEM Granite UI dialog → Sanity object schema + TypeGen pipeline.
  - `aem-to-sanity-content`: AEM JCR content → Sanity document migration with streaming drift audit.

### Patch Changes

- Updated dependencies [[`1614ea4`](https://github.com/demo-repositories/aem-to-sanity/commit/1614ea4204bbcbfa742a60f0eb34ea509218b926)]:
  - aem-to-sanity-core@1.0.0
