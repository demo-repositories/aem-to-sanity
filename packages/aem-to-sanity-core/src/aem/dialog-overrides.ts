import type { DialogNode } from "./dialog-types.ts";
import { AemFetchError } from "./fetcher.ts";
import { resolveDialogViaSuperType } from "./dialog-resolution.ts";
import type {
  DialogOverrideEntry,
  SupplementaryTab,
} from "../config/dialog-overrides.ts";

/**
 * Apply `aem-dialog-overrides.json` entries to a component's dialog.
 *
 * AEM's Sling Resource Merger merges dialogs across the whole
 * `sling:resourceSuperType` chain — a proxy component with its own
 * `cq:dialog` still inherits tabs from ancestor dialogs. The migrator's
 * resolution (`resolveDialogViaSuperType`) deliberately stops at the first
 * dialog it finds, so merged-in tabs are invisible to it. Rather than
 * reimplement merger semantics (`sling:hideResource`, `sling:orderBefore`,
 * key-level deep merge, per hop), operators name the merged pieces
 * explicitly and this module splices them in.
 */

/**
 * A config or splice problem — distinguished from `AemFetchError` so
 * callers can classify it as an operator-config failure rather than a
 * transport one.
 */
export class DialogOverrideError extends Error {}

export interface AppliedSupplementaryTab {
  /** JCR path the tab node was fetched from. */
  path: string;
  /** Node name it was spliced in under. */
  key: string;
  /** `"append"`, `"after:<anchor>"`, or `"before:<anchor>"`. */
  position: string;
}

const TABS_RESOURCE_TYPE = "granite/ui/components/coral/foundation/tabs";

export interface EffectiveDialogResult {
  dialog: DialogNode;
  /**
   * The `sling:resourceSuperType` walk, when resolution ran (absent when a
   * `dialogFile` override or an embedded dialog supplied the base). Same
   * shape as `DialogResolution.chain`.
   */
  chain?: string[];
  /** Set when `override.dialogFile` replaced dialog resolution. */
  dialogFileApplied?: string;
  /** Tabs spliced in, in application order. */
  appliedTabs?: AppliedSupplementaryTab[];
}

export interface ResolveEffectiveDialogOptions {
  /** The component's `aem-dialog-overrides.json` entry, if any. */
  override?: DialogOverrideEntry;
  /**
   * A `cq:dialog` embedded in the component node's own `.infinity.json`,
   * when the caller already fetched it. Skips the supertype walk (matches
   * the schema migrator's behavior); a `dialogFile` override still wins.
   */
  embeddedDialog?: DialogNode;
  /** Sink for non-fatal messages (missing anchor, heuristic tab match). */
  warn?: (msg: string) => void;
}

/**
 * The single entry point `migrate:schema`'s processOne, the audit step, and
 * `scripts/aem-probe.ts` all share, so "what the migrator sees" stays one
 * definition. Base dialog = `dialogFile` override ?? embedded `cq:dialog`
 * ?? supertype-chain resolution; then supplementary tabs splice on top.
 */
export async function resolveEffectiveDialog(
  componentPath: string,
  fetcher: (jcrPath: string) => Promise<DialogNode>,
  opts: ResolveEffectiveDialogOptions = {},
): Promise<EffectiveDialogResult> {
  const { override, embeddedDialog, warn } = opts;
  const result: EffectiveDialogResult = { dialog: {} as DialogNode };

  if (override?.dialog) {
    result.dialog = override.dialog;
    result.dialogFileApplied = override.dialogFile;
  } else if (embeddedDialog) {
    result.dialog = embeddedDialog;
  } else {
    const resolution = await resolveDialogViaSuperType(componentPath, fetcher);
    result.dialog = resolution.dialog;
    result.chain = resolution.chain;
  }

  if (override?.supplementaryTabs?.length) {
    const spliced = await spliceSupplementaryTabs(
      result.dialog,
      override.supplementaryTabs,
      fetcher,
      warn,
    );
    result.dialog = spliced.dialog;
    result.appliedTabs = spliced.applied;
  }
  return result;
}

/**
 * Fetch each supplementary tab node and splice it into the dialog's tabs
 * container. Never mutates the input dialog — the caller may be holding an
 * embedded dialog that aliases a prefetched component node.
 *
 * Key insertion order is load-bearing: the schema mapper walks dialog
 * children in `Object.entries` order, and titled tab containers become
 * Studio groups in that order — so where the key lands in `items` is
 * exactly where the tab lands in the Studio.
 *
 * Tabs apply sequentially in config order; a later entry may anchor on a
 * previously spliced key.
 */
export async function spliceSupplementaryTabs(
  dialog: DialogNode,
  tabs: SupplementaryTab[],
  fetcher: (jcrPath: string) => Promise<DialogNode>,
  warn?: (msg: string) => void,
): Promise<{ dialog: DialogNode; applied: AppliedSupplementaryTab[] }> {
  const out = structuredClone(dialog);
  const container = findTabsContainer(out, warn);
  if (!container) {
    throw new DialogOverrideError(
      `supplementaryTabs: no tabs container found in the resolved dialog ` +
        `(looked for sling:resourceType "${TABS_RESOURCE_TYPE}", then a node named "tabs" with an "items" child). ` +
        `Use "dialogFile" to supply the full dialog instead.`,
    );
  }

  const applied: AppliedSupplementaryTab[] = [];
  for (const tab of tabs) {
    const node = await fetchTabNode(tab.path, fetcher);
    // The loader guarantees `key` is set (path-derived fallback), but keep
    // the derivation for callers constructing entries programmatically.
    const key = tab.key ?? tab.path.split("/").filter(Boolean).at(-1)!;
    const items = container.items as Record<string, unknown>;
    const tabKeys = Object.keys(items).filter(
      (k) => items[k] && typeof items[k] === "object" && !Array.isArray(items[k]),
    );
    if (tabKeys.includes(key)) {
      throw new DialogOverrideError(
        `supplementaryTabs: tab key "${key}" (from ${tab.path}) already exists in the dialog's tabs container — ` +
          `merging into an existing tab isn't supported; use "dialogFile" for true merges.`,
      );
    }

    let anchor = tab.insertAfter ?? tab.insertBefore;
    let position: string;
    if (anchor !== undefined && !tabKeys.includes(anchor)) {
      warn?.(
        `supplementaryTabs: anchor "${anchor}" (for ${tab.path}) not found among tabs [${tabKeys.join(", ")}] — appending at the end`,
      );
      anchor = undefined;
    }
    if (anchor === undefined) {
      position = "append";
      items[key] = node;
    } else {
      position = tab.insertAfter !== undefined ? `after:${anchor}` : `before:${anchor}`;
      container.items = insertAtAnchor(
        items,
        key,
        node,
        anchor,
        tab.insertAfter !== undefined,
      );
    }
    applied.push({ path: tab.path, key, position });
  }
  return { dialog: out, applied };
}

/**
 * A tabs container as found by {@link findTabsContainer} — guaranteed to
 * have an object-valued `items`.
 */
interface TabsContainer extends DialogNode {
  items: Record<string, unknown>;
}

/**
 * DFS (in `Object.entries` order) for the dialog's tabs container.
 *
 * Primary match: `sling:resourceType === TABS_RESOURCE_TYPE`. Fallback: a
 * node whose key is `tabs` carrying an object `items` child — real proxy
 * dialogs frequently omit the resourceType because the Sling Resource
 * Merger supplies it from `/libs` at runtime (verified against Core
 * Components proxies), so the by-name match is required in practice; it
 * warns so operators know a heuristic fired.
 */
function findTabsContainer(
  dialog: DialogNode,
  warn?: (msg: string) => void,
): TabsContainer | undefined {
  const byType = findNode(
    dialog,
    (node) => node["sling:resourceType"] === TABS_RESOURCE_TYPE && hasObjectItems(node),
  );
  if (byType) return byType as TabsContainer;

  const byName = findNode(
    dialog,
    (node, key) => key === "tabs" && hasObjectItems(node),
  );
  if (byName) {
    warn?.(
      `supplementaryTabs: tabs container matched by node name ("tabs") — the dialog omits ` +
        `sling:resourceType "${TABS_RESOURCE_TYPE}" (typical for proxy dialogs the Sling Resource Merger completes at runtime)`,
    );
    return byName as TabsContainer;
  }
  return undefined;
}

function hasObjectItems(node: DialogNode): boolean {
  const items = node["items"];
  return !!items && typeof items === "object" && !Array.isArray(items);
}

function findNode(
  node: DialogNode,
  match: (node: DialogNode, key: string) => boolean,
  key = "",
): DialogNode | undefined {
  if (key && match(node, key)) return node;
  for (const [childKey, child] of Object.entries(node)) {
    if (!child || typeof child !== "object" || Array.isArray(child)) continue;
    const found = findNode(child as DialogNode, match, childKey);
    if (found) return found;
  }
  return undefined;
}

/**
 * Rebuild an `items` object with `key` inserted adjacent to `anchor`.
 * Non-object (scalar) entries such as `jcr:primaryType` keep their
 * positions — only the new key moves.
 */
function insertAtAnchor(
  items: Record<string, unknown>,
  key: string,
  node: DialogNode,
  anchor: string,
  after: boolean,
): Record<string, unknown> {
  const rebuilt: Record<string, unknown> = {};
  for (const [existingKey, value] of Object.entries(items)) {
    if (!after && existingKey === anchor) rebuilt[key] = node;
    rebuilt[existingKey] = value;
    if (after && existingKey === anchor) rebuilt[key] = node;
  }
  return rebuilt;
}

async function fetchTabNode(
  path: string,
  fetcher: (jcrPath: string) => Promise<DialogNode>,
): Promise<DialogNode> {
  let node: DialogNode;
  try {
    node = await fetcher(path);
  } catch (err) {
    // A 404 means the configured JCR path doesn't exist — an operator typo,
    // reported as a config error. Auth / network / parse failures propagate
    // as `AemFetchError` so callers classify (and circuit-break) them like
    // any other fetch.
    if (err instanceof AemFetchError && err.details?.status === 404) {
      throw new DialogOverrideError(
        `supplementaryTabs: tab node ${path} does not exist (404). ` +
          `Check the JCR path in aem-dialog-overrides.json.`,
        { cause: err },
      );
    }
    throw err;
  }
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    throw new DialogOverrideError(
      `supplementaryTabs: ${path} did not return a JSON object node`,
    );
  }
  return node;
}
