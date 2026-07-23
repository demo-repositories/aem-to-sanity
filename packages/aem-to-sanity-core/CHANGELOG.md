# aem-to-sanity-core

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
