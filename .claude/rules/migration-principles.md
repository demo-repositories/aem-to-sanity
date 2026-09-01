# Migration toolkit — core principles (always loaded)

Detailed, path-scoped rules live beside this file and load automatically when you touch the matching code:

- `tenant-config-files.md` — the operator config surface (`tenants/**`, config loaders)
- `containers-and-fragments.md` — flatten/document container modes, depth budget
- `dialog-resolution-and-overrides.md` — supertype walk, `aem-dialog-overrides.json`, `aem-eject-dialogs`
- `type-naming-and-emission.md` — naming strategies, suffixes, icons, previews
- `transform-and-import.md` — coercion, doc ids, drop-lists, import invariants
- `schema-pipeline-internals.md` — mapping table, slots, audit, report, generated-file lifecycle

Principles that apply everywhere:

1. **Config over code, and config fails loudly.** Tenant behavior differences belong in the tenant JSON/list files, not in per-tenant code branches. Loaders throw on malformed entries with actionable messages; keys that match nothing are warned and dropped, never silently honored.
2. **The generated schema is the base; deviations are declared.** Generated files (GENERATED-marker banner) are never hand-edited — they get overwritten/pruned. A Sanity field that doesn't exist in AEM must be introduced via `aem-dialog-overrides.json` (`fieldOverrides`, `supplementaryTabs`, or an ejected `dialogFile`) so it survives regeneration and is visible in config review. If someone can't explain why a field exists that isn't in AEM, it's either a migration bug to fix at the mapper layer or a field to add via override — not a hand edit.
3. **Set-once knobs reshape identity.** `MIGRATION_DOC_ID_PREFIX_STRIP`, `MIGRATION_TYPE_NAMING`, `MIGRATION_TYPE_SUFFIX` (in default `type` mode), `name` overrides in `aem-component-names.json`, and `MIGRATION_ASSET_BACKEND` (feeds emitted asset field types and ingested field values) all feed ingested `_id`/`_type`/value shapes. Changing any after the first real import orphans documents or field values. Treat semantic changes to them as breaking.
4. **One resolution path.** Dialog resolution goes through `resolveEffectiveDialog` for the migrator, the audit, the probe, and eject-dialogs alike. Never fork it — the probe must show exactly what the migrator sees.
5. **Keep-original-on-failure.** Transform coercion leaves unparseable values in place so they surface as Studio validation errors; never trade that for silent data loss.
6. **Stage order matters and dry-run is the default.** extract → tags → migrate:schema → transform → assets → import (template/slot discovery read the extract cache, so schema runs after extract). Import writes nothing until `MIGRATION_DRY_RUN=false`.
7. **Verify by running, not just typechecking.** `pnpm -r build` first (Node runs from `dist/`), then run the affected stage(s) against a local tenant folder; use `pnpm assets -- --link-only` on re-runs.
8. **Docs and changesets travel with the change.** Follow the doc-trigger table in CLAUDE.md; regenerate `docs/aem-to-sanity-mapping.md` from `docs.ts`/`mapping-table.ts` rather than editing it; every user-facing change gets a changeset.
