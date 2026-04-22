# AEM → Sanity field mapping

> Auto-generated from `packages/aem-to-sanity-schema/src/mapping-table.ts` on every `pnpm migrate:schema` run. Do not edit by hand — update the mapping table and re-run.

Each AEM Granite UI `sling:resourceType` is mapped to a Sanity field kind. Unknown types become a string placeholder and are reported in `output/migration-report.json` so you can extend the table.

| AEM resource type | Sanity kind | Description |
|---|---|---|
| `granite/ui/components/coral/foundation/form/textfield` | `string` | Single-line text → Sanity string |
| `granite/ui/components/coral/foundation/form/textarea` | `text` | Multi-line text → Sanity text (rows preserved) |
| `granite/ui/components/coral/foundation/form/richtext` | `richtext` | Rich text → Sanity array of PortableText blocks |
| `cq/gui/components/authoring/dialog/richtext` | `richtext` | Legacy rich text → Sanity array of PortableText blocks |
| `granite/ui/components/coral/foundation/form/numberfield` | `number` | Number → Sanity number (min/max → validation) |
| `granite/ui/components/coral/foundation/form/checkbox` | `boolean` | Checkbox → Sanity boolean |
| `granite/ui/components/coral/foundation/form/select` | `select` | Dropdown → Sanity string with options.list |
| `granite/ui/components/coral/foundation/form/radiogroup` | `radio` | Radio group → Sanity string with options.list and layout:'radio' |
| `granite/ui/components/coral/foundation/form/datepicker` | `date` | Date picker → Sanity date or datetime based on `type` |
| `granite/ui/components/coral/foundation/form/pathfield` | `pathfield` | AEM pathfield → Sanity string (reference migration is future work) |
| `cq/gui/components/authoring/dialog/fileupload` | `file` | Image/video upload: read-only `{fileReferenceParameter}AemPath` (DAM path) + `{fileReference}` image/file asset; required only on asset when AEM required |
| `granite/ui/components/coral/foundation/form/multifield` | `multifield` | Composite multifield → array; persisted key from inner `field.name` (strip ./); JCR rows `item0`/`item1`; titles from `fieldLabel` |
| `granite/ui/components/coral/foundation/container` | `container` | Container → flattened; children hoist up |
| `cq/gui/components/authoring/dialog` | `container` | Dialog root → walked for top-level fields |
| `granite/ui/components/coral/foundation/tabs` | `container` | Tabs → flattened; tab titles become fieldset groups |
| `granite/ui/components/coral/foundation/well` | `container` | Well → flattened; children hoist up |
| `granite/ui/components/coral/foundation/fixedcolumns` | `container` | Fixed columns → flattened; children hoist up |
| `granite/ui/components/coral/foundation/form/fieldset` | `container` | Fieldset → flattened with group label |
| `granite/ui/components/coral/foundation/form/hidden` | `hidden` | Hidden → skipped |
| `granite/ui/components/foundation/heading` | `hidden` | Decorative UI heading inside a dialog → skipped (not a field) |
| `aem-integration/components/dialog/space` | `hidden` | Authoring-only spacer in Granite dialogs → skipped (not content) |
| `granite/ui/components/coral/foundation/form/colorfield` | `string` | Color picker → Sanity string (hex value) |
| `granite/ui/components/foundation/include` | `include` | Reference to another dialog fragment → fetched and inlined |

## Fallback behaviour

- **Unknown resource type** → emitted as a `string` field with a TODO description and recorded under `unmapped` in the run report.
- **Missing `name`** → field is skipped and recorded.
- **Hidden field** → skipped (not emitted, not a failure).

## Composite multifields (dialog + authored JCR)

When a dialog node has `sling:resourceType`: `granite/ui/components/coral/foundation/form/multifield` and `composite` is `true`, AEM stores authored values under a **persisted property** named by the nested **`field`** child (usually a fieldset), **not** by the Granite sibling key under `items`:

1. **Property name** — Read `field.name` (e.g. `./videos`, `./textAsImages`). Strip a leading `./` (Granite “current node” prefix) and normalize to camelCase so it matches page JSON keys and Sanity fields (same rules as other dialog `name` values).
2. **Repeating rows** — Under that property, each row is a child node keyed `item0`, `item1`, … (or sometimes `0`, `1`, …). Each item is `nt:unstructured` and repeats the inner fieldset’s field names (e.g. `fileReference`, `visible`, `videoFormat`). For `cq/gui/components/authoring/dialog/fileupload`, the DAM path is stored on the property named by `fileReferenceParameter` (often `./fileReference` → `fileReference`), not necessarily on the widget’s own `name` (e.g. `./video`).
3. **Schema** — `aem-to-sanity-schema` maps multifield → Sanity `array` of objects. The array field uses that inner `field.name` for `defineField({ name })`, uses the multifield’s `fieldLabel` for Studio titles, and emits row object titles from `fieldLabel` (see `multifieldArrayPropertyName` / multifield handling in `mapper.ts`).
4. **Content** — `aem-transform` (`aem-to-sanity-content`) inlines components, then `deepCoerceAemMultifieldMapsToArrays` turns any object whose keys are exclusively `itemN` / numeric indices into a JSON **array** so it matches Sanity `array` types. Scalar keys still use dialog `name` when the JCR sibling key differs (`sanityPropertyKeyFromAemChild` in `transform.ts`).

## Authoring dialog file upload (`cq/gui/components/authoring/dialog/fileupload`)

When `fileReferenceParameter` is present (e.g. `./fileReference`), AEM stores the DAM path on that property in page JSON (often `/content/dam/...`). The widget `name` (e.g. `./video`) is not where the path is persisted.

**Schema** — If `fileReferenceParameter` is set, the migrator emits **two** fields in order:

1. **`{name}AemPath`** — `string`, `readOnly: true`, holds the migrated AEM path for traceability in Studio.
2. **`{name}`** — `image` when all `mimeTypes` are `image/*`, otherwise `file` (e.g. video). **`required`** from AEM applies only here so authors attach a Sanity asset.

If `fileReferenceParameter` is omitted, a single image/file field is emitted (legacy behaviour).

**Content + assets** — `aem-transform` moves `/content/dam/...` strings from `{name}` onto `{name}AemPath` using `content-type-registry.json` (field names include **nested** multifield/array member fields via `flattenSchemaFieldNames` in `mapper.ts`). `aem-assets` uploads binaries and replaces `{name}` with a Sanity asset reference object, while **leaving** `{name}AemPath` strings untouched (`rewriteDamRefs` in `assets.ts`).
