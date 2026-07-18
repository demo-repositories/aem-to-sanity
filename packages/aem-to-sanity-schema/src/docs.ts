import { writeTextFile } from "aem-to-sanity-core";
import { MAPPING } from "./mapping-table.ts";

export async function writeMappingDocs(outputFile: string): Promise<void> {
  const rows = Object.entries(MAPPING)
    .map(
      ([aemType, entry]) =>
        `| \`${aemType}\` | \`${entry.kind}\` | ${entry.description} |`,
    )
    .join("\n");

  const md = `# AEM → Sanity field mapping

> Auto-generated from \`packages/aem-to-sanity-schema/src/mapping-table.ts\` on every \`pnpm migrate:schema\` run. Do not edit by hand — update the mapping table and re-run.

Each AEM Granite UI \`sling:resourceType\` is mapped to a Sanity field kind. Unknown types become a string placeholder and are reported in \`output/cache/migration-report.json\` so you can extend the table.

| AEM resource type | Sanity kind | Description |
|---|---|---|
${rows}

## Fallback behaviour

- **Unknown resource type** → emitted as a \`string\` field with a TODO description and recorded under \`unmapped\` in the run report.
- **Missing \`name\`** → field is skipped and recorded.
- **Hidden field** → skipped (not emitted, not a failure).

## Dialog inheritance via \`sling:resourceSuperType\`

\`migrate:schema\` resolves each component's dialog the same way AEM does at request time — by walking the \`sling:resourceSuperType\` chain when the component itself has no \`cq:dialog\`. This makes proxy components (the AEMaaCS norm where \`/apps/<site>/components/proxy/foo\` extends \`<site>/components/foo/v1/foo\` or a \`/libs\` ancestor) migrate without operators having to hand-flatten the inheritance.

Resolution rules:

1. Try the component's own \`cq:dialog\` (either embedded in the component node or at \`{path}/_cq_dialog.infinity.json\`).
2. On 404, read \`sling:resourceSuperType\` off the component. Absent → record a \`failure\` for the component (genuinely dialogless).
3. Resolve the supertype:
   - **Absolute** (\`/apps/...\`, \`/libs/...\`) — used as-is.
   - **Relative** (\`<namespace>/components/...\`) — AEM's lookup order is \`/apps/<rt>\` first, then \`/libs/<rt>\`.
4. Recurse with the resolved path. Cycle guard + 10-hop cap prevent runaway walks.

The resolved chain is recorded on each successful component's \`supertypeChain\` in \`output/cache/migration-report.json\` (omitted for direct hits). The registry key (the AEM resource type used at content-ingest time) remains the **original proxy path's resource type** — authored content with \`sling:resourceType: <proxy>\` keeps matching its emitted Sanity type even though the dialog fields came from an ancestor. Two proxies sharing one supertype produce two distinct Sanity types with identical fields.

A standalone probe (\`scripts/aem-probe.ts\`) uses the same resolver, useful for inspecting a single component's resolution before kicking off a full schema run.

## Composite multifields (dialog + authored JCR)

When a dialog node has \`sling:resourceType\`: \`granite/ui/components/coral/foundation/form/multifield\` and \`composite\` is \`true\`, AEM stores authored values under a **persisted property** named by the nested **\`field\`** child (usually a fieldset), **not** by the Granite sibling key under \`items\`:

1. **Property name** — Read \`field.name\` (e.g. \`./videos\`, \`./textAsImages\`). Strip a leading \`./\` (Granite “current node” prefix) and normalize to camelCase so it matches page JSON keys and Sanity fields (same rules as other dialog \`name\` values).
2. **Repeating rows** — Under that property, each row is a child node keyed \`item0\`, \`item1\`, … (or sometimes \`0\`, \`1\`, …). Each item is \`nt:unstructured\` and repeats the inner fieldset’s field names (e.g. \`fileReference\`, \`visible\`, \`videoFormat\`). For \`cq/gui/components/authoring/dialog/fileupload\`, the DAM path is stored on the property named by \`fileReferenceParameter\` (often \`./fileReference\` → \`fileReference\`), not necessarily on the widget’s own \`name\` (e.g. \`./video\`).
3. **Schema** — \`aem-to-sanity-schema\` maps multifield → Sanity \`array\` of objects. The array field uses that inner \`field.name\` for \`defineField({ name })\`, uses the multifield’s \`fieldLabel\` for Studio titles, and emits row object titles from \`fieldLabel\` (see \`multifieldArrayPropertyName\` / multifield handling in \`mapper.ts\`).
4. **Content** — \`aem-transform\` (\`aem-to-sanity-content\`) inlines components, then \`deepCoerceAemMultifieldMapsToArrays\` turns any object whose keys are exclusively \`itemN\` / numeric indices into a JSON **array** so it matches Sanity \`array\` types. Scalar keys still use dialog \`name\` when the JCR sibling key differs (\`sanityPropertyKeyFromAemChild\` in \`transform.ts\`).

## Named slots (auto-discovered)

Some AEM components embed a **single named child component** under a fixed JCR key — e.g. \`aem-integration/components/media-paragraph\` has a \`content\` child whose own \`sling:resourceType\` is \`aem-integration/components/content\`. That's not a dialog field, and it's not a \`cq:isContainer\` drop-zone either; it's a named slot. The dialog itself doesn't describe it, so the shape only shows up in authored content.

\`migrate:schema\` runs a post-extract scan of \`output/cache/aem/content/\` (the output of \`aem-extract\` and tag roots from \`aem-tags\`) and records every \`parentResourceType → slotKey → childResourceType\` combo it sees. It then appends one \`defineField\` per **logical** slot to the parent schema so the Studio shows the slot as a first-class typed field rather than flagging it as an "Unknown field found".

**Repeated slots collapse to one array field.** AEM auto-names every authored instance of the same child — \`content\`, \`content_1793623844\`, \`content_1893078103_c\`, \`content…_copy_copy\`, \`title_1967938466_cop_1581547696\`, … — so a single logical slot surfaces under hundreds of distinct JCR keys on content-heavy pages. Emitting one field per key would produce one \`defineField\` per author-drop and blow past Sanity's per-dataset attribute limit. Instead the scan groups keys by their **logical base** (suffix-stripped: timestamps, paste ids, and \`_c\`/\`_co\`/\`_cop\`/\`_copy\`/\`C…\` copy markers all peeled off), and emits:

- a single **array** field (\`array of <childType>\`) when the base was authored more than once or under an auto-generated key — the common case for drop-zone-style slots, and
- a single inline **reference** field when it's a lone, hand-named slot (key equals base, seen once).

- **First run has no extracted content** → scan returns empty, no slot fields emitted. Run \`aem-extract\` then re-run \`migrate:schema\`; the second pass picks up every slot.
- **Dialog field with the same name** → dialog field wins; slot synthesis skipped.
- **Container parents** (listed in \`aem-component-containers.json\`) skip slot synthesis entirely — their drop-zone children are already claimed by \`childrenField\`.
- **Multiple child types** seen under one base → skipped + warned; the pipeline won't guess which type to reference. Transform still writes the nested blocks under their JCR keys so data isn't lost; the Studio keeps flagging "Unknown field" until a human authors the field.
- **Unmapped child type** (not in \`aem-component-paths\`) → skipped + warned. Add the path to the list, re-run \`migrate:schema\`.

The content transform mirrors this offline: it groups a node's child components by the same logical base and emits them under the base field name — an **array** when the registry marks the field as a repeated slot, a single inline object otherwise — using the same \`_type\` + \`_key\` + coercion pipeline as top-level blocks. The schema makes the array-vs-single decision once (from its global view of every page) and records it in \`content-type-registry.json\`; the transform obeys it, so both sides agree on the shape regardless of how many instances any single page happens to carry. Data flows correctly on the first run; the second \`migrate:schema\` upgrades "Unknown field" warnings to typed fields in the Studio.

## Container components (\`cq:isContainer\`)

Some AEM components are containers: authors drop child components into them via the page editor instead of declaring the children as a dialog multifield. The canonical examples are \`aem-integration/components/expander\`, \`container\`, \`column-layout\`, and \`box\`. Their JCR nodes mix dialog values (\`theme\`, \`singleExpansion\`, …) with child keys like \`item_1657754806454\`, each of which is itself a full component instance with its own \`sling:resourceType\`.

AEM marks these with \`cq:isContainer=true\` in component definitions, but that flag isn't in the dialog payload — so the migration mirrors it explicitly in \`aem-component-containers.json\` (override via \`AEM_COMPONENT_CONTAINERS_FILE\`):

\`\`\`json
{
  "aem-integration/components/expander":     { "childrenField": "items" },
  "aem-integration/components/box":          { "childrenField": "items" },
  "aem-integration/components/column-layout":{ "childrenField": "items" },
  "aem-integration/components/container":    { "childrenField": "items" }
}
\`\`\`

- **Schema side:** \`migrate:schema\` appends \`defineField({ name: childrenField, title: "Items", type: "pageBuilder" })\` to each listed component so the palette inside the container matches the top-level page builder. Name collisions with a dialog-declared field skip the append (dialog field wins).
- **Content side:** \`aem-transform\` walks the container's subtree — descending through \`nt:unstructured\` layout-only wrappers (AEM's responsive-grid pattern: \`container_64909622 → layout: ... → nested container_64909 → ...\`) — and emits each resource-type-bearing descendant as a pageBuilder block (full \`_type\` / \`_key\` / coercion pipeline) under \`childrenField\`. Children without \`sling:resourceType\` stay inline on the container so multifield handling keeps working.

**\`flatten: true\`** (optional, default \`false\`) tells the transform to drop the container's own wrapper block and hoist its items into the **parent's** pageBuilder array. Designed for AEM responsive-grid containers (\`proxy/content/container\`) and similar pure-layout components: their wrapping block carries no authored content, and deep nesting (container-in-container-in-container) trips Sanity's hard 20-level attribute-depth limit at import time. With \`flatten\`, every responsive-grid layer collapses and content surfaces at a manageable depth. Use the default (\`false\`) for containers with meaningful dialog fields you want preserved (accordions, expanders).

Containers nest without special-casing — expander → box → content → Portable Text roundtrips through the same recursive call. Missing file → container behavior stays off. Malformed JSON / invalid entries are a hard error so a typo doesn't silently drop children.

## Type-aware coercion at transform

AEM's JCR is schemaless on dialog inputs: \`.infinity.json\` serializes everything authored through a dialog widget as a **JSON string**, regardless of what the dialog thinks the type is. A numberfield storing \`10\` lands as \`"10"\`; a checkbox or switch lands as \`"true"\` / \`"false"\`; a richtext widget lands as an HTML string. The emitted Sanity schemas declare proper types (\`number\`, \`boolean\`, \`array-of-blocks\`), so without coercion the Studio rejects every ingested value with "Expected type X, got String".

\`content-type-registry.json\` records each field's Sanity type as a tree (\`fields: Array<{name, type, itemFields?}>\`) so \`aem-transform\` can coerce at any depth. Nested array-of-object members carry their own field types under \`itemFields\`; the coercion pass recurses into every multifield item, so richtext / number / boolean inside a \`variableColumn.columnContents[]\` row is treated the same as a top-level field.

**Map-shaped multifields.** AEM stores multifield rows in two shapes: the canonical ordered form (child keys \`item0\` / \`item1\` / ...) and a named-key form where each row lives under a meaningful key (e.g. \`colors: { weddingDresses: {...}, bridesmaidDresses: {...} }\` on \`color-carousel\`). The ordered form is materialized during \`transformInline\` by \`deepCoerceAemMultifieldMapsToArrays\`; the named-key form is materialized during \`coerceFieldTypes\` whenever the registry declares a field as \`array-of-object\` but the value is a plain object — \`Object.values\` preserves authored order (JSON key order as emitted by AEM).

**Dialog-runtime metadata.** AEM writes bookkeeping flags next to authored fields that have no Sanity counterpart — e.g. \`textIsRich: "true"\` sits alongside every richtext value so the AEM runtime knows to render it as HTML. These are dropped during \`transformInline\` (\`AEM_DIALOG_RUNTIME_KEYS\` in \`transform.ts\`) so they don't surface in the Studio as "Unknown field found". Add new entries to that set as more leaks show up; they should stay a narrow allowlist, not a blanket string-value filter.

### Richtext → Portable Text

Both richtext variants — \`cq/gui/components/authoring/dialog/richtext\` (legacy) and \`granite/ui/components/coral/foundation/form/richtext\` (Coral) — map to \`array-of-blocks\`. When the ingested value is a string, \`aem-transform\` parses it as HTML via \`@portabletext/block-tools\` (with \`jsdom\` as the DOM):

- Decorators preserved: \`strong\`, \`em\`, \`underline\`, \`strike-through\`, \`code\`.
- Styles preserved: \`normal\`, \`h1\`–\`h4\`, \`blockquote\`.
- Lists preserved: \`bullet\`, \`number\`.
- \`<a href="...">\` preserved as a \`link\` annotation with an \`href\` field.
- \`_key\`s derived from SHA1 of \`{jcrPath}::{fieldName}:{counter}\` so re-runs produce byte-identical clean docs (deterministic-diff invariant).
- Parser failure leaves the original string in place — no silent data loss.

### Number and boolean

AEM stores numberfield values as strings (\`"10"\`) and checkbox / switch values as literal \`"true"\` / \`"false"\` strings. \`aem-transform\` coerces when the declared Sanity type is \`number\` or \`boolean\`:

- \`number\` → \`Number(v)\`; kept as-is on \`NaN\`.
- \`boolean\` → \`true\` when value is the literal string \`"true"\`, \`false\` when \`"false"\`; kept as-is otherwise. Unrecognized literals surface as Studio validation errors rather than being silently remapped (e.g. \`"yes"\`, \`"1"\`, \`""\` are not assumed).
- \`array-of-string\` → multi-select buttongroup values. JCR persists a multi-value string property, which \`.infinity.json\` serializes as a JSON array when several values are picked but as a bare string when exactly one is. The bare-string case is wrapped into a one-item array; any other shape keeps the original value so the mismatch surfaces in the Studio.
- \`array-of-reference\` → AEM tagfield values arrive as string arrays of canonical tag ids (e.g. \`["promotion:payout/recurring-device-credits", "promotion:status/in-market"]\`). Resolved through the categories manifest produced by \`aem-tags\` into \`[{_type:"reference", _key:..., _ref:"category-..."}]\`. Follows \`cq:movedTo\` aliases when AEM has redirected the source tag. Page-level \`cq:tags\` on the \`jcr:content\` node are lifted onto the page doc's \`tags\` field via the same resolver. Authored tag ids not present in the manifest get dropped (no opaque string left dangling in a reference array) and surfaced in \`transform-report.json → unresolvedTagRefs\` so the operator can either include the missing namespace in \`aem-tag-roots\` or accept that AEM had a stale reference.

### Legacy registries

\`content-type-registry.json\` files written before type-info was recorded (\`fields: string[]\`) still load, but every coercion step is skipped — Studio will reject the values. Regenerate via \`pnpm migrate:schema\` to opt in.

## Authoring dialog file upload (\`cq/gui/components/authoring/dialog/fileupload\`)

When \`fileReferenceParameter\` is present (e.g. \`./fileReference\`), AEM stores the DAM path on that property in page JSON (often \`/content/dam/...\`). The widget \`name\` (e.g. \`./video\`) is not where the path is persisted.

**Schema** — If \`fileReferenceParameter\` is set, the migrator emits **two** fields in order:

1. **\`{name}AemPath\`** — \`string\`, \`readOnly: true\`, holds the migrated AEM path for traceability in Studio.
2. **\`{name}\`** — \`image\` when **any** \`mimeTypes\` entry is \`image/*\` (covers pure-image slots and mixed image+video slots like \`feature-card\`'s \`mediaItems\`). \`file\` only when no entry is \`image/*\` (e.g. \`hero-video-banner\`'s \`video/*\`-only upload). The asset linker emits image references unconditionally, so a \`file\`-typed mixed slot would surface "Invalid file value" in Studio. **\`required\`** from AEM applies only here so authors attach a Sanity asset.

If \`fileReferenceParameter\` is omitted, a single image/file field is emitted (legacy behaviour).

**Content + assets** — \`aem-transform\` moves \`/content/dam/...\` strings from \`{name}\` onto \`{name}AemPath\` using \`content-type-registry.json\` (field names include **nested** multifield/array member fields via \`flattenSchemaFieldNames\` in \`mapper.ts\`). \`aem-assets\` uploads binaries and replaces \`{name}\` with a Sanity asset reference object, while **leaving** \`{name}AemPath\` strings untouched (\`rewriteDamRefs\` in \`assets.ts\`).

## AEM authoring hints (\`cq:panelTitle\` and friends)

AEM stores certain authoring metadata **outside** the dialog payload. The clearest example is accordion / expander panels: each child node carries the panel heading on \`cq:panelTitle\` (sibling to its own dialog fields), not on a dialog-defined property. The transform's normal property iterator drops anything with a colon — so without an explicit lift step the value would be lost.

The migrator handles this in two layers — a global rename vocabulary and a per-component opt-in config — so only components that actually use the hint pick up a corresponding Sanity field. Other components stay untouched.

**Rename vocabulary** — \`AEM_AUTHORING_HINTS\` in \`packages/aem-to-sanity-core/src/aem/authoring-hints.ts\` lists the AEM keys we know how to canonicalize:

| AEM key | Sanity field |
| --- | --- |
| \`cq:panelTitle\` | \`panelTitle\` |

**Per-project opt-in** — \`aem-component-hints.json\` (override via \`AEM_COMPONENT_HINTS_FILE\`) names which components opt into which AEM keys. Same shape and override mechanism as \`aem-component-containers.json\`:

\`\`\`json
{
  "aem-integration/components/box":     ["cq:panelTitle"],
  "aem-integration/components/content": ["cq:panelTitle"]
}
\`\`\`

**Transform** — \`transformInline\` (in \`packages/aem-to-sanity-content/src/transform.ts\`) consults the opt-in config keyed by the current node's \`sling:resourceType\`. If the node is opted in and the current property is in its allowlist, the value is renamed via \`AEM_AUTHORING_HINTS\` and emitted under the Sanity field name. Otherwise colon-bearing keys drop as before. \`diffProps\` skips opted-in keys so the report doesn't flag them as unknown.

**Schema** — \`migrateSchemas\` injects, **only on opted-in components**, a \`readOnly\` \`string\` field per declared hint key. The field is read-only because the value is preserved from AEM, not authored from the Studio dialog. Non-opted components stay clean.

**Extending** — to support a new hint:

1. Add the AEM-key → Sanity-field row to \`AEM_AUTHORING_HINTS\`.
2. Add the AEM key to the relevant component's array in \`aem-component-hints.json\`.
3. Re-run \`pnpm migrate:schema\` and \`pnpm transform\`. The field surfaces in the registry and clean docs in the same step; nothing else needs editing.

## Page-shell components and per-template document types (\`aem-page-components.json\`)

AEM stores page-level dialog values on the \`jcr:content\` node of each authored page. The node's own \`sling:resourceType\` points at a "page" component (e.g. \`/apps/uxp/components/structure/page\`) whose \`cq:dialog\` defines properties like \`pwaOrientation\`, \`disableCache\`, \`pinPage\`, and a sibling \`cq:template\` (e.g. \`/conf/uxp/settings/wcm/templates/plan-details\`) identifies what kind of page it is.

Declare each (page-shell, template) pairing in \`aem-page-components.json\` (override via \`AEM_PAGE_COMPONENTS_FILE\`). Two modes are supported and can coexist:

**Explicit list:**

\`\`\`json
{
  "uxp/components/structure/page": {
    "templates": [
      "/conf/uxp/settings/wcm/templates/plan-details",
      "/conf/uxp/settings/wcm/templates/news-article"
    ]
  }
}
\`\`\`

**Auto-discover from extracted content:**

\`\`\`json
{
  "uxp/components/structure/page": {
    "discover": true
  }
}
\`\`\`

With \`discover: true\`, \`migrate:schema\` scans \`output/cache/aem/content/\` (populated by \`aem-extract\`) for distinct \`cq:template\` values on \`jcr:content\` nodes whose \`sling:resourceType\` matches the declared page-shell, and emits one doc type per discovered template. First-ever schema run with no extracted content yet logs a hint to run \`extract\` first; the natural pipeline order (\`extract\` → \`migrate:schema\`, which the chained \`migrate\` script already enforces) makes this transparent on subsequent runs. Explicit templates and \`discover: true\` can be combined — discovered values are appended to the explicit list, deduplicated.

The page-shell \`sling:resourceType\` must also appear in \`aem-component-paths\` so its dialog is fetched and emitted as a Sanity object type — that object becomes the inline \`pageProperties\` field on the document types described below.

**Schema** — For every (resourceType, template) pair, the emitter renders one Sanity *document* type (\`planDetailsPage.ts\`, \`newsArticlePage.ts\`, …). Naming follows the same camelCase + reserved-name-prefix rules used for components (\`templatePathToTypeName\` in \`template-pages.ts\`, taking the segment after \`/templates/\` and suffixing \`Page\`). Each rendered document type carries:

- \`title\` (required string)
- \`slug\` (slug)
- \`tags\` (array of category references; same pattern as the generic \`page\` doc)
- \`pageProperties\` — inline object typed against the page-shell's Sanity object, so the Studio shows the dialog fields directly on the document
- \`featuredImage\` (image, lifted from \`jcr:content/cq:featuredimage\`)
- \`cqTemplate\` (read-only / hidden string, retained for traceability)
- \`pageBuilder\` (the standard page-builder array)

The page-shell object itself is automatically excluded from \`pageBuilder.of[]\` — it belongs on \`jcr:content\`, not in the body, so it never appears in the "+ Add" menu.

**Manifest** — \`migrate:schema\` writes \`output/cache/page-templates.json\` with one entry per pair (\`{pageComponentResourceType, pageComponentSanityType, cqTemplate, sanityType, sanityTitle}\`). \`aem-transform\` reads this manifest to route each raw page to the right \`_type\`.

**Transform** — \`derivePageProperties\` in \`packages/aem-to-sanity-content/src/transform.ts\` lifts every authored value from \`jcr:content\` into \`pageProperties\`, applying the same camelCase rule as ordinary fields and the same coercion pipeline (\`"true"\` → \`true\`, HTML → Portable Text, etc.). \`derivePageFeaturedImage\` moves \`cq:featuredimage/fileReference\` into \`fileReferenceAemPath\` so \`aem-assets\` rewrites it to a Sanity asset ref the same way it does for fileupload widgets. The \`JCR_CONTENT_BOOKKEEPING_KEYS\` denylist drops replication-per-agent, versioning, and ContextHub plumbing that AEM writes onto \`jcr:content\` but which has no Sanity counterpart.

**Audit** — Pages whose \`jcr:content\` carries a declared page-shell \`sling:resourceType\` but a *undeclared* \`cq:template\` fall back to the generic \`_type: "page"\` and surface as \`unknownPageTemplates\` findings in \`transform-report.json\`. Add the template to \`aem-page-components.json\` and re-run \`migrate:schema\` + \`transform\` + \`import\` to upgrade them.

Missing / empty file → no per-template documents; every page uses the generic \`page\` doc (today's behavior). Fully backwards compatible.

## Coral buttongroup (\`granite/ui/components/coral/foundation/form/buttongroup\`)

AEM's buttongroup renders a row of toggle buttons; it persists like a select — one string in \`selectionMode="single"\`, a multi-value string property in \`selectionMode="multiple"\`.

**Schema** — single mode emits a Sanity \`string\` with \`options.list\` built from the literal \`items\` children (item \`text\` → title, \`value\` → value; an item flagged \`selected\` becomes the field's \`initialValue\`), plus a non-standard \`options.aemWidget: "buttonGroup"\` marker (the \`defineField\` call carries \`{ strict: false }\` so the extra option typechecks). Multiple mode emits \`array\` of \`string\` with the same \`options.list\`, which the Studio renders as its built-in checkbox list. Dialogs whose items come from a \`datasource\` (e.g. ACS Commons generic lists) are resolved server-side at dialog render time and are opaque over \`.infinity.json\` — those fields fall back to a plain \`string\` (or plain array) without options; authored values still migrate.

**Studio** — the example Studio (\`apps/studio\`) routes fields carrying the \`aemWidget: "buttonGroup"\` marker to a toggle-button-group input (\`components/inputs/StringToggleGroupInput.tsx\`, wired through \`form.components.input\` in \`sanity.config.ts\`) so authors get the same one-click row of buttons they had in AEM. Studios without that resolver fall back to Sanity's default dropdown — the marker is additive and the persisted value shape is unaffected.

**Content** — single-mode values pass through as strings; multiple-mode values are coerced to arrays (see \`array-of-string\` under "Type-aware coercion at transform").

## Coral text (\`granite/ui/components/coral/foundation/text\`)

AEM dialogs use the Coral \`text\` widget for static author-facing copy — inline instructions and warnings (e.g. uxp promocard's note about aspect-ratio behavior in split mode). The node has no \`name\` and persists nothing in JCR; it exists purely to be read.

**Schema** — maps to a display-only **note**: a read-only \`string\` field whose \`description\` carries the message, marked \`options.aemWidget: "note"\` (the \`defineField\` call carries \`{ strict: false }\` for the non-standard option). A text node without a \`text\` attribute renders nothing in AEM either and is skipped as hidden.

**Studio** — the example Studio routes marked fields through a \`form.components.field\` resolver to a caution-toned banner (\`apps/studio/components/inputs/NoteField.tsx\`) that replaces the entire field — no label, no input box, just the message, mirroring AEM's yellow inline warning. Studios without the resolver fall back to an empty read-only string input with the message as its description.

**Content** — nothing to migrate: no authored value ever exists for these fields, so the transform and import are unaffected.

## Dialog structure: tabs vs. accordions

Both Coral \`tabs\` and \`accordion\` nodes flatten — their fields hoist into the object's single field list — but they land on different Studio primitives, mirroring how AEM renders them:

- **Tab panels** (titled containers directly under a \`tabs\` node) become **Studio groups**: one tab per panel at the top of the object's editor.
- **Accordion panels** (titled containers directly under an \`accordion\` node) become **collapsible fieldsets** *inside* whatever tab the accordion sits in — an accordion in AEM is a fold-out section within a tab, not a sibling tab. Fields inside the panel keep the surrounding tab's \`group\` and additionally get the panel's \`fieldset\`. The fieldset starts collapsed unless the panel node carries a truthy \`active\` attribute (Coral's expanded-by-default flag).

Example: uxp \`promocard\` nests an accordion titled "Height" inside its "Display" tab. The six height fields emit with \`group: "display"\` + \`fieldset: "height"\`, so the Studio shows them as a collapsible "Height" section on the Display tab — not as a stray top-level "Height" tab.

## AEM tagfield (\`cq/gui/components/coral/common/form/tagfield\`)

AEM tagfields multiselect from the canonical tag tree at \`/content/cq:tags/<namespace>/...\`. The migration maps them to **arrays of references to a \`category\` document type** that implements Sanity's [parent-child taxonomy pattern](https://www.sanity.io/docs/developer-guides/parent-child-taxonomy).

**Schema** — \`mapping-table.ts\` maps both \`cq/gui/components/coral/common/form/tagfield\` and the Granite alias \`granite/ui/components/coral/foundation/form/tagfield\` to the \`tags\` kind. The mapper emits \`array of reference-to-category\` (always multiselect — AEM tagfield has no single-value mode). The dialog's \`rootPath\` (the namespace it narrows to) is not yet enforced on the Sanity side; reference filtering by ancestor would require walking the parent chain at query time and is left to the consumer.

**\`category\` doc type** — Hand-authored at \`apps/studio/schemas/category.ts\`. Fields: \`title\`, \`slug\`, \`parent\` (\`reference\` to \`category\`, empty on namespace docs), \`tagId\` (read-only, canonical AEM tag id for traceability), \`description\`. Hand-authored so it survives schema regeneration.

**Content** — Populated by the \`aem-tags\` CLI, which walks every namespace listed in \`aem-tag-roots\` and emits one Sanity \`category\` doc per AEM \`cq:Tag\` node. Tag id → Sanity \`_id\`:

| AEM tag id | Sanity \`_id\` |
| --- | --- |
| \`promotion:payout/recurring-device-credits\` | \`category-promotion-payout-recurring-device-credits\` |
| \`color/red\` (default namespace, prefix dropped) | \`category-color-red\` |

\`aem-tags\` and \`aem-transform\` compute the same \`_id\` from the same AEM tag id, without sharing state — both sides hyphenate, lowercase, and hash-truncate long values the same way \`pathToDocId\` handles page paths.

**Allowlist, not denylist** — only namespaces listed in \`aem-tag-roots\` are walked. There's no canonical "always skip" set in AEM, so sample-content namespaces like \`wknd\` are simply absent from the file.

**\`cq:movedTo\` aliases** — when AEM has merged a tag into another, the tombstone carries \`cq:movedTo\` pointing at the new tag id. \`aem-tags\` records the alias in the manifest (no category doc is emitted for the tombstone), and \`aem-transform\` follows the alias chain when resolving authored references. Cycle guard prevents pathological alias loops.

**Page-level \`cq:tags\`** — AEM stores page tags as a multi-valued string property on the \`jcr:content\` (cq:PageContent) node, not on any descendant component. \`aem-transform\` lifts these onto the page doc's \`tags\` field via the same resolver — the \`page\` schema declares the field by default; remove it from \`apps/studio/schemas/generated/page.ts\` if your migration has no page-level tags.
`;

  await writeTextFile(outputFile, md);
}
