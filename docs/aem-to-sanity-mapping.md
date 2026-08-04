# AEM → Sanity field mapping

> Auto-generated from `packages/aem-to-sanity-schema/src/mapping-table.ts` on every `pnpm migrate:schema` run. Do not edit by hand — update the mapping table and re-run.

Each AEM Granite UI `sling:resourceType` is mapped to a Sanity field kind. Unknown types become a string placeholder and are reported in `output/cache/migration-report.json` so you can extend the table.

| AEM resource type | Sanity kind | Description |
|---|---|---|
| `granite/ui/components/coral/foundation/form/textfield` | `string` | Single-line text → Sanity string |
| `granite/ui/components/coral/foundation/form/textarea` | `text` | Multi-line text → Sanity text (rows preserved) |
| `granite/ui/components/coral/foundation/form/richtext` | `richtext` | Rich text → Sanity array of PortableText blocks |
| `cq/gui/components/authoring/dialog/richtext` | `richtext` | Legacy rich text → Sanity array of PortableText blocks |
| `granite/ui/components/coral/foundation/form/numberfield` | `number` | Number → Sanity number (min/max → validation) |
| `granite/ui/components/coral/foundation/form/checkbox` | `boolean` | Checkbox → Sanity boolean. `initialValue` from the `checked` attribute (the default state), not `value` (the constant persisted when checked); omitted when `checked` is absent or a Granite EL expression (`${...}`, unresolvable offline). Custom persisted constants (`value` / `uncheckedValue` other than `"true"` / `"false"`, e.g. a link-target checkbox storing `_blank` / `_self`) are recorded in the content registry so `aem-transform` coerces them to `true` / `false`. |
| `granite/ui/components/coral/foundation/form/switch` | `boolean` | Switch → Sanity boolean (rendered as a toggle in Studio v3+). Same `checked`-based default handling as checkbox. |
| `granite/ui/components/coral/foundation/form/select` | `select` | Dropdown → Sanity string with options.list. Datasource-driven items resolve when the datasource is an ACS Commons generic list (options fetched from the list page's JCR) or a core policy datasource (allowedheadingelements / title allowedtypes → the no-policy h1–h6 default); other datasources fall back to a plain string (reported as `datasource-unresolved`). |
| `granite/ui/components/coral/foundation/form/radiogroup` | `radio` | Radio group → Sanity string with options.list and layout:'radio'. Same datasource resolution/fallback as select. |
| `granite/ui/components/coral/foundation/form/buttongroup` | `buttongroup` | Button group → single mode: Sanity string with options.list rendered as a toggle-button group in the Studio (options.aemWidget:'buttonGroup'); multiple mode: array of strings with options.list. Same datasource resolution/fallback as select (no literal `items` node → ACS generic lists and core policy datasources resolve; the rest fall back to a plain field without options). |
| `granite/ui/components/coral/foundation/form/datepicker` | `date` | Date picker → Sanity date or datetime based on `type`. The dialog's `valueFormat` (the pattern of the string AEM persists, e.g. `MMM DD, yyyy` → `"May 23, 2024"`) is recorded in the content registry so `aem-transform` can parse authored values back into Sanity's `YYYY-MM-DD` / UTC-ISO shapes. |
| `granite/ui/components/coral/foundation/form/pathfield` | `pathfield` | AEM pathfield → Sanity string (reference migration is future work) |
| `granite/ui/components/coral/foundation/form/pathbrowser` | `pathbrowser` | Coral pathbrowser → Sanity image when rootPath is under /content/dam or field name matches /image/i, else string (same as pathfield) |
| `granite/ui/components/foundation/form/pathbrowser` | `pathbrowser` | Legacy (non-Coral) pathbrowser alias → same routing as the Coral variant (image vs string based on rootPath + field name) |
| `cq/gui/components/authoring/dialog/fileupload` | `file` | Image/video upload: read-only `{fileReferenceParameter}AemPath` (DAM path) + `{fileReference}` image/file asset; required only on asset when AEM required |
| `cq/gui/components/coral/common/form/tagfield` | `tags` | AEM tag picker → Sanity array of references to `category` documents (parent-child taxonomy). Categories are populated by the `aem-tags` CLI from `/content/cq:tags`. |
| `granite/ui/components/coral/foundation/form/tagfield` | `tags` | Granite tagfield alias → same `array of reference-to-category` shape as the cq/gui tagfield. |
| `granite/ui/components/coral/foundation/form/multifield` | `multifield` | Composite multifield → array; persisted key from inner `field.name` (strip ./); JCR rows `item0`/`item1`; titles from `fieldLabel` |
| `granite/ui/components/coral/foundation/container` | `container` | Container → flattened; children hoist up |
| `cq/gui/components/authoring/dialog` | `container` | Dialog root → walked for top-level fields |
| `granite/ui/components/coral/foundation/tabs` | `container` | Tabs → flattened; tab titles become fieldset groups |
| `granite/ui/components/coral/foundation/well` | `container` | Well (static grouping box) → non-collapsible fieldset titled from `jcr:title` or the first `heading` widget inside the well (wrapper containers are searched through); untitled wells flatten and children hoist up |
| `granite/ui/components/coral/foundation/accordion` | `container` | Accordion → flattened; panel titles become collapsible fieldsets inside the surrounding tab group (collapsed unless the panel is `active`) |
| `granite/ui/components/coral/foundation/fixedcolumns` | `container` | Fixed columns → flattened; children hoist up |
| `granite/ui/components/coral/foundation/form/fieldset` | `container` | Fieldset → flattened with group label |
| `granite/ui/components/coral/foundation/form/hidden` | `hidden` | Hidden → skipped |
| `granite/ui/components/coral/foundation/text` | `note` | Static dialog text (author instructions / warnings) → read-only Studio note banner via `options.aemWidget: "note"`; nothing is persisted |
| `granite/ui/components/foundation/heading` | `hidden` | Decorative UI heading inside a dialog → skipped (not a field) |
| `granite/ui/components/foundation/section` | `container` | Granite UI v1 section → same handling as coral containers: a titled section directly under tabs becomes a group (tab); untitled layout sections flatten and children hoist up |
| `granite/ui/components/coral/foundation/heading` | `hidden` | Coral heading → not a field itself; the first heading inside a well supplies the well's fieldset title via its `text` |
| `aem-integration/components/dialog/space` | `hidden` | Authoring-only spacer in Granite dialogs → skipped (not content) |
| `granite/ui/components/coral/foundation/form/colorfield` | `string` | Color picker → Sanity string (hex value) |
| `granite/ui/components/foundation/include` | `include` | Reference to another dialog fragment → fetched and inlined. Structural fragments contribute their child fields; a fragment whose root node is itself a widget (e.g. a shared buttongroup dialog like uxp's textstyle `textAlignment`) maps as that single field. |

## Fallback behaviour

- **Unknown resource type** → emitted as a `string` field with a TODO description and recorded under `unmapped` in the run report.
- **Missing `name`** → field is skipped and recorded.
- **Hidden field** → skipped (not emitted, not a failure).

## Dialog inheritance via `sling:resourceSuperType`

`migrate:schema` resolves each component's dialog the same way AEM does at request time — by walking the `sling:resourceSuperType` chain when the component itself has no `cq:dialog`. This makes proxy components (the AEMaaCS norm where `/apps/<site>/components/proxy/foo` extends `<site>/components/foo/v1/foo` or a `/libs` ancestor) migrate without operators having to hand-flatten the inheritance.

Resolution rules:

1. Try the component's own `cq:dialog` (either embedded in the component node or at `{path}/_cq_dialog.infinity.json`).
2. On 404, read `sling:resourceSuperType` off the component. Absent → record a `failure` for the component (genuinely dialogless).
3. Resolve the supertype:
   - **Absolute** (`/apps/...`, `/libs/...`) — used as-is.
   - **Relative** (`<namespace>/components/...`) — AEM's lookup order is `/apps/<rt>` first, then `/libs/<rt>`.
4. Recurse with the resolved path. Cycle guard + 10-hop cap prevent runaway walks.

The resolved chain is recorded on each successful component's `supertypeChain` in `output/cache/migration-report.json` (omitted for direct hits). The registry key (the AEM resource type used at content-ingest time) remains the **original proxy path's resource type** — authored content with `sling:resourceType: <proxy>` keeps matching its emitted Sanity type even though the dialog fields came from an ancestor. Two proxies sharing one supertype produce two distinct Sanity types with identical fields.

A standalone probe (`scripts/aem-probe.ts`) uses the same resolver, useful for inspecting a single component's resolution before kicking off a full schema run.

### Dialog overrides (`aem-dialog-overrides.json`)

The walk above is **first-hit**: it stops at the first `cq:dialog` in the chain. AEM's runtime goes further — the **Sling Resource Merger** merges dialogs across the whole chain, so a proxy component with its own dialog still inherits tabs from ancestor dialogs (a proxy accordion defining `content` + `theme` tabs also shows the Core Component's `properties` tab at author time). The migration deliberately doesn't reimplement merger semantics (`sling:hideResource`, `sling:orderBefore`, key-level deep merge per hop); the optional per-tenant file `aem-dialog-overrides.json` (override via `AEM_DIALOG_OVERRIDES_FILE`) is the escape hatch — name the merged-in pieces explicitly, keyed by `sling:resourceType` (a leading `/apps/` is accepted and stripped):

```json
{
  "uxp/components/proxy/content/accordion": {
    "supplementaryTabs": [
      {
        "path": "/libs/core/wcm/components/accordion/v1/accordion/cq:dialog/content/items/tabs/items/properties",
        "insertAfter": "theme"
      }
    ]
  },
  "uxp/components/proxy/content/hero": {
    "dialogFile": "./dialog-overrides/hero.json"
  }
}
```

- **`supplementaryTabs`** — each entry names an absolute JCR path of a tab node; the migrator fetches `{path}.infinity.json` and splices the node into the resolved dialog's tabs container. `insertAfter` / `insertBefore` (mutually exclusive) position it next to an existing tab's node name; omitted → appended. `key` overrides the spliced node name (default: last path segment). Entries apply in array order. A missing anchor warns and appends; a key that already exists in the dialog is a hard error (per-tab merging isn't supported — use `dialogFile`), as is a dialog with no tabs container at all. The tabs container is found by `sling:resourceType` (`granite/ui/components/coral/foundation/tabs`) with a fallback on the node name `tabs` — proxy dialogs routinely omit the resourceType because the merger supplies it at runtime.
- **`dialogFile`** — a local JSON file (resolved against the config file's directory, then the working directory) holding the complete `cq:dialog` node, same shape as `_cq_dialog.infinity.json` (grab one with `scripts/aem-probe.ts --save`). Replaces dialog resolution entirely — no supertype walk, no `supertypeChain`. When both capabilities are set on one entry, the file is the base and the tabs splice on top.
- **`fieldOverrides`** — per-field Studio tweaks applied after dialog mapping, keyed by emitted (camelCase) field name. `readOnly` locks the input; `initialValue` seeds Studio-created instances with a JSON literal, or the sentinel `"uuid"` which emits `initialValue: () => crypto.randomUUID()` — the pattern for auto-generated ids like a permissions tab's `componentId`. The special `"*"` config key applies its `fieldOverrides` to **every** listed component (per-component entries win per field; `"*"` may carry only `fieldOverrides`), so a shared tab's fields need declaring once. Overrides that match no mapped field on a component are skipped silently — expected for the wildcard. `initialValue` only affects content created in the Studio; migrated content keeps its authored values. Safe to change between runs — never touches type names or ingested content.

Provenance lands in `migration-report.json` — `results[].dialogOverride` (`{file}`) and `results[].supplementaryTabs` (`[{path, key, position}]`) — and the dialog snapshot under `output/cache/aem/apps/…` records the **merged** dialog, not the raw AEM response, so the audit trail matches what was actually mapped (worth remembering when comparing the cache against CRXDE). Config or splice failures (bad tab path, duplicate key, no tabs container) report as `mappingError`, not `network`. Missing file → dialogs resolve from AEM as usual; malformed JSON or invalid entries are a hard error so a typo doesn't silently leave a dialog un-overridden. The probe applies the same overrides, so what it prints stays exactly what the migrator sees.

**Ejecting dialogs (`aem-eject-dialogs`).** The companion CLI materializes a component's (or every listed component's, `--all`) effective dialog into `./dialog-overrides/<resourceType>.json` and rewrites its config entry to `dialogFile` — running the same resolution the migrator uses and baking resolvable datasource options in as literal `items` (unresolvable ones keep their `datasource` node so the report still flags them). The file becomes the hand-editable source of truth: add fields, prune tabs, pin options, re-run `migrate:schema`. Ejected dialogs are frozen snapshots — AEM-side dialog changes stop flowing until re-ejected with `--force`, which discards hand edits; without it existing files are never overwritten.

## Composite multifields (dialog + authored JCR)

When a dialog node has `sling:resourceType`: `granite/ui/components/coral/foundation/form/multifield` and `composite` is `true`, AEM stores authored values under a **persisted property** named by the nested **`field`** child (usually a fieldset), **not** by the Granite sibling key under `items`:

1. **Property name** — Read `field.name` (e.g. `./videos`, `./textAsImages`). Strip a leading `./` (Granite “current node” prefix) and normalize to camelCase so it matches page JSON keys and Sanity fields (same rules as other dialog `name` values).
2. **Repeating rows** — Under that property, each row is a child node keyed `item0`, `item1`, … (or sometimes `0`, `1`, …). Each item is `nt:unstructured` and repeats the inner fieldset’s field names (e.g. `fileReference`, `visible`, `videoFormat`). For `cq/gui/components/authoring/dialog/fileupload`, the DAM path is stored on the property named by `fileReferenceParameter` (often `./fileReference` → `fileReference`), not necessarily on the widget’s own `name` (e.g. `./video`).
3. **Schema** — `aem-to-sanity-schema` maps multifield → Sanity `array` of objects. The array field uses that inner `field.name` for `defineField({ name })`, uses the multifield’s `fieldLabel` for Studio titles, and emits row object titles from `fieldLabel` (see `multifieldArrayPropertyName` / multifield handling in `mapper.ts`).
4. **Content** — `aem-transform` (`aem-to-sanity-content`) inlines components, then `deepCoerceAemMultifieldMapsToArrays` turns any object whose keys are exclusively `itemN` / numeric indices into a JSON **array** so it matches Sanity `array` types. Scalar keys still use dialog `name` when the JCR sibling key differs (`sanityPropertyKeyFromAemChild` in `transform.ts`).
5. **Bookkeeping multifields are skipped.** A multifield whose inner field(s) map to nothing authorable emits **no field at all** (surfaced in `migration-report.json → results[].unmapped` with reason `hidden`). AEM core components use this shape as dialog bookkeeping — e.g. the list editor's `./pages` multifield wraps a single `form/hidden` input mirroring the real `./static` composite. Emitting it would produce an array of a zero-field object, which Sanity's schema validation rejects.

## Named slots (auto-discovered)

Some AEM components embed a **single named child component** under a fixed JCR key — e.g. `aem-integration/components/media-paragraph` has a `content` child whose own `sling:resourceType` is `aem-integration/components/content`. That's not a dialog field, and it's not a `cq:isContainer` drop-zone either; it's a named slot. The dialog itself doesn't describe it, so the shape only shows up in authored content.

`migrate:schema` runs a post-extract scan of `output/cache/aem/content/` (the output of `aem-extract` and tag roots from `aem-tags`) and records every `parentResourceType → slotKey → childResourceType` combo it sees. It then appends one `defineField` per **logical** slot to the parent schema so the Studio shows the slot as a first-class typed field rather than flagging it as an "Unknown field found".

**Repeated slots collapse to one array field.** AEM auto-names every authored instance of the same child — `content`, `content_1793623844`, `content_1893078103_c`, `content…_copy_copy`, `title_1967938466_cop_1581547696`, … — so a single logical slot surfaces under hundreds of distinct JCR keys on content-heavy pages. Emitting one field per key would produce one `defineField` per author-drop and blow past Sanity's per-dataset attribute limit. Instead the scan groups keys by their **logical base** (suffix-stripped: timestamps, paste ids, and `_c`/`_co`/`_cop`/`_copy`/`C…` copy markers all peeled off), and emits:

- a single **array** field (`array of <childType>`) when the base was authored more than once or under an auto-generated key — the common case for drop-zone-style slots, and
- a single inline **reference** field when it's a lone, hand-named slot (key equals base, seen once). These render **collapsed** in the Studio (`options: { collapsible: true, collapsed: true }`) — one row the author clicks to open, the closest native equivalent of AEM's edit-child-in-its-own-dialog flow — instead of the child's full field set expanded inline among the parent's own fields.

When the parent dialog declares field groups (tabs), synthesized slot fields — and the container `childrenField` — join the **default group** (the first one, matching the tab the Studio auto-selects). Without a group they'd only surface under the "All fields" tab, which authors read as the field being missing.

**Slot-only components leave the page builder.** A component type whose every observed appearance is as a slot fill (e.g. a `button` that only ever lives under `promocard`'s `buttonPrimary` / `buttonSecondary` keys) is dropped from `pageBuilder.of[]` so it doesn't clutter the page-level "+ Add" menu — its schema type is still emitted and the parents' slot fields still reference it. A type seen even once **directly in a page body** (under the page root / responsive grid) or **inside a container drop zone** stays in the page builder — excluding it would orphan those blocks. `migrate:schema` logs each exclusion; authoring the component at page level in AEM brings it back on the next run. Like slot discovery itself this is driven by extracted content, so a first run without an extract cache excludes nothing. Note the standalone `aem-to-sanity-pagebuilder` CLI works from schema filenames alone and cannot know slot-only status — re-running the full `migrate:schema` restores the exclusions.

- **First run has no extracted content** → scan returns empty, no slot fields emitted. Run `aem-extract` then re-run `migrate:schema`; the second pass picks up every slot.
- **Dialog field with the same name** → dialog field wins; slot synthesis skipped.
- **Container parents** (listed in `aem-component-containers.json`) skip slot synthesis entirely — their drop-zone children are already claimed by `childrenField`.
- **Multiple child types** seen under one base → skipped + warned; the pipeline won't guess which type to reference. Transform still writes the nested blocks under their JCR keys so data isn't lost; the Studio keeps flagging "Unknown field" until a human authors the field.
- **Unmapped child type** (not in `aem-component-paths`) → skipped + warned. Add the path to the list, re-run `migrate:schema`.

The content transform mirrors this offline: it groups a node's child components by the same logical base and emits them under the base field name — an **array** when the registry marks the field as a repeated slot, a single inline object otherwise — using the same `_type` + `_key` + coercion pipeline as top-level blocks. The schema makes the array-vs-single decision once (from its global view of every page) and records it in `content-type-registry.json`; the transform obeys it, so both sides agree on the shape regardless of how many instances any single page happens to carry. Data flows correctly on the first run; the second `migrate:schema` upgrades "Unknown field" warnings to typed fields in the Studio.

### Slot visibility (`aem-component-slots.json`)

Many slot-carrying components gate each child behind an enable-toggle in their own dialog — e.g. `uxp/components/proxy/content/promocard` carries `buttonPrimary` / `buttonSecondary` / `image` child slots controlled by its `enablePrimaryButton` / `enableSecondaryButton` / `enableForegroundImage` checkboxes. AEM's render logic reads the toggle; nothing in the dialog or the content links toggle to child, so the pipeline can't wire it automatically. The optional per-tenant file `aem-component-slots.json` (override via `AEM_COMPONENT_SLOTS_FILE`) declares that link, keyed by the parent `sling:resourceType` (a leading `/apps/` is accepted and stripped), then by the **emitted slot field name** (the camelCased logical base — for hand-named slots like `buttonPrimary` that's just the JCR key):

```json
{
  "uxp/components/proxy/content/promocard": {
    "buttonPrimary":   { "visibleWhen": "enablePrimaryButton" },
    "buttonSecondary": { "visibleWhen": "enableSecondaryButton" },
    "image":           { "visibleWhen": "enableForegroundImage" },
    "banner":          { "visibleWhen": { "field": "cardStyle", "equals": "flood" } }
  }
}
```

- **`"visibleWhen": "<field>"`** — boolean-toggle shorthand: the slot field is visible only while the sibling **boolean** field is `true`.
- **`"visibleWhen": { "field": "<field>", "equals": "<value>" | ["<v1>", "<v2>"] }`** — the slot field is visible while the sibling **string** field holds one of the listed values.

**Schema** — the synthesized slot field carries `hidden: ({ parent }) => …` through the same conditional-visibility machinery as the [dialog show/hide idioms](#showhide-widgets-conditional-fields): controller defaults (checkbox `checked`, select `selected`) apply so an unset value on a migrated document lands where a fresh AEM dialog would show it. A rule whose controller is missing or wrongly typed **warns and is skipped** — the slot stays visible, because attaching a condition against a field that never matches would hide it unconditionally. A rule naming a slot that never synthesizes (typo, dialog field claimed the name, container parent, or no extract cache yet) also warns.

**Content** — nothing changes at transform/import. Hiding is a Studio display concern: authored slot content migrates and persists regardless of the toggle's value, exactly as AEM keeps a disabled child node in the JCR.

## Container components (`cq:isContainer`)

Some AEM components are containers: authors drop child components into them via the page editor instead of declaring the children as a dialog multifield. The canonical examples are `aem-integration/components/expander`, `container`, `column-layout`, and `box`. Their JCR nodes mix dialog values (`theme`, `singleExpansion`, …) with child keys like `item_1657754806454`, each of which is itself a full component instance with its own `sling:resourceType`.

AEM marks these with `cq:isContainer=true` in component definitions, but that flag isn't in the dialog payload — so the migration mirrors it explicitly in `aem-component-containers.json` (override via `AEM_COMPONENT_CONTAINERS_FILE`):

```json
{
  "aem-integration/components/expander":     { "childrenField": "items" },
  "aem-integration/components/box":          { "childrenField": "items" },
  "aem-integration/components/column-layout":{ "childrenField": "items" },
  "aem-integration/components/container":    { "childrenField": "items" }
}
```

- **Schema side:** `migrate:schema` appends `defineField({ name: childrenField, title: "Items", type: "pageBuilder" })` to each listed component so the palette inside the container matches the top-level page builder. The referenced array type follows `MIGRATION_PAGE_BUILDER_NAME` (default `pageBuilder`). Name collisions with a dialog-declared field skip the append (dialog field wins).
- **Content side:** `aem-transform` walks the container's subtree — descending through `nt:unstructured` layout-only wrappers (AEM's responsive-grid pattern: `container_64909622 → layout: ... → nested container_64909 → ...`) — and emits each resource-type-bearing descendant as a pageBuilder block (full `_type` / `_key` / coercion pipeline) under `childrenField`. Children without `sling:resourceType` stay inline on the container so multifield handling keeps working.

**`flatten: true`** (optional, default `false`) tells the transform to drop the container's own wrapper block and hoist its items into the **parent's** pageBuilder array. Designed for AEM responsive-grid containers (`proxy/content/container`) and similar pure-layout components: their wrapping block carries no authored content, and deep nesting (container-in-container-in-container) trips Sanity's hard 20-level attribute-depth limit at import time. With `flatten`, every responsive-grid layer collapses and content surfaces at a manageable depth. Use the default (`false`) for containers with meaningful dialog fields you want preserved (accordions, expanders).

**Tabs / accordion panels.** AEM's tab and accordion components drop the *same* container resource type into their panels that responsive grids use for layout — distinguished only by the `cq:panelTitle` the panel editor stamps on the node. A `flatten: true` container carrying `cq:panelTitle` therefore keeps its block (the title and the panel boundary are authored content); title-less containers flatten as usual, including inside a kept panel. To migrate the pattern: register the tabs/accordion component as a plain (non-flatten) container and opt the panel container's resource type into the `cq:panelTitle` authoring hint (`aem-component-hints.json`) so the title lands on a `panelTitle` field. Nested tabs (tabs → panel → tabs) roundtrip recursively. Preserving panels costs two attribute levels each, and pathological authoring (tabs-in-tabs-in-accordions with rich text at the bottom) can push a page past Sanity's hard 20-level attribute-depth limit. The limit is counted **per document**, so the transform repairs this losslessly: the topmost container block on the offending chain whose subtree fits a standalone document is cut into a `contentFragment` document (title + a page-builder `content` array; `_id` derived from the page id + the block's stable `_key`, so re-runs are idempotent) and a `contentFragmentRef` block referencing it takes its place — cuts nest when needed. Fragments are written into the same clean file and imported in the same per-page transaction; every cut is listed in `transform-report.json → depthExtractedFragments`. Both types are emitted as generated schemas on every run (the ref block joins the page-builder palette; the names are reserved). Frontends must resolve the reference — one extra GROQ join. Fallback for degenerate shapes that can't be cut: the deepest titled panel is flattened (lossy, reported under `depthFlattenedPanels`).

**Styled wrappers** — a component whose dialog is all layout config (per-breakpoint padding / gap / height / background for mobile, tablet, desktop) around a drop zone — are just non-flatten containers. Register the wrapper with `{ "childrenField": "items" }` (no `flatten`): its dialog fields survive as ordinary typed fields (numberfields → `number`, checkboxes → `boolean`, fileupload → `image` + `{base}AemPath`), slot discovery is skipped for it, and its drop-zone children land in `items`. This works for both authored shapes AEM produces: children placed directly on the wrapper node, and children inside a nested responsive-grid `container` — a `flatten: true` container nested inside a wrapper collapses into the wrapper's `items` (the intermediate container block disappears; the wrapper's own block does not). A childless wrapper keeps a stable shape (`items: []`).

**`document: true`** (optional, mutually exclusive with `flatten`) extracts EVERY instance of the component into its own `contentFragment` document with a `contentFragmentRef` block in the parent array — by design, not depth pressure. Use it for recursive structural components (tabs, accordions): depth is counted per document, so each extracted level resets the attribute-depth budget by construction; the Studio always shows the component as one click-through reference (a single consistent shape instead of sometimes-inline / sometimes-ref); and the frontend needs exactly one join per configured type. Fragment `_id`s derive from the page id + the block's stable `_key` (idempotent re-runs; note a re-run that stops producing a fragment leaves the old document orphaned — reconcile against `transform-report.json → configExtractedFragments`). Fragment titles come from the component's dialog (`title` / `panelTitle` / `accessibilityLabel`), falling back to the nearest enclosing panel title plus the block type ("Get started — accordion").

**Querying fragments from the frontend.** A `contentFragmentRef` block carries a single field — `fragment`, a Sanity reference to a `contentFragment` document (`title`, read-only `sourcePath` provenance, and a `content` array with the same page-builder shape as the page's own array). Resolve it inline with GROQ's dereference operator wherever a page-builder array is projected:

```groq
*[_type == "page" && slug.current == $slug][0]{
  title,
  pageBuilder[]{
    ...,
    _type == "contentFragmentRef" => {
      ...,
      fragment->{ _id, title, content }
    }
  }
}
```

Two shapes to plan for:

1. **Refs are not only top-level.** A `contentFragmentRef` can sit anywhere a page-builder block can — including inside a container block's `childrenField` array (`items` by convention). Repeat the conditional projection at every level you project, or centralize it in a shared projection string your queries interpolate.
2. **Fragments nest.** A fragment's `content` can itself contain `contentFragmentRef` blocks — `document: true` components nest exactly as deep as authors nested them in AEM (tabs-in-tabs), and depth-triggered cuts chain when one cut isn't enough. GROQ cannot recurse unboundedly, so either **(a)** build the join in code and inline it to a known maximum depth:

   ```js
   const fragmentJoin = (depth) =>
     depth === 0
       ? "..."
       : `..., _type == "contentFragmentRef" => {
            ..., fragment->{ _id, title, content[]{ ${fragmentJoin(depth - 1)} } }
          }`;
   ```

   or **(b)** resolve lazily: render the ref block as a component that fetches its own fragment on mount (`*[_type == "contentFragment" && _id == $id][0]{ title, content }`) — one extra round-trip per fragment, but depth-proof and cache-friendly (fragment ids are stable across re-runs). Lazy resolution is the safer default when authors control nesting depth.

Like every other block `_type`, `contentFragmentRef` needs a matching primitive in the consuming frontend's block dispatcher — it renders the joined (or lazily fetched) fragment's `content` through the same dispatcher, so fragments and inline blocks share one rendering path.

Containers nest without special-casing — expander → box → content → Portable Text roundtrips through the same recursive call. Missing file → container behavior stays off. Malformed JSON / invalid entries are a hard error so a typo doesn't silently drop children.

## Type-aware coercion at transform

AEM's JCR is schemaless on dialog inputs: `.infinity.json` serializes everything authored through a dialog widget as a **JSON string**, regardless of what the dialog thinks the type is. A numberfield storing `10` lands as `"10"`; a checkbox or switch lands as `"true"` / `"false"`; a richtext widget lands as an HTML string. The emitted Sanity schemas declare proper types (`number`, `boolean`, `array-of-blocks`), so without coercion the Studio rejects every ingested value with "Expected type X, got String".

`content-type-registry.json` records each field's Sanity type as a tree (`fields: Array<{name, type, itemFields?}>`) so `aem-transform` can coerce at any depth. Nested array-of-object members carry their own field types under `itemFields`; the coercion pass recurses into every multifield item, so richtext / number / boolean inside a `variableColumn.columnContents[]` row is treated the same as a top-level field.

**Map-shaped multifields.** AEM stores multifield rows in two shapes: the canonical ordered form (child keys `item0` / `item1` / ...) and a named-key form where each row lives under a meaningful key (e.g. `colors: { weddingDresses: {...}, bridesmaidDresses: {...} }` on `color-carousel`). The ordered form is materialized during `transformInline` by `deepCoerceAemMultifieldMapsToArrays`; the named-key form is materialized during `coerceFieldTypes` whenever the registry declares a field as `array-of-object` but the value is a plain object — `Object.values` preserves authored order (JSON key order as emitted by AEM).

**Field-name case canonicalization.** The schema emitter camelCases dialog `name` values (`./linkURL` → `linkUrl`, `./altValueFromDAM` → `altValueFromDam`), but the JCR persists the raw name — so authored values arrive under keys that differ from the declared field only by letter case. Before coercing, `aem-transform` renames any key that case-insensitively matches a declared field (at every depth, including `itemFields` items) onto the declared name, so the value lands in the typed field instead of surfacing as an "Unknown field" next to an empty declared one. Only case-only mismatches are renamed — a genuinely different authored key (e.g. a dialog field renamed in AEM after content was authored) still passes through untouched and shows up in the drift report. A declared key that already holds a value is never clobbered.

**Dialog-runtime metadata.** AEM writes bookkeeping flags next to authored fields that have no Sanity counterpart — e.g. `textIsRich: "true"` sits alongside every richtext value so the AEM runtime knows to render it as HTML. These are dropped during `transformInline` (`AEM_DIALOG_RUNTIME_KEYS` in `transform.ts`) so they don't surface in the Studio as "Unknown field found". Add new entries to that set as more leaks show up; they should stay a narrow allowlist, not a blanket string-value filter.

### Richtext → Portable Text

Both richtext variants — `cq/gui/components/authoring/dialog/richtext` (legacy) and `granite/ui/components/coral/foundation/form/richtext` (Coral) — map to `array-of-blocks`, emitted as `of: [{ type: "block" }, { type: "table" }]`. When the ingested value is a string, `aem-transform` parses it as HTML via `@portabletext/block-tools` (with `jsdom` as the DOM):

- Decorators preserved: `strong`, `em`, `underline`, `strike-through`, `code`.
- Styles preserved: `normal`, `h1`–`h4`, `blockquote`.
- Lists preserved: `bullet`, `number`.
- `<a href="...">` preserved as a `link` annotation with an `href` field.
- `_key`s derived from SHA1 of `{jcrPath}::{fieldName}:{counter}` so re-runs produce byte-identical clean docs (deterministic-diff invariant).
- Parser failure leaves the original string in place — no silent data loss.

**Tables.** `<table>` elements convert to Sanity's native Portable Text table block (Studio ≥ 6.6): `{ _type: "table", headerRows, rows: [{ _type: "row", cells: [{ _type: "cell", value: [ ...blocks ] }] }] }`. The three type definitions are emitted alongside the component schemas on every `migrate:schema` run (`table.ts` / `row.ts` / `cell.ts` in the generated barrel), and the toolkit's `aemFormComponents` enables the Studio's table plugin so ingested tables render as editable tables. Conversion rules:

- `headerRows` = the `<thead>` row count when present, else the number of leading rows whose cells are all `<th>`, else `0`.
- Cell content goes through the same HTML → Portable Text pass as the surrounding richtext, so decorators, links, and lists inside cells survive.
- `colspan` / `rowspan` are dropped (content is kept at its DOM position); short rows are padded with empty cells so the grid stays rectangular.
- `<caption>` content is preserved as regular text block(s) emitted immediately before the table block — the canonical table shape has no caption field.
- Nested tables are not converted — an inner table's text flattens to plain blocks inside the parent cell (no data loss).
- Malformed or empty tables fall back to block-tools' default flattening, so their text still lands as normal blocks.

The names `table`, `row`, and `cell` are **reserved** for this feature: an AEM component that would derive one of them is renamed with the `aem` prefix (e.g. `aemTable`) — the same mechanism as the `image` built-in.

### Number and boolean

AEM stores numberfield values as strings (`"10"`) and checkbox / switch values as literal `"true"` / `"false"` strings. `aem-transform` coerces when the declared Sanity type is `number` or `boolean`:

- `number` → `Number(v)`; kept as-is on `NaN`.
- `boolean` → `true` when value is the literal string `"true"`, `false` when `"false"`; kept as-is otherwise. Unrecognized literals surface as Studio validation errors rather than being silently remapped (e.g. `"yes"`, `"1"`, `""` are not assumed). **Custom checkbox constants:** AEM checkboxes persist their `value` attribute when checked and `uncheckedValue` when not — dialogs are free to pick constants other than `"true"` / `"false"` (a link-target checkbox stores `"_blank"` / `"_self"`). `migrate:schema` records such constants in the registry as `checkedValue` / `uncheckedValue` on the field, and `aem-transform` coerces exact matches to `true` / `false` before falling back to the standard literals.
- `date` / `datetime` → AEM datepickers persist whatever their `valueFormat` dialog attribute says: the standard ISO-8601-with-offset JCR date when unset, a display-style string when set (`valueFormat="MMM DD, yyyy"` persists `"May 23, 2024"`). Sanity's types validate strict shapes (`date` → `YYYY-MM-DD`, `datetime` → UTC ISO), so `migrate:schema` records the `valueFormat` in the registry and `aem-transform` parses authored values with it. ISO inputs coerce without a recorded format (covers legacy registries); a `MMM DD, YYYY` month-name fallback handles the most common display format when the registry predates `valueFormat` capture. For `date`, ISO-with-time inputs keep the **literal** date part — no timezone conversion, so a midnight-EST date doesn't shift to the previous day. Unparseable values keep the original and surface in Studio validation.
- `array-of-string` → multi-select buttongroup values. JCR persists a multi-value string property, which `.infinity.json` serializes as a JSON array when several values are picked but as a bare string when exactly one is. The bare-string case is wrapped into a one-item array; any other shape keeps the original value so the mismatch surfaces in the Studio.
- `array-of-reference` → AEM tagfield values arrive as string arrays of canonical tag ids (e.g. `["promotion:payout/recurring-device-credits", "promotion:status/in-market"]`). Resolved through the categories manifest produced by `aem-tags` into `[{_type:"reference", _key:..., _ref:"category-..."}]`. Follows `cq:movedTo` aliases when AEM has redirected the source tag. Page-level `cq:tags` on the `jcr:content` node are lifted onto the page doc's `tags` field via the same resolver. Authored tag ids not present in the manifest get dropped (no opaque string left dangling in a reference array) and surfaced in `transform-report.json → unresolvedTagRefs` so the operator can either include the missing namespace in `aem-tag-roots` or accept that AEM had a stale reference.

### Legacy registries

`content-type-registry.json` files written before type-info was recorded (`fields: string[]`) still load, but every coercion step is skipped — Studio will reject the values. Regenerate via `pnpm migrate:schema` to opt in.

## Authoring dialog file upload (`cq/gui/components/authoring/dialog/fileupload`)

When `fileReferenceParameter` is present (e.g. `./fileReference`), AEM stores the DAM path on that property in page JSON (often `/content/dam/...`). The widget `name` (e.g. `./video`) is not where the path is persisted.

**Schema** — If `fileReferenceParameter` is set, the migrator emits **two** fields in order:

1. **`{name}AemPath`** — `string`, `readOnly: true`, holds the migrated AEM path for traceability in Studio.
2. **`{name}`** — `image` when **any** `mimeTypes` entry is `image/*` (covers pure-image slots and mixed image+video slots like `feature-card`'s `mediaItems`). `file` only when no entry is `image/*` (e.g. `hero-video-banner`'s `video/*`-only upload). The asset linker emits image references unconditionally, so a `file`-typed mixed slot would surface "Invalid file value" in Studio. **`required`** from AEM applies only here so authors attach a Sanity asset.

If `fileReferenceParameter` is omitted, a single image/file field is emitted (legacy behaviour).

**Content + assets** — `aem-transform` moves `/content/dam/...` strings from `{name}` onto `{name}AemPath` using `content-type-registry.json` (field names include **nested** multifield/array member fields via `flattenSchemaFieldNames` in `mapper.ts`). `aem-assets` uploads binaries and replaces `{name}` with a Sanity asset reference object, while **leaving** `{name}AemPath` strings untouched (`rewriteDamRefs` in `assets.ts`).

## AEM authoring hints (`cq:panelTitle` and friends)

AEM stores certain authoring metadata **outside** the dialog payload. The clearest example is accordion / expander panels: each child node carries the panel heading on `cq:panelTitle` (sibling to its own dialog fields), not on a dialog-defined property. The transform's normal property iterator drops anything with a colon — so without an explicit lift step the value would be lost.

The migrator handles this in two layers — a global rename vocabulary and a per-component opt-in config — so only components that actually use the hint pick up a corresponding Sanity field. Other components stay untouched.

**Rename vocabulary** — `AEM_AUTHORING_HINTS` in `packages/aem-to-sanity-core/src/aem/authoring-hints.ts` lists the AEM keys we know how to canonicalize:

| AEM key | Sanity field |
| --- | --- |
| `cq:panelTitle` | `panelTitle` |

**Per-project opt-in** — `aem-component-hints.json` (override via `AEM_COMPONENT_HINTS_FILE`) names which components opt into which AEM keys. Same shape and override mechanism as `aem-component-containers.json`:

```json
{
  "aem-integration/components/box":     ["cq:panelTitle"],
  "aem-integration/components/content": ["cq:panelTitle"]
}
```

**Transform** — `transformInline` (in `packages/aem-to-sanity-content/src/transform.ts`) consults the opt-in config keyed by the current node's `sling:resourceType`. If the node is opted in and the current property is in its allowlist, the value is renamed via `AEM_AUTHORING_HINTS` and emitted under the Sanity field name. Otherwise colon-bearing keys drop as before. `diffProps` skips opted-in keys so the report doesn't flag them as unknown.

**Schema** — `migrateSchemas` injects, **only on opted-in components**, a `readOnly` `string` field per declared hint key. The field is read-only because the value is preserved from AEM, not authored from the Studio dialog. Non-opted components stay clean.

**Extending** — to support a new hint:

1. Add the AEM-key → Sanity-field row to `AEM_AUTHORING_HINTS`.
2. Add the AEM key to the relevant component's array in `aem-component-hints.json`.
3. Re-run `pnpm migrate:schema` and `pnpm transform`. The field surfaces in the registry and clean docs in the same step; nothing else needs editing.

## Page-shell components and per-template document types (`aem-page-components.json`)

AEM stores page-level dialog values on the `jcr:content` node of each authored page. The node's own `sling:resourceType` points at a "page" component (e.g. `/apps/uxp/components/structure/page`) whose `cq:dialog` defines properties like `pwaOrientation`, `disableCache`, `pinPage`, and a sibling `cq:template` (e.g. `/conf/uxp/settings/wcm/templates/plan-details`) identifies what kind of page it is.

Declare each (page-shell, template) pairing in `aem-page-components.json` (override via `AEM_PAGE_COMPONENTS_FILE`). Two modes are supported and can coexist:

**Explicit list:**

```json
{
  "uxp/components/structure/page": {
    "templates": [
      "/conf/uxp/settings/wcm/templates/plan-details",
      "/conf/uxp/settings/wcm/templates/news-article"
    ]
  }
}
```

**Auto-discover from extracted content:**

```json
{
  "uxp/components/structure/page": {
    "discover": true
  }
}
```

With `discover: true`, `migrate:schema` scans `output/cache/aem/content/` (populated by `aem-extract`) for distinct `cq:template` values on `jcr:content` nodes whose `sling:resourceType` matches the declared page-shell, and emits one doc type per discovered template. First-ever schema run with no extracted content yet logs a hint to run `extract` first; the natural pipeline order (`extract` → `migrate:schema`, which the chained `migrate` script already enforces) makes this transparent on subsequent runs. Explicit templates and `discover: true` can be combined — discovered values are appended to the explicit list, deduplicated.

The page-shell `sling:resourceType` must also appear in `aem-component-paths` so its dialog is fetched and emitted as a Sanity object type — that object becomes the inline `pageProperties` field on the document types described below.

**Schema** — For every (resourceType, template) pair, the emitter renders one Sanity *document* type (`planDetailsPage.ts`, `newsArticlePage.ts`, …). Naming follows the same camelCase + reserved-name-prefix rules used for components (`templatePathToTypeName` in `template-pages.ts`, taking the segment after `/templates/` and suffixing `Page`). Each rendered document type carries:

- `title` (required string)
- `slug` (slug)
- `tags` (array of category references; same pattern as the generic `page` doc)
- `pageProperties` — inline object typed against the page-shell's Sanity object, so the Studio shows the dialog fields directly on the document
- `featuredImage` (image, lifted from `jcr:content/cq:featuredimage`)
- `cqTemplate` (read-only / hidden string, retained for traceability)
- `pageBuilder` (the standard page-builder array; both the field and the array type follow `MIGRATION_PAGE_BUILDER_NAME`, default `pageBuilder` — `aem-transform` reads the same env var so the ingested content keys page blocks identically)

The page-shell object itself is automatically excluded from `pageBuilder.of[]` — it belongs on `jcr:content`, not in the body, so it never appears in the "+ Add" menu.

**Per-template name/title overrides (`names`)** — the derived name doubles up when a template path already ends in "-page" (`.../templates/universal-page` → `universalPagePage`). An entry's optional `names` map, keyed by `cq:template` path, pins the emitted document type name and/or Studio title — same string-or-object shape as `aem-component-names.json`:

```json
{
  "uxp/components/structure/page": {
    "discover": true,
    "names": {
      "/conf/uxp/settings/wcm/templates/universal-page": { "name": "universalPage", "title": "Universal Page" },
      "/conf/uxp/settings/wcm/templates/news-article": "newsArticle"
    }
  }
}
```

Explicit names are used verbatim and claim first — another template whose *derived* name would collide takes the usual fallback (`aem` prefix / numeric suffix), while an explicit name that is reserved or collides with an emitted component type is a hard error at `migrate:schema` time. Keys must match a declared template unless `discover: true` is set (a discovered template can be named before it's ever listed). The override flows through the `page-templates.json` manifest, so `aem-transform` stamps the same `_type` — no extra wiring. Like `aem-component-names.json`, this is a **set-once-before-first-import** knob: renaming after content is ingested changes every affected doc's `_type`, and the re-import needs `--recreate-on-type-change` (destroys publish history + drafts of those docs).

**Manifest** — `migrate:schema` writes `output/cache/page-templates.json` with one entry per pair (`{pageComponentResourceType, pageComponentSanityType, cqTemplate, sanityType, sanityTitle}`). `aem-transform` reads this manifest to route each raw page to the right `_type`.

**Transform** — `derivePageProperties` in `packages/aem-to-sanity-content/src/transform.ts` lifts every authored value from `jcr:content` into `pageProperties`, applying the same camelCase rule as ordinary fields and the same coercion pipeline (`"true"` → `true`, HTML → Portable Text, etc.). `derivePageFeaturedImage` moves `cq:featuredimage/fileReference` into `fileReferenceAemPath` so `aem-assets` rewrites it to a Sanity asset ref the same way it does for fileupload widgets. The `JCR_CONTENT_BOOKKEEPING_KEYS` denylist drops replication-per-agent, versioning, and ContextHub plumbing that AEM writes onto `jcr:content` but which has no Sanity counterpart.

**Audit** — Pages whose `jcr:content` carries a declared page-shell `sling:resourceType` but a *undeclared* `cq:template` fall back to the generic `_type: "page"` and surface as `unknownPageTemplates` findings in `transform-report.json`. Add the template to `aem-page-components.json` and re-run `migrate:schema` + `transform` + `import` to upgrade them.

Missing / empty file → no per-template documents; every page uses the generic `page` doc (today's behavior). Fully backwards compatible.

## Coral buttongroup (`granite/ui/components/coral/foundation/form/buttongroup`)

AEM's buttongroup renders a row of toggle buttons; it persists like a select — one string in `selectionMode="single"`, a multi-value string property in `selectionMode="multiple"`.

**Schema** — single mode emits a Sanity `string` with `options.list` built from the literal `items` children (item `text` → title, `value` → value; an item flagged `selected` becomes the field's `initialValue`), plus a non-standard `options.aemWidget: "buttonGroup"` marker (the `defineField` call carries `{ strict: false }` so the extra option typechecks). Multiple mode emits `array` of `string` with the same `options.list`, which the Studio renders as its built-in checkbox list. Dialogs whose items come from a `datasource` follow the datasource resolution described below.

### Datasource-driven options (selects, radiogroups, buttongroups)

Widgets whose options come from a `datasource` child instead of literal `items` run a server-side servlet at dialog render time — opaque over `.infinity.json`. The mapper resolves the two families it can and reports the rest:

- **ACS Commons generic lists** (`acs-commons/components/utilities/genericlist/datasource`) — the datasource node names the list page's JCR path; options are fetched from `{path}/jcr:content/list` (children with `jcr:title` + `value`), using the same transport/auth as dialog fetches. Lists are fetched once per component run and shared across fields. A missing or empty list falls back to a plain field.
- **Core policy datasources** — `core/wcm/components/commons/datasources/allowedheadingelements/v1` and the title component's `allowedtypes` (v1/v2) emit the servlet's **no-policy default** (`h1`–`h6`). The real option set lives in the template's content policy (per-instance, while the migration is per-type), so the emitted list may be broader than a restrictive policy allowed; the authored value round-trips either way.
- **Everything else** (project-custom datasource servlets, Scene7 image presets, language lists) falls back to a plain `string` (or plain array) without options — authored values still migrate. Each fallback is recorded in `migration-report.json → results[].unmapped` with reason `datasource-unresolved` and a detail naming the datasource. To restore a dropdown for those, supply the dialog via `aem-dialog-overrides.json`'s `dialogFile` with literal `items`.

**Studio** — the example Studio (`apps/studio`) routes fields carrying the `aemWidget: "buttonGroup"` marker to a toggle-button-group input (`components/inputs/StringToggleGroupInput.tsx`, wired through `form.components.input` in `sanity.config.ts`) so authors get the same one-click row of buttons they had in AEM. Studios without that resolver fall back to Sanity's default dropdown — the marker is additive and the persisted value shape is unaffected.

**Content** — single-mode values pass through as strings; multiple-mode values are coerced to arrays (see `array-of-string` under "Type-aware coercion at transform").

## Coral text (`granite/ui/components/coral/foundation/text`)

AEM dialogs use the Coral `text` widget for static author-facing copy — inline instructions and warnings (e.g. uxp promocard's note about aspect-ratio behavior in split mode). The node has no `name` and persists nothing in JCR; it exists purely to be read.

**Schema** — maps to a display-only **note**: a read-only `string` field whose `description` carries the message, marked `options.aemWidget: "note"` (the `defineField` call carries `{ strict: false }` for the non-standard option). A text node without a `text` attribute renders nothing in AEM either and is skipped as hidden.

**Studio** — the example Studio routes marked fields through a `form.components.field` resolver to a caution-toned banner (`apps/studio/components/inputs/NoteField.tsx`) that replaces the entire field — no label, no input box, just the message, mirroring AEM's yellow inline warning. Studios without the resolver fall back to an empty read-only string input with the message as its description.

**Content** — nothing to migrate: no authored value ever exists for these fields, so the transform and import are unaffected.

## Show/hide widgets (conditional fields)

Two dialog show/hide idioms — [ACS AEM Commons show/hide](https://adobe-consulting-services.github.io/acs-aem-commons/features/ui-widgets/show-hide-widgets/index.html) and core AEM's stock `cq-dialog-dropdown-showhide` — let a dialog select or checkbox toggle the visibility of other dialog fields via `granite:data` attributes. Both use the same mechanism (a `.class` selector on the controller, the class + a target value on each toggled node) with different attribute names, and both map onto Sanity's conditional `hidden` callback so the Studio dialog folds the same way the AEM dialog did.

**Detection** — a widget whose `granite:data` carries a target selector (a `.class` selector) is a **controller**:

- `acs-cq-dialog-dropdown-checkbox-showhide-target` (ACS) — selects / radio groups / button groups drive dropdown conditions, checkboxes / switches drive checkbox conditions.
- `cq-dialog-dropdown-showhide-target` (core AEM) — the stock dropdown pattern; the controller select also carries `granite:class: cq-dialog-dropdown-showhide`.

Any node whose `granite:class` contains the selector's class is a **target**; its `granite:data` names the values that make it visible:

- `acs-dropdownshowhidetargetvalue` (ACS) or `showhidetargetvalue` (core AEM) — one or more select values, space-separated.
- `acs-checkboxshowhidetargetvalue` (ACS) — `"true"` → visible when checked, `""` → visible when unchecked.

Targets may be individual widgets or whole containers (wells, tab items) — every field mapped underneath a target container inherits its condition, and nested targets AND together (e.g. uxp promocard's split-mode warning is visible only when `cardStyle == "flood"` **and** `isSplit` is checked).

**Schema** — each conditioned field emits `hidden: ({ parent }) => …` reading the controller off the sibling scope. An unset controller counts as its AEM default, matching what an author sees opening a fresh dialog: dropdown conditions fall back to the `selected` option, checkbox conditions to the widget's `checked` attribute (a default-checked controller flips the emitted comparison to `=== false` / `!== false` so unset lands on the visible side; absent or Granite EL `${...}` defaults count as unchecked).

Predicates compare **raw values, deliberately without type coercion** — select controllers hold strings and checkbox controllers hold booleans after `aem-transform`'s type-aware coercion, so stringifying in the callback would only mask a wrongly-typed value. If a controller ever carries a mismatched type (e.g. a JCR Boolean on a select-backed property), its targets hide and the controller itself surfaces a Studio validation error — consistent with the pipeline-wide keep-original-on-failure contract. Don't re-add defensive `String(...)` wrapping; fix the value or the schema type instead. Controllers and targets resolve **within the same object scope only** — a top-level select can't toggle a multifield row field (Sanity's `hidden` reads `parent`), which also matches ACS semantics where checkbox/select state only affects the current multifield row. Unmatched targets (no controller owns the class, or the selector isn't a simple `.class`) stay unconditionally visible.

**Content** — nothing changes at transform/import: AEM persists authored values even while their widget is hidden, and so does Sanity — the `hidden` callback is purely a Studio display concern.

### Conditional alt required (core-image pattern)

AEM's core-image editor marks the `./alt` textfield `required: true` but only enforces it while the field is editable — checking "Don't provide an alternative text" (`isDecorative`) or either inherit toggle (`altValueFromDAM` / `altValueFromPageImage`) hides the field and stores **no alt on the page node**; the runtime resolves it from the DAM asset's `dc:description` or the page's featured image instead. That toggle wiring lives in the image editor's JS (`granite:class`), not in `granite:data` show/hide attributes, so the generic machinery above can't see it. The mapper detects the pattern structurally — a required field named `alt` with at least one of those companion checkboxes in the same object scope — and the emitter renders a conditional `Rule.custom` instead of a hard `Rule.required()`: validation passes when any toggle is on (tolerating both coerced booleans and legacy uncoerced `"true"` strings on already-imported docs), and demands a non-empty value only when the author was actually expected to type one. Required fields without those companions keep the unconditional rule.

## Dialog structure: tabs, accordions, wells

Coral `tabs`, `accordion`, and `well` nodes all flatten — their fields hoist into the object's single field list — but they land on different Studio primitives, mirroring how AEM renders them:

- **Tab panels** (titled containers directly under a `tabs` node) become **Studio groups**: one tab per panel at the top of the object's editor.
- **Accordion panels** (titled containers directly under an `accordion` node) become **collapsible fieldsets** *inside* whatever tab the accordion sits in — an accordion in AEM is a fold-out section within a tab, not a sibling tab. Fields inside the panel keep the surrounding tab's `group` and additionally get the panel's `fieldset`. The fieldset starts collapsed unless the panel node carries a truthy `active` attribute (Coral's expanded-by-default flag).
- **Wells** (`granite/ui/components/coral/foundation/well`) become **non-collapsible fieldsets** — AEM renders a well as a static bordered box grouping related fields. The title comes from the well's `jcr:title` when present, otherwise from the `text` of the first `heading` widget rendered inside the well (the common authoring pattern, e.g. an "Overlay Options:" heading; a trailing colon is stripped). Structural wrappers between the well and its heading are searched through — uxp promocard nests `well > column > heading` — but a nested well's heading belongs to that inner well. A well with no title source stays transparent: its fields hoist up ungrouped, exactly as before. The heading widget itself persists nothing and emits no field.

Example: uxp `promocard` nests an accordion titled "Height" inside its "Display" tab. The six height fields emit with `group: "display"` + `fieldset: "height"`, so the Studio shows them as a collapsible "Height" section on the Display tab — not as a stray top-level "Height" tab.

## AEM tagfield (`cq/gui/components/coral/common/form/tagfield`)

AEM tagfields multiselect from the canonical tag tree at `/content/cq:tags/<namespace>/...`. The migration maps them to **arrays of references to a `category` document type** that implements Sanity's [parent-child taxonomy pattern](https://www.sanity.io/docs/developer-guides/parent-child-taxonomy).

**Schema** — `mapping-table.ts` maps both `cq/gui/components/coral/common/form/tagfield` and the Granite alias `granite/ui/components/coral/foundation/form/tagfield` to the `tags` kind. The mapper emits `array of reference-to-category` (always multiselect — AEM tagfield has no single-value mode). The dialog's `rootPath` (the namespace it narrows to) is not yet enforced on the Sanity side; reference filtering by ancestor would require walking the parent chain at query time and is left to the consumer.

**`category` doc type** — Hand-authored at `apps/studio/schemas/category.ts`. Fields: `title`, `slug`, `parent` (`reference` to `category`, empty on namespace docs), `tagId` (read-only, canonical AEM tag id for traceability), `description`. Hand-authored so it survives schema regeneration.

**Content** — Populated by the `aem-tags` CLI, which walks every namespace listed in `aem-tag-roots` and emits one Sanity `category` doc per AEM `cq:Tag` node. Tag id → Sanity `_id`:

| AEM tag id | Sanity `_id` |
| --- | --- |
| `promotion:payout/recurring-device-credits` | `category-promotion-payout-recurring-device-credits` |
| `color/red` (default namespace, prefix dropped) | `category-color-red` |

`aem-tags` and `aem-transform` compute the same `_id` from the same AEM tag id, without sharing state — both sides hyphenate, lowercase, and hash-truncate long values the same way `pathToDocId` handles page paths.

**Allowlist, not denylist** — only namespaces listed in `aem-tag-roots` are walked. There's no canonical "always skip" set in AEM, so sample-content namespaces like `wknd` are simply absent from the file.

**`cq:movedTo` aliases** — when AEM has merged a tag into another, the tombstone carries `cq:movedTo` pointing at the new tag id. `aem-tags` records the alias in the manifest (no category doc is emitted for the tombstone), and `aem-transform` follows the alias chain when resolving authored references. Cycle guard prevents pathological alias loops.

**Page-level `cq:tags`** — AEM stores page tags as a multi-valued string property on the `jcr:content` (cq:PageContent) node, not on any descendant component. `aem-transform` lifts these onto the page doc's `tags` field via the same resolver — the `page` schema declares the field by default; remove it from `apps/studio/schemas/generated/page.ts` if your migration has no page-level tags.
