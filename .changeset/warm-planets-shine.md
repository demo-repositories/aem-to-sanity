---
"aem-to-sanity-core": minor
"aem-to-sanity-schema": minor
---

Restrict components to specific page templates in the page builder via a new optional `components` map on `aem-page-components.json` entries.

Keyed by `cq:template` path, each map entry lists the component `sling:resourceType`s allowed only on that template's pages. Listed components leave the shared `pageBuilder.of[]` (the base set every page type offers), and each keyed template's document type gets a dedicated generated array type (`{docType}Builder`, base members + that template's extras, alphabetized) that its page-builder field references. The page-builder field *name* is unchanged, so `aem-transform` output and previously imported content are untouched: this only reshapes Studio "+ Add" menus and is safe to adopt, change, or remove between runs.

Like `names`, a `components` key must match a declared template unless `discover: true` is set (load-time error otherwise); undiscovered templates and resource types matching no emitted component are warned and skipped, keeping the component in the shared array. Note the shared array also backs container drop zones and the generic `page` doc, so a restricted component stops being offered there as well.

Nothing to do for existing tenants: entries without a `components` map keep today's single shared page-builder array. The `page-templates.json` manifest now records each document type's array under a new `pageBuilderType` field, and the standalone `aem-to-sanity-pagebuilder` CLI no longer folds per-template document types (or their builder arrays) back into `pageBuilder.of[]` when rescanning a schemas directory.
