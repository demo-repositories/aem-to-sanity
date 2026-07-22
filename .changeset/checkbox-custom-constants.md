---
"aem-to-sanity-schema": patch
"aem-to-sanity-content": patch
---

Boolean fields backed by AEM checkboxes with custom persisted constants no longer land as strings. AEM checkboxes persist their `value` attribute when checked and `uncheckedValue` when not — usually `"true"` / `"false"`, but dialogs are free to pick any constant (a link-target checkbox stores `"_blank"` / `"_self"`), which the Studio then rejected with `Expected type "Boolean", got "String"`.

`migrate:schema` now records such constants in `content-type-registry.json` as `checkedValue` / `uncheckedValue` on the field (additive; old registries still load), and `aem-transform` coerces exact matches to `true` / `false` alongside the standard `"true"` / `"false"` literals. Works at any nesting depth, including multifield items.

To pick up the fix on an existing migration: re-run `migrate:schema` (regenerates the registry with the constants), then `transform` + `import`.
