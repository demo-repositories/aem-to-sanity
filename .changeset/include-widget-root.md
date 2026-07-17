---
"aem-to-sanity-schema": patch
---

Fix widget-rooted granite includes: a dialog fragment referenced via `granite/ui/components/coral/foundation/include` whose fetched root node is itself a form widget (e.g. a shared buttongroup dialog like uxp textstyle's `textAlignment`) now maps as that single field. Previously the mapper only walked the fragment's children, so the widget's option items leaked out as placeholder string fields (`inherit`, `left`, `center`, `right`) and the real field was never emitted. Structural fragments whose fields are child nodes are unaffected. Re-run `migrate:schema` (then transform + import) to pick up the corrected fields.
