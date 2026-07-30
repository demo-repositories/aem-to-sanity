---
"aem-to-sanity-core": minor
"aem-to-sanity-schema": minor
---

Configurable folder layout for the generated schemas directory.

- New env var `MIGRATION_SCHEMA_LAYOUT` — `flat` (default, current behavior) or `kind`, which groups generated files into `documents/` (the `page` doc, per-template docs, `contentFragment`) and `objects/` (component schemas, the page-builder array, table types, `contentFragmentRef`) subfolders.
- Entries in `aem-component-names.json` accept a new optional `folder` key that pins a component's generated file to a custom subfolder (e.g. `{"folder": "navigationObjects"}`). Overrides apply in both layouts. An entry may carry `folder` alone.
- The `index.ts` barrel always stays at the root of the schemas dir with an identical `allSchemaTypes` export — Studio imports need no changes.
- Unlike the naming knobs, layout and `folder` are safe to change between runs: files move but type names and ingested `_type` values don't, and the pruner removes copies left at old locations (and now-empty subfolders) on the next `migrate:schema` run.
- The `aem-to-sanity-pagebuilder` CLI gained a `--layout <flat|kind>` flag (defaults to `MIGRATION_SCHEMA_LAYOUT`).
- Typegen now scans the schemas dir recursively and no longer feeds the barrel `index.ts` itself into the synthesized config.

No action needed to keep the current flat layout.
