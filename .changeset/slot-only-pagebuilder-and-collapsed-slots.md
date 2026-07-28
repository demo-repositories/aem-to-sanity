---
"aem-to-sanity-schema": minor
---

Slot-fill components stop cluttering the page-level "+ Add" menu, and single-slot fields render as a click-to-open row.

Two Studio-facing refinements to auto-discovered named slots (e.g. `promocard`'s `buttonPrimary` / `buttonSecondary` children):

- **Slot-only types leave `pageBuilder.of[]`.** A component type whose every observed appearance in extracted content is as a slot fill is now excluded from the page-builder array — its schema type is still emitted and the parents' slot fields still reference it, so nothing about the migrated data changes; it just no longer appears as an insertable page-level block. A type authored even once directly in a page body (under the page root / responsive grid) or inside a container drop zone stays in the menu, so no existing block is ever orphaned. `migrate:schema` logs each exclusion. Like slot discovery, this is driven by the extract cache: a first run without one excludes nothing, and authoring the component at page level in AEM brings it back on the next run.
- **Lone hand-named slot fields render collapsed** (`options: { collapsible: true, collapsed: true }`): the Studio shows one row the author clicks to open — the closest native equivalent of AEM's edit-child-in-its-own-dialog flow — instead of the child's full field set expanded inline among the parent's own fields.

**What you must do:** nothing — re-run `migrate:schema` and both changes apply to the regenerated schemas. If a slot-only component disappears from the "+ Add" menu that you still want insertable at page level, author one instance at page level in AEM (any page in your content roots) and re-run.
