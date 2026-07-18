---
"aem-to-sanity-schema": minor
---

Support ACS Commons [show/hide widgets](https://adobe-consulting-services.github.io/acs-aem-commons/features/ui-widgets/show-hide-widgets/index.html) — dialog fields toggled by a select or checkbox now emit as Sanity conditional fields:

- A select / radio group / button group or checkbox / switch whose `granite:data` carries `acs-cq-dialog-dropdown-checkbox-showhide-target` (a `.class` selector) is detected as a **controller**; any dialog node whose `granite:class` includes that class and whose `granite:data` names `acs-dropdownshowhidetargetvalue` (space-separated select values) or `acs-checkboxshowhidetargetvalue` (`"true"` → visible when checked, `""` → visible when unchecked) is a **target**.
- Every field mapped from or under a target emits `hidden: ({ parent }) => …` reading the controller off its sibling scope, so the Studio dialog folds the same way the AEM one did. Target containers (wells, tab items) condition all fields inside them; nested targets AND together; a target carrying both attributes combines dropdown + checkbox conditions.
- Dropdown conditions fall back to the controller's default (`selected`) option when the document has no value yet; an unset checkbox counts as unchecked — matching what an author sees opening a fresh AEM dialog.
- Resolution is scoped per object: a controller and its targets must be siblings in the emitted Sanity object (same rule inside multifield rows, mirroring ACS's row-local semantics). Unmatched targets stay unconditionally visible.

Visibility is a Studio display concern only — authored values migrate and import regardless of whether their field is currently shown. Re-run `migrate:schema` to pick up the conditional callbacks (previously these fields were always visible).
