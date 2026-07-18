---
"aem-to-sanity-schema": minor
---

Coral wells (`granite/ui/components/coral/foundation/well`) now emit as non-collapsible Sanity fieldsets instead of flattening invisibly. The fieldset title comes from the well's `jcr:title` when present, otherwise from the `text` of the first `heading` widget (`granite/ui/components/coral/foundation/heading`) rendered inside the well — wrapper containers between the well and the heading are searched through, matching the common AEM authoring pattern (a trailing colon is stripped, e.g. "Overlay Options:" → "Overlay Options"). Wells with neither keep the old behavior: fields hoist up ungrouped. Re-run `pnpm migrate:schema` to pick up the new grouping; persisted content is unaffected (fieldsets are a Studio display concern).
