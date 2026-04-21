import { z } from "zod";

/**
 * Granite UI dialog nodes in JSON form (what `.infinity.json` returns when the
 * target is a `cq:dialog`-rooted resource). Keys follow JCR naming
 * (`sling:resourceType`, `jcr:title`, etc.). Children are nested objects keyed
 * by child node name.
 *
 * We keep this lenient: AEM exposes many attributes we don't care about;
 * `.catchall()` preserves them so container nodes can still be walked without
 * losing children.
 */
export const DialogNodeSchema: z.ZodType<DialogNode> = z.lazy(() =>
  z
    .object({
      "sling:resourceType": z.string().optional(),
      "jcr:primaryType": z.string().optional(),
      "jcr:title": z.string().optional(),
      fieldLabel: z.string().optional(),
      fieldDescription: z.string().optional(),
      name: z.string().optional(),
      required: z.union([z.boolean(), z.string()]).optional(),
      value: z.unknown().optional(),
      defaultValue: z.unknown().optional(),
      emptyText: z.string().optional(),
      min: z.union([z.number(), z.string()]).optional(),
      max: z.union([z.number(), z.string()]).optional(),
      rows: z.union([z.number(), z.string()]).optional(),
      type: z.string().optional(),
      displayedType: z.string().optional(),
      mimeTypes: z.union([z.string(), z.array(z.string())]).optional(),
      fileNameParameter: z.string().optional(),
      fileReferenceParameter: z.string().optional(),
    })
    .catchall(z.unknown()),
);

export interface DialogNode {
  "sling:resourceType"?: string;
  "jcr:primaryType"?: string;
  "jcr:title"?: string;
  fieldLabel?: string;
  fieldDescription?: string;
  name?: string;
  required?: boolean | string;
  value?: unknown;
  defaultValue?: unknown;
  emptyText?: string;
  min?: number | string;
  max?: number | string;
  rows?: number | string;
  type?: string;
  displayedType?: string;
  mimeTypes?: string | string[];
  fileNameParameter?: string;
  fileReferenceParameter?: string;
  [k: string]: unknown;
}

/**
 * Direct child dialog nodes of a given node, in their declared order. A "child
 * node" is any property whose value is a plain object. Attributes beginning
 * with `jcr:` or `sling:` that happen to be objects are excluded defensively.
 */
export function childNodes(
  node: DialogNode,
): Array<{ key: string; value: DialogNode }> {
  const out: Array<{ key: string; value: DialogNode }> = [];
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("jcr:") || key.startsWith("sling:")) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out.push({ key, value: value as DialogNode });
    }
  }
  return out;
}

export function isTruthyAttr(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === "string")
    return v.toLowerCase() === "true" || v === "{Boolean}true";
  return false;
}
