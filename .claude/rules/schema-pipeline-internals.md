---
paths:
  - "packages/aem-to-sanity-schema/**"
---

# migrate:schema internals — mapping table, slots, audit, report

## `mapping-table.ts` is the single source of truth for widget → field mapping

`MAPPING: Record<slingResourceType, { kind, description }>`. `lookup()` tries exact match, then suffix match on the last two path segments (catches vendor copies of Granite widgets). The `description` strings flow **verbatim** into the generated `docs/aem-to-sanity-mapping.md` table — write them as operator-facing behavioral spec. After any mapping change, rerun `pnpm migrate:schema` (or call `writeMappingDocs` standalone) so the doc regenerates; commit doc + source together.

Unknown widget types land in the audit: `auditUnmappedTypes` (on by default) re-resolves dialogs with the same `resolveEffectiveDialog` as the migrator and snapshots one real example node per unmapped resource type to `output/cache/audit/unmapped-examples.json`. That file is the raw material for extending `MAPPING` — read it before guessing what a widget does. Audit failures are debug-logged, never fail the run; keep it that way.

## Slot discovery and synthesis

- **Discovery** (`slots.ts`) is a pure, config-free scan of the extract cache (`output/cache/aem/content/`): any direct child object with its own `sling:resourceType` under a non-namespaced key becomes `parent → slotKey → childType`. Structural wrappers (`responsivegrid`, integration page) route children to `pageBodyTypes` instead. Needs a prior `aem-extract` run — first-ever run discovers nothing.
- **Synthesis** (`api.ts`): slot keys are grouped by logical base (`normalizeSlotBase` peels paste-timestamps/copy markers); emitted as `slot-array` (multiple/auto-named keys) or `slot-reference` (lone hand-named slot, rendered collapsible). Skips when: dialog already owns the field name, parent is a registered container, >1 child type per base (warn), or child type isn't in `aem-component-paths` (warn).
- Slot-only types are excluded from `pageBuilder.of[]` (`collectSlotOnlyResourceTypes`) unless also seen at page-body or container drop zones.
- **Visibility** (`aem-component-slots.json`) resolves against sibling mapped fields: `equals` form needs a `string` controller, shorthand needs a `boolean` controller. Wrong/missing controller → **warn and leave the slot visible** — attaching a broken condition would hide it unconditionally. Display-only; content always migrates.

## Field pipeline order in `processOne`

fetch component node → `resolveEffectiveDialog` (dialogFile → embedded → supertype walk, then supplementary tabs) → `mapDialog` → **fieldOverrides** → container `childrenField` synthesis → slot synthesis (+ hint keys) → emit. Order matters: fieldOverrides only see mapped dialog fields; synthetic container/slot fields can't be overridden — keep it that way or document the change loudly.

## `migration-report.json` (output/cache/)

`summary` (`total`/`successes`/`failures`/`unmappedTypes` counts) + `results[]`. Success entries carry `fields[]` (the typed tree that becomes `content-type-registry.json` — transform coercion depends on it), `unmapped[]`, `renamed[]`, and optionally `supertypeChain`, `dialogOverride`, `supplementaryTabs`. Failure `kind`s: `network | auth | parseError | tooLarge | mappingError | writeError` — `DialogOverrideError` maps to `mappingError`, transport to `network`/`auth` (the auth circuit breaker and `--continue-on-auth` depend on this split).

## Generated-file lifecycle

Every emitted file starts with a GENERATED marker; the pruner removes generated files no longer in the expected set but **never touches files without the marker** (hand-authored types, e.g. a de-marked `page.ts`). `apps/studio/schemas/generated/` is gitignored; `scripts/ensure-studio-stub.ts` writes an empty barrel on install so bare clones typecheck. Hand-authored document types belong in `apps/studio/schemas/` (or the toolkit packages), never inside `generated/`.

## docs.ts

`writeMappingDocs` regenerates `docs/aem-to-sanity-mapping.md` on every `migrate:schema` run — it's the canonical field-level mapping doc ("Do not edit by hand" banner). Emitter/mapper/container/slot/coercion behavior changes must update the matching prose section in `docs.ts` and regenerate. Naming/suffix/icon/preview knobs are deliberately documented in the package README + root README instead — don't duplicate them into the generated doc.
