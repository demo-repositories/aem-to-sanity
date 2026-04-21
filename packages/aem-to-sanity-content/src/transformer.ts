import type { AemContentNode, SanityDoc } from "./types.ts";
import { pathToDocId } from "./id-strategy.ts";
import { stableKey } from "./key-strategy.ts";
import type { SchemaTypeRegistry } from "./type-registry.ts";

/**
 * JCR properties that only describe the node's JCR identity / housekeeping
 * and should NEVER land on a Sanity doc. Everything else is considered
 * content and copied as-is in v1. Step 7's audit is what flags "copied as-is
 * but the schema doesn't actually have this field" — the transformer stays
 * intentionally permissive so we don't drop data silently.
 */
const JCR_METADATA_PROPS = new Set<string>([
  "jcr:primaryType",
  "jcr:mixinTypes",
  "jcr:uuid",
  "jcr:created",
  "jcr:createdBy",
  "jcr:lastModified",
  "jcr:lastModifiedBy",
  "cq:lastModified",
  "cq:lastModifiedBy",
  "cq:lastReplicated",
  "cq:lastReplicatedBy",
  "cq:lastReplicationAction",
  "sling:resourceType",
  "sling:resourceSuperType",
]);

export interface TransformOptions {
  /** Absolute JCR path of the node being transformed. */
  jcrPath: string;
  /** Registry that maps AEM resource types to Sanity schema types. */
  registry: SchemaTypeRegistry;
}

export interface TransformResult {
  doc: SanityDoc;
  /** Sanity schema type we mapped to, or `undefined` if unmappable. */
  type: string | undefined;
  /** AEM resource type we read off the node, if any. */
  resourceType: string | undefined;
}

/**
 * Turn an AEM node into a Sanity doc with `_id`, `_type`, and copied
 * properties. Nested child nodes are converted into inline objects with a
 * stable `_key` — we do NOT emit references for them in v1, matching how the
 * schema package currently inlines container components.
 */
export function transformNode(
  node: AemContentNode,
  opts: TransformOptions,
): TransformResult {
  const resourceType = asString(node["sling:resourceType"]);
  const meta = resourceType ? opts.registry.lookup(resourceType) : undefined;
  const type = meta?.sanityType;

  const doc: SanityDoc = {
    _id: pathToDocId(opts.jcrPath),
    _type: type ?? "aemUnmapped",
  };

  for (const [key, value] of Object.entries(node)) {
    if (JCR_METADATA_PROPS.has(key)) continue;
    if (isChildNode(value)) {
      doc[key] = transformChild(value, `${opts.jcrPath}/${key}`, opts);
    } else {
      doc[key] = value;
    }
  }

  return { doc, type, resourceType };
}

/**
 * A child AEM node becomes an inline Sanity object. We recurse, but drop the
 * `_id` (only the root doc carries one) and add `_key` so Sanity arrays and
 * nested objects stay stable across re-runs.
 */
function transformChild(
  node: AemContentNode,
  jcrPath: string,
  opts: TransformOptions,
): Record<string, unknown> {
  const { doc } = transformNode(node, { ...opts, jcrPath });
  const { _id, ...inline } = doc;
  void _id;
  return {
    ...inline,
    _key: stableKey({ jcrUuid: asString(node["jcr:uuid"]), jcrPath }),
  };
}

function isChildNode(value: unknown): value is AemContentNode {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    // AEM depth-truncation markers come back as strings — not nodes. When
    // Step 6 lands, the fetcher resolves those before the transformer runs.
    !(value as { __truncated?: boolean }).__truncated
  );
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
