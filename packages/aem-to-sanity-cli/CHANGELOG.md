# aem-to-sanity-cli

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

### Patch Changes

- [#78](https://github.com/demo-repositories/aem-to-sanity/pull/78) [`6528a75`](https://github.com/demo-repositories/aem-to-sanity/commit/6528a75ae3dd9d8409a67dbc08b31688cccb204d) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - `aem-to-sanity doctor` no longer errors on a missing or placeholder `SANITY_MEDIA_LIBRARY_ID` when `MIGRATION_ASSETS_DOWNLOAD_ONLY=true`. Download-only asset runs stop after the AEM download phase and never read the Media Library id, so the doctor now reports an info line explaining the exemption instead of a hard error. No action needed: tenants that upload to the Media Library are checked exactly as before.

## 2.1.0

### Minor Changes

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

## 2.0.0

## 1.11.1

### Patch Changes

- [#71](https://github.com/demo-repositories/aem-to-sanity/pull/71) [`913e4b3`](https://github.com/demo-repositories/aem-to-sanity/commit/913e4b381d029b09eb32f12abf40c0217167ed13) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Standalone scaffolds get their `.gitignore` back. npm strips `.gitignore` files from published tarballs, so the template's ignore file never reached scaffolded projects — the scaffolder's initial commit captured `node_modules/` and the seeded `.env`, and any later commit would have put real AEM/Sanity credentials into git history. The template now ships the file as `dot-gitignore` (which npm keeps) and the scaffolder renames it on copy; as a safety net the scaffolder also writes a default `.gitignore` before `git init` if none exists. **If you scaffolded with `create-aem-to-sanity` 0.3.0:** check `git ls-files` for `.env` — if present, add the `.gitignore` (`node_modules/`, `dist/`, `output/`, `.env`, `.turbo/`, `.DS_Store`), run `git rm -r --cached .` then `git add -A`, and rewrite/avoid pushing any history that contains credentials.

## 1.11.0

### Minor Changes

- [#67](https://github.com/demo-repositories/aem-to-sanity/pull/67) [`e559707`](https://github.com/demo-repositories/aem-to-sanity/commit/e559707d2e60d4c39e436525c14113dfc0037847) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - npm distribution. All toolkit packages are now published to npm on every release — client projects install them as regular dependencies and update with `npm install <pkg>@latest` instead of git merges. New `aem-to-sanity-cli` package carries the operator CLI (`aem-to-sanity doctor | studio-sync | run | wipe-media-library`, all workspace-mode aware: they work both in the monorepo and in standalone scaffolds) and embeds the project template that `create-aem-to-sanity` scaffolds from. The repo scripts `migrate-doctor`, `studio-sync`, `run-with-log`, and `wipe-media-library` moved into the package (root `pnpm -w migrate:doctor` / `studio:sync` are now thin wrappers over the `aem-to-sanity` bin).

### Patch Changes

- [#69](https://github.com/demo-repositories/aem-to-sanity/pull/69) [`e9f078f`](https://github.com/demo-repositories/aem-to-sanity/commit/e9f078f183c8b1f76e8e34c7226b559b7a42e51e) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Standalone-scaffold fixes found by the post-release client smoke test. The embedded project template no longer ships Studio build output (`studio/dist/`, `studio/.sanity/` are skipped at embed and scaffold-copy time). The seeded `.env` now has `SCHEMAS_OUT_DIR=./studio/schemas/generated` active, so `migrate:schema` feeds the scaffold's own Studio out of the box instead of emitting to `output/schemas/` that the Studio never loads. The template Studio declares `@types/node`, so `tsc --noEmit` passes in a standalone scaffold (it previously resolved only via monorepo hoisting).
