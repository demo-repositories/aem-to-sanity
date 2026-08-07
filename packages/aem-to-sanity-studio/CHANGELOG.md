# aem-to-sanity-studio

## 2.9.0

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

## 2.6.0

### Minor Changes

- [#97](https://github.com/demo-repositories/aem-to-sanity/pull/97) [`5fec675`](https://github.com/demo-repositories/aem-to-sanity/commit/5fec675ddf8bd34145b4cf28bfa1cb0f198d03f1) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Per-component Studio icons via `aem-component-names.json`. Entries can now carry an `icon` — a `@sanity/icons` icon component name (e.g. `"icon": "ControlsIcon"`). The generated schema imports it from the icon's subpath module (`import { ControlsIcon } from "@sanity/icons/Controls"` — the v5 layout; the root module no longer has per-icon exports) and declares `defineType({ icon })`, so the component shows that icon in the page-builder insert menu, array item previews, and structure lists. Icons are safe to add, change, or drop between runs — they never touch type names or ingested content. Malformed values (anything that isn't a PascalCase identifier ending in `Icon`) fail at config load.

  Operators: the consuming Studio needs `@sanity/icons` in its dependencies. Newly scaffolded studios include it; existing tenant studios pick it up with `pnpm -w studio:sync <slug> --fix` (or add `"@sanity/icons": "^5.2.1"` by hand).

## 2.5.0

## 2.4.0

## 2.3.0

## 2.2.0

## 2.1.3

## 2.1.2

## 2.1.1

## 2.1.0

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

## 1.11.1

## 1.11.0

### Minor Changes

- [#67](https://github.com/demo-repositories/aem-to-sanity/pull/67) [`e559707`](https://github.com/demo-repositories/aem-to-sanity/commit/e559707d2e60d4c39e436525c14113dfc0037847) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - npm distribution. All toolkit packages are now published to npm on every release — client projects install them as regular dependencies and update with `npm install <pkg>@latest` instead of git merges. New `aem-to-sanity-cli` package carries the operator CLI (`aem-to-sanity doctor | studio-sync | run | wipe-media-library`, all workspace-mode aware: they work both in the monorepo and in standalone scaffolds) and embeds the project template that `create-aem-to-sanity` scaffolds from. The repo scripts `migrate-doctor`, `studio-sync`, `run-with-log`, and `wipe-media-library` moved into the package (root `pnpm -w migrate:doctor` / `studio:sync` are now thin wrappers over the `aem-to-sanity` bin).

- [#67](https://github.com/demo-repositories/aem-to-sanity/pull/67) [`2cadb47`](https://github.com/demo-repositories/aem-to-sanity/commit/2cadb47c4746cfb285eaf0bdbf3cb5517b12f979) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Dependency majors: `zod` 4.4.3 in core (config error output unchanged; `z.string().url()` → `z.url()`) and `dotenv` 17.4.2 in the schema/content CLIs — v17's startup log line is silenced via a `load-env` module with `quiet: true`, so CLI stdout stays script-consumable. TypeScript is pinned to 5.9 with a workspace `pnpm.overrides` entry: TypeScript 7 (the native port) doesn't expose the compiler API tsup's declaration bundler needs, and without the pin sanity's optional `typescript` peer resolves to 7.x inside tenant workspaces. Remove the override when the toolchain supports TS 7.

## 1.10.1

### Patch Changes

- [#63](https://github.com/demo-repositories/aem-to-sanity/pull/63) [`f70ee6e`](https://github.com/demo-repositories/aem-to-sanity/commit/f70ee6e364ddd164df4f192e4eb041d5cc042451) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Dependency refresh across the toolkit: Sanity Studio to 6.6.0 (`@sanity/ui` 3.4.3, `@sanity/schema` 6.6.0, `@sanity/client` 7.24.0), `zod` 4.4.3, `dotenv` 17.4.2 (with its new startup log line silenced — CLI stdout stays clean), `@portabletext/block-tools` 5.1.12, `@portabletext/schema` 2.2.3, `jsdom` 29.1.1, `prettier` 3.9.6, React 19.2.8, `styled-components` 6.4.4, plus dev tooling (tsx 4.23, turbo 2.10, vitest 4). TypeScript stays pinned to 5.9 via a workspace override — TypeScript 7 (the native port) doesn't expose the compiler API that tsup's declaration bundler needs; remove the override once the toolchain supports it. No CLI or output behavior changes.

## 1.10.0

### Minor Changes

- [#58](https://github.com/demo-repositories/aem-to-sanity/pull/58) [`1cb19da`](https://github.com/demo-repositories/aem-to-sanity/commit/1cb19da5f0e19717b5a5b21955e1d5f8492d7e85) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - New `aem-to-sanity-studio` package: migration-critical Studio surface (the `category` taxonomy type, `aemFormComponents` AEM-widget input routing, the `aemSource` Media Library aspect) now ships as an importable package instead of files copied into each tenant Studio — toolkit updates deliver Studio changes to existing tenants automatically. The Studio template and `apps/studio` import from it; existing tenant studios adopt it via the new `pnpm -w studio:sync <slug> --fix` (copies template file additions and missing deps, never overwrites operator customizations).
