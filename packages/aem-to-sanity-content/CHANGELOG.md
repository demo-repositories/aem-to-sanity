# aem-to-sanity-content

## 2.9.0

### Patch Changes

- Updated dependencies [[`e838fc4`](https://github.com/demo-repositories/aem-to-sanity/commit/e838fc42e2503099c38285885a45cf63b03bf03a)]:
  - aem-to-sanity-core@2.9.0

## 2.8.0

### Minor Changes

- [#104](https://github.com/demo-repositories/aem-to-sanity/pull/104) [`3f93ade`](https://github.com/demo-repositories/aem-to-sanity/commit/3f93adebd0321e4ba249b326697b1ca65ff01590) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Two new per-component Studio polish knobs:

  **`fieldOverrides` in `aem-dialog-overrides.json`** — per-field tweaks the AEM dialog can't express, keyed by emitted (camelCase) field name. `readOnly: true` locks the input; `initialValue` seeds Studio-created content with a JSON literal, or the sentinel `"uuid"` which emits `initialValue: () => crypto.randomUUID()` — the pattern for auto-generated ids like a permissions tab's `componentId`. A `"*"` key applies its `fieldOverrides` to every listed component (per-component entries win per field), so shared-tab fields need declaring once:

  ```json
  {
    "*": {
      "fieldOverrides": {
        "componentId": { "readOnly": true, "initialValue": "uuid" }
      }
    }
  }
  ```

  **`preview` in `aem-component-names.json`** — overrides the generated type's Studio preview. `title` / `subtitle` / `media` are select paths (dot notation allowed, e.g. `"items.0.title"`); `count` names a top-level array field whose item count is appended to the row title (`"Accordion (3 items)"`); Studio previews can't select whole arrays, so the count probes the first 10 indexes' `_key`s (arrays of objects only) and shows `"10+"` beyond that. Unset slots keep the emitter's defaults (static component title, subtitle/media heuristics):

  ```json
  {
    "uxp/components/proxy/content/accordion": {
      "preview": { "subtitle": "items.0.title", "count": "items" }
    }
  }
  ```

  Operators: no action needed — both knobs are optional and safe to change between runs (they never touch type names or ingested content; `initialValue` only affects content created in the Studio). Re-run `migrate:schema` to apply.

### Patch Changes

- Updated dependencies [[`3f93ade`](https://github.com/demo-repositories/aem-to-sanity/commit/3f93adebd0321e4ba249b326697b1ca65ff01590)]:
  - aem-to-sanity-core@2.8.0

## 2.7.0

### Minor Changes

- [#100](https://github.com/demo-repositories/aem-to-sanity/pull/100) [`b047a4a`](https://github.com/demo-repositories/aem-to-sanity/commit/b047a4aba503639edb2e4b85191ba7023dbdfe3d) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Datasource-driven selects, radiogroups, and buttongroups now resolve their options where possible instead of always falling back to a plain field:

  - **ACS Commons generic lists** (`acs-commons/components/utilities/genericlist/datasource`) — options are fetched from the list page named by the datasource's `path` (`{path}/jcr:content/list` children's `jcr:title` + `value`), using the same transport/auth as dialog fetches, memoized per component run. Missing or empty lists fall back as before.
  - **Core policy datasources** — `allowedheadingelements/v1` and the title component's `allowedtypes` (v1/v2) emit the servlet's no-policy default list (`h1`–`h6`). The template content policy may allow fewer values than offered (policy resolution is per-instance; the migration is per-type) — authored values round-trip either way.
  - **All other datasources** (project-custom servlets, Scene7 image presets, language lists) still fall back to a plain field, and each fallback is now visible in `migration-report.json → results[].unmapped` with the new reason `datasource-unresolved` and a detail naming the datasource. Restore those dropdowns with `aem-dialog-overrides.json`'s `dialogFile` and literal `items`.

  Operators: no action needed. Re-running `migrate:schema` upgrades affected fields from plain text inputs to dropdowns / toggle groups; authored content is unaffected.

- [#100](https://github.com/demo-repositories/aem-to-sanity/pull/100) [`618dd9a`](https://github.com/demo-repositories/aem-to-sanity/commit/618dd9ab811a94de2246bb62569a025899b82f0d) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - New optional tenant config `aem-dialog-overrides.json` (path override: `AEM_DIALOG_OVERRIDES_FILE`): per-component dialog overrides for `migrate:schema`, the escape hatch for Sling-Resource-Merger dialog inheritance.

  AEM merges dialogs across the whole `sling:resourceSuperType` chain at author time, so a proxy component with its own `cq:dialog` still inherits tabs from ancestor dialogs — tabs the migrator's first-hit resolution never sees (symptom: the AEM author dialog shows a tab the emitted Sanity type is missing). Keyed by `sling:resourceType`, each entry supports:

  - `supplementaryTabs: [{path, insertAfter?, insertBefore?, key?}]` — fetches each tab node from the given absolute JCR path (`{path}.infinity.json`, same transport/auth as other dialog fetches) and splices it into the resolved dialog's tabs container. Position by sibling tab node name; omitted → append. Missing anchor warns and appends; a duplicate tab key, a dialog without a tabs container, or a 404 on the tab path fail the component as `mappingError` (previously such config problems could only surface as `network`).
  - `dialogFile: "<path>"` — a local JSON file (resolved against the config file's directory, then cwd) holding the complete `cq:dialog` node; replaces dialog resolution entirely. Combinable: the file is the base, tabs splice on top.

  Applied overrides are recorded in `migration-report.json` (`results[].dialogOverride`, `results[].supplementaryTabs`), and the `output/cache/aem/apps/…` snapshot now stores the **merged** dialog rather than the raw AEM response. `scripts/aem-probe.ts` and the audit step apply the same overrides via the new shared `resolveEffectiveDialog` helper in `aem-to-sanity-core`, so probe output stays exactly what the migrator maps.

  Operators: nothing to do unless you need it — missing file is a no-op. To adopt, copy the empty stub from `tenants/template/aem-dialog-overrides.json` (new tenants get it from `migrate:init`; `migrate:doctor` classifies it as operator-owned).

- [#100](https://github.com/demo-repositories/aem-to-sanity/pull/100) [`c8c3bc3`](https://github.com/demo-repositories/aem-to-sanity/commit/c8c3bc31eed723c6fe3fbbae7bd9524ec16d05f9) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - New `aem-eject-dialogs` CLI (tenant script `pnpm eject-dialogs <paths…|--all> [--force] [--out-dir <dir>]`): materializes each component's **effective** dialog into a static, hand-editable file.

  For every requested component it runs the exact resolution `migrate:schema` uses — embedded `cq:dialog`, the `sling:resourceSuperType` walk, and `aem-dialog-overrides.json` `supplementaryTabs` splicing — bakes resolvable datasource options in as literal `items` (ACS generic lists fetched from JCR, core policy datasources → their `h1`–`h6` defaults; unresolvable datasources keep their `datasource` node so the report still flags them), writes the result to `./dialog-overrides/<resourceType>.json`, and rewrites the component's `aem-dialog-overrides.json` entry to `{ "dialogFile": … }` (a baked `supplementaryTabs` entry is dropped to prevent double-splicing; unrelated entries pass through untouched).

  The ejected file becomes the component's dialog source of truth: hand-add fields, prune tabs, pin select options, then re-run `migrate:schema` — no more thinking about resolution order, merger inheritance, or datasource servlets. Trade-off: ejected dialogs are frozen snapshots — AEM-side dialog changes stop flowing until re-ejected with `--force`, which overwrites the file and discards hand edits. Without `--force`, existing files are never touched.

  Operators: opt-in only; nothing changes unless you run it. The tenant template gains the `eject-dialogs` script (`migrate:doctor --fix` propagates it to existing tenants).

- [#102](https://github.com/demo-repositories/aem-to-sanity/pull/102) [`c75cace`](https://github.com/demo-repositories/aem-to-sanity/commit/c75cacee60f738a2211dbcd0af618a98bc2a8b0b) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Per-template document type names can now be pinned in `aem-page-components.json` via a new `names` map on each page-shell entry, keyed by `cq:template` path. Values are a type name string or `{ "name", "title" }` — the same shape as `aem-component-names.json`:

  ```json
  {
    "uxp/components/structure/page": {
      "discover": true,
      "names": {
        "/conf/uxp/settings/wcm/templates/universal-page": {
          "name": "universalPage",
          "title": "Universal Page"
        }
      }
    }
  }
  ```

  Without an override the type name still derives from the template path with a `Page` suffix, which doubles up when the template name already ends in "-page" (`universal-page` → `universalPagePage`). Explicit names are used verbatim and claim first; a reserved or colliding explicit name fails `migrate:schema` with a clear error. The override flows through the `page-templates.json` manifest so `aem-transform` stamps the same `_type` automatically.

  Operators: no action needed — existing configs keep their derived names. If you rename a type on an already-imported tenant, re-run `migrate:schema` → `transform` → `import --recreate-on-type-change` (destroys publish history and drafts of the affected page docs).

### Patch Changes

- Updated dependencies [[`b047a4a`](https://github.com/demo-repositories/aem-to-sanity/commit/b047a4aba503639edb2e4b85191ba7023dbdfe3d), [`618dd9a`](https://github.com/demo-repositories/aem-to-sanity/commit/618dd9ab811a94de2246bb62569a025899b82f0d), [`c8c3bc3`](https://github.com/demo-repositories/aem-to-sanity/commit/c8c3bc31eed723c6fe3fbbae7bd9524ec16d05f9), [`c75cace`](https://github.com/demo-repositories/aem-to-sanity/commit/c75cacee60f738a2211dbcd0af618a98bc2a8b0b)]:
  - aem-to-sanity-core@2.7.0

## 2.6.0

### Minor Changes

- [#97](https://github.com/demo-repositories/aem-to-sanity/pull/97) [`5fec675`](https://github.com/demo-repositories/aem-to-sanity/commit/5fec675ddf8bd34145b4cf28bfa1cb0f198d03f1) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Per-component Studio icons via `aem-component-names.json`. Entries can now carry an `icon` — a `@sanity/icons` icon component name (e.g. `"icon": "ControlsIcon"`). The generated schema imports it from the icon's subpath module (`import { ControlsIcon } from "@sanity/icons/Controls"` — the v5 layout; the root module no longer has per-icon exports) and declares `defineType({ icon })`, so the component shows that icon in the page-builder insert menu, array item previews, and structure lists. Icons are safe to add, change, or drop between runs — they never touch type names or ingested content. Malformed values (anything that isn't a PascalCase identifier ending in `Icon`) fail at config load.

  Operators: the consuming Studio needs `@sanity/icons` in its dependencies. Newly scaffolded studios include it; existing tenant studios pick it up with `pnpm -w studio:sync <slug> --fix` (or add `"@sanity/icons": "^5.2.1"` by hand).

### Patch Changes

- Updated dependencies [[`5fec675`](https://github.com/demo-repositories/aem-to-sanity/commit/5fec675ddf8bd34145b4cf28bfa1cb0f198d03f1)]:
  - aem-to-sanity-core@2.6.0

## 2.5.0

### Patch Changes

- Updated dependencies [[`e2d6443`](https://github.com/demo-repositories/aem-to-sanity/commit/e2d6443c37dbdd42f0ff7ac26671cfb5149692b3)]:
  - aem-to-sanity-core@2.5.0

## 2.4.0

### Patch Changes

- [#89](https://github.com/demo-repositories/aem-to-sanity/pull/89) [`5749d10`](https://github.com/demo-repositories/aem-to-sanity/commit/5749d10ec744798666966b0e1c98aa3b9003f7fe) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Document how frontends query `contentFragmentRef` blocks: the generated mapping doc (and the operator guide) now include the GROQ dereference pattern (`fragment->{ _id, title, content }`), a note that refs appear at any page-builder depth (including container `items`), and two strategies for nested fragments — a depth-N inline join helper or lazy per-fragment fetching. No behavior change; docs only.

- Updated dependencies [[`63e5133`](https://github.com/demo-repositories/aem-to-sanity/commit/63e5133ac26ee991f24c4e0da56aff1a8896d79d)]:
  - aem-to-sanity-core@2.4.0

## 2.3.0

### Minor Changes

- [`2230cad`](https://github.com/demo-repositories/aem-to-sanity/commit/2230cadcd7f3b72e77e7fbbcb46d82e55ec7b509) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - New container config option `document: true` (mutually exclusive with `flatten`): every instance of the component is extracted into its own `contentFragment` document with a `contentFragmentRef` block left in the parent array — by design, not depth pressure. Intended for recursive structural components (tabs, accordions): Sanity's attribute-depth limit is counted per document, so each extracted level resets the budget by construction; editors always see one click-through reference shape; frontends need exactly one join per configured type. Fragment ids derive from the page id + the block's stable `_key` (idempotent re-runs), titles come from the component's dialog with a nearest-panel-title fallback ("Get started — accordion"), and every extraction is listed in `transform-report.json → configExtractedFragments`. Note: a re-run that stops producing a fragment leaves the old document orphaned — reconcile against the report. The depth-triggered extraction remains as a safety net for unconfigured shapes.

### Patch Changes

- Updated dependencies [[`2230cad`](https://github.com/demo-repositories/aem-to-sanity/commit/2230cadcd7f3b72e77e7fbbcb46d82e55ec7b509)]:
  - aem-to-sanity-core@2.3.0

## 2.2.0

### Minor Changes

- [`cc8f917`](https://github.com/demo-repositories/aem-to-sanity/commit/cc8f917cfb9efa74c5a311af51ddaff8c363f851) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Tabs and accordion panels survive migration. AEM's tab/accordion components drop the same container resource type into their panels that responsive grids use for pure layout — distinguished only by the `cq:panelTitle` stamped on the panel node. A `flatten: true` container carrying `cq:panelTitle` now keeps its block instead of dissolving into the parent (which merged all panels' contents into one flat list and dropped every panel title); title-less layout containers flatten exactly as before, including inside a kept panel, and nested tabs roundtrip recursively.

  To adopt: register the tabs/accordion component as a plain (non-flatten) container in `aem-component-containers.json` and opt the panel container's resource type into the `cq:panelTitle` authoring hint in `aem-component-hints.json`, then re-run `migrate:schema` + `transform` + `import --discard-drafts`. Pages whose preserved panels would exceed Sanity's hard 20-level attribute-depth limit are repaired automatically and losslessly: the transform cuts the offending subtree into a standalone `contentFragment` document and leaves a `contentFragmentRef` block in its place (fragments import in the same per-page transaction; every cut is listed in `transform-report.json → depthExtractedFragments`). Shapes that can't be cut fall back to flattening the deepest titled panel (`depthFlattenedPanels`).

### Patch Changes

- [`5eab4e0`](https://github.com/demo-repositories/aem-to-sanity/commit/5eab4e0d2b1c4ef76d8dba36b6c4100b07598166) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - `aem-import` no longer aborts the whole run when one page's transaction fails (e.g. a document rejected by the API). Each page is already its own atomic transaction, so the importer now records the failure, keeps committing the remaining pages, prints a per-page `FAILED:` line plus an end-of-run summary of failed pages, and exits non-zero. Previously one bad document silently blocked every page after it.

- Updated dependencies []:
  - aem-to-sanity-core@2.2.0

## 2.1.3

### Patch Changes

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

### Patch Changes

- [#54](https://github.com/demo-repositories/aem-to-sanity/pull/54) [`7dee8fb`](https://github.com/demo-repositories/aem-to-sanity/commit/7dee8fb47d9be08cdabf855edc16b63e31ce675b) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - `aem-transform` no longer inlines nested child pages' content into the parent page's pageBuilder. A roots entry migrates only that page's own body: when a roots-file entry points at a section root (non-leaf page), each nested `cq:Page` subtree is now skipped instead of being flattened into the parent doc. Skipped pages are counted in the run summary and listed in full under `transform-report.json → skippedChildPages` — add each one as its own line in `aem-content-roots`, then re-run `extract` → `transform` → `import` to migrate it as its own document.

  Operators who previously ran a non-leaf roots entry should re-run `transform` + `import` after upgrading: the parent doc sheds the duplicated child content, and the child pages import as separate docs once listed in the roots file.

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

### Minor Changes

- [#47](https://github.com/demo-repositories/aem-to-sanity/pull/47) [`21ca802`](https://github.com/demo-repositories/aem-to-sanity/commit/21ca8024d9da8f90d4917b3749d3ca717db89b4a) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - New `MIGRATION_SLUG_STRATEGY` env var controls how each page doc's `slug.current` is derived at `aem-transform`. `segment` (default, unchanged behavior) uses the last segment of the JCR path. `path` uses the path relative to the roots-file `@base`, exactly as authored in `aem-content-roots` (e.g. `us/en/company-culture/belonging/chapters`) — for frontends that route nested pages off the full sub-path.

  `aem-extract` now records that base-relative path as `relativePath` in each raw cache file (additive; old caches still load). With `MIGRATION_SLUG_STRATEGY=path`, raw files extracted before this release (and absolute roots entries outside any `@base`) fall back to the last segment with a warning — run `aem-extract --overwrite` once to capture the base-relative paths.

  Pick the strategy once before the first import: switching later rewrites `slug.current` on every page (doc `_id`s are unaffected, so re-imports overwrite in place rather than orphaning), and frontend routing keyed on slugs must move in the same deploy.

### Patch Changes

- Updated dependencies []:
  - aem-to-sanity-core@1.8.0

## 1.7.0

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

### Patch Changes

- Updated dependencies []:
  - aem-to-sanity-core@1.5.0

## 1.4.0

### Patch Changes

- Updated dependencies []:
  - aem-to-sanity-core@1.4.0

## 1.3.0

### Patch Changes

- Updated dependencies []:
  - aem-to-sanity-core@1.3.0

## 1.2.0

### Patch Changes

- Updated dependencies []:
  - aem-to-sanity-core@1.2.0

## 1.1.0

### Minor Changes

- [#22](https://github.com/demo-repositories/aem-to-sanity/pull/22) [`b4361e4`](https://github.com/demo-repositories/aem-to-sanity/commit/b4361e42f0400b9c2beb840f5107eb04ea0b3871) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Support AEM's Coral buttongroup widget (`granite/ui/components/coral/foundation/form/buttongroup`):
  - **Single selection mode** → Sanity `string` with `options.list` built from the dialog's literal `items`; an item flagged `selected` becomes the field's `initialValue`. Fields carry an `options.aemWidget: "buttonGroup"` marker that the example Studio routes to a new toggle-button-group input (`apps/studio/components/inputs/StringToggleGroupInput.tsx`, adapted from sanity-io/sanetti-3), so authors keep the one-click row of buttons they had in AEM. Studios without the resolver fall back to the default dropdown.
  - **Multiple selection mode** → Sanity `array` of `string` with the same `options.list` (built-in checkbox rendering). `aem-transform` coerces the bare-string shape JCR produces when exactly one value is picked into a one-item array.
  - **Datasource-driven items** (ACS Commons generic lists etc.) are opaque over `.infinity.json`; those fields fall back to a plain field without options — authored values still migrate.

  No action needed for existing migrations; re-run `migrate:schema` + `transform` to pick up the new mapping (previously these dialogs emitted TODO placeholder strings).

### Patch Changes

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
