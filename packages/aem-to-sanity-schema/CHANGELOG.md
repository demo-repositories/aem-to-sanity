# aem-to-sanity-schema

## 1.3.0

### Minor Changes

- [#29](https://github.com/demo-repositories/aem-to-sanity/pull/29) [`59766b5`](https://github.com/demo-repositories/aem-to-sanity/commit/59766b52e3c2dc84dbc24f9ef40be9fc3aa3c0da) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Support ACS Commons [show/hide widgets](https://adobe-consulting-services.github.io/acs-aem-commons/features/ui-widgets/show-hide-widgets/index.html) — dialog fields toggled by a select or checkbox now emit as Sanity conditional fields:
  - A select / radio group / button group or checkbox / switch whose `granite:data` carries `acs-cq-dialog-dropdown-checkbox-showhide-target` (a `.class` selector) is detected as a **controller**; any dialog node whose `granite:class` includes that class and whose `granite:data` names `acs-dropdownshowhidetargetvalue` (space-separated select values) or `acs-checkboxshowhidetargetvalue` (`"true"` → visible when checked, `""` → visible when unchecked) is a **target**.
  - Every field mapped from or under a target emits `hidden: ({ parent }) => …` reading the controller off its sibling scope, so the Studio dialog folds the same way the AEM one did. Target containers (wells, tab items) condition all fields inside them; nested targets AND together; a target carrying both attributes combines dropdown + checkbox conditions.
  - An unset controller counts as its AEM default — matching what an author sees opening a fresh AEM dialog: dropdown conditions fall back to the controller's default (`selected`) option, checkbox conditions to the widget's `checked` attribute (absent or Granite EL `${...}` defaults count as unchecked).
  - Resolution is scoped per object: a controller and its targets must be siblings in the emitted Sanity object (same rule inside multifield rows, mirroring ACS's row-local semantics). Unmatched targets stay unconditionally visible.

  Visibility is a Studio display concern only — authored values migrate and import regardless of whether their field is currently shown. Re-run `migrate:schema` to pick up the conditional callbacks (previously these fields were always visible).

### Patch Changes

- [#29](https://github.com/demo-repositories/aem-to-sanity/pull/29) [`3e9d897`](https://github.com/demo-repositories/aem-to-sanity/commit/3e9d8974cfa87b32f2bffda938a36a677f94d276) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Fix boolean `initialValue` emission: checkbox / switch defaults now come from the AEM `checked` attribute (the widget's actual default state) instead of `value` (the constant persisted when checked — `"true"` on virtually every widget). Previously nearly every generated boolean field carried `initialValue: true`, so documents created fresh in the Studio got toggles flipped on that AEM would have defaulted off. Literal `checked` values map directly (`true`/`"true"` → `true`, `false`/`"false"` → `false`); when `checked` is absent or a Granite EL expression (`${...}`, resolved server-side against design config and unresolvable offline), no `initialValue` is emitted — the Studio's unset boolean behaves as unchecked, matching AEM.

  Migrated documents are unaffected (`initialValue` only applies at Studio document creation). Re-run `migrate:schema` to regenerate.

- Updated dependencies []:
  - aem-to-sanity-core@1.3.0

## 1.2.0

### Minor Changes

- [#26](https://github.com/demo-repositories/aem-to-sanity/pull/26) [`c6bd779`](https://github.com/demo-repositories/aem-to-sanity/commit/c6bd779f5422d1c7e47235fed9d2030d7c022937) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Support AEM's Coral text widget (`granite/ui/components/coral/foundation/text`) — the static author-facing copy dialogs use for instructions and inline warnings. It now emits a display-only note: a read-only `string` field carrying the message in its `description`, marked `options.aemWidget: "note"`. The example Studio renders marked fields as a caution-toned banner replacing the whole field (label and input included) via a new `form.components.field` resolver; Studios without the resolver fall back to an empty read-only input with the message as its description. Nothing is persisted for these fields. Previously Coral text surfaced as an unmapped placeholder field with a TODO description. Re-run `pnpm migrate:schema` to regenerate schemas.

### Patch Changes

- Updated dependencies []:
  - aem-to-sanity-core@1.2.0

## 1.1.0

### Minor Changes

- [#24](https://github.com/demo-repositories/aem-to-sanity/pull/24) [`4073b7d`](https://github.com/demo-repositories/aem-to-sanity/commit/4073b7d427e58c550f95dd3a78c14f056998d1f7) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Support AEM's Coral accordion container (`granite/ui/components/coral/foundation/accordion`) in dialogs. Accordion panels flatten into the parent field list, and each panel's `jcr:title` becomes a **collapsible Sanity fieldset** (collapsed unless the panel carries a truthy `active` attribute). Fields inside the panel keep the surrounding tab's group, so an accordion nested inside a dialog tab renders as a fold-out section within that tab — matching AEM — instead of being promoted to a top-level Studio tab. Previously accordions surfaced as an unmapped placeholder field and their nested fields were dropped. Re-run `pnpm migrate:schema` to regenerate schemas with the fieldsets.

- [#22](https://github.com/demo-repositories/aem-to-sanity/pull/22) [`b4361e4`](https://github.com/demo-repositories/aem-to-sanity/commit/b4361e42f0400b9c2beb840f5107eb04ea0b3871) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Support AEM's Coral buttongroup widget (`granite/ui/components/coral/foundation/form/buttongroup`):
  - **Single selection mode** → Sanity `string` with `options.list` built from the dialog's literal `items`; an item flagged `selected` becomes the field's `initialValue`. Fields carry an `options.aemWidget: "buttonGroup"` marker that the example Studio routes to a new toggle-button-group input (`apps/studio/components/inputs/StringToggleGroupInput.tsx`, adapted from sanity-io/sanetti-3), so authors keep the one-click row of buttons they had in AEM. Studios without the resolver fall back to the default dropdown.
  - **Multiple selection mode** → Sanity `array` of `string` with the same `options.list` (built-in checkbox rendering). `aem-transform` coerces the bare-string shape JCR produces when exactly one value is picked into a one-item array.
  - **Datasource-driven items** (ACS Commons generic lists etc.) are opaque over `.infinity.json`; those fields fall back to a plain field without options — authored values still migrate.

  No action needed for existing migrations; re-run `migrate:schema` + `transform` to pick up the new mapping (previously these dialogs emitted TODO placeholder strings).

### Patch Changes

- [`c94a85f`](https://github.com/demo-repositories/aem-to-sanity/commit/c94a85fc425915183eeb178edac0f4c03150e637) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Fix widget-rooted granite includes: a dialog fragment referenced via `granite/ui/components/coral/foundation/include` whose fetched root node is itself a form widget (e.g. a shared buttongroup dialog like uxp textstyle's `textAlignment`) now maps as that single field. Previously the mapper only walked the fragment's children, so the widget's option items leaked out as placeholder string fields (`inherit`, `left`, `center`, `right`) and the real field was never emitted. Structural fragments whose fields are child nodes are unaffected. Re-run `migrate:schema` (then transform + import) to pick up the corrected fields.

- Updated dependencies []:
  - aem-to-sanity-core@1.1.0

## 1.0.0

### Major Changes

- [`1614ea4`](https://github.com/demo-repositories/aem-to-sanity/commit/1614ea4204bbcbfa742a60f0eb34ea509218b926) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Initial stable release (1.0.0) of the AEM → Sanity migration toolkit:
  - `aem-to-sanity-core`: shared AEM fetcher, config resolver, logger, and `.infinity.json` depth-truncation walker.
  - `aem-to-sanity-schema`: AEM Granite UI dialog → Sanity object schema + TypeGen pipeline.
  - `aem-to-sanity-content`: AEM JCR content → Sanity document migration with streaming drift audit.

### Patch Changes

- Updated dependencies [[`1614ea4`](https://github.com/demo-repositories/aem-to-sanity/commit/1614ea4204bbcbfa742a60f0eb34ea509218b926)]:
  - aem-to-sanity-core@1.0.0
