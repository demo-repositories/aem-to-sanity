import type { Logger } from "../logger.ts";
import { fetchInfinityJson, type FetchDeps } from "./fetcher.ts";

/**
 * Generic JCR content tree node. Property values can be scalars, arrays of
 * scalars, or other nodes (recursively). AEM serializes truncated descendants
 * as absolute-path strings — when present in the tree post-resolution they
 * are replaced with either the resolved subtree or a
 * {@link TruncationFailureMarker}.
 */
export interface ContentNode {
  [key: string]: unknown;
}

/**
 * Emitted into the resolved tree in place of a truncation marker when the
 * follow-up fetch failed. The extractor treats this as opaque (it's not a
 * child node) and lets the audit step surface it.
 */
export interface TruncationFailureMarker {
  __truncated: true;
  path: string;
  error: string;
}

export interface FetchContentTreeOptions {
  /** Max rounds of follow-up fetches before we give up expanding further. */
  maxDepthExpansions?: number;
  /** Concurrent follow-ups per round. */
  concurrency?: number;
  /** Notified for every follow-up fetch actually issued. */
  onFollowUp?: (path: string, depth: number) => void;
  /** Optional abort signal — honoured between rounds, not mid-fetch. */
  signal?: AbortSignal;
  logger?: Logger;
}

/**
 * Fetch a JCR subtree at `rootPath` via `.infinity.json`, then transparently
 * resolve every depth-truncation marker by issuing follow-up fetches. The
 * result is a single ContentNode tree that callers can walk without thinking
 * about AEM's depth cap.
 *
 * Cycle guard: resolved-path set — if a follow-up would re-enter an already-
 * resolved ancestor, it's skipped and replaced with a failure marker.
 * Batching: follow-ups are collected per round and dispatched in parallel
 * (bounded by `concurrency`); each round replaces *only* markers that were
 * visible in the current tree, so newly uncovered deeper markers get a fresh
 * round. We cap at `maxDepthExpansions` rounds to bound the worst case.
 */
export async function fetchContentTree(
  deps: FetchDeps,
  rootPath: string,
  opts: FetchContentTreeOptions = {},
): Promise<ContentNode> {
  const maxRounds = opts.maxDepthExpansions ?? 6;
  const concurrency = opts.concurrency ?? 4;
  const logger = opts.logger ?? deps.logger;

  const root = await fetchInfinityJson<ContentNode>(deps, rootPath);
  const resolved = new Set<string>([rootPath]);

  for (let round = 0; round < maxRounds; round++) {
    if (opts.signal?.aborted) throw new Error("fetchContentTree: aborted");

    const markers = detectTruncations(root, rootPath).filter(
      (p) => !resolved.has(p),
    );
    if (markers.length === 0) break;

    logger?.debug(
      `fetchContentTree: round ${round + 1}, ${markers.length} follow-ups`,
    );

    const results = new Map<string, ContentNode | TruncationFailureMarker>();
    await runWithConcurrency(markers, concurrency, async (path) => {
      opts.onFollowUp?.(path, round);
      try {
        const sub = await fetchInfinityJson<ContentNode>(deps, path);
        results.set(path, sub);
      } catch (err) {
        results.set(path, {
          __truncated: true,
          path,
          error: (err as Error).message,
        });
      }
      resolved.add(path);
    });

    spliceResolved(root, rootPath, results);
  }

  return root;
}

/**
 * Walks a node tree and returns the absolute paths of every unresolved
 * truncation marker found. Markers appear as:
 *
 *   1. A string property value that looks like an AEM JCR path at a position
 *      where a child node is expected (the common case).
 *   2. A child node that looks "suspiciously empty" — literally `{}` or
 *      containing only `jcr:primaryType` — when its siblings carry content.
 *      This is rarer but real; ignoring it loses data silently.
 */
export function detectTruncations(
  node: unknown,
  basePath: string,
): string[] {
  const out: string[] = [];
  walkForTruncations(node, basePath, out);
  return out;
}

function walkForTruncations(
  node: unknown,
  basePath: string,
  out: string[],
): void {
  if (!isPlainObject(node)) return;

  const siblingsHaveContent = anyChildCarriesProperties(node);

  for (const [key, value] of Object.entries(node)) {
    const childPath = `${basePath}/${key}`;
    if (isStringMarker(value)) {
      out.push(value as string);
      continue;
    }
    if (isPlainObject(value)) {
      if (siblingsHaveContent && isSuspiciouslyEmpty(value)) {
        out.push(childPath);
        continue;
      }
      walkForTruncations(value, childPath, out);
    }
  }
}

/**
 * A value is a truncation marker when it's a string that points at an AEM
 * well-known tree root. False positives here just cost a wasted fetch —
 * false negatives lose data — so the default is permissive but anchored.
 */
export function isTruncationMarker(
  value: unknown,
  _expectedAt?: string,
): boolean {
  return isStringMarker(value);
}

const AEM_ROOTS = ["/content/", "/apps/", "/conf/", "/etc/", "/var/", "/libs/"];

function isStringMarker(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return AEM_ROOTS.some((r) => value.startsWith(r));
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

/**
 * Splice resolved subtrees back into the root tree, replacing each marker
 * position with the fetched node (or a failure marker). Paths are absolute,
 * so we re-derive the path for every node visited and match exactly.
 */
function spliceResolved(
  node: ContentNode,
  basePath: string,
  resolved: Map<string, ContentNode | TruncationFailureMarker>,
): void {
  for (const [key, value] of Object.entries(node)) {
    const childPath = `${basePath}/${key}`;

    if (isStringMarker(value)) {
      const fetched = resolved.get(value as string);
      if (fetched !== undefined) node[key] = fetched;
      continue;
    }

    if (isPlainObject(value)) {
      const fetched = resolved.get(childPath);
      if (fetched !== undefined) {
        node[key] = fetched;
        // Continue recursing into the *new* subtree so further markers it
        // exposes are addressable in subsequent rounds.
        if (isPlainObject(fetched)) {
          spliceResolved(fetched, childPath, resolved);
        }
        continue;
      }
      spliceResolved(value, childPath, resolved);
    }
  }
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers: Promise<void>[] = [];
  const width = Math.max(1, Math.min(limit, items.length));

  for (let i = 0; i < width; i++) {
    workers.push(
      (async () => {
        while (cursor < items.length) {
          const idx = cursor++;
          const item = items[idx];
          if (item === undefined) continue;
          await task(item);
        }
      })(),
    );
  }
  await Promise.all(workers);
}
