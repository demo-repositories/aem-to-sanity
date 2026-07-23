---
"aem-to-sanity-schema": patch
---

Multifields whose inner field(s) map to nothing authorable (e.g. AEM core components' hidden bookkeeping multifield — the list editor's `./pages` wrapping a single `form/hidden` input) no longer emit an array of a zero-field object, which Sanity's schema validation rejects (`Object should have at least one field`). The field is skipped and surfaced in `migration-report.json → results[].unmapped` with reason `hidden`. Re-run `migrate:schema` if a previously generated schema fails `sanity schema validate` with that error.
