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
| `cq/gui/components/authoring/dialog/fileupload` | `file` | File upload → Sanity image (if image mimeTypes) else file |
| `granite/ui/components/coral/foundation/form/multifield` | `multifield` | Multifield → Sanity array of inline objects |
| `granite/ui/components/coral/foundation/container` | `container` | Container → flattened; children hoist up |
| `cq/gui/components/authoring/dialog` | `container` | Dialog root → walked for top-level fields |
| `granite/ui/components/coral/foundation/tabs` | `container` | Tabs → flattened; tab titles become fieldset groups |
| `granite/ui/components/coral/foundation/well` | `container` | Well → flattened; children hoist up |
| `granite/ui/components/coral/foundation/fixedcolumns` | `container` | Fixed columns → flattened; children hoist up |
| `granite/ui/components/coral/foundation/form/fieldset` | `container` | Fieldset → flattened with group label |
| `granite/ui/components/coral/foundation/form/hidden` | `hidden` | Hidden → skipped |
| `granite/ui/components/foundation/heading` | `hidden` | Decorative UI heading inside a dialog → skipped (not a field) |
| `granite/ui/components/coral/foundation/form/colorfield` | `string` | Color picker → Sanity string (hex value) |
| `granite/ui/components/foundation/include` | `include` | Reference to another dialog fragment → fetched and inlined |

## Fallback behaviour

- **Unknown resource type** → emitted as a `string` field with a TODO description and recorded under `unmapped` in the run report.
- **Missing `name`** → field is skipped and recorded.
- **Hidden field** → skipped (not emitted, not a failure).
