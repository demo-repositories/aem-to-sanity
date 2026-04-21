import type { FetchDeps, Logger } from "aem-to-sanity-core";
import { fetchContentTree } from "aem-to-sanity-core";
import type { AemContentNode, ExtractedDoc } from "./types.ts";
import { walk } from "./walker.ts";
import { transformNode } from "./transformer.ts";
import type { SchemaTypeRegistry } from "./type-registry.ts";

export interface ExtractOptions {
  /** AEM JCR paths to walk (e.g. `["/content/site/us/en"]`). */
  rootPaths: string[];
  /** Type registry used by the transformer to resolve `_type`. */
  registry: SchemaTypeRegistry;
  /**
   * When set, nodes whose `sling:resourceType` is not in this allow-list are
   * skipped. Defaults to every type the registry knows about.
   */
  includeResourceTypes?: string[];
  /** Max rounds of follow-up fetches for depth-truncated AEM subtrees. */
  maxDepthExpansions?: number;
  /** Concurrency for depth follow-ups per round. */
  concurrency?: number;
  /** Notified for every follow-up fetch triggered by depth truncation. */
  onFollowUp?: (path: string, depth: number) => void;
  /**
   * Called for nodes whose `sling:resourceType` is present but not in the
   * registry. The extractor still skips them, but the callback lets the
   * audit layer record drift against the mapping.
   */
  onUnmapped?: (resourceType: string, jcrPath: string) => void;
  logger?: Logger;
}

/**
 * Async-iterable content extractor. Yields one `ExtractedDoc` per AEM node
 * with a recognized `sling:resourceType`. The caller decides what to do with
 * each doc (dry-run log, write to Sanity, audit, …) — keeping this as a
 * streaming source means a full-site migration doesn't buffer everything in
 * memory.
 *
 * Depth-5 truncation is NOT handled here yet. Step 6 adds a resolver inside
 * `aem-to-sanity-core` that replaces path-string markers with resolved
 * subtrees; this extractor will then consume those resolved trees unchanged.
 */
export async function* extract(
  deps: FetchDeps,
  opts: ExtractOptions,
): AsyncIterable<ExtractedDoc> {
  const { rootPaths, registry, logger } = opts;
  const allowed = opts.includeResourceTypes
    ? new Set(opts.includeResourceTypes)
    : undefined;

  for (const rootPath of rootPaths) {
    logger?.info(`extract: fetching ${rootPath}.infinity.json`);
    const root = (await fetchContentTree(deps, rootPath, {
      maxDepthExpansions: opts.maxDepthExpansions,
      concurrency: opts.concurrency,
      onFollowUp: opts.onFollowUp,
      logger,
    })) as AemContentNode;

    for (const entry of walk(root, rootPath)) {
      const resourceType = entry.node["sling:resourceType"];
      if (typeof resourceType !== "string") continue;
      if (allowed && !allowed.has(resourceType)) continue;

      const { doc, type } = transformNode(entry.node, {
        jcrPath: entry.jcrPath,
        registry,
      });
      if (!type) {
        logger?.debug(
          `extract: skipping ${entry.jcrPath} — unmapped resource type ${resourceType}`,
        );
        opts.onUnmapped?.(resourceType, entry.jcrPath);
        continue;
      }
      yield {
        type,
        jcrPath: entry.jcrPath,
        raw: entry.node,
        doc,
      };
    }
  }
}
