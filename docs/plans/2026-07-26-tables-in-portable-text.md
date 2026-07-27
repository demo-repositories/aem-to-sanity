# Tables in Portable Text: map AEM rich-text `<table>` HTML to Sanity 6.6 native tables

> **Status: implemented** (2026-07-26). One deviation discovered during verification:
> `sanitizeSchemaTypes` originally renamed *any* type in `RESERVED_SANITY_TYPE_NAMES`,
> which clobbered the toolkit's own `table`/`row`/`cell` types at Studio load. The set
> was split — `SANITY_BUILTIN_TYPE_NAMES` (what sanitize renames) vs
> `PORTABLE_TEXT_TABLE_TYPE_NAMES` (reserved against AEM component names only), with
> `RESERVED_SANITY_TYPE_NAMES` as their union. Everything else landed as planned.
> See also the "AEM Table *component* handling" addendum at the end.

## Addendum: AEM Table *component* handling (2026-07-26)

Some AEM sites carry a dedicated Table **component** (e.g. `/apps/uxp/components/proxy/content/table`, `jcr:title: "Table"`) in addition to tables typed into ordinary richtext. Its dialog is a richtext field (`./text`) with the RTE table plugin, plus a `hideCaption` checkbox — the authored table is stored as `<table>` HTML in `text`. No special mapping is needed: `text` maps to `array-of-blocks` and the transform converts the HTML into a native PT `table` block. Verified end-to-end on the demo tenant, whose `proxyContentTable` component blocks each carry a converted table block.

Two consequences handled:

1. **`<caption>` support** — the component's `hideCaption` checkbox implies authored captions, and the original table rule walked only `HTMLTableElement.rows`, silently dropping `<caption>` text. Fixed: caption content converts to regular text block(s) emitted immediately before the table block (the canonical table shape has no caption field). Covered by a test in `richtext-table.test.ts`.

2. **Naming collision on title-strategy tenants** — with `MIGRATION_TYPE_NAMING=title`, a component titled "Table" derives the now-reserved name `table`. The default fallback is `aemTable`, but a tenant can pin a friendlier name via `aem-component-names.json`. t-mobile opted for `tableData`:

   ```json
   "uxp/components/proxy/content/table": { "name": "tableData", "title": "Table" }
   ```

   (`aemImage` / `aemText` keep the prefix for now — set-once knobs; renaming them would orphan ingested `_type` values.) The rename lands on the tenant's next `migrate:schema` run against live AEM; any previously ingested docs of the old `_type` need `transform` + `import --discard-drafts` after.

## Context

AEM rich text fields can contain HTML tables. Today the pipeline converts richtext HTML to Portable Text via `htmlToBlocks` with no table handling, so `<table>` markup gets flattened into loose paragraphs — structure is lost. Sanity Studio **v6.6.0** (released 2026-07-22; already this repo's studio dependency) added built-in table editing for Portable Text via an opt-in plugin (`plugins: {table: {enabled: true}}` on `components.portableText`) that binds to a canonical shape:

```
{ _type: 'table', _key, headerRows: number,
  rows: [{ _type: 'row', _key,
    cells: [{ _type: 'cell', _key, value: [ ...block[] ] }] }] }
```

Verified: block-tools 5.1.12 (current dep) has **no** native table→table-block deserializer (only a `createFlattenTableRule` that flattens), so the transform needs a custom `DeserializerRule`.

**Decision (user-confirmed)**: use canonical names `table`/`row`/`cell` and reserve them, renaming colliding AEM components to `aemTable` etc. (same mechanism as the existing `image` reservation). Breaking for tenants that already ingested a component-derived `_type: "table"` (the demo tenant has one) → **major changeset**.

## Phase 1 — Reserve canonical names (schema package)

`packages/aem-to-sanity-schema/src/naming.ts`: add `"table"`, `"row"`, `"cell"` to `RESERVED_SANITY_TYPE_NAMES` (lines 7–25). Downstream follows automatically:
- `resolveSanityTypeNames` renames a colliding AEM component to `aemTable` — file name, registry `sanityType`, `pageBuilder.of[]`, and ingested `_type` stay in lockstep.
- `sanitize.ts` parity is automatic (imports the set).
- `aem-component-names.json` overrides pinning these names now hard-error; `MIGRATION_PAGE_BUILDER_NAME=table` now rejected (both desired — call out in changeset).

Must land before Phase 2 so the emitted canonical `table.ts` can never collide with a component file on disk.

## Phase 2 — Emit table types + widen `array-of-blocks` (schema package)

- **New `packages/aem-to-sanity-schema/src/pt-table.ts`** (mirror `pagebuilder.ts`): export `PT_TABLE_TYPE_NAMES = ["cell", "row", "table"]` and `writePortableTextTableArtifacts({schemasDir})` writing `table.ts`, `row.ts`, `cell.ts` into the generated schemas dir, each with the pruner-recognized `// GENERATED …` banner and a `const` named exactly like the filename (barrel convention):
  - `cell`: object, `value: array of [{type: 'block'}]` (no nested table member — nested tables unsupported)
  - `row`: object, `cells: array of [{type: 'cell'}]`
  - `table`: object, `headerRows: number` **and** `rows: array of [{type: 'row'}]`. `headerRows` is mandatory — without it the Studio's header-row toggle silently no-ops.
- **`api.ts`**: call `writePortableTextTableArtifacts` unconditionally near the `writePageBuilderArtifacts` call (~line 433), before `pruneGeneratedSchemaFiles` (line 477). Add the three names to the pruner's keep-set (lines 893–897) and to `writeSchemasBarrel`'s extras (non-pageBuilder path, lines 928–956); `rewriteBarrelFromDisk` picks the files up via filename scan automatically.
  - Rationale for emitting into generated schemas (vs exporting from `aem-to-sanity-studio` + editing `schemas/index.ts`): existing operator studios never get `index.ts` rewritten by `studio:sync`, but every operator reruns `pnpm migrate:schema`, so the generated barrel reaches all tenants with zero manual steps.
- **`pagebuilder.ts` / `pagebuilder-cli.ts`**: keep table types out of the page-builder palette — add `PT_TABLE_TYPE_NAMES` to the `excludeSet` in `writePageBuilderArtifacts` (line 60) and the CLI's filename-scan excludes (~line 98).
- **`emitter.ts`** `case "array-of-blocks"` (lines 365–369): `props.of = '[{ type: "block" }, { type: "table" }]'`. Unconditional — verified nothing downstream reads `of` members (registry records only `{name, type: "array-of-blocks"}`). Nested richtext inside `array-of-object` gets the member via the same `renderField` recursion.
- No changes to `mapper.ts` or `content-registry.ts` — registry shape unchanged, legacy-registry back-compat untouched.

## Phase 3 — Transform: `<table>` deserializer rule (content package)

All in `packages/aem-to-sanity-content/src/transform.ts`:

- **`PORTABLE_TEXT_SCHEMA`** (lines 717–739): add `blockObjects: [{name: "table", fields: [{name: "headerRows", type: "number"}, {name: "rows", type: "array"}]}]` (verified legal in `@portabletext/schema@2.2.3`). Without it, normalization strips the unknown block.
- **New `createTableRule(keyGenerator)`** — `DeserializerRule` factory next to `htmlStringToPortableText`:
  - Bail (`return undefined`) unless `tagName === 'table'`.
  - Walk `HTMLTableElement.rows` / `row.cells` (JSDOM implements both; excludes nested tables' rows, rows in section order).
  - `headerRows`: `el.tHead?.rows.length`, else count of *leading* rows whose cells are all `<th>`, else `0`.
  - **Cell content: recursive `htmlToBlocks(cell.innerHTML, PORTABLE_TEXT_SCHEMA, {parseHtml, keyGenerator})`** — not `next(cell.childNodes)` (next() yields bare spans entangled with outer traversal state; a fresh call guarantees normalized block arrays with marks/links/lists preserved). Do **not** pass the table rule into the recursive call.
  - Keys: stamp `_key` on every row/cell from the **same** `deterministicKeyGen(seed)` instance passed as `options.keyGenerator` and into recursive cell calls — one counter stream ⇒ byte-identical re-runs (clean-git-diff invariant). Return `createBlock({_type: 'table', headerRows, rows})`; verify normalization assigns the top-level `_key` from the key generator — stamp explicitly if not.
  - colspan/rowspan: convert anyway, span attributes dropped, content kept; pad short rows with empty cells to the max column count so the plugin's rectangular grid holds. Documented limitation.
  - Nested tables: inner tables degrade to block-tools default flattening inside the parent cell (no data loss). Documented limitation.
  - **Keep-original-on-failure**: try/catch around the rule body; on throw or degenerate table (zero rows / all rows empty) `return undefined` so default flattening preserves the text; hard parser failure still hits `htmlStringToPortableText`'s existing catch → original HTML string kept.
- **`htmlStringToPortableText`** (lines 765–777): create the key generator once, pass `rules: [createTableRule(keyGen)]`. Export it (or the rule) for unit testing.
- Coercion walker: explicitly **no change** — table handling lives entirely inside `htmlToBlocks`; nested richtext in multifields converts through the existing `itemFields` recursion.

## Phase 4 — Studio plugin enablement (studio package)

`packages/aem-to-sanity-studio/src/components/StringToggleGroupInput.tsx` (or a new `portableTextPlugins.tsx`): add a module-scope component and a `portableText` key to `aemFormComponents` (lines 92–106):

```tsx
function AemPortableTextPlugins(props: PortableTextPluginsProps) {
  return props.renderDefault({
    ...props,
    plugins: { ...props.plugins, table: { enabled: true } },
  });
}
export const aemFormComponents = { input, field, portableText: { plugins: AemPortableTextPlugins } };
```

Verified against sanity 6.6.0 types (`FormComponents.portableText?.plugins`, `plugins.table?: {enabled?: boolean}`). If `PortableTextPluginsProps` isn't exported from `sanity` top level (it's `@beta`), type structurally. Since `apps/studio/sanity.config.ts` **and** `tenants/template/studio/sanity.config.ts` already pass `form: {components: aemFormComponents}`, this reaches apps/studio and existing operator studios via the toolkit package update — no template edit needed (per CLAUDE.md's migration-critical-code rule, so no doctor/template classification changes either).

Bump the studio package's `sanity` peer/dep floor to `^6.6.0` and note in the changeset.

## Phase 5 — Docs, changeset, tests

**Docs (binding per CLAUDE.md):**
- `packages/aem-to-sanity-schema/src/docs.ts` — extend "Richtext → Portable Text" (lines 106–115): table block shape, headerRows detection, colspan/rowspan + padding, nested-table and malformed-table fallbacks; note in type-name prose that `table`/`row`/`cell` are reserved (→ `aemTable`).
- Regenerate `docs/aem-to-sanity-mapping.md` **and** `tenants/demo/docs/aem-to-sanity-mapping.md` (demo tenant is tracked) via `pnpm migrate:schema` in `tenants/demo`.
- Mirror blurbs: `packages/aem-to-sanity-content/README.md` + `docs/running-the-migration.md` § 4b; update CLAUDE.md's `array-of-blocks` regeneration bullet.
- **Changeset: major** (fixed group). Notes: (a) rich-text tables → native Sanity table blocks, plugin auto-enabled; (b) **breaking**: `table`/`row`/`cell` reserved — components previously emitting `_type: 'table'` become `aemTable`, orphaning ingested docs; remediation = rerun `migrate:schema` + `transform` + `import --discard-drafts` (optionally unpublish old-`_type` docs first); (c) name overrides using those names now hard-error; (d) sanity ≥ 6.6 required.
- PR description: flag that `aem-to-sanity-demo-web` needs a `table` block renderer in `apps/web/src/blocks/`.

**Tests:**
- New `packages/aem-to-sanity-content/tests/richtext-table.test.ts` (node:test + tsx): thead → `headerRows: 1`; leading-`<th>` rows → correct count; plain → `0`; marks/links in cells survive; determinism (same seed ⇒ deep-equal, different seed ⇒ different keys); colspan/rowspan padding; nested table flattened; degenerate `<table></table>` → no table block, no throw, surrounding text kept; paragraph–table–paragraph ordering.
- Schema package: `pt-table.test.ts` (three files written with banner; barrel includes them; pruner keeps them; page-builder excludes them); emitter test for `of: [{type:'block'},{type:'table'}]` incl. nested `itemFields`; naming test: `/…/table` component → `aemTable`, `table` override throws.

## Verification

```bash
pnpm -r build && pnpm -r typecheck && pnpm -r test
cd tenants/demo && pnpm migrate:schema && pnpm transform && pnpm import
pnpm --filter studio exec sanity schema validate
pnpm --filter studio dev   # insert a table, toggle header row (headerRows persists), open an ingested doc with a converted table
```

## Open risks (verify during implementation)

- block-tools normalization of rule-returned blocks: confirm top-level `_key` comes from `options.keyGenerator`; stamp if not.
- Confirm `blockObjects` declaration carries nested `rows` through `normalizeBlock` untouched.
- Empty `cell.value: []` acceptance by the Studio table UI; fallback = one empty paragraph block per padded cell.
- Sanity's 20-level attribute-depth import cap: table→row→cell→block→span adds ~8 levels; deeply nested multifield richtext could hit it — document as known limitation.
- Operators with hand-authored `table`/`row`/`cell` types would collide with the generated barrel exports — one sentence in changeset.
