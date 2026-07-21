---
"aem-to-sanity-core": minor
"aem-to-sanity-schema": minor
"aem-to-sanity-content": minor
---

Configurable page-builder name via `MIGRATION_PAGE_BUILDER_NAME` (#40).

The generated page-builder array type and the field page blocks land under — previously hardcoded to `pageBuilder` — can now be renamed (e.g. `sections`). One env var names everything that must agree: the emitted `{name}.ts` file and its `defineType({ name })`, the field on `page.ts` and per-template documents, the type container drop-zones reference, and the key `aem-transform` writes page blocks under on ingested documents. The standalone `aem-to-sanity-pagebuilder` CLI also defaults to it (`--pagebuilder-type` still overrides).

Operator notes:

- Default is unchanged (`pageBuilder`) — existing tenants need no changes.
- Set the value once in the tenant `.env` before the first run and leave it alone. `migrate:schema` and `aem-transform` both read the same env var; changing it between stages desyncs the schema from the ingested content.
- The name must be a valid identifier (letters/digits/underscores, starting with a letter). `page` and `index` are rejected (file collisions in the schemas dir), as are names shadowing a built-in Sanity type or a generated component type.
- Frontends query the page-builder field by name — mirror a custom value in the consuming app's GROQ queries.
