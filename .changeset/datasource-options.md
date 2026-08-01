---
"aem-to-sanity-core": minor
"aem-to-sanity-schema": minor
"aem-to-sanity-content": minor
"aem-to-sanity-studio": minor
"aem-to-sanity-cli": minor
---

Datasource-driven selects, radiogroups, and buttongroups now resolve their options where possible instead of always falling back to a plain field:

- **ACS Commons generic lists** (`acs-commons/components/utilities/genericlist/datasource`) — options are fetched from the list page named by the datasource's `path` (`{path}/jcr:content/list` children's `jcr:title` + `value`), using the same transport/auth as dialog fetches, memoized per component run. Missing or empty lists fall back as before.
- **Core policy datasources** — `allowedheadingelements/v1` and the title component's `allowedtypes` (v1/v2) emit the servlet's no-policy default list (`h1`–`h6`). The template content policy may allow fewer values than offered (policy resolution is per-instance; the migration is per-type) — authored values round-trip either way.
- **All other datasources** (project-custom servlets, Scene7 image presets, language lists) still fall back to a plain field, and each fallback is now visible in `migration-report.json → results[].unmapped` with the new reason `datasource-unresolved` and a detail naming the datasource. Restore those dropdowns with `aem-dialog-overrides.json`'s `dialogFile` and literal `items`.

Operators: no action needed. Re-running `migrate:schema` upgrades affected fields from plain text inputs to dropdowns / toggle groups; authored content is unaffected.
