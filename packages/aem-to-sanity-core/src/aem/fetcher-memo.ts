import { AemFetchError } from "./fetcher.ts";
import type { DialogNode } from "./dialog-types.ts";

/**
 * Per-run in-memory memoization for a JCR-path fetcher.
 *
 * Dialog resolution walks the full `sling:resourceSuperType` chain, and every
 * proxy component in a site tends to share the same `/libs/core/wcm/...`
 * ancestors — without memoization each component re-fetches them. Cache
 * successes AND 404s (a missing node stays missing for the run); transient
 * failures (auth, network, 5xx) are evicted so a retry can succeed.
 *
 * The cache holds promises, so concurrent callers of the same path share one
 * in-flight request.
 */
export function memoizeFetcher(
  fetcher: (jcrPath: string) => Promise<DialogNode>,
): (jcrPath: string) => Promise<DialogNode> {
  const cache = new Map<string, Promise<DialogNode>>();
  return (jcrPath: string) => {
    const hit = cache.get(jcrPath);
    if (hit) return hit;
    const pending = fetcher(jcrPath).catch((err: unknown) => {
      const cacheable =
        err instanceof AemFetchError && err.details?.status === 404;
      if (!cacheable) cache.delete(jcrPath);
      throw err;
    });
    cache.set(jcrPath, pending);
    return pending;
  };
}
