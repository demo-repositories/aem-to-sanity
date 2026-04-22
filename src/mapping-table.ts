/**
 * Single source of truth for AEM Granite UI resource types → Sanity field
 * types. Keyed by the exact `sling:resourceType` string. Update this file when
 * the migration-report.json flags new `unmappedFields`.
 *
 * The matcher uses exact match first, then a suffix match on the last two
 * path segments (e.g. `form/textfield`) so minor vendor-path variations still
 * resolve.
 */

export type SanityKind =
  | "string"
  | "text"
  | "number"
  | "boolean"
  | "date"
  | "datetime"
  | "richtext"
  | "select"
  | "radio"
  | "image"
  | "file"
  | "multifield"
  | "container"
  | "hidden"
  | "pathfield"
  | "include";

export interface MappingEntry {
  kind: SanityKind;
  description: string;
}

export const MAPPING: Record<string, MappingEntry> = {
  "granite/ui/components/coral/foundation/form/textfield": {
    kind: "string",
    description: "Single-line text → Sanity string",
  },
  "granite/ui/components/coral/foundation/form/textarea": {
    kind: "text",
    description: "Multi-line text → Sanity text (rows preserved)",
  },
  "granite/ui/components/coral/foundation/form/richtext": {
    kind: "richtext",
    description: "Rich text → Sanity array of PortableText blocks",
  },
  "cq/gui/components/authoring/dialog/richtext": {
    kind: "richtext",
    description: "Legacy rich text → Sanity array of PortableText blocks",
  },
  "granite/ui/components/coral/foundation/form/numberfield": {
    kind: "number",
    description: "Number → Sanity number (min/max → validation)",
  },
  "granite/ui/components/coral/foundation/form/checkbox": {
    kind: "boolean",
    description: "Checkbox → Sanity boolean",
  },
  "granite/ui/components/coral/foundation/form/select": {
    kind: "select",
    description: "Dropdown → Sanity string with options.list",
  },
  "granite/ui/components/coral/foundation/form/radiogroup": {
    kind: "radio",
    description: "Radio group → Sanity string with options.list and layout:'radio'",
  },
  "granite/ui/components/coral/foundation/form/datepicker": {
    kind: "date",
    description: "Date picker → Sanity date or datetime based on `type`",
  },
  "granite/ui/components/coral/foundation/form/pathfield": {
    kind: "pathfield",
    description: "AEM pathfield → Sanity string (reference migration is future work)",
  },
  "cq/gui/components/authoring/dialog/fileupload": {
    kind: "file",
    description:
      "Image/video upload: read-only `{fileReferenceParameter}AemPath` (DAM path) + `{fileReference}` image/file asset; required only on asset when AEM required",
  },
  "granite/ui/components/coral/foundation/form/multifield": {
    kind: "multifield",
    description:
      "Composite multifield → array; persisted key from inner `field.name` (strip ./); JCR rows `item0`/`item1`; titles from `fieldLabel`",
  },
  "granite/ui/components/coral/foundation/container": {
    kind: "container",
    description: "Container → flattened; children hoist up",
  },
  "cq/gui/components/authoring/dialog": {
    kind: "container",
    description: "Dialog root → walked for top-level fields",
  },
  "granite/ui/components/coral/foundation/tabs": {
    kind: "container",
    description: "Tabs → flattened; tab titles become fieldset groups",
  },
  "granite/ui/components/coral/foundation/well": {
    kind: "container",
    description: "Well → flattened; children hoist up",
  },
  "granite/ui/components/coral/foundation/fixedcolumns": {
    kind: "container",
    description: "Fixed columns → flattened; children hoist up",
  },
  "granite/ui/components/coral/foundation/form/fieldset": {
    kind: "container",
    description: "Fieldset → flattened with group label",
  },
  "granite/ui/components/coral/foundation/form/hidden": {
    kind: "hidden",
    description: "Hidden → skipped",
  },
  "granite/ui/components/foundation/heading": {
    kind: "hidden",
    description: "Decorative UI heading inside a dialog → skipped (not a field)",
  },
  "aem-integration/components/dialog/space": {
    kind: "hidden",
    description:
      "Authoring-only spacer in Granite dialogs → skipped (not content)",
  },
  "granite/ui/components/coral/foundation/form/colorfield": {
    kind: "string",
    description: "Color picker → Sanity string (hex value)",
  },
  "granite/ui/components/foundation/include": {
    kind: "include",
    description: "Reference to another dialog fragment → fetched and inlined",
  },
};

export function lookup(resourceType: string | undefined): MappingEntry | undefined {
  if (!resourceType) return undefined;
  if (MAPPING[resourceType]) return MAPPING[resourceType];
  // Suffix match on last two path segments so `some/path/form/textfield`
  // still resolves to the textfield entry.
  const parts = resourceType.split("/");
  if (parts.length >= 2) {
    const suffix = parts.slice(-2).join("/");
    for (const [key, value] of Object.entries(MAPPING)) {
      if (key.endsWith(suffix)) return value;
    }
  }
  return undefined;
}
