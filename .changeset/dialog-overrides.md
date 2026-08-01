---
"aem-to-sanity-core": minor
"aem-to-sanity-schema": minor
"aem-to-sanity-content": minor
"aem-to-sanity-studio": minor
"aem-to-sanity-cli": minor
---

New optional tenant config `aem-dialog-overrides.json` (path override: `AEM_DIALOG_OVERRIDES_FILE`): per-component dialog overrides for `migrate:schema`, the escape hatch for Sling-Resource-Merger dialog inheritance.

AEM merges dialogs across the whole `sling:resourceSuperType` chain at author time, so a proxy component with its own `cq:dialog` still inherits tabs from ancestor dialogs — tabs the migrator's first-hit resolution never sees (symptom: the AEM author dialog shows a tab the emitted Sanity type is missing). Keyed by `sling:resourceType`, each entry supports:

- `supplementaryTabs: [{path, insertAfter?, insertBefore?, key?}]` — fetches each tab node from the given absolute JCR path (`{path}.infinity.json`, same transport/auth as other dialog fetches) and splices it into the resolved dialog's tabs container. Position by sibling tab node name; omitted → append. Missing anchor warns and appends; a duplicate tab key, a dialog without a tabs container, or a 404 on the tab path fail the component as `mappingError` (previously such config problems could only surface as `network`).
- `dialogFile: "<path>"` — a local JSON file (resolved against the config file's directory, then cwd) holding the complete `cq:dialog` node; replaces dialog resolution entirely. Combinable: the file is the base, tabs splice on top.

Applied overrides are recorded in `migration-report.json` (`results[].dialogOverride`, `results[].supplementaryTabs`), and the `output/cache/aem/apps/…` snapshot now stores the **merged** dialog rather than the raw AEM response. `scripts/aem-probe.ts` and the audit step apply the same overrides via the new shared `resolveEffectiveDialog` helper in `aem-to-sanity-core`, so probe output stays exactly what the migrator maps.

Operators: nothing to do unless you need it — missing file is a no-op. To adopt, copy the empty stub from `tenants/template/aem-dialog-overrides.json` (new tenants get it from `migrate:init`; `migrate:doctor` classifies it as operator-owned).
