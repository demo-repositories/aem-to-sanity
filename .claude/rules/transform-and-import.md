---
paths:
  - "packages/aem-to-sanity-content/**"
---

# Transform coercion, ids, and import

## Coercion has one entry point

`coerceFieldTypes(inline, fieldTypes, jcrPath, ctx)` in `packages/aem-to-sanity-content/src/transform.ts` — in-place, recursive, driven by the field-type **tree** in `content-type-registry.json` (written by `migrate:schema`; legacy `fields: string[]` registries load but disable coercion). Called for page-builder blocks, page-shell properties, and recursively into `array-of-object` `itemFields`. There are no `coerceScalarFields`/`coerceRichTextFields` functions anymore — extend `coerceFieldTypes`'s switch.

Why it exists: AEM's `.infinity.json` serializes every authored value as a JSON string (`"10"`, `"true"`, HTML), while emitted schemas declare real types — without coercion the Studio rejects everything as "Expected type X, got String".

Per-type behavior: `array-of-blocks` → Portable Text (`portable-text.ts`, `_key`s SHA1-seeded for deterministic diffs); `number` → `Number(v)` only if finite; `boolean` → registry `checkedValue`/`uncheckedValue` constants first (e.g. `"_blank"`), then literal `"true"`/`"false"`; `date`/`datetime` → `coerceDateString` with the dialog's `valueFormat`; `array-of-string` → bare string wrapped; `array-of-reference` → tag ids resolved through the category manifest (follows `cq:movedTo` aliases, drops + audits unresolved); `array-of-object` → recurse, with `Object.values` materializing named-key multifields in authored order.

**The keep-original-on-failure contract is non-negotiable**: a failed parse leaves the AEM value in place so it surfaces as a Studio validation error — never silent data loss. When adding a coerced type: extend `coerceFieldTypes`, keep the contract, document it in `docs.ts` "Type-aware coercion" + regenerate the mapping doc, mirror in the content README and `docs/running-the-migration.md` § 4b. If the real problem is a wrong emitted type, fix `mapping-table.ts` — don't paper over schema bugs with transform coercion.

## Key drop/keep lists (transform.ts) — keep them explicit allowlists

- `JCR_METADATA` — node bookkeeping always dropped.
- `JCR_CONTENT_BOOKKEEPING_KEYS` — page-level-only drops.
- `AEM_DIALOG_RUNTIME_KEYS` — dialog-runtime sidecars to drop (today just `textIsRich`); add new leaks here as they appear.
- `AEM_AUTHORED_COLON_KEYS` — colon keys camelCased instead of dropped (today just `cq:tags` → `cqTags`).
- Everything else containing `:` is dropped by `isValidSanityAttributeKey`; per-tenant opt-ins go through `aem-component-hints.json` (see tenant-config rule).

Never replace any of these with a blanket heuristic — replication/bookkeeping keys would leak into documents.

## Document ids (`pathToDocId`)

`_id` = JCR path with `MIGRATION_DOC_ID_PREFIX_STRIP` prefixes removed (longest-first), `/` and invalid chars → `-`, collapsed; >80 chars → `{first-60}-{sha1-10}` (stays under Sanity's 128 limit). Hyphen separator is deliberate: a `.` in `_id` makes the doc **private** (token-only reads). Changing the strip prefixes between runs reshapes every id and orphans imported docs. `slug.current` is separate (`MIGRATION_SLUG_STRATEGY`: `segment` default | `path`), and `_id` is independent of `_type` — per-template doc types don't orphan ids.

## Import stage invariants (`import.ts`)

- **Dry-run is the default** — writes happen only when `MIGRATION_DRY_RUN=false` (literally).
- Categories import first (batches of 50) so page-side references resolve; then **one transaction per page** — a page's fragments live in the same clean file and the same transaction. A failed page is recorded and the run continues with `exitCode = 1`.
- `--discard-drafts` / `MIGRATION_DISCARD_DRAFTS=true` deletes `drafts.{id}` alongside each write. Off by default (destroys author edits). When an operator says "I re-ran the import and nothing changed in the Studio", suspect a shadowing draft first.
- `--recreate-on-type-change` handles `_type` flips: delete old doc + draft in a **separate, earlier transaction** (the content lake validates `_type` immutability against pre-transaction state — delete+create in one tx still fails), then create. Don't "optimize" this into one transaction.

## Verification

Rebuild first (`pnpm -r build` — Node runs from `dist/`), then actually run the stage(s) against a local tenant folder; typecheck doesn't exercise the tree walks. `pnpm assets -- --link-only` skips AEM downloads/ML uploads on re-runs. Full chain order matters: extract → tags → migrate:schema → transform → assets → import (schema after extract because template/slot discovery read the extract cache).
