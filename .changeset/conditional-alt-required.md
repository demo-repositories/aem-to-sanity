---
"aem-to-sanity-schema": patch
---

The AEM core-image alt pattern no longer produces false "Required" validation errors in the Studio. AEM marks the `./alt` textfield required but only enforces it while the field is editable — the `isDecorative` / `altValueFromDAM` / `altValueFromPageImage` toggles hide it and store no alt on the page node (the runtime inherits it from the DAM asset or page instead). Emitted schemas now render a conditional rule that passes when any of those toggles is on (tolerating legacy uncoerced `"true"` strings on already-imported documents) and requires a non-empty value only when the author was expected to type one. Re-run `migrate:schema` to regenerate affected component schemas (e.g. image, promocard, wrapper).
