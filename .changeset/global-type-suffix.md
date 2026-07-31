---
"aem-to-sanity-schema": minor
"aem-to-sanity-core": minor
---

New `MIGRATION_TYPE_SUFFIX` env var: append a global suffix to every generated Sanity type name (`proxyContentHero` → `proxyContentHeroBlock` with `MIGRATION_TYPE_SUFFIX=Block`) so the emitted schema matches an existing customer schema's naming vocabulary. A companion `MIGRATION_TYPE_SUFFIX_MODE` controls what the suffix decorates.

- Works with either `MIGRATION_TYPE_NAMING` strategy (`path` or `title`); the suffix lands last on every derived name, including `aem`-prefixed and collision-disambiguated ones.
- Reserved-name checks run against the suffixed name, so a component named `image` emits as `imageBlock` — no `aem` prefix needed.
- Explicit names from `aem-component-names.json` are exempt and emit exactly as written.
- Letters/digits/underscore only; appended verbatim (casing is yours).
- `MIGRATION_TYPE_SUFFIX_MODE=type` (default): the suffix is part of the type name itself. **Set once before the first import** — changing it later renames every emitted type and orphans previously ingested `_type` values, same as `MIGRATION_TYPE_NAMING`.
- `MIGRATION_TYPE_SUFFIX_MODE=file`: the suffix decorates only each generated file's basename and its `export const` (`accordionType.ts` exporting `accordionType`, but `defineType({ name: "accordion" })`). Type names, the content registry, `pageBuilder.of[]`, and ingested `_type` values stay bare — safe to add, change, or drop between runs; the pruner cleans up files at old basenames.
- The standalone `aem-to-sanity-pagebuilder` CLI now reads each schema file's `defineType({ name })` (falling back to the basename) when rebuilding `pageBuilder.of[]`, so it registers correct type names under `file` mode.
- `aem-component-names.json` entries accept a new `file` field pinning the generated file's exact basename and `export const` identifier (`{ "name": "tableData", "file": "tableDataSchema" }` → `tableDataSchema.ts` exporting `tableDataSchema` with `name: "tableData"`). Wins over the `file`-mode suffix; must be identifier-like and unique; safe to change between runs (a file rename never renames the type).
