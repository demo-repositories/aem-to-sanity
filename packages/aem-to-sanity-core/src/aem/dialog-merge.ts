import { isTruthyAttr, type DialogNode } from "./dialog-types.ts";

/**
 * Sling Resource Merger (override picker) semantics for Granite UI dialogs.
 *
 * AEM resolves a component's dialog at request time through `/mnt/override`,
 * which MERGES the dialogs of every component on the `sling:resourceSuperType`
 * chain — the more-derived (child) dialog overlaying its ancestors:
 *
 *  - property collisions → child value wins (arrays replaced wholesale,
 *    never element-merged)
 *  - same-named child nodes → merged recursively
 *  - ordering: the ancestor's declared child order first, child-only nodes
 *    appended in the child's declared order
 *  - `sling:orderBefore` — reposition a node before the named sibling
 *  - `sling:hideProperties` (string | string[], `*` wildcard) — drop
 *    inherited properties
 *  - `sling:hideChildren` (string | string[], `*` wildcard) — drop named
 *    inherited children
 *  - `sling:hideResource` (truthy) — drop the inherited node entirely
 *
 * Reference: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/developing/full-stack/sling-resource-merger
 *
 * Sling's `!name` negation entries inside hide lists are NOT supported —
 * they're rare and ambiguous to partially apply; encountering one emits an
 * `onWarning` and the entry is ignored.
 */

export interface MergeDialogsOptions {
  /** Called for non-fatal merge oddities (e.g. `!name` negation entries). */
  onWarning?: (message: string) => void;
}

const MERGE_CONTROL_KEYS = [
  "sling:hideProperties",
  "sling:hideChildren",
  "sling:hideResource",
  "sling:orderBefore",
] as const;

/**
 * Merge dialogs collected along a supertype chain. `dialogs[0]` is the
 * MOST-DERIVED (leaf/child) dialog; the last entry is the base-most ancestor.
 *
 * A single-entry input is returned verbatim — same reference, no cloning —
 * which guarantees byte-identical output for components whose chain supplies
 * only one dialog (the overwhelmingly common case before this feature).
 */
export function mergeDialogs(
  dialogs: DialogNode[],
  opts: MergeDialogsOptions = {},
): DialogNode {
  if (dialogs.length === 0) {
    throw new Error("mergeDialogs requires at least one dialog");
  }
  if (dialogs.length === 1) return dialogs[0]!;
  const merged = dialogs.reduceRight((base, child) =>
    mergeNode(base, child, opts.onWarning),
  );
  return stripMergeControls(merged);
}

/**
 * A "child node" is a plain non-array object whose key isn't `jcr:*` /
 * `sling:*` — the same predicate `childNodes()` in dialog-types.ts uses to
 * walk dialogs. Everything else is a property: replaced wholesale on
 * collision, never structurally merged.
 */
function isMergeableChild(key: string, value: unknown): value is DialogNode {
  if (key.startsWith("jcr:") || key.startsWith("sling:")) return false;
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** `string | string[]` hide-list attribute → clean string[]; warns on `!name`. */
function normalizeNameList(
  v: unknown,
  attr: string,
  onWarning?: (message: string) => void,
): string[] {
  const raw = typeof v === "string" ? [v] : Array.isArray(v) ? v : [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || entry.length === 0) continue;
    if (entry.startsWith("!")) {
      onWarning?.(
        `${attr} negation entry "${entry}" is not supported and was ignored`,
      );
      continue;
    }
    out.push(entry);
  }
  return out;
}

function mergeNode(
  base: DialogNode,
  child: DialogNode,
  onWarning?: (message: string) => void,
): DialogNode {
  const hideProps = normalizeNameList(
    child["sling:hideProperties"],
    "sling:hideProperties",
    onWarning,
  );
  const hideChildren = normalizeNameList(
    child["sling:hideChildren"],
    "sling:hideChildren",
    onWarning,
  );
  const hideAllProps = hideProps.includes("*");
  const hideAllChildren = hideChildren.includes("*");

  const out: Record<string, unknown> = {};

  // 1. Inherited properties, minus hidden ones. Child properties override
  //    or append after — object key order puts inherited attrs first, which
  //    matches how the merged resource serializes in AEM.
  for (const [k, v] of Object.entries(base)) {
    if (isMergeableChild(k, v)) continue;
    if (hideAllProps || hideProps.includes(k)) continue;
    out[k] = v;
  }
  for (const [k, v] of Object.entries(child)) {
    if (isMergeableChild(k, v)) continue;
    out[k] = v;
  }

  // 2. Children: ancestor's declared order first. A same-named child node in
  //    the overlay merges recursively; `sling:hideResource` on the overlay
  //    drops the inherited node; `sling:hideChildren` drops by name.
  for (const [k, baseChild] of Object.entries(base)) {
    if (!isMergeableChild(k, baseChild)) continue;
    if (hideAllChildren || hideChildren.includes(k)) continue;
    const overlay = child[k];
    if (isMergeableChild(k, overlay)) {
      if (isTruthyAttr(overlay["sling:hideResource"])) continue;
      out[k] = mergeNode(baseChild, overlay, onWarning);
    } else {
      out[k] = baseChild;
    }
  }

  // 3. Remaining overlay children appended in the overlay's declared order:
  //    genuinely child-only nodes, plus redefinitions of inherited children
  //    that were hidden in pass 2 (the local node stands alone, unmerged —
  //    Sling's hideChildren removes only the underlying resource). A
  //    hideResource marker with nothing inherited to hide emits nothing.
  for (const [k, v] of Object.entries(child)) {
    if (!isMergeableChild(k, v)) continue;
    if (k in out) continue;
    if (isTruthyAttr(v["sling:hideResource"])) continue;
    out[k] = v;
  }

  return applyOrderBefore(out);
}

/**
 * Honor `sling:orderBefore` among the merged sibling set: each child node
 * carrying the attribute moves immediately before the named sibling.
 * Unknown targets leave the node in place (Sling ignores them too).
 * Property entries keep their relative positions.
 */
function applyOrderBefore(node: Record<string, unknown>): DialogNode {
  const entries = Object.entries(node);
  const moves = entries.filter(
    ([k, v]) =>
      isMergeableChild(k, v) &&
      typeof (v as DialogNode)["sling:orderBefore"] === "string",
  );
  if (moves.length === 0) return node as DialogNode;

  for (const [key, value] of moves) {
    const target = (value as DialogNode)["sling:orderBefore"] as string;
    const from = entries.findIndex(([k]) => k === key);
    const to = entries.findIndex(([k]) => k === target);
    if (to === -1 || from === -1 || from === to) continue;
    const [entry] = entries.splice(from, 1);
    const insertAt = entries.findIndex(([k]) => k === target);
    entries.splice(insertAt, 0, entry!);
  }
  return Object.fromEntries(entries) as DialogNode;
}

/**
 * Recursively remove the Sling merge-control attributes from a merged tree so
 * the dialog mapper (and saved snapshots) never see bookkeeping that only
 * mattered during the merge.
 */
function stripMergeControls(node: DialogNode): DialogNode {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if ((MERGE_CONTROL_KEYS as readonly string[]).includes(k)) continue;
    out[k] = isMergeableChild(k, v) ? stripMergeControls(v) : v;
  }
  return out as DialogNode;
}
