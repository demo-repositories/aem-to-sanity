import { createHash } from "node:crypto";

/**
 * Derive a stable `_key` for a Sanity array item.
 *
 * Sanity requires every array item to carry a unique `_key`; that key drives
 * patch targeting, so if it changes across re-runs the next migration produces
 * churn instead of updates. We never key by array index — that's how you end
 * up with silent data corruption when AEM reorders children.
 *
 * Preference order:
 *   1. `jcr:uuid` when present (AEM-stable identity).
 *   2. SHA1 of the node's absolute JCR path (stable as long as the path is).
 */
export function stableKey(opts: {
  jcrUuid?: string;
  jcrPath: string;
}): string {
  if (opts.jcrUuid && opts.jcrUuid.length > 0) {
    return opts.jcrUuid.replace(/-/g, "").slice(0, 16);
  }
  return createHash("sha1").update(opts.jcrPath).digest("hex").slice(0, 16);
}
