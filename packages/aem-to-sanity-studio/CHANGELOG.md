# aem-to-sanity-studio

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
