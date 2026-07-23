# aem-to-sanity-content

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
