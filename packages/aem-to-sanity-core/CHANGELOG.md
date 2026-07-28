# aem-to-sanity-core

## 2.1.2

## 2.1.1

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

## 1.9.0

### Minor Changes

- [#54](https://github.com/demo-repositories/aem-to-sanity/pull/54) [`8217136`](https://github.com/demo-repositories/aem-to-sanity/commit/8217136172272ae21d37d453329084bf126add69) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - New optional tenant config `aem-component-names.json` (path override: `AEM_COMPONENT_NAMES_FILE`): pin the emitted Sanity type name and/or Studio title per component, keyed by `sling:resourceType`. Value is the type name as a string, or `{ "name", "title" }`. Explicit names win over the `MIGRATION_TYPE_NAMING` strategy and are claimed first — another component whose derived name collides takes the usual collision fallback. Reserved built-in names and duplicate override names are hard errors; entries matching no listed component path are logged and ignored. Same set-once-before-first-import hazard as the naming strategy: changing an override after content is ingested renames the type and orphans existing `_type` values.

## 1.8.1

## 1.8.0

## 1.7.0

## 1.6.0

### Minor Changes

- [#41](https://github.com/demo-repositories/aem-to-sanity/pull/41) [`40dfac7`](https://github.com/demo-repositories/aem-to-sanity/commit/40dfac77d7380531c665aef5710474a03b66298d) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Configurable page-builder name via `MIGRATION_PAGE_BUILDER_NAME` ([#40](https://github.com/demo-repositories/aem-to-sanity/issues/40)).

  The generated page-builder array type and the field page blocks land under — previously hardcoded to `pageBuilder` — can now be renamed (e.g. `sections`). One env var names everything that must agree: the emitted `{name}.ts` file and its `defineType({ name })`, the field on `page.ts` and per-template documents, the type container drop-zones reference, and the key `aem-transform` writes page blocks under on ingested documents. The standalone `aem-to-sanity-pagebuilder` CLI also defaults to it (`--pagebuilder-type` still overrides).

  Operator notes:
  - Default is unchanged (`pageBuilder`) — existing tenants need no changes.
  - Set the value once in the tenant `.env` before the first run and leave it alone. `migrate:schema` and `aem-transform` both read the same env var; changing it between stages desyncs the schema from the ingested content.
  - The name must be a valid identifier (letters/digits/underscores, starting with a letter). `page` and `index` are rejected (file collisions in the schemas dir), as are names shadowing a built-in Sanity type or a generated component type.
  - Frontends query the page-builder field by name — mirror a custom value in the consuming app's GROQ queries.

## 1.5.0

## 1.4.0

## 1.3.0

## 1.2.0

## 1.1.0

## 1.0.0

### Major Changes

- [`1614ea4`](https://github.com/demo-repositories/aem-to-sanity/commit/1614ea4204bbcbfa742a60f0eb34ea509218b926) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Initial stable release (1.0.0) of the AEM → Sanity migration toolkit:
  - `aem-to-sanity-core`: shared AEM fetcher, config resolver, logger, and `.infinity.json` depth-truncation walker.
  - `aem-to-sanity-schema`: AEM Granite UI dialog → Sanity object schema + TypeGen pipeline.
  - `aem-to-sanity-content`: AEM JCR content → Sanity document migration with streaming drift audit.
