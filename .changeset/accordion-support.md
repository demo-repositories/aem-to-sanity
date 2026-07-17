---
"aem-to-sanity-schema": minor
---

Support AEM's Coral accordion container (`granite/ui/components/coral/foundation/accordion`) in dialogs. Accordion panels are flattened like tabs: fields inside each panel hoist into the parent field list, and a panel's `jcr:title` becomes a Sanity fieldset group so the Studio keeps the same visual grouping AEM showed. Previously accordions surfaced as an unmapped placeholder field and their nested fields were dropped.
