---
"aem-to-sanity-schema": major
"aem-to-sanity-content": major
"aem-to-sanity-studio": major
---

Rich-text HTML tables now migrate to Sanity's native Portable Text tables (Studio ≥ 6.6).

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
