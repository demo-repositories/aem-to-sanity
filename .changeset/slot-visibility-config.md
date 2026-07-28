---
"aem-to-sanity-core": minor
"aem-to-sanity-schema": minor
"aem-to-sanity-cli": minor
---

New optional tenant config `aem-component-slots.json`: per-slot visibility rules for auto-discovered named slots.

Components that embed direct child components under fixed JCR keys (e.g. `promocard` carrying `buttonPrimary` / `buttonSecondary` / `image` children) were already auto-discovered and emitted as typed slot fields. This release lets you mirror the AEM enable-toggles that gate those children — `enablePrimaryButton`, `enableSecondaryButton`, `enableForegroundImage`, … — so the Studio hides a slot field exactly when AEM would hide the child:

```json
{
  "uxp/components/proxy/content/promocard": {
    "buttonPrimary":   { "visibleWhen": "enablePrimaryButton" },
    "buttonSecondary": { "visibleWhen": "enableSecondaryButton" },
    "image":           { "visibleWhen": "enableForegroundImage" }
  }
}
```

- Keys: parent `sling:resourceType` (leading `/apps/` accepted) → emitted slot field name.
- `"visibleWhen": "<field>"` — visible while the sibling **boolean** field is `true`.
- `"visibleWhen": { "field": "...", "equals": "v" | ["v1", "v2"] }` — visible while the sibling **string** field matches.
- Emitted as a Sanity `hidden: ({ parent }) => …` callback via the same machinery as the dialog show/hide idioms, including controller defaults.
- Display-only: authored slot content migrates and persists regardless of the toggle. Rules with a missing/wrongly-typed controller, or naming a slot that never synthesized, warn and are skipped — nothing is ever hidden by accident.
- Override the file path with `AEM_COMPONENT_SLOTS_FILE` (default `./aem-component-slots.json`); a missing file means no visibility behavior, as before.

Also fixed: on dialogs with field groups (tabs), synthesized slot fields and the container drop-zone `childrenField` now join the first (default) group. Previously they carried no group, so the Studio — which auto-selects the first group tab — only showed them under "All fields", where authors couldn't find them. Re-run `migrate:schema` to pick up the regenerated schemas.

**What you must do:** nothing, unless you want the behavior — then add `aem-component-slots.json` next to your other `aem-component-*` config and re-run `migrate:schema`. New tenants get an empty file scaffolded by `migrate:init`; on existing tenants `aem-to-sanity doctor` now points out when it's absent.
