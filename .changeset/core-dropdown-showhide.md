---
"aem-to-sanity-schema": minor
---

Core AEM's stock `cq-dialog-dropdown-showhide` pattern now emits conditional Studio fields, same as the ACS Commons show/hide support: a select whose `granite:data` carries `cq-dialog-dropdown-showhide-target` (a `.class` selector) conditions every field under nodes marked with that class and `granite:data.showhidetargetvalue` — they emit `hidden: ({ parent }) => …` callbacks so the Studio dialog folds like the AEM one. Both vocabularies resolve through the same machinery (same scoping, default-value fallbacks, and AND-ing of nested targets). Re-run `pnpm migrate:schema` to pick it up; persisted content is unaffected.
