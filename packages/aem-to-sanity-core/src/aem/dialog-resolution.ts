import { AemFetchError } from "./fetcher.ts";
import type { DialogNode } from "./dialog-types.ts";
import { mergeDialogs } from "./dialog-merge.ts";

/**
 * Resolve a component's Granite UI dialog by walking the FULL
 * `sling:resourceSuperType` chain and merging every `cq:dialog` found along
 * it with Sling Resource Merger semantics (see dialog-merge.ts).
 *
 * This mirrors AEM's runtime dialog-resolution through `/mnt/override`: the
 * dialog an author sees is the child dialog overlaid on its ancestors', so a
 * tab defined only in an ancestor (e.g. Core Components' Properties tab on a
 * `title` proxy) still renders even when the derived component's dialog only
 * declares its own additions. First-hit-wins resolution would silently drop
 * those inherited tabs.
 *
 * Resolution rules:
 *
 *  1. At each hop, try `${current}/_cq_dialog.infinity.json`. A hit is
 *     collected (not returned); a 404 just means "no dialog at this level".
 *  2. Read `sling:resourceSuperType` from `${current}.infinity.json`.
 *     Absent → chain ends. If at least one dialog was collected, merge and
 *     return; otherwise the component is genuinely dialogless → throw.
 *  3. Resolve the supertype:
 *       - Absolute paths (`/apps/...`, `/libs/...`) → used as-is.
 *       - Relative resource types (`<namespace>/components/...`) →
 *         AEM's lookup order is `/apps/<rt>` first, then `/libs/<rt>`.
 *  4. Recurse, guarding against cycles and capping the hop count.
 *
 * Error policy: any failure BEFORE the first dialog is found (dead end,
 * cycle, hop cap, unresolvable supertype, non-404 fetch error) throws — the
 * component can't be migrated. The same failure AFTER at least one dialog
 * was collected degrades gracefully: the walk stops, a warning is recorded
 * (and forwarded to `onWarning`), and whatever was collected is merged. A
 * broken ancestor should cost the inherited fields, not the component.
 *
 * The injected `fetcher` is the same shape `aem-to-sanity-schema` already
 * uses (`(jcrPath) => Promise<DialogNode>`), so this helper plugs in without
 * a new transport.
 */

export interface DialogResolution {
  /**
   * The merged Granite UI dialog. When only one chain entry supplied a
   * dialog this is that dialog verbatim (same reference — merging is
   * identity for a single source).
   */
  dialog: DialogNode;
  /** Nearest (most-derived) JCR path that supplied a dialog. */
  resolvedPath: string;
  /**
   * The full supertype walk. First entry is the originally-requested path.
   * The walk continues past the first dialog hit, so the chain may extend
   * beyond `resolvedPath`.
   */
  chain: string[];
  /** Chain entries that supplied a dialog, most-derived first. */
  contributingPaths: string[];
  /** Degradation notes from mid-chain failures (also sent to `onWarning`). */
  warnings: string[];
}

export interface ResolveDialogOptions {
  /** Cap on supertype hops. Default 10. */
  maxHops?: number;
  /**
   * Pre-fetched leaf dialog — a component node's embedded `cq:dialog`.
   * Seeds the walk: `componentPath` is treated as contributing without
   * fetching `${componentPath}/_cq_dialog`, and `superType` (when provided;
   * `null` = known absent) skips re-fetching the component node the caller
   * already has in hand.
   */
  seed?: { dialog: DialogNode; superType?: string | null };
  /** Receives each degradation warning as it happens. */
  onWarning?: (message: string) => void;
}

const DEFAULT_MAX_HOPS = 10;

export async function resolveDialogViaSuperType(
  componentPath: string,
  fetcher: (jcrPath: string) => Promise<DialogNode>,
  opts: ResolveDialogOptions = {},
): Promise<DialogResolution> {
  const maxHops = opts.maxHops ?? DEFAULT_MAX_HOPS;
  const visited = new Set<string>();
  const chain: string[] = [];
  const collected: Array<{ path: string; dialog: DialogNode }> = [];
  const warnings: string[] = [];
  let current: string | undefined = componentPath;

  /**
   * Mid-chain failure: throw when nothing was collected yet (component is
   * unmigrate-able), degrade to "merge what we have" otherwise. Returns true
   * when the caller should stop walking.
   */
  const degradeOrThrow = (makeError: () => Error): true => {
    if (collected.length === 0) throw makeError();
    const message = `supertype walk stopped early — inherited dialog fields beyond ${
      collected[collected.length - 1]!.path
    } may be missing: ${makeError().message}`;
    warnings.push(message);
    opts.onWarning?.(message);
    return true;
  };

  walk: for (let hop = 0; hop < maxHops && current; hop++) {
    if (visited.has(current)) {
      degradeOrThrow(
        () =>
          new Error(
            `Cycle in sling:resourceSuperType chain at ${current}. Chain: ${chain.join(" → ")}`,
          ),
      );
      break walk;
    }
    visited.add(current);
    chain.push(current);

    // Dialog at this level? Seed covers hop 0 when the caller already has
    // the leaf's embedded cq:dialog in hand.
    if (hop === 0 && opts.seed) {
      collected.push({ path: current, dialog: opts.seed.dialog });
    } else {
      try {
        const dialog = await fetcher(`${current}/_cq_dialog`);
        collected.push({ path: current, dialog });
      } catch (err) {
        if (!isNotFound(err)) {
          degradeOrThrow(() => err as Error);
          break walk;
        }
        // 404 — no dialog at this level; keep walking the chain.
      }
    }

    // Find the next hop.
    let supertype: string | undefined;
    if (hop === 0 && opts.seed && opts.seed.superType !== undefined) {
      supertype = opts.seed.superType ?? undefined;
    } else {
      try {
        supertype = await readResourceSuperType(current, fetcher);
      } catch (err) {
        degradeOrThrow(() => err as Error);
        break walk;
      }
    }
    if (!supertype) {
      if (collected.length > 0) break walk; // normal chain end
      throw new Error(
        `No \`cq:dialog\` at ${current} and no \`sling:resourceSuperType\` to follow. ` +
          `Chain walked: ${chain.join(" → ")}`,
      );
    }

    let resolved: string | undefined;
    try {
      resolved = await resolveSuperTypePath(supertype, fetcher);
    } catch (err) {
      degradeOrThrow(() => err as Error);
      break walk;
    }
    if (!resolved) {
      degradeOrThrow(
        () =>
          new Error(
            `Found \`sling:resourceSuperType="${supertype}"\` at ${current} but couldn't ` +
              `resolve it under /apps/ or /libs/. Chain walked: ${chain.join(" → ")}`,
          ),
      );
      break walk;
    }
    current = resolved;

    if (hop === maxHops - 1) {
      degradeOrThrow(
        () =>
          new Error(
            `Aborting after ${maxHops} supertype hops without finding a dialog. ` +
              `Chain: ${chain.join(" → ")}`,
          ),
      );
      break walk;
    }
  }

  if (collected.length === 0) {
    // Only reachable when the hop budget ran out before any dialog surfaced
    // (all other empty-handed exits throw inline above).
    throw new Error(
      `Aborting after ${maxHops} supertype hops without finding a dialog. ` +
        `Chain: ${chain.join(" → ")}`,
    );
  }

  return {
    dialog: mergeDialogs(
      collected.map((c) => c.dialog),
      { onWarning: opts.onWarning },
    ),
    resolvedPath: collected[0]!.path,
    chain,
    contributingPaths: collected.map((c) => c.path),
    warnings,
  };
}

/**
 * Read `sling:resourceSuperType` from a component node's `.infinity.json`.
 * Returns undefined if the component itself 404s or has no supertype
 * declared. Non-404 errors propagate.
 */
async function readResourceSuperType(
  componentPath: string,
  fetcher: (jcrPath: string) => Promise<DialogNode>,
): Promise<string | undefined> {
  let node: DialogNode;
  try {
    node = await fetcher(componentPath);
  } catch (err) {
    if (isNotFound(err)) return undefined;
    throw err;
  }
  const v = node["sling:resourceSuperType"];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Resolve a `sling:resourceSuperType` value to an absolute JCR path.
 *
 * Absolute paths (starting with `/`) are returned as-is after a HEAD-like
 * existence check. Relative resource types follow AEM's lookup order:
 * `/apps/<rt>` first (project + AMS overrides take precedence), `/libs/<rt>`
 * second (Adobe defaults).
 *
 * Returns undefined when neither candidate exists — the chain dead-ends.
 */
async function resolveSuperTypePath(
  supertype: string,
  fetcher: (jcrPath: string) => Promise<DialogNode>,
): Promise<string | undefined> {
  if (supertype.startsWith("/")) {
    return (await pathExists(supertype, fetcher)) ? supertype : undefined;
  }
  for (const base of ["/apps", "/libs"] as const) {
    const candidate = `${base}/${supertype}`;
    if (await pathExists(candidate, fetcher)) return candidate;
  }
  return undefined;
}

async function pathExists(
  jcrPath: string,
  fetcher: (jcrPath: string) => Promise<DialogNode>,
): Promise<boolean> {
  try {
    await fetcher(jcrPath);
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    // Auth / network / parse — bubble up so callers see real failures
    // instead of "couldn't resolve supertype" masking a 401.
    throw err;
  }
}

/**
 * Distinguish AEM's "JCR node doesn't exist" 404 from other errors. The
 * fetcher classifies non-401/403 HTTP failures as `kind: "network"` with
 * `details.status` set, so we key off the status code.
 */
function isNotFound(err: unknown): boolean {
  if (!(err instanceof AemFetchError)) return false;
  return err.details?.status === 404;
}
