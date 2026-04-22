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
  renamed: RenamedField[];
  fetcher: NodeFetcher;
  visitedIncludes: Set<string>;
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
  | (CommonFieldProps & ArrayOfObjectField)
  | (CommonFieldProps & PlaceholderField);

export interface CommonFieldProps {
  name: string;
  title?: string;
  description?: string;
  required?: boolean;
  group?: string;
}

interface StringField {
  type: "string";
  initialValue?: string;
  /** Read-only string (e.g. migrated AEM DAM path alongside an asset field). */
  readOnly?: boolean;
  options?: {
    list?: Array<{ title: string; value: string }>;
    layout?: "radio";
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
}
interface DateField {
  type: "date" | "datetime";
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
interface ArrayOfObjectField {
  type: "array-of-object";
  itemFields: SanityField[];
  /** AEM multifield `fieldLabel` → Sanity array member `title` (repeating row). */
  itemTitle?: string;
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

export async function mapDialog(
  root: DialogNode,
  fetcher: NodeFetcher,
): Promise<{
  fields: SanityField[];
  unmapped: UnmappedField[];
  groups: Array<{ name: string; title: string }>;
  renamed: RenamedField[];
}> {
  const ctx: MappingContext = {
    unmapped: [],
    groups: [],
    renamed: [],
    fetcher,
    visitedIncludes: new Set(),
  };
  const fields: SanityField[] = [];
  await walk(root, ctx, fields, undefined);
  dedupeFieldNames(fields, ctx.renamed);
  return {
    fields,
    unmapped: ctx.unmapped,
    groups: ctx.groups,
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
  currentGroup: string | undefined,
): Promise<void> {
  for (const { key, value: child } of childNodes(node)) {
    const resourceType = child["sling:resourceType"];
    const entry = lookup(resourceType);

    // Transparent `items` wrapper — AEM often uses literal `items` nodes to
    // group children; they have no resourceType. Walk through them.
    if (!entry && !resourceType && key === "items") {
      await walk(child, ctx, out, currentGroup);
      continue;
    }

    if (!entry) {
      const placeholder = buildPlaceholder(key, child, currentGroup);
      if (placeholder) {
        out.push(placeholder);
        ctx.unmapped.push({
          name: placeholder.name,
          resourceType: resourceType ?? "(none)",
          reason: "unknown-type",
        });
      }
      continue;
    }

    if (entry.kind === "hidden") {
      ctx.unmapped.push({
        name: fieldName(child) ?? key,
        resourceType: resourceType ?? "(none)",
        reason: "hidden",
      });
      continue;
    }

    if (entry.kind === "include") {
      await resolveInclude(child, ctx, out, currentGroup);
      continue;
    }

    if (entry.kind === "container") {
      let groupForChildren = currentGroup;
      const title = child["jcr:title"];
      if (title && typeof title === "string") {
        const groupName = toCamelCase(title);
        if (!ctx.groups.find((g) => g.name === groupName)) {
          ctx.groups.push({ name: groupName, title });
        }
        groupForChildren = groupName;
      }
      const itemsChild = child["items"];
      if (
        itemsChild &&
        typeof itemsChild === "object" &&
        !Array.isArray(itemsChild)
      ) {
        await walk(itemsChild as DialogNode, ctx, out, groupForChildren);
      } else {
        await walk(child, ctx, out, groupForChildren);
      }
      continue;
    }

    const builtList = await buildFieldsForKind(
      entry.kind,
      key,
      child,
      currentGroup,
      ctx,
    );
    for (const built of builtList) {
      if (built) out.push(built);
    }
  }
}

async function resolveInclude(
  includeNode: DialogNode,
  ctx: MappingContext,
  out: SanityField[],
  currentGroup: string | undefined,
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
  // The fetched node is itself a dialog fragment — walk its children into the
  // current output, preserving the current group.
  await walk(included, ctx, out, currentGroup);
}

/** Suffix for read-only DAM path string paired with `fileReference`-style asset fields. */
export const AEM_FILE_UPLOAD_PATH_FIELD_SUFFIX = "AemPath";

async function buildFieldsForKind(
  kind: SanityKind,
  nodeKey: string,
  node: DialogNode,
  group: string | undefined,
  ctx: MappingContext,
): Promise<SanityField[]> {
  if (kind === "file" && stringAttr(node.fileReferenceParameter)) {
    return buildFileUploadFieldPair(nodeKey, node, group, ctx);
  }
  const one = await buildField(kind, nodeKey, node, group, ctx);
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
  group: string | undefined,
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
  const pathField: SanityField = {
    name: pathName,
    title: `${label} (AEM DAM path)`,
    description:
      "Original AEM path from migration (read-only). Use the Sanity asset field below for previews and delivery.",
    required: false,
    group,
    type: "string",
    readOnly: true,
  };
  const assetField: SanityField = {
    name: assetName,
    title: label,
    description: stringAttr(node.fieldDescription),
    required: isTruthyAttr(node.required) || undefined,
    group,
    type: isImageUpload(node) ? "image" : "file",
  } as SanityField;
  return [pathField, assetField];
}

async function buildField(
  kind: SanityKind,
  nodeKey: string,
  node: DialogNode,
  group: string | undefined,
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
    group,
  };

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
    case "boolean":
      return {
        ...common,
        type: "boolean",
        initialValue:
          typeof node.value === "boolean"
            ? node.value
            : isTruthyAttr(node.value),
      };
    case "date":
      return {
        ...common,
        type: stringAttr(node.type) === "datetime" ? "datetime" : "date",
      };
    case "datetime":
      return { ...common, type: "datetime" };
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
    case "image":
      return { ...common, type: "image" };
    case "file":
      return {
        ...common,
        type: isImageUpload(node) ? "image" : "file",
      } as SanityField;
    case "pathfield":
      return { ...common, type: "string" };
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
    case "hidden":
    case "container":
    case "include":
      return undefined;
  }
}

function buildPlaceholder(
  nodeKey: string,
  node: DialogNode,
  group: string | undefined,
): (CommonFieldProps & PlaceholderField) | undefined {
  const name = fieldName(node) ?? toCamelCase(nodeKey);
  if (!name) return undefined;
  return {
    name,
    title:
      stringAttr(node.fieldLabel) ?? stringAttr(node["jcr:title"]) ?? name,
    description: `TODO: no Sanity mapping for AEM resource type "${node["sling:resourceType"] ?? "unknown"}". Falling back to string.`,
    group,
    type: "placeholder",
    originalResourceType: node["sling:resourceType"] ?? "unknown",
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
      await walk(itemsChild as DialogNode, ctx, inner, undefined);
    } else {
      await walk(fieldNode, ctx, inner, undefined);
    }
    return inner;
  }

  const singleKey = fieldName(fieldNode) ?? "value";
  if (entry) {
    const parts = await buildFieldsForKind(
      entry.kind,
      singleKey,
      fieldNode,
      undefined,
      ctx,
    );
    return parts;
  }
  const built = buildPlaceholder(singleKey, fieldNode, undefined);
  return built ? [built] : [];
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
  return arr.every((m) => m.startsWith("image/"));
}
