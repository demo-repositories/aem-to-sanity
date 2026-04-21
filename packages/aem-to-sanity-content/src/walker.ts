import type { AemContentNode } from "./types.ts";

export interface WalkEntry {
  /** Absolute JCR path of this node. */
  jcrPath: string;
  /** The node itself. */
  node: AemContentNode;
  /** Depth from the walk root (root = 0). */
  depth: number;
}

/**
 * Depth-first walk of a content tree, yielding every node with a
 * `sling:resourceType` property. The walker intentionally does NOT yield
 * nodes without a resource type — they're structural containers (like
 * `jcr:content`, policy nodes, etc.) whose properties bubble up to the
 * transformer when the parent is emitted.
 *
 * Cycle guard: we track visited paths and refuse to re-enter — the AEM JCR
 * should be acyclic, but a malformed `.infinity.json` (or, once Step 6 lands,
 * a follow-up that resolves back to an ancestor) could loop.
 */
export function* walk(
  root: AemContentNode,
  rootPath: string,
): Generator<WalkEntry> {
  const visited = new Set<string>();
  yield* walkInner(root, rootPath, 0, visited);
}

function* walkInner(
  node: AemContentNode,
  jcrPath: string,
  depth: number,
  visited: Set<string>,
): Generator<WalkEntry> {
  if (visited.has(jcrPath)) return;
  visited.add(jcrPath);

  if (typeof node["sling:resourceType"] === "string") {
    yield { jcrPath, node, depth };
  }

  for (const [key, value] of Object.entries(node)) {
    if (isChildNode(value)) {
      yield* walkInner(value, `${jcrPath}/${key}`, depth + 1, visited);
    }
  }
}

function isChildNode(value: unknown): value is AemContentNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
