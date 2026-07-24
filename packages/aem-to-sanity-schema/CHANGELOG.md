# aem-to-sanity-schema

## 1.11.0

### Minor Changes

- [#67](https://github.com/demo-repositories/aem-to-sanity/pull/67) [`e559707`](https://github.com/demo-repositories/aem-to-sanity/commit/e559707d2e60d4c39e436525c14113dfc0037847) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - npm distribution. All toolkit packages are now published to npm on every release — client projects install them as regular dependencies and update with `npm install <pkg>@latest` instead of git merges. New `aem-to-sanity-cli` package carries the operator CLI (`aem-to-sanity doctor | studio-sync | run | wipe-media-library`, all workspace-mode aware: they work both in the monorepo and in standalone scaffolds) and embeds the project template that `create-aem-to-sanity` scaffolds from. The repo scripts `migrate-doctor`, `studio-sync`, `run-with-log`, and `wipe-media-library` moved into the package (root `pnpm -w migrate:doctor` / `studio:sync` are now thin wrappers over the `aem-to-sanity` bin).

- [#67](https://github.com/demo-repositories/aem-to-sanity/pull/67) [`2cadb47`](https://github.com/demo-repositories/aem-to-sanity/commit/2cadb47c4746cfb285eaf0bdbf3cb5517b12f979) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Dependency majors: `zod` 4.4.3 in core (config error output unchanged; `z.string().url()` → `z.url()`) and `dotenv` 17.4.2 in the schema/content CLIs — v17's startup log line is silenced via a `load-env` module with `quiet: true`, so CLI stdout stays script-consumable. TypeScript is pinned to 5.9 with a workspace `pnpm.overrides` entry: TypeScript 7 (the native port) doesn't expose the compiler API tsup's declaration bundler needs, and without the pin sanity's optional `typescript` peer resolves to 7.x inside tenant workspaces. Remove the override when the toolchain supports TS 7.

### Patch Changes

- Updated dependencies [[`e559707`](https://github.com/demo-repositories/aem-to-sanity/commit/e559707d2e60d4c39e436525c14113dfc0037847), [`2cadb47`](https://github.com/demo-repositories/aem-to-sanity/commit/2cadb47c4746cfb285eaf0bdbf3cb5517b12f979)]:
  - aem-to-sanity-core@1.11.0

## 1.10.1

### Patch Changes

- [#63](https://github.com/demo-repositories/aem-to-sanity/pull/63) [`f70ee6e`](https://github.com/demo-repositories/aem-to-sanity/commit/f70ee6e364ddd164df4f192e4eb041d5cc042451) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Dependency refresh across the toolkit: Sanity Studio to 6.6.0 (`@sanity/ui` 3.4.3, `@sanity/schema` 6.6.0, `@sanity/client` 7.24.0), `zod` 4.4.3, `dotenv` 17.4.2 (with its new startup log line silenced — CLI stdout stays clean), `@portabletext/block-tools` 5.1.12, `@portabletext/schema` 2.2.3, `jsdom` 29.1.1, `prettier` 3.9.6, React 19.2.8, `styled-components` 6.4.4, plus dev tooling (tsx 4.23, turbo 2.10, vitest 4). TypeScript stays pinned to 5.9 via a workspace override — TypeScript 7 (the native port) doesn't expose the compiler API that tsup's declaration bundler needs; remove the override once the toolchain supports it. No CLI or output behavior changes.

- Updated dependencies [[`f70ee6e`](https://github.com/demo-repositories/aem-to-sanity/commit/f70ee6e364ddd164df4f192e4eb041d5cc042451)]:
  - aem-to-sanity-core@1.10.1

## 1.10.0

### Minor Changes

- [#58](https://github.com/demo-repositories/aem-to-sanity/pull/58) [`1cb19da`](https://github.com/demo-repositories/aem-to-sanity/commit/1cb19da5f0e19717b5a5b21955e1d5f8492d7e85) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - New `aem-to-sanity-studio` package: migration-critical Studio surface (the `category` taxonomy type, `aemFormComponents` AEM-widget input routing, the `aemSource` Media Library aspect) now ships as an importable package instead of files copied into each tenant Studio — toolkit updates deliver Studio changes to existing tenants automatically. The Studio template and `apps/studio` import from it; existing tenant studios adopt it via the new `pnpm -w studio:sync <slug> --fix` (copies template file additions and missing deps, never overwrites operator customizations).

### Patch Changes

- Updated dependencies [[`1cb19da`](https://github.com/demo-repositories/aem-to-sanity/commit/1cb19da5f0e19717b5a5b21955e1d5f8492d7e85)]:
  - aem-to-sanity-core@1.10.0

## 1.9.0

### Minor Changes

- [#54](https://github.com/demo-repositories/aem-to-sanity/pull/54) [`8217136`](https://github.com/demo-repositories/aem-to-sanity/commit/8217136172272ae21d37d453329084bf126add69) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - New optional tenant config `aem-component-names.json` (path override: `AEM_COMPONENT_NAMES_FILE`): pin the emitted Sanity type name and/or Studio title per component, keyed by `sling:resourceType`. Value is the type name as a string, or `{ "name", "title" }`. Explicit names win over the `MIGRATION_TYPE_NAMING` strategy and are claimed first — another component whose derived name collides takes the usual collision fallback. Reserved built-in names and duplicate override names are hard errors; entries matching no listed component path are logged and ignored. Same set-once-before-first-import hazard as the naming strategy: changing an override after content is ingested renames the type and orphans existing `_type` values.

### Patch Changes

- [#54](https://github.com/demo-repositories/aem-to-sanity/pull/54) [`fe48e06`](https://github.com/demo-repositories/aem-to-sanity/commit/fe48e06624f6d7cd633e11c31680ece6254cd14a) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Multifields whose inner field(s) map to nothing authorable (e.g. AEM core components' hidden bookkeeping multifield — the list editor's `./pages` wrapping a single `form/hidden` input) no longer emit an array of a zero-field object, which Sanity's schema validation rejects (`Object should have at least one field`). The field is skipped and surfaced in `migration-report.json → results[].unmapped` with reason `hidden`. Re-run `migrate:schema` if a previously generated schema fails `sanity schema validate` with that error.

- Updated dependencies [[`8217136`](https://github.com/demo-repositories/aem-to-sanity/commit/8217136172272ae21d37d453329084bf126add69)]:
  - aem-to-sanity-core@1.9.0

## 1.8.1

### Patch Changes

- [#50](https://github.com/demo-repositories/aem-to-sanity/pull/50) [`7d7b81b`](https://github.com/demo-repositories/aem-to-sanity/commit/7d7b81bf31791e4e87120d49bcc3a41c02dc1db2) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Boolean fields backed by AEM checkboxes with custom persisted constants no longer land as strings. AEM checkboxes persist their `value` attribute when checked and `uncheckedValue` when not — usually `"true"` / `"false"`, but dialogs are free to pick any constant (a link-target checkbox stores `"_blank"` / `"_self"`), which the Studio then rejected with `Expected type "Boolean", got "String"`.

  `migrate:schema` now records such constants in `content-type-registry.json` as `checkedValue` / `uncheckedValue` on the field (additive; old registries still load), and `aem-transform` coerces exact matches to `true` / `false` alongside the standard `"true"` / `"false"` literals. Works at any nesting depth, including multifield items.

  To pick up the fix on an existing migration: re-run `migrate:schema` (regenerates the registry with the constants), then `transform` + `import`.

- [#53](https://github.com/demo-repositories/aem-to-sanity/pull/53) [`e649102`](https://github.com/demo-repositories/aem-to-sanity/commit/e6491022e6535978aecb618947c9da683cbb0fb2) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Date and datetime fields no longer fail Studio validation with `Invalid date. Must be on the format "YYYY-MM-DD"`. AEM datepickers persist whatever their `valueFormat` dialog attribute says — the standard ISO-8601-with-offset JCR date when unset, but a display-style string when set (`valueFormat="MMM DD, yyyy"` persists `"May 23, 2024"`), which Sanity's strict `date` / `datetime` types rejected.

  `migrate:schema` now records the datepicker's `valueFormat` in `content-type-registry.json` (additive; old registries still load), and `aem-transform` parses authored values with it, re-emitting `YYYY-MM-DD` for `date` fields and UTC ISO for `datetime`. ISO inputs coerce even without a recorded format, and a `MMM DD, YYYY` month-name fallback covers the most common display format on registries that predate the capture. Dates parsed from ISO-with-time inputs keep the literal date part (no timezone conversion), and unparseable values keep the original so they surface in Studio validation instead of being silently remapped.

  To pick up the fix on an existing migration: re-run `migrate:schema`, then `transform` + `import`.

- Updated dependencies []:
  - aem-to-sanity-core@1.8.1

## 1.8.0

### Patch Changes

- Updated dependencies []:
  - aem-to-sanity-core@1.8.0

## 1.7.0

### Minor Changes

- [#44](https://github.com/demo-repositories/aem-to-sanity/pull/44) [`e279947`](https://github.com/demo-repositories/aem-to-sanity/commit/e2799479e9c44c79cc7aae7048f0805f4d3a090c) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Title-based type naming via `MIGRATION_TYPE_NAMING=title`.

  By default, component Sanity type names (and schema file names, registry `sanityType`s, and ingested `_type`s) derive from the JCR path after `components/` — `proxy/content/cardcontainer` → `proxyContentCardcontainer`. Setting `MIGRATION_TYPE_NAMING=title` derives them from each component's `jcr:title` instead: `"Card Container"` → `cardContainer`, with the redundant trailing " component" stripped the same way Studio labels are.

  Behavior in title mode:
  - `migrate:schema` runs an extra pre-pass fetching component nodes so titles are known before names resolve; the main pass reuses the fetched nodes (no double fetch).
  - Missing/blank `jcr:title` falls back to the path-derived name.
  - Title collisions keep the first component (in `aem-component-paths` order) clean; later ones get their path-derived name as a suffix (`teaser`, `teaserProxyContentTeaser`). Reserved Sanity built-ins still get the `aem` prefix.
  - Every fallback is logged at info level.

  Operator notes:
  - Default is unchanged (`path`) — existing tenants need no changes.
  - **Pick the strategy once, before the first import.** Switching later — or renaming a component's `jcr:title` in AEM — renames the emitted types and orphans previously ingested `_type` values; recovering requires `--recreate-on-type-change` or a fresh dataset.
  - Custom `_type` values must be mirrored in the consuming frontend's block dispatcher.

### Patch Changes

- Updated dependencies []:
  - aem-to-sanity-core@1.7.0

## 1.6.0

### Minor Changes

- [#41](https://github.com/demo-repositories/aem-to-sanity/pull/41) [`40dfac7`](https://github.com/demo-repositories/aem-to-sanity/commit/40dfac77d7380531c665aef5710474a03b66298d) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Configurable page-builder name via `MIGRATION_PAGE_BUILDER_NAME` ([#40](https://github.com/demo-repositories/aem-to-sanity/issues/40)).

  The generated page-builder array type and the field page blocks land under — previously hardcoded to `pageBuilder` — can now be renamed (e.g. `sections`). One env var names everything that must agree: the emitted `{name}.ts` file and its `defineType({ name })`, the field on `page.ts` and per-template documents, the type container drop-zones reference, and the key `aem-transform` writes page blocks under on ingested documents. The standalone `aem-to-sanity-pagebuilder` CLI also defaults to it (`--pagebuilder-type` still overrides).

  Operator notes:
  - Default is unchanged (`pageBuilder`) — existing tenants need no changes.
  - Set the value once in the tenant `.env` before the first run and leave it alone. `migrate:schema` and `aem-transform` both read the same env var; changing it between stages desyncs the schema from the ingested content.
  - The name must be a valid identifier (letters/digits/underscores, starting with a letter). `page` and `index` are rejected (file collisions in the schemas dir), as are names shadowing a built-in Sanity type or a generated component type.
  - Frontends query the page-builder field by name — mirror a custom value in the consuming app's GROQ queries.

### Patch Changes

- Updated dependencies [[`40dfac7`](https://github.com/demo-repositories/aem-to-sanity/commit/40dfac77d7380531c665aef5710474a03b66298d)]:
  - aem-to-sanity-core@1.6.0

## 1.5.0

### Minor Changes

- [#37](https://github.com/demo-repositories/aem-to-sanity/pull/37) [`d23d24b`](https://github.com/demo-repositories/aem-to-sanity/commit/d23d24b1eb0f2479581786bc362c1f9bbc77b114) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Core AEM's stock `cq-dialog-dropdown-showhide` pattern now emits conditional Studio fields, same as the ACS Commons show/hide support: a select whose `granite:data` carries `cq-dialog-dropdown-showhide-target` (a `.class` selector) conditions every field under nodes marked with that class and `granite:data.showhidetargetvalue` — they emit `hidden: ({ parent }) => …` callbacks so the Studio dialog folds like the AEM one. Both vocabularies resolve through the same machinery (same scoping, default-value fallbacks, and AND-ing of nested targets). Re-run `pnpm migrate:schema` to pick it up; persisted content is unaffected.

### Patch Changes

- Updated dependencies []:
  - aem-to-sanity-core@1.5.0

## 1.4.0

### Minor Changes

- [#34](https://github.com/demo-repositories/aem-to-sanity/pull/34) [`e6beb8a`](https://github.com/demo-repositories/aem-to-sanity/commit/e6beb8aa7d2d05e7c84c73545f15c77310dbd934) Thanks [@shehjad-noqtaai](https://github.com/shehjad-noqtaai)! - Coral wells (`granite/ui/components/coral/foundation/well`) now emit as non-collapsible Sanity fieldsets instead of flattening invisibly. The fieldset title comes from the well's `jcr:title` when present, otherwise from the `text` of the first `heading` widget (`granite/ui/components/coral/foundation/heading`) rendered inside the well — wrapper containers between the well and the heading are searched through, matching the common AEM authoring pattern (a trailing colon is stripped, e.g. "Overlay Options:" → "Overlay Options"). Wells with neither keep the old behavior: fields hoist up ungrouped. Re-run `pnpm migrate:schema` to pick up the new grouping; persisted content is unaffected (fieldsets are a Studio display concern).

### Patch Changes

- Updated dependencies []:
  - aem-to-sanity-core@1.4.0

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
