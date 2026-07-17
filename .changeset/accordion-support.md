---
"aem-to-sanity-schema": minor
---

Support AEM's Coral accordion container (`granite/ui/components/coral/foundation/accordion`) in dialogs. Accordion panels flatten into the parent field list, and each panel's `jcr:title` becomes a **collapsible Sanity fieldset** (collapsed unless the panel carries a truthy `active` attribute). Fields inside the panel keep the surrounding tab's group, so an accordion nested inside a dialog tab renders as a fold-out section within that tab — matching AEM — instead of being promoted to a top-level Studio tab. Previously accordions surfaced as an unmapped placeholder field and their nested fields were dropped. Re-run `pnpm migrate:schema` to regenerate schemas with the fieldsets.
