---
"aem-to-sanity-schema": patch
"aem-to-sanity-content": patch
---

Two fixes surfaced by AEM quick-links-style components:

- **Granite UI v1 sections are now walked.** `granite/ui/components/foundation/section` (the pre-Coral container, still common in older dialogs' tab layouts) is mapped as a container: a titled section directly under `tabs` becomes a Studio group and its child widgets become real fields; untitled layout sections flatten. Previously the section itself was emitted as a single placeholder string field and every field inside it was silently dropped from the schema. Re-run `migrate:schema` to pick up newly surfaced fields.
- **Case-only field-name mismatches are canonicalized at transform.** The schema emitter camelCases dialog names (`./linkURL` → `linkUrl`) while the JCR persists the raw key; `aem-transform` now renames authored keys that case-insensitively match a declared field onto the declared name (at every depth, including multifield items) so values land in the typed field instead of surfacing as "Unknown field" next to an empty declared one. Case-only mismatches no longer appear in the drift report. Re-run `transform` + `import` to repair affected documents.
