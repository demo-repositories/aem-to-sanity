# aem-to-sanity-cli

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
