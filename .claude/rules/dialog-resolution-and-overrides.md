---
paths:
  - "packages/aem-to-sanity-core/src/aem/dialog-resolution.ts"
  - "packages/aem-to-sanity-core/src/aem/dialog-overrides.ts"
  - "packages/aem-to-sanity-core/src/config/dialog-overrides.ts"
  - "packages/aem-to-sanity-schema/src/eject-dialogs*.ts"
  - "packages/aem-to-sanity-schema/src/api.ts"
  - "**/aem-dialog-overrides.json"
  - "**/dialog-overrides/**"
---

# Dialog resolution and overrides

How `migrate:schema` finds each component's `cq:dialog`, and the operator mechanism for correcting/extending what AEM returns. Single shared entry point: `resolveEffectiveDialog` (`packages/aem-to-sanity-core/src/aem/dialog-overrides.ts`) — used by `processOne`, `audit.ts`, `eject-dialogs.ts`, and `scripts/aem-probe.ts`. **Never add a second resolution path**; what the probe shows must be exactly what the migrator sees.

Base-dialog precedence: `dialogFile` override → embedded `cq:dialog` on the component → `resolveDialogViaSuperType` walk. Then `supplementaryTabs` splice on top. Then `fieldOverrides` apply after field mapping.

## The supertype walk is first-hit, whole-dialog — by design

`resolveDialogViaSuperType` (`dialog-resolution.ts`) tries `{path}/_cq_dialog`, on 404 follows `sling:resourceSuperType` (relative paths resolve `/apps/<rt>` then `/libs/<rt>`), cycle guard, 10-hop cap. It stops at the **first** dialog found and returns it wholesale. It does **not** reimplement Sling Resource Merger semantics (node-level tab merge, `sling:hideResource`, `sling:orderBefore`) — real AEM merges dialogs across the whole chain at node level, like method overriding in a class hierarchy. Reimplementing that was judged too complex and fragile; the deliberate middle ground is `supplementaryTabs` config ("there's one more tab at this path, pull it in after tab X"). Don't "fix" the walk to merge — extend the override config instead.

Consequence to remember: a component whose first-hit dialog lacks a tab that a *deeper* ancestor contributes (e.g. accordion's fourth "properties" tab from `/libs/core/wcm/components/accordion/v1/accordion`) needs a `supplementaryTabs` entry.

## `aem-dialog-overrides.json` — three combinable capabilities per resource type

```json
{
  "*": { "fieldOverrides": { "componentId": { "readOnly": true, "initialValue": "uuid" } } },
  "uxp/components/proxy/content/accordion": {
    "supplementaryTabs": [{ "path": "/libs/core/.../cq:dialog/content/items/tabs/items/properties", "insertAfter": "theme" }]
  },
  "uxp/components/proxy/content/wrapper": { "dialogFile": "./dialog-overrides/uxp/components/proxy/content/wrapper.json" }
}
```

- **`supplementaryTabs`**: `path` (absolute JCR path, fetched as `.infinity.json`), `insertAfter`/`insertBefore` (sibling tab node names, mutually exclusive), `key` (defaults to last path segment). Splicing `structuredClone`s (never mutates), applies tabs in config order (later tabs can anchor on earlier ones), finds the tabs container by `granite/ui/components/coral/foundation/tabs` resourceType with a warned name-`tabs` fallback. Duplicate tab key → hard error ("merging into an existing tab isn't supported; use dialogFile"). Missing anchor → warn + append. **Key insertion order in `items` is load-bearing** — the mapper walks `Object.entries` order, which becomes Studio group order.
- **`dialogFile`**: local JSON with a complete `cq:dialog`; replaces resolution entirely (no supertype walk, no `supertypeChain` in the report). Loaded eagerly at config-load so a broken path fails at startup; resolved against the config dir first, then cwd. With `supplementaryTabs` too, the file is the base and tabs splice on top.
- **`fieldOverrides`**: keyed by **emitted camelCase field name**, `{ readOnly?, initialValue? }`. Sentinel `initialValue: "uuid"` emits `initialValue: () => crypto.randomUUID()`. Wildcard key `"*"` may carry *only* `fieldOverrides` (per-component wins per field). Applied in `processOne` after `mapDialog`, before container/slot synthesis; names matching no mapped field are silently skipped.

Error taxonomy: config/splice problems raise `DialogOverrideError` → report `kind: "mappingError"`; transport problems stay `AemFetchError` → `network`/`auth`. Keep that distinction — the circuit breaker and `--continue-on-auth` key off it.

## `aem-eject-dialogs` — materialize effective dialogs for hand-editing

`pnpm eject-dialogs [paths… | --all] [--force] [--out-dir]` writes each component's **effective** dialog (same resolution as the migrator) to `dialog-overrides/<resourceType>.json`, then rewrites `aem-dialog-overrides.json` to point the entry at that `dialogFile`. Invariants:

- Existing files are **skipped without `--force`** — ejected files are hand-edited operator artifacts; never clobber them.
- Datasource-driven selects get their options baked as literal `items` nodes (`materializeDatasourceItems`); unresolvable datasources keep the `datasource` node + warn so the mapper still reports `datasource-unresolved`.
- The config rewrite works on the raw JSON (unrelated entries untouched) and replaces the ejected entry **wholesale**, deliberately dropping its `supplementaryTabs` — they're now baked into the file and would double-splice (duplicate-key hard error) if kept.
- After ejecting, AEM isn't needed for that component's schema — this is the intended workflow for "team wants to add fields that don't exist in AEM": eject, hand-add the Granite field node, re-run `migrate:schema`. **A field in the Sanity schema that isn't in AEM must come from an override file — never hand-edit generated schema files** (they're pruned/regenerated).

The cached snapshot under `output/cache/aem/apps/**` records the merged/effective dialog for audit — it is *not* the hand-editable surface; the ejected file is.

## Doc triggers

Changes here must update: the "Dialog inheritance" / "Dialog overrides" sections in `packages/aem-to-sanity-schema/src/docs.ts` (+ regenerate `docs/aem-to-sanity-mapping.md`), `docs/running-the-migration.md` § 1c (dialog overrides), and the report shape notes if `supertypeChain`/`supplementaryTabs`/`dialogOverride` result fields change.
