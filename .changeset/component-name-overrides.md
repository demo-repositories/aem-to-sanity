---
"aem-to-sanity-schema": minor
"aem-to-sanity-core": minor
---

New optional tenant config `aem-component-names.json` (path override: `AEM_COMPONENT_NAMES_FILE`): pin the emitted Sanity type name and/or Studio title per component, keyed by `sling:resourceType`. Value is the type name as a string, or `{ "name", "title" }`. Explicit names win over the `MIGRATION_TYPE_NAMING` strategy and are claimed first — another component whose derived name collides takes the usual collision fallback. Reserved built-in names and duplicate override names are hard errors; entries matching no listed component path are logged and ignored. Same set-once-before-first-import hazard as the naming strategy: changing an override after content is ingested renames the type and orphans existing `_type` values.
