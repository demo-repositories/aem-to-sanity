import { childNodes, isTruthyAttr, type DialogNode } from "aem-to-sanity-core";
import { lookup, type SanityKind } from "./mapping-table.ts";
import { toCamelCase } from "./naming.ts";

export interface UnmappedField {
  name: string;
  resourceType: string;
  reason: "unknown-type" | "missing-name" | "hidden" | "include-failed";
  detail?: string;
}

export interface RenamedField {
  originalName: string;
  newName: string;
  title?: string;
}

export type NodeFetcher = (jcrPath: string) => Promise<DialogNode>;

interface MappingContext {
  unmapped: UnmappedField[];
  groups: Array<{ name: string; title: string }>;
  fieldsets: SanityFieldset[];
  renamed: RenamedField[];
  fetcher: NodeFetcher;
  visitedIncludes: Set<string>;
}

/**
 * Fieldset emitted for a Coral accordion panel or well. Unlike titled tab
 * containers (which become Studio groups, i.e. tabs), both are sections
 * *within* their surrounding tab — Sanity's fieldset is the matching
 * primitive. Accordion panels are `collapsible`, starting closed unless the
 * panel node carries a truthy `active` attribute; wells are static boxes,
 * so they emit non-collapsible (`collapsed` is ignored for those).
 */
export interface SanityFieldset {
  name: string;
  title: string;
  collapsed: boolean;
  collapsible: boolean;
}

/**
 * Where a mapped field lands in the Studio UI, threaded down the dialog walk.
 * `group` comes from the nearest titled tab-like container; `fieldset` from
 * the nearest accordion panel. `accordionPanels` is set while walking the
 * direct children of a Coral accordion so titled panel containers there
 * become fieldsets instead of new groups. `showHide` accumulates the ACS
 * Commons show/hide target wrappers the walk has descended through — every
 * field built under them inherits their visibility conditions.
 */
interface Placement {
  group?: string;
  fieldset?: string;
  accordionPanels?: boolean;
  showHide?: RawShowHideTarget[];
}

/**
 * Dialog show/hide: a select or checkbox marked with a target selector in
 * `granite:data` (a `.class` selector) toggles every dialog node carrying
 * that class. Two attribute vocabularies implement the same mechanism —
 * ACS Commons (https://adobe-consulting-services.github.io/acs-aem-commons/features/ui-widgets/show-hide-widgets/)
 * and core AEM's stock `cq-dialog-dropdown-showhide` — and both resolve
 * through this record. It captures one target node's linkage as authored —
 * the class tokens on the node plus the values that make it visible —
 * before we know which widget (if any) owns the selector.
 */
interface RawShowHideTarget {
  /** Class tokens from the node's `granite:class`, matched against controller selectors. */
  classTokens: string[];
  /** `acs-dropdownshowhidetargetvalue` / core `showhidetargetvalue`, space-split: select values that show this node. */
  dropdownValues?: string[];
  /** `acs-checkboxshowhidetargetvalue`: `"true"` → visible when checked, `""` → visible when unchecked. */
  checkboxVisibleWhenChecked?: boolean;
}

/** Show/hide controller metadata attached to the widget field that drives targets. */
interface ShowHideControllerMeta {
  /** The target selector's class name (leading `.` stripped). */
  selectorClass: string;
  kind: "dropdown" | "checkbox";
  /** Dropdown controller's default option value (`selected` item), used as the unset-value fallback. */
  defaultValue?: string;
  /** Checkbox controller declared default-checked (`checked` attr); absent → unchecked/unknown. */
  defaultChecked?: boolean;
}

/**
 * One resolved visibility condition on a field: the field is visible only
 * when the sibling `controllerField` holds a matching value. Multiple
 * conditions on one field AND together (nested show/hide wrappers). The
 * emitter renders these as a Sanity `hidden: ({ parent }) => …` callback.
 */
export interface ShowHideCondition {
  controllerField: string;
  kind: "dropdown" | "checkbox";
  /** Dropdown: values that make the field visible. */
  values?: string[];
  /** Dropdown: controller's default value, applied when the document has none. */
  controllerDefault?: string;
  /** Checkbox: true → visible when checked, false → visible when unchecked. */
  visibleWhenChecked?: boolean;
  /** Checkbox: controller defaults to checked, so an unset boolean counts as checked. */
  controllerDefaultChecked?: boolean;
}

const CORAL_ACCORDION_RESOURCE_TYPE =
  "granite/ui/components/coral/foundation/accordion";

/** Matches the Coral well and its legacy non-Coral alias. */
function isWellResourceType(resourceType: string | undefined): boolean {
  return (
    typeof resourceType === "string" &&
    resourceType.endsWith("foundation/well")
  );
}

export type SanityField =
  | (CommonFieldProps & StringField)
  | (CommonFieldProps & TextField)
  | (CommonFieldProps & NumberField)
  | (CommonFieldProps & BooleanField)
  | (CommonFieldProps & DateField)
  | (CommonFieldProps & ImageField)
  | (CommonFieldProps & FileField)
  | (CommonFieldProps & RichTextField)
  | (CommonFieldProps & ArrayOfStringField)
  | (CommonFieldProps & ArrayOfObjectField)
  | (CommonFieldProps & ReferenceArrayField)
  | (CommonFieldProps & ContainerChildrenField)
  | (CommonFieldProps & SlotReferenceField)
  | (CommonFieldProps & SlotArrayField)
  | (CommonFieldProps & NoteField)
  | (CommonFieldProps & PlaceholderField);

export interface CommonFieldProps {
  name: string;
  title?: string;
  description?: string;
  required?: boolean;
  group?: string;
  fieldset?: string;
  /** Resolved ACS show/hide visibility conditions (ANDed) → emitted `hidden` callback. */
  hiddenConditions?: ShowHideCondition[];
  /** @internal Raw target linkage; resolved into `hiddenConditions` and removed before mapDialog returns. */
  showHideTargets?: RawShowHideTarget[];
  /** @internal Controller linkage; consumed during resolution and removed before mapDialog returns. */
  showHideController?: ShowHideControllerMeta;
}

interface StringField {
  type: "string";
  initialValue?: string;
  /** Read-only string (e.g. migrated AEM DAM path alongside an asset field). */
  readOnly?: boolean;
  options?: {
    list?: Array<{ title: string; value: string }>;
    layout?: "radio";
    /**
     * Marker for AEM widgets whose Studio rendering needs a custom input
     * component (resolved via `form.components.input` in the consuming
     * Studio's config — see `apps/studio/components/inputs/`). Emitted with
     * `{ strict: false }` on the `defineField` call since it's not a
     * standard Sanity option. Studios without the resolver fall back to the
     * default dropdown; the persisted value shape is unaffected.
     */
    aemWidget?: "buttonGroup";
  };
}
interface TextField {
  type: "text";
  rows?: number;
  initialValue?: string;
}
interface NumberField {
  type: "number";
  initialValue?: number;
  min?: number;
  max?: number;
}
interface BooleanField {
  type: "boolean";
  initialValue?: boolean;
  /**
   * Custom constant the checkbox persists when checked (its `value` attr),
   * when it isn't the literal `"true"` — e.g. a link-target checkbox that
   * stores `"_blank"`. Carried into the content registry so `aem-transform`
   * can coerce the authored constant to `true`.
   */
  checkedValue?: string;
  /** Custom constant persisted when unchecked (`uncheckedValue` attr, e.g. `"_self"`). */
  uncheckedValue?: string;
}
interface DateField {
  type: "date" | "datetime";
  /**
   * The datepicker's `valueFormat` attr — the moment-style pattern of the
   * string AEM persists to JCR (e.g. `"MMM DD, yyyy"` stores `"May 23,
   * 2024"`). Absent when the dialog doesn't set one, in which case JCR
   * stores the standard ISO-8601-with-offset date. Carried into the content
   * registry so `aem-transform` can parse authored values back into
   * Sanity's `YYYY-MM-DD` / UTC-ISO shapes deterministically.
   */
  valueFormat?: string;
}
interface ImageField {
  type: "image";
}
interface FileField {
  type: "file";
}
interface RichTextField {
  type: "array-of-blocks";
}
/**
 * Multi-value option picker (buttongroup with `selectionMode="multiple"`).
 * JCR persists a multi-value string property; Sanity renders `array` of
 * `string` with `options.list` as its built-in checkbox list.
 */
interface ArrayOfStringField {
  type: "array-of-string";
  options?: {
    list?: Array<{ title: string; value: string }>;
  };
}
interface ArrayOfObjectField {
  type: "array-of-object";
  itemFields: SanityField[];
  /** AEM multifield `fieldLabel` → Sanity array member `title` (repeating row). */
  itemTitle?: string;
}
/**
 * AEM tagfield → Sanity `array of reference-to-<refType>`. The picker is
 * always multiselect at the AEM side (`tagfield` doesn't have a single-value
 * mode the way Granite select does), so we always emit the array shape. The
 * referenced Sanity type is currently `category` — the hand-authored
 * parent-child taxonomy doc populated by `aem-tags`.
 */
interface ReferenceArrayField {
  type: "array-of-reference";
  /** Sanity type name to reference. Always `category` for tagfields today. */
  refType: string;
}
/**
 * Drop-zone array on an AEM container component (e.g. `expander`, `container`,
 * `column-layout`). Emitted as a field of the page-builder array type so the
 * Studio palette inside the container matches the top-level page builder.
 * Populated at content-transform time by walking the container's child
 * component nodes — NOT by coerceFieldTypes, which doesn't touch this type
 * string.
 */
interface ContainerChildrenField {
  type: "container-children";
  /** Page-builder array type to reference. Default: `pageBuilder`. */
  pageBuilderTypeName?: string;
}
/**
 * Named-slot field: a dialog-less child component embedded under a fixed
 * JCR key (e.g. `media-paragraph`'s `content` child → `content` component).
 * Discovered by scanning extracted AEM content, not the dialog. Emitted
 * as a direct type reference so the single nested block lands inline
 * under the slot key rather than as an array member.
 */
interface SlotReferenceField {
  type: "slot-reference";
  /** Sanity type name of the nested block that fills this slot. */
  slotTypeName: string;
}
/**
 * Repeated named slot: a single logical slot that authors filled with many
 * instances of the same child component. AEM auto-names each instance
 * (`content`, `content1732069919C`, `content…CopyCopy`, …); discovery groups
 * them by {@link normalizeSlotBase} and emits ONE array field instead of one
 * `defineField` per instance — otherwise content-heavy pages blow past
 * Sanity's per-dataset attribute limit. Emitted as `array of <slotTypeName>`;
 * the content transform collects every sibling node sharing the base into this
 * array.
 */
interface SlotArrayField {
  type: "slot-array";
  /** Sanity type name of the nested blocks that fill this slot. */
  slotTypeName: string;
}
/**
 * Static authoring text (Coral `text` widget) — instructions or warnings AEM
 * shows inside the dialog. Nothing is persisted in JCR (the node has no
 * `name`), so the Studio counterpart is display-only: a read-only string
 * field carrying the message, marked `options.aemWidget: "note"` so the
 * consuming Studio can render it as a banner instead of an input.
 */
interface NoteField {
  type: "note";
  noteText: string;
}
interface PlaceholderField {
  type: "placeholder";
  originalResourceType: string;
}

/**
 * All `defineField` names for a component, including nested multifield / array
 * member fields (used by `content-type-registry.json` and `aem-transform`).
 */
export function flattenSchemaFieldNames(fields: SanityField[]): string[] {
  const out: string[] = [];
  function walk(f: SanityField): void {
    out.push(f.name);
    if (f.type === "array-of-object" && f.itemFields?.length) {
      for (const inner of f.itemFields) walk(inner);
    }
  }
  for (const f of fields) walk(f);
  return out;
}

/**
 * Tree of every mapped field with its Sanity type. Nested array-of-object
 * members are carried under `itemFields` so `aem-transform` can coerce
 * scalar AEM values at any depth — notably, richtext HTML strings inside
 * nested multifields (variableColumn > columnContents[] > columnText)
 * become Portable Text instead of raising "expected array" in the Studio.
 *
 * Leaf fields have no `itemFields`; `array-of-object` carries the nested
 * structure. This mirrors Sanity's own `of: [{ type: "object", fields:
 * [...] }]` shape without the full `SanityField` details the transform
 * doesn't need (e.g. options, validation, group).
 */
export interface SchemaFieldInfo {
  name: string;
  type: string;
  itemFields?: SchemaFieldInfo[];
  /**
   * Boolean fields only: custom constants the AEM checkbox persists when
   * checked / unchecked (`value` / `uncheckedValue` attrs), recorded when
   * they aren't the `"true"` / `"false"` literals the transform coerces by
   * default — e.g. a link-target checkbox storing `"_blank"` / `"_self"`.
   */
  checkedValue?: string;
  uncheckedValue?: string;
  /**
   * Date / datetime fields only: the AEM datepicker's `valueFormat` — the
   * moment-style pattern of the string persisted to JCR (e.g. `"MMM DD,
   * yyyy"` → `"May 23, 2024"`). Absent when the dialog stores the standard
   * ISO-8601 JCR date.
   */
  valueFormat?: string;
}

export function describeSchemaFields(
  fields: SanityField[],
): SchemaFieldInfo[] {
  return fields.map((f) => {
    const info: SchemaFieldInfo = { name: f.name, type: f.type };
    if (f.type === "array-of-object" && f.itemFields?.length) {
      info.itemFields = describeSchemaFields(f.itemFields);
    }
    if (f.type === "boolean") {
      if (f.checkedValue !== undefined) info.checkedValue = f.checkedValue;
      if (f.uncheckedValue !== undefined) info.uncheckedValue = f.uncheckedValue;
    }
    if ((f.type === "date" || f.type === "datetime") && f.valueFormat !== undefined) {
      info.valueFormat = f.valueFormat;
    }
    return info;
  });
}

export async function mapDialog(
  root: DialogNode,
  fetcher: NodeFetcher,
): Promise<{
  fields: SanityField[];
  unmapped: UnmappedField[];
  groups: Array<{ name: string; title: string }>;
  fieldsets: SanityFieldset[];
  renamed: RenamedField[];
}> {
  const ctx: MappingContext = {
    unmapped: [],
    groups: [],
    fieldsets: [],
    renamed: [],
    fetcher,
    visitedIncludes: new Set(),
  };
  const fields: SanityField[] = [];
  await walk(root, ctx, fields, {});
  dedupeFieldNames(fields, ctx.renamed);
  // After dedupe so conditions reference final controller field names.
  resolveShowHideConditions(fields);
  return {
    fields,
    unmapped: ctx.unmapped,
    groups: ctx.groups,
    fieldsets: ctx.fieldsets,
    renamed: ctx.renamed,
  };
}

/**
 * Collisions happen when multiple AEM fields share the same `./name` (legal in
 * AEM when they live in different tabs, illegal in a flat Sanity object). For
 * each collision, prefer a name derived from `title` when available, else
 * append a numeric suffix. Recurses into array-of-object item fields.
 */
function dedupeFieldNames(
  fields: SanityField[],
  renamed: RenamedField[],
): void {
  const used = new Set<string>();
  for (const field of fields) {
    const original = field.name;
    let candidate = original;
    if (used.has(candidate) && field.title) {
      const fromTitle = toCamelCaseFromText(field.title);
      if (fromTitle && !used.has(fromTitle)) candidate = fromTitle;
    }
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${original}${suffix++}`;
    }
    if (candidate !== original) {
      renamed.push({
        originalName: original,
        newName: candidate,
        title: field.title,
      });
      field.name = candidate;
    }
    used.add(candidate);
    if (field.type === "array-of-object") {
      dedupeFieldNames(field.itemFields, renamed);
    }
  }
}

function toCamelCaseFromText(input: string): string {
  const words = input
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/);
  if (words.length === 0) return "";
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      return i === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
}

async function walk(
  node: DialogNode,
  ctx: MappingContext,
  out: SanityField[],
  placement: Placement,
): Promise<void> {
  for (const { key, value: child } of childNodes(node)) {
    await processNode(key, child, ctx, out, placement);
  }
}

/** Map one dialog node — a widget, container, include, or wrapper — into `out`. */
async function processNode(
  key: string,
  child: DialogNode,
  ctx: MappingContext,
  out: SanityField[],
  incomingPlacement: Placement,
): Promise<void> {
  const resourceType = child["sling:resourceType"];
  const entry = lookup(resourceType);

  // ACS show/hide target: this node (widget or container) carries a target
  // class + target value. Fields built from it — and everything under it,
  // for containers — inherit the visibility condition.
  const showHideTarget = showHideTargetRecord(child);
  const placement: Placement = showHideTarget
    ? {
        ...incomingPlacement,
        showHide: [...(incomingPlacement.showHide ?? []), showHideTarget],
      }
    : incomingPlacement;

  // Transparent wrapper handling. Two patterns show up in real AEM dialogs:
  //  1. Literal `items` grouping node — walk its children directly.
  //  2. A named wrapper (e.g. outer `content`, `columns`, `column`) that
  //     lacks `sling:resourceType` but nests an `items` child. David's
  //     Bridal `aem-integration/components/content` is the motivating
  //     example: every structural level omits the
  //     `cq/gui/components/authoring/dialog` / granite container markup,
  //     so without this descent we'd stop at the first child and emit a
  //     single placeholder string instead of the real richtext + option
  //     fields buried several levels down.
  if (!entry && !resourceType) {
    if (key === "items") {
      await walk(child, ctx, out, placement);
      return;
    }
    const itemsChild = child["items"];
    if (itemsChild && typeof itemsChild === "object" && !Array.isArray(itemsChild)) {
      await walk(itemsChild as DialogNode, ctx, out, placement);
      return;
    }
  }

  if (!entry) {
    const placeholder = buildPlaceholder(key, child, placement);
    if (placeholder) {
      out.push(placeholder);
      ctx.unmapped.push({
        name: placeholder.name,
        resourceType: resourceType ?? "(none)",
        reason: "unknown-type",
      });
    }
    return;
  }

  if (entry.kind === "hidden") {
    ctx.unmapped.push({
      name: fieldName(child) ?? key,
      resourceType: resourceType ?? "(none)",
      reason: "hidden",
    });
    return;
  }

  if (entry.kind === "include") {
    await resolveInclude(child, ctx, out, placement);
    return;
  }

  if (entry.kind === "container") {
    const childPlacement: Placement = {
      group: placement.group,
      fieldset: placement.fieldset,
      showHide: placement.showHide,
      // A Coral accordion's direct item children are its panels — their
      // titles become collapsible fieldsets, not Studio groups (tabs).
      // Any other container resets the flag: only immediate panels count.
      accordionPanels: resourceType === CORAL_ACCORDION_RESOURCE_TYPE,
    };
    const title = stringAttr(child["jcr:title"]);
    // A well is AEM's static grouping box — visually a bordered section
    // within its tab, so it maps to a non-collapsible fieldset. Its title
    // rarely lives on `jcr:title`; the usual authoring pattern puts a
    // `heading` widget as the well's first item (e.g. "Overlay Options:").
    // Untitled wells stay transparent and their fields hoist up as before.
    const wellTitle = isWellResourceType(resourceType)
      ? (title ?? wellHeadingText(child))
      : undefined;
    if (wellTitle) {
      const cleanTitle = wellTitle.replace(/\s*:\s*$/, "") || wellTitle;
      const fieldsetName = toCamelCase(cleanTitle);
      if (fieldsetName) {
        if (!ctx.fieldsets.find((f) => f.name === fieldsetName)) {
          ctx.fieldsets.push({
            name: fieldsetName,
            title: cleanTitle,
            collapsed: false,
            collapsible: false,
          });
        }
        childPlacement.fieldset = fieldsetName;
      }
    } else if (title) {
      if (placement.accordionPanels) {
        const fieldsetName = toCamelCase(title);
        if (!ctx.fieldsets.find((f) => f.name === fieldsetName)) {
          ctx.fieldsets.push({
            name: fieldsetName,
            title,
            collapsed: !isTruthyAttr(child.active),
            collapsible: true,
          });
        }
        childPlacement.fieldset = fieldsetName;
      } else {
        const groupName = toCamelCase(title);
        if (!ctx.groups.find((g) => g.name === groupName)) {
          ctx.groups.push({ name: groupName, title });
        }
        childPlacement.group = groupName;
      }
    }
    const itemsChild = child["items"];
    if (
      itemsChild &&
      typeof itemsChild === "object" &&
      !Array.isArray(itemsChild)
    ) {
      await walk(itemsChild as DialogNode, ctx, out, childPlacement);
    } else {
      await walk(child, ctx, out, childPlacement);
    }
    return;
  }

  const builtList = await buildFieldsForKind(
    entry.kind,
    key,
    child,
    placement,
    ctx,
  );
  for (const built of builtList) {
    if (built) out.push(built);
  }
}

async function resolveInclude(
  includeNode: DialogNode,
  ctx: MappingContext,
  out: SanityField[],
  placement: Placement,
): Promise<void> {
  const path = stringAttr(includeNode["path"]);
  if (!path) {
    ctx.unmapped.push({
      name: stringAttr(includeNode["jcr:title"]) ?? "include",
      resourceType: "granite/ui/components/foundation/include",
      reason: "include-failed",
      detail: "include node has no `path` attribute",
    });
    return;
  }
  if (ctx.visitedIncludes.has(path)) return;
  ctx.visitedIncludes.add(path);

  let included: DialogNode;
  try {
    included = await ctx.fetcher(path);
  } catch (err) {
    ctx.unmapped.push({
      name: "include",
      resourceType: "granite/ui/components/foundation/include",
      reason: "include-failed",
      detail: `${path}: ${(err as Error).message}`,
    });
    return;
  }
  // Two fragment shapes exist in the wild. Most fragments are structural —
  // an unmarked root whose children are the fields — and get walked as such.
  // But shared single-widget dialogs (e.g. uxp's
  // `.../textstyle/v1/dialogs/textAlignment`, a bare buttongroup with its own
  // `name`/`items`) put the widget's `sling:resourceType` on the fragment
  // ROOT. Walking that root's children would skip the widget mapping and leak
  // its option items out as placeholder fields, so route the root through the
  // same per-node logic as a regular dialog child. The synthetic key is the
  // fragment path's last segment; the widget's `name` attribute still wins
  // for the emitted field name.
  const rootEntry = lookup(included["sling:resourceType"]);
  if (rootEntry) {
    const rootKey = path.split("/").filter(Boolean).pop() ?? "include";
    await processNode(rootKey, included, ctx, out, placement);
    return;
  }
  await walk(included, ctx, out, placement);
}

/** Suffix for read-only DAM path string paired with `fileReference`-style asset fields. */
export const AEM_FILE_UPLOAD_PATH_FIELD_SUFFIX = "AemPath";

async function buildFieldsForKind(
  kind: SanityKind,
  nodeKey: string,
  node: DialogNode,
  placement: Placement,
  ctx: MappingContext,
): Promise<SanityField[]> {
  if (kind === "file" && stringAttr(node.fileReferenceParameter)) {
    return buildFileUploadFieldPair(nodeKey, node, placement, ctx);
  }
  const one = await buildField(kind, nodeKey, node, placement, ctx);
  return one ? [one] : [];
}

/**
 * When `fileReferenceParameter` is set (typical fileupload), emit two fields:
 * `{name}AemPath` read-only string (migrated DAM path) + `{name}` image/file
 * (Sanity asset). Required validation applies only to the asset field.
 */
function buildFileUploadFieldPair(
  nodeKey: string,
  node: DialogNode,
  placement: Placement,
  ctx: MappingContext,
): SanityField[] {
  const assetName = persistedFileLikeFieldName(node, nodeKey);
  if (!assetName) {
    ctx.unmapped.push({
      name: nodeKey,
      resourceType: node["sling:resourceType"] ?? "(none)",
      reason: "missing-name",
    });
    return [];
  }
  const pathName = `${assetName}${AEM_FILE_UPLOAD_PATH_FIELD_SUFFIX}`;
  const label =
    stringAttr(node.fieldLabel) ??
    stringAttr(node["jcr:title"]) ??
    assetName;
  const showHideTargets = placement.showHide?.length
    ? { showHideTargets: placement.showHide }
    : {};
  const pathField: SanityField = {
    name: pathName,
    title: `${label} (AEM DAM path)`,
    description:
      "Original AEM path from migration (read-only). Use the Sanity asset field below for previews and delivery.",
    required: false,
    group: placement.group,
    fieldset: placement.fieldset,
    type: "string",
    readOnly: true,
    ...showHideTargets,
  };
  const assetField: SanityField = {
    name: assetName,
    title: label,
    description: stringAttr(node.fieldDescription),
    required: isTruthyAttr(node.required) || undefined,
    group: placement.group,
    fieldset: placement.fieldset,
    type: isImageUpload(node) ? "image" : "file",
    ...showHideTargets,
  } as SanityField;
  return [pathField, assetField];
}

async function buildField(
  kind: SanityKind,
  nodeKey: string,
  node: DialogNode,
  placement: Placement,
  ctx: MappingContext,
): Promise<SanityField | undefined> {
  const name = fieldNameForKind(kind, node, nodeKey);
  if (!name) {
    ctx.unmapped.push({
      name: nodeKey,
      resourceType: node["sling:resourceType"] ?? "(none)",
      reason: "missing-name",
    });
    return undefined;
  }

  const common: CommonFieldProps = {
    name,
    title:
      stringAttr(node.fieldLabel) ??
      stringAttr(node["jcr:title"]) ??
      (kind === "multifield" ? multifieldInnerFieldJcrTitle(node) : undefined),
    description: stringAttr(node.fieldDescription),
    required: isTruthyAttr(node.required) || undefined,
    group: placement.group,
    fieldset: placement.fieldset,
    ...(placement.showHide?.length
      ? { showHideTargets: placement.showHide }
      : {}),
  };
  const controller = showHideControllerMeta(kind, node);
  if (controller) common.showHideController = controller;

  switch (kind) {
    case "string":
      return {
        ...common,
        type: "string",
        initialValue: stringAttr(node.value),
      };
    case "text":
      return {
        ...common,
        type: "text",
        rows: numberAttr(node.rows),
        initialValue: stringAttr(node.value),
      };
    case "number":
      return {
        ...common,
        type: "number",
        initialValue: numberAttr(node.value),
        min: numberAttr(node.min),
        max: numberAttr(node.max),
      };
    case "boolean": {
      const defaultChecked = checkboxDefaultChecked(node);
      const checkedValue = customBooleanConstant(node.value);
      const uncheckedValue = customBooleanConstant(node.uncheckedValue);
      return {
        ...common,
        type: "boolean",
        ...(defaultChecked !== undefined
          ? { initialValue: defaultChecked }
          : {}),
        ...(checkedValue !== undefined ? { checkedValue } : {}),
        ...(uncheckedValue !== undefined ? { uncheckedValue } : {}),
      };
    }
    case "date": {
      const valueFormat = datepickerValueFormat(node);
      return {
        ...common,
        type: stringAttr(node.type) === "datetime" ? "datetime" : "date",
        ...(valueFormat !== undefined ? { valueFormat } : {}),
      };
    }
    case "datetime": {
      const valueFormat = datepickerValueFormat(node);
      return {
        ...common,
        type: "datetime",
        ...(valueFormat !== undefined ? { valueFormat } : {}),
      };
    }
    case "richtext":
      return { ...common, type: "array-of-blocks" };
    case "select":
      return {
        ...common,
        type: "string",
        options: { list: extractSelectItems(node) },
      };
    case "radio":
      return {
        ...common,
        type: "string",
        options: { list: extractSelectItems(node), layout: "radio" },
      };
    case "buttongroup": {
      // Coral buttongroup persists like a select: one string in `single`
      // mode, a multi-value string property in `multiple` mode. Items may
      // come from a literal `items` node (extractable) or a `datasource`
      // resolved server-side at dialog render time — the latter is opaque
      // over `.infinity.json`, so those fields keep the value but get no
      // options list (same fallback the select widget has today).
      const list = extractSelectItems(node);
      if (stringAttr(node.selectionMode) === "multiple") {
        return {
          ...common,
          type: "array-of-string",
          ...(list.length > 0 ? { options: { list } } : {}),
        };
      }
      return {
        ...common,
        type: "string",
        initialValue: selectedItemValue(node),
        ...(list.length > 0
          ? { options: { list, aemWidget: "buttonGroup" as const } }
          : {}),
      };
    }
    case "image":
      return { ...common, type: "image" };
    case "file":
      return {
        ...common,
        type: isImageUpload(node) ? "image" : "file",
      } as SanityField;
    case "pathfield":
    case "pathbrowser": {
      // Route by rootPath + field name heuristic:
      //   - rootPath starts with /content/dam → image (DAM asset picker)
      //   - last word of the field name is `image`/`img` → image
      //   - otherwise → `string` (internal content path; future `reference`)
      if (isPathbrowserImage(node, name)) {
        return { ...common, type: "image" };
      }
      return { ...common, type: "string" };
    }
    case "multifield": {
      const itemTitle =
        stringAttr(node.fieldLabel) ??
        multifieldInnerFieldJcrTitle(node) ??
        stringAttr(node["jcr:title"]);
      return {
        ...common,
        type: "array-of-object",
        itemFields: await extractMultifieldItems(node, ctx),
        ...(itemTitle ? { itemTitle } : {}),
      };
    }
    case "note": {
      // Coral text is display-only — no `name`, nothing persisted. A node
      // without `text` renders nothing in AEM either; skip it as hidden.
      const text = stringAttr(node.text);
      if (!text) {
        ctx.unmapped.push({
          name: nodeKey,
          resourceType: node["sling:resourceType"] ?? "(none)",
          reason: "hidden",
          detail: "coral text node without a `text` attribute",
        });
        return undefined;
      }
      return { ...common, type: "note", noteText: text };
    }
    case "tags":
      // AEM tagfield is always multiselect (no single-value mode), so we
      // always emit the array shape. References target the hand-authored
      // `category` document type populated by `aem-tags`. The dialog's
      // `rootPath` (e.g. `/content/cq:tags/promotion`) would let us narrow
      // the picker via a `filter` option in the Studio, but that requires
      // walking the parent chain at query time — punt to follow-up work.
      return { ...common, type: "array-of-reference", refType: "category" };
    case "hidden":
    case "container":
    case "include":
      return undefined;
  }
}

function buildPlaceholder(
  nodeKey: string,
  node: DialogNode,
  placement: Placement,
): (CommonFieldProps & PlaceholderField) | undefined {
  const name = fieldName(node) ?? toCamelCase(nodeKey);
  if (!name) return undefined;
  return {
    name,
    title:
      stringAttr(node.fieldLabel) ?? stringAttr(node["jcr:title"]) ?? name,
    description: `TODO: no Sanity mapping for AEM resource type "${node["sling:resourceType"] ?? "unknown"}". Falling back to string.`,
    group: placement.group,
    fieldset: placement.fieldset,
    type: "placeholder",
    originalResourceType: node["sling:resourceType"] ?? "unknown",
    ...(placement.showHide?.length
      ? { showHideTargets: placement.showHide }
      : {}),
  };
}

function extractSelectItems(
  node: DialogNode,
): Array<{ title: string; value: string }> {
  const items = node["items"];
  if (!items || typeof items !== "object" || Array.isArray(items)) return [];
  const out: Array<{ title: string; value: string }> = [];
  for (const [, child] of Object.entries(items as Record<string, unknown>)) {
    if (!child || typeof child !== "object" || Array.isArray(child)) continue;
    const c = child as DialogNode;
    const value = stringAttr(c.value);
    const text =
      stringAttr((c as Record<string, unknown>)["text"]) ??
      stringAttr(c["jcr:title"]) ??
      value;
    if (value !== undefined) out.push({ title: text ?? value, value });
  }
  return out;
}

/**
 * The `value` of the option item flagged `selected` (buttongroup / select
 * items mark their default that way) → Sanity `initialValue`. First match
 * wins; `undefined` when no item carries the flag.
 */
function selectedItemValue(node: DialogNode): string | undefined {
  const items = node["items"];
  if (!items || typeof items !== "object" || Array.isArray(items)) {
    return undefined;
  }
  for (const child of Object.values(items as Record<string, unknown>)) {
    if (!child || typeof child !== "object" || Array.isArray(child)) continue;
    const c = child as DialogNode;
    if (isTruthyAttr(c.selected)) {
      return stringAttr(c.value);
    }
  }
  return undefined;
}

/**
 * An AEM checkbox/switch's default state lives on the `checked` attribute —
 * NOT `value`, which is the constant persisted when the box is checked
 * (`"true"` on virtually every widget). Deriving `initialValue` from `value`
 * flipped nearly every boolean default to `true`.
 *
 * Returns `undefined` (emit no initialValue) when the default is unknowable
 * offline: `checked` absent (AEM renders unchecked and persists nothing
 * until dialog save — the Studio's unset boolean behaves the same) or a
 * Granite EL expression (`${...}`, resolved server-side against design
 * config). Literal `true`/`"true"` → `true`; literal `false`/`"false"` →
 * `false`.
 */
/**
 * A checkbox/switch persists its `value` attribute when checked and its
 * `uncheckedValue` when not. On most widgets those are `"true"` / absent —
 * which `aem-transform` already coerces — but dialogs are free to pick any
 * constant (a link-target checkbox stores `"_blank"` / `"_self"`). Return
 * the constant only when it's a custom one worth recording in the registry:
 * string, non-empty, not a boolean literal, not a Granite EL expression.
 */
function customBooleanConstant(attr: unknown): string | undefined {
  if (typeof attr !== "string") return undefined;
  const v = attr.trim();
  if (v === "" || v === "true" || v === "false" || v.includes("${")) return undefined;
  return v;
}

/**
 * A datepicker's `valueFormat` controls the string persisted to JCR. When
 * unset, AEM stores the standard ISO-8601-with-offset JCR date — but dialogs
 * frequently set a display-style pattern, which AEM then persists verbatim
 * (`valueFormat="MMM DD, yyyy"` stores `"May 23, 2024"`). Skip Granite EL
 * expressions (unresolvable offline) and empty strings.
 */
function datepickerValueFormat(node: DialogNode): string | undefined {
  const v = stringAttr(node.valueFormat);
  if (!v || !v.trim() || v.includes("${")) return undefined;
  return v.trim();
}

function checkboxDefaultChecked(node: DialogNode): boolean | undefined {
  const checked = node["checked"];
  if (typeof checked === "boolean") return checked;
  if (typeof checked === "string") {
    if (checked.includes("${")) return undefined;
    return isTruthyAttr(checked);
  }
  return undefined;
}

function graniteData(node: DialogNode): Record<string, unknown> | undefined {
  const data = node["granite:data"];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }
  return data as Record<string, unknown>;
}

/**
 * Show/hide target detection: a node whose `granite:data` carries a
 * target-value attribute is shown/hidden by a controller widget. Two
 * attribute vocabularies exist for the same mechanism:
 *
 *  - ACS Commons: `acs-dropdownshowhidetargetvalue` /
 *    `acs-checkboxshowhidetargetvalue`.
 *  - Core AEM (`cq-dialog-dropdown-showhide`): `showhidetargetvalue`
 *    (dropdown only — the value(s) of the select that show this node).
 *
 * Which controller is unknown here — the linkage is the class token shared
 * with the controller's selector, so we record the raw attributes and match
 * after the walk completes (targets can precede their controller in dialog
 * order).
 */
function showHideTargetRecord(
  node: DialogNode,
): RawShowHideTarget | undefined {
  const data = graniteData(node);
  if (!data) return undefined;
  const acsDropdownRaw = data["acs-dropdownshowhidetargetvalue"];
  const coreDropdownRaw = data["showhidetargetvalue"];
  const dropdownRaw =
    typeof acsDropdownRaw === "string"
      ? acsDropdownRaw
      : typeof coreDropdownRaw === "string"
        ? coreDropdownRaw
        : undefined;
  const checkboxRaw = data["acs-checkboxshowhidetargetvalue"];
  const hasCheckbox = typeof checkboxRaw === "string";
  if (dropdownRaw === undefined && !hasCheckbox) return undefined;
  const classAttr = stringAttr(node["granite:class"]);
  const classTokens = classAttr ? classAttr.split(/\s+/).filter(Boolean) : [];
  if (classTokens.length === 0) return undefined;
  const record: RawShowHideTarget = { classTokens };
  if (dropdownRaw !== undefined) {
    // Multiple values are space-separated; an empty attribute means the
    // target shows when the select's value is the empty string.
    const values = dropdownRaw.split(/\s+/).filter(Boolean);
    record.dropdownValues = values.length > 0 ? values : [""];
  }
  if (hasCheckbox) {
    // "true" → visible when checked; "" (ACS maps false to empty) → visible
    // when unchecked.
    record.checkboxVisibleWhenChecked = isTruthyAttr(checkboxRaw);
  }
  return record;
}

/**
 * Show/hide controller detection: a select/radio/buttongroup or
 * checkbox/switch whose `granite:data` carries a target selector drives
 * target visibility. Two attribute vocabularies exist:
 *
 *  - ACS Commons: `acs-cq-dialog-dropdown-checkbox-showhide-target`
 *    (dropdown and checkbox controllers).
 *  - Core AEM: `cq-dialog-dropdown-showhide-target` (the stock
 *    `cq-dialog-dropdown-showhide` pattern — dropdown controllers only).
 *
 * Only simple `.class` selectors are supported (the documented usage);
 * anything else is ignored and the targets stay unconditionally visible.
 */
function showHideControllerMeta(
  kind: SanityKind,
  node: DialogNode,
): ShowHideControllerMeta | undefined {
  const data = graniteData(node);
  if (!data) return undefined;
  const selector =
    data["acs-cq-dialog-dropdown-checkbox-showhide-target"] ??
    data["cq-dialog-dropdown-showhide-target"];
  if (typeof selector !== "string") return undefined;
  const match = /^\.([A-Za-z0-9_-]+)$/.exec(selector.trim());
  if (!match) return undefined;
  const controllerKind =
    kind === "boolean"
      ? ("checkbox" as const)
      : kind === "select" || kind === "radio" || kind === "buttongroup"
        ? ("dropdown" as const)
        : undefined;
  if (!controllerKind) return undefined;
  const meta: ShowHideControllerMeta = {
    selectorClass: match[1]!,
    kind: controllerKind,
  };
  if (controllerKind === "dropdown") {
    meta.defaultValue = selectedItemValue(node);
  } else if (checkboxDefaultChecked(node) === true) {
    // Only a literal checked default matters; absent or EL-expression
    // defaults are treated as unchecked (the conservative reading).
    meta.defaultChecked = true;
  }
  return meta;
}

/**
 * Match every field's raw show/hide target records against the controllers
 * in the SAME sibling scope, producing the `hiddenConditions` the emitter
 * turns into `hidden: ({ parent }) => …`. Scoping matters: the callback
 * reads the controller off `parent`, so a controller outside the field's
 * object (e.g. top-level select vs. a multifield row target) can't be
 * expressed — such records are dropped and the field stays visible, which
 * also matches ACS semantics (checkbox/select state only affects the
 * current multifield row). Recurses into array-of-object item fields as
 * their own scope. Internal linkage props are removed either way so the
 * returned field tree carries only the resolved conditions.
 */
function resolveShowHideConditions(fields: SanityField[]): void {
  const controllers = fields.filter((f) => f.showHideController);
  for (const field of fields) {
    const conditions: ShowHideCondition[] = [];
    for (const raw of field.showHideTargets ?? []) {
      for (const controller of controllers) {
        if (controller === field) continue;
        const meta = controller.showHideController!;
        if (!raw.classTokens.includes(meta.selectorClass)) continue;
        if (meta.kind === "dropdown" && raw.dropdownValues) {
          conditions.push({
            controllerField: controller.name,
            kind: "dropdown",
            values: raw.dropdownValues,
            ...(meta.defaultValue !== undefined
              ? { controllerDefault: meta.defaultValue }
              : {}),
          });
        } else if (
          meta.kind === "checkbox" &&
          raw.checkboxVisibleWhenChecked !== undefined
        ) {
          conditions.push({
            controllerField: controller.name,
            kind: "checkbox",
            visibleWhenChecked: raw.checkboxVisibleWhenChecked,
            ...(meta.defaultChecked
              ? { controllerDefaultChecked: true }
              : {}),
          });
        }
      }
    }
    if (conditions.length > 0) field.hiddenConditions = conditions;
    delete field.showHideTargets;
    if (field.type === "array-of-object") {
      resolveShowHideConditions(field.itemFields);
    }
  }
  for (const field of fields) delete field.showHideController;
}

function fieldNameForKind(
  kind: SanityKind,
  node: DialogNode,
  nodeKey: string,
): string | undefined {
  if (kind === "image" || kind === "file") {
    return persistedFileLikeFieldName(node, nodeKey);
  }
  if (kind === "multifield") {
    return multifieldArrayPropertyName(node, nodeKey);
  }
  return fieldName(node) ?? toCamelCase(nodeKey);
}

/**
 * JCR stores multifield rows under the inner `field` node's `name` (e.g.
 * `./textAsImages`), not the Granite sibling key under `items` (e.g. `images`).
 */
function multifieldArrayPropertyName(
  node: DialogNode,
  nodeKey: string,
): string | undefined {
  const field = node["field"];
  if (field && typeof field === "object" && !Array.isArray(field)) {
    const fromInner = fieldName(field as DialogNode);
    if (fromInner) return fromInner;
  }
  return fieldName(node) ?? toCamelCase(nodeKey);
}

function multifieldInnerFieldJcrTitle(node: DialogNode): string | undefined {
  const field = node["field"];
  if (!field || typeof field !== "object" || Array.isArray(field)) {
    return undefined;
  }
  return stringAttr((field as DialogNode)["jcr:title"]);
}

async function extractMultifieldItems(
  node: DialogNode,
  ctx: MappingContext,
): Promise<SanityField[]> {
  const field = node["field"];
  if (!field || typeof field !== "object" || Array.isArray(field)) return [];
  const fieldNode = field as DialogNode;
  const resourceType = fieldNode["sling:resourceType"];
  const entry = lookup(resourceType);

  if (entry?.kind === "container") {
    const inner: SanityField[] = [];
    // Walk into `items` if present, otherwise the node's direct children.
    const itemsChild = fieldNode["items"];
    if (
      itemsChild &&
      typeof itemsChild === "object" &&
      !Array.isArray(itemsChild)
    ) {
      await walk(itemsChild as DialogNode, ctx, inner, {});
    } else {
      await walk(fieldNode, ctx, inner, {});
    }
    return inner;
  }

  const singleKey = fieldName(fieldNode) ?? "value";
  if (entry) {
    const parts = await buildFieldsForKind(
      entry.kind,
      singleKey,
      fieldNode,
      {},
      ctx,
    );
    return parts;
  }
  const built = buildPlaceholder(singleKey, fieldNode, {});
  return built ? [built] : [];
}

/**
 * Title text for a well: the `text` of the first `heading` widget rendered
 * inside it, in document order (Coral or legacy foundation heading — both
 * carry the label on `text`). AEM dialogs routinely wrap the heading in a
 * structural container (uxp promocard: `well > column > heading`), so the
 * search descends through nested wrappers — but not into nested wells,
 * whose headings belong to them.
 */
function wellHeadingText(node: DialogNode): string | undefined {
  for (const { value: child } of childNodes(node)) {
    const rt = child["sling:resourceType"];
    if (typeof rt === "string" && rt.endsWith("/heading")) {
      const text = stringAttr(child["text"]);
      if (text) return text;
      continue;
    }
    if (isWellResourceType(rt)) continue;
    const nested = wellHeadingText(child);
    if (nested) return nested;
  }
  return undefined;
}

function fieldName(node: DialogNode): string | undefined {
  const raw = stringAttr(node.name);
  if (!raw) return undefined;
  const cleaned = raw.replace(/^\.\//, "").replace(/\//g, "_");
  return toCamelCase(cleaned);
}

/**
 * cq/gui authoring fileupload stores the DAM path on the property named by
 * `fileReferenceParameter` (e.g. `./fileReference`), not on `name` (`./video`).
 * Match that so schemas align with page `.infinity.json` content.
 */
function persistedFileLikeFieldName(
  node: DialogNode,
  nodeKey: string,
): string {
  const refParam = stringAttr(node.fileReferenceParameter);
  if (refParam) {
    const cleaned = refParam.replace(/^\.\//, "").replace(/\//g, "_");
    return toCamelCase(cleaned);
  }
  return fieldName(node) ?? toCamelCase(nodeKey);
}

function stringAttr(v: unknown): string | undefined {
  if (typeof v === "string" && v.length > 0) return v;
  return undefined;
}

function numberAttr(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function isImageUpload(node: DialogNode): boolean {
  const mimes = node.mimeTypes;
  const arr = Array.isArray(mimes)
    ? mimes
    : typeof mimes === "string"
      ? [mimes]
      : [];
  if (arr.length === 0) return false;
  // If the slot accepts any image mime, treat it as image — even when mixed
  // with video/* (e.g. feature-card's mediaItems). The asset linker emits
  // image refs unconditionally, so a `file`-typed field would reject them.
  // Pure-non-image uploads (e.g. video-only) still emit `file` correctly.
  return arr.some((m) => m.startsWith("image/"));
}

/**
 * Decide whether a pathfield/pathbrowser should become a Sanity `image` or a
 * `string`. Exported for unit tests.
 *
 * Rule:
 *   - `rootPath` starts with `/content/dam` → image (DAM asset picker)
 *   - last camelCase/snake/kebab word of the field name is `image`/`img` → image
 *   - otherwise → string (internal content path; future `reference`)
 *
 * Why "last word only": the earlier `/image/i` substring rule mis-routed
 * string fields like `preImageLink`, `bgImagePath`, and `imageCaptionText`
 * to Sanity `image`, silently losing the link/path/text value at transform
 * time. The last-word rule keeps the common case (`heroImage`, `desktopImage`,
 * plain `image`) while ruling out compound names where the image token is
 * a qualifier.
 */
export function isPathbrowserImage(
  node: DialogNode,
  resolvedFieldName: string,
): boolean {
  const rootPath = stringAttr(node["rootPath"]);
  if (rootPath && rootPath.startsWith("/content/dam")) return true;
  return isImageyFieldName(resolvedFieldName);
}

function isImageyFieldName(name: string): boolean {
  // Split camelCase (`heroImage` → `hero Image`), snake_case, and kebab-case
  // into lowercase tokens. The `([a-z])([A-Z])` boundary preserves ALL-CAPS
  // runs like `MobileIMAGE` as a single trailing token rather than per-char.
  const tokens = name
    .replace(/[_-]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return false;
  const last = tokens[tokens.length - 1];
  return last === "image" || last === "img";
}
