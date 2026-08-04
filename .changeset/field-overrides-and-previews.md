---
"aem-to-sanity-core": minor
"aem-to-sanity-schema": minor
"aem-to-sanity-content": minor
"aem-to-sanity-studio": minor
"aem-to-sanity-cli": minor
---

Two new per-component Studio polish knobs:

**`fieldOverrides` in `aem-dialog-overrides.json`** — per-field tweaks the AEM dialog can't express, keyed by emitted (camelCase) field name. `readOnly: true` locks the input; `initialValue` seeds Studio-created content with a JSON literal, or the sentinel `"uuid"` which emits `initialValue: () => crypto.randomUUID()` — the pattern for auto-generated ids like a permissions tab's `componentId`. A `"*"` key applies its `fieldOverrides` to every listed component (per-component entries win per field), so shared-tab fields need declaring once:

```json
{
  "*": {
    "fieldOverrides": {
      "componentId": { "readOnly": true, "initialValue": "uuid" }
    }
  }
}
```

**`preview` in `aem-component-names.json`** — overrides the generated type's Studio preview. `title` / `subtitle` / `media` are select paths (dot notation allowed, e.g. `"items.0.title"`); `count` names a top-level array field whose item count is appended to the row title (`"Accordion (3 items)"`); Studio previews can't select whole arrays, so the count probes the first 10 indexes' `_key`s (arrays of objects only) and shows `"10+"` beyond that. Unset slots keep the emitter's defaults (static component title, subtitle/media heuristics):

```json
{
  "uxp/components/proxy/content/accordion": {
    "preview": { "subtitle": "items.0.title", "count": "items" }
  }
}
```

Operators: no action needed — both knobs are optional and safe to change between runs (they never touch type names or ingested content; `initialValue` only affects content created in the Studio). Re-run `migrate:schema` to apply.
