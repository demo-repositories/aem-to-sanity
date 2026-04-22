/**
 * Generic JCR content tree node. Property values can be scalars, arrays of
 * scalars, or other nodes (recursively). AEM serializes truncated descendants
 * as absolute-path strings — callers detect these with {@link detectTruncations}
 * and either fetch the missing subtree (download phase) or treat them as
 * truncated (process phase, if the fragment isn't on disk).
 */
export interface ContentNode {
  [key: string]: unknown;
}

/**
 * Sentinel that stands in for a subtree we could not resolve. Callers that
 * walk trees treat this as opaque — not a child node.
 */
export interface TruncationFailureMarker {
  __truncated: true;
  path: string;
  error: string;
}

/**
 * Walk a node tree and return the absolute paths of every unresolved
 * truncation marker. Markers appear as:
 *
 *   1. A string property value equal to the absolute path of what-would-be the
 *      child node at that position (AEM's depth cap — always a descendant of
 *      the parent path).
 *   2. A child node that is suspiciously empty (`{}` or only `jcr:primaryType`)
 *      when its siblings carry content. Rare but real; ignoring it loses data.
 *
 * Iterative to stay stack-safe on deep AEM pages.
 */
export function detectTruncations(node: unknown, basePath: string): string[] {
  const out: string[] = [];
  if (!isPlainObject(node)) return out;
  const stack: Array<{ node: ContentNode; basePath: string }> = [
    { node, basePath },
  ];

  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) continue;
    const siblingsHaveContent = anyChildCarriesProperties(frame.node);

    for (const [key, value] of Object.entries(frame.node)) {
      const childPath = `${frame.basePath}/${key}`;
      if (isStringMarker(value, frame.basePath)) {
        out.push(value);
        continue;
      }
      if (isPlainObject(value)) {
        if (siblingsHaveContent && isSuspiciouslyEmpty(value)) {
          out.push(childPath);
          continue;
        }
        stack.push({ node: value, basePath: childPath });
      }
    }
  }
  return out;
}

/**
 * True when `value` is a string that looks like an AEM truncation marker at
 * `parentPath`. Truncation markers are always absolute JCR paths that sit
 * *below* the parent — cross-tree links (e.g. `fileReference` pointing into
 * `/content/dam/...`) are not truncation and must not be refetched.
 */
export function isTruncationMarker(
  value: unknown,
  parentPath?: string,
): value is string {
  return isStringMarker(value, parentPath);
}

function isStringMarker(value: unknown, parentPath?: string): value is string {
  if (typeof value !== "string") return false;
  if (!value.startsWith("/")) return false;
  if (parentPath) return value.startsWith(`${parentPath}/`);
  // Back-compat unchecked path: any absolute JCR-ish path. Use the
  // parent-aware form in new callers.
  return (
    value.startsWith("/content/") ||
    value.startsWith("/apps/") ||
    value.startsWith("/conf/") ||
    value.startsWith("/etc/") ||
    value.startsWith("/var/") ||
    value.startsWith("/libs/")
  );
}

function isPlainObject(value: unknown): value is ContentNode {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { __truncated?: unknown }).__truncated !== true
  );
}

function isSuspiciouslyEmpty(node: ContentNode): boolean {
  const keys = Object.keys(node);
  if (keys.length === 0) return true;
  if (keys.length === 1 && keys[0] === "jcr:primaryType") return true;
  return false;
}

function anyChildCarriesProperties(node: ContentNode): boolean {
  for (const value of Object.values(node)) {
    if (isPlainObject(value)) {
      const keys = Object.keys(value);
      if (keys.length > 1) return true;
    }
  }
  return false;
}
