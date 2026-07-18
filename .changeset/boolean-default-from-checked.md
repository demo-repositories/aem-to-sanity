---
"aem-to-sanity-schema": patch
---

Fix boolean `initialValue` emission: checkbox / switch defaults now come from the AEM `checked` attribute (the widget's actual default state) instead of `value` (the constant persisted when checked — `"true"` on virtually every widget). Previously nearly every generated boolean field carried `initialValue: true`, so documents created fresh in the Studio got toggles flipped on that AEM would have defaulted off. Literal `checked` values map directly (`true`/`"true"` → `true`, `false`/`"false"` → `false`); when `checked` is absent or a Granite EL expression (`${...}`, resolved server-side against design config and unresolvable offline), no `initialValue` is emitted — the Studio's unset boolean behaves as unchecked, matching AEM.

Migrated documents are unaffected (`initialValue` only applies at Studio document creation). Re-run `migrate:schema` to regenerate.
