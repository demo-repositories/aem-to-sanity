import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  loadExtractedContentTrees,
  type SlotVisibleWhen,
} from "aem-to-sanity-core";
import type { SanityField, ShowHideCondition } from "./mapper.ts";

/**
 * Nested-component slot discovery. Some AEM components embed a **single named
 * child component** rather than declaring it in their dialog — e.g.
 * `aem-integration/components/media-paragraph` carries a `content` child
 * whose own `sling:resourceType` is `aem-integration/components/content`.
 * That's not a dialog field and it's not a cq:isContainer drop-zone; it's
 * a named slot. Operators don't want to enumerate these by hand, and the
 * dialog itself carries no hint of them — the only place the slot shape
 * shows up is inside already-extracted content.
 *
 * So the schema emitter runs a post-extract pass: walk every raw page JSON
 * on disk, and for every mapped parent node, note which of its direct
 * children carry their own `sling:resourceType` under a key that isn't a
 * dialog field. That's a slot. The result feeds the emitter, which then
 * declares `defineField({ name: slotKey, type: childTypeName })` on the
 * parent schema so the Studio stops flagging the slot as an "Unknown
 * field".
 *
 * Missing `raw/` dir → empty result (first-ever run has no content to
 * scan, which is fine — a second `migrate:schema` after the first
 * `extract` picks up the slots). Keeps the feature config-free.
 */

interface AemNode {
  [key: string]: unknown;
  "sling:resourceType"?: string;
}

interface SlotHit {
  /** First JCR path where this parent→slot→child combo was seen. */
  examplePath: string;
}

export interface SlotMapEntry {
  /** Keyed by the child `sling:resourceType`. Multi-type slots stay flagged. */
  childTypes: Map<string, SlotHit>;
}

export type DiscoveredSlots = Map<string, Map<string, SlotMapEntry>>;

export interface SlotScanResult {
  slots: DiscoveredSlots;
  /**
   * Resource types seen as a **direct child of a structural wrapper**
   * (page root / responsive grid) — i.e. authored as a page-body block
   * somewhere in the extracted content. Feeds the slot-only page-builder
   * exclusion: a type that appears here must stay in `pageBuilder.of[]`
   * no matter how often it also fills slots.
   */
  pageBodyTypes: Set<string>;
}

export interface ScanOptions {
  /**
   * JCR path prefixes that are structural wrappers, not real components. Their
   * children aren't slots; they are transparent walk-throughs. Keeps the AEM
   * `page` root + responsive-grid from polluting the slot map for every
   * top-level block.
   */
  structuralPassthroughTypes?: Set<string>;
}

const DEFAULT_STRUCTURAL = new Set<string>([
  "aem-integration/components/page",
  "wcm/foundation/components/responsivegrid",
]);

/**
 * Pure scanner — takes a list of raw AEM roots (each is an extracted page
 * tree) and returns every `parentResourceType → childKey → childResourceType`
 * combo it sees, plus the set of resource types found directly under
 * structural wrappers (page-body blocks). Consumers filter by dialog-field
 * names at emission time (the scanner doesn't have that knowledge yet;
 * migrate:schema maps dialogs after scanning).
 *
 * Exported for unit testing; the CLI wrapper {@link scanSlotGraphFromExtractCache}
 * handles disk I/O and JSON parsing.
 */
export function discoverSlotGraph(
  roots: AemNode[],
  opts: ScanOptions = {},
): SlotScanResult {
  const structural = opts.structuralPassthroughTypes ?? DEFAULT_STRUCTURAL;
  const out: DiscoveredSlots = new Map();
  const pageBodyTypes = new Set<string>();

  function visit(node: AemNode, jcrPath: string): void {
    const parentType = typeof node["sling:resourceType"] === "string"
      ? (node["sling:resourceType"] as string)
      : undefined;
    const parentIsReal = parentType && !structural.has(parentType);

    // Direct children of a structural wrapper are page-body blocks, not
    // slot fills — record their types so the slot-only page-builder
    // exclusion knows they must stay insertable at page level.
    if (parentType && structural.has(parentType)) {
      for (const value of Object.values(node)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const childType = (value as AemNode)["sling:resourceType"];
        if (typeof childType === "string") pageBodyTypes.add(childType);
      }
    }

    if (parentIsReal && parentType) {
      for (const [key, value] of Object.entries(node)) {
        if (key.startsWith("jcr:") || key.startsWith("sling:") || key.startsWith("cq:")) continue;
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const child = value as AemNode;
        const childType = typeof child["sling:resourceType"] === "string"
          ? (child["sling:resourceType"] as string)
          : undefined;
        if (!childType) continue;

        let bySlot = out.get(parentType);
        if (!bySlot) {
          bySlot = new Map();
          out.set(parentType, bySlot);
        }
        let entry = bySlot.get(key);
        if (!entry) {
          entry = { childTypes: new Map() };
          bySlot.set(key, entry);
        }
        if (!entry.childTypes.has(childType)) {
          entry.childTypes.set(childType, { examplePath: `${jcrPath}/${key}` });
        }
      }
    }

    // Always recurse — nested blocks can have their own slots too.
    for (const [key, value] of Object.entries(node)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      visit(value as AemNode, `${jcrPath}/${key}`);
    }
  }

  for (const root of roots) visit(root, "");
  return { slots: out, pageBodyTypes };
}

/**
 * Slot-map-only view of {@link discoverSlotGraph}, kept for callers that
 * don't need the page-body type set.
 */
export function discoverSlots(
  roots: AemNode[],
  opts: ScanOptions = {},
): DiscoveredSlots {
  return discoverSlotGraph(roots, opts).slots;
}

/**
 * Disk-backed wrapper: reads extract/tag cache under `output/cache/aem/content/`
 * (falling back to legacy `cache/raw/`), feeds the trees into
 * {@link discoverSlotGraph}, and returns the combined slot map + page-body
 * type set.
 */
export function scanSlotGraphFromExtractCache(
  outputDir: string,
  opts: ScanOptions = {},
): SlotScanResult {
  const roots = loadExtractedContentTrees(outputDir) as AemNode[];
  return discoverSlotGraph(roots, opts);
}

/**
 * Slot-map-only view of {@link scanSlotGraphFromExtractCache}, kept for
 * callers that don't need the page-body type set.
 */
export function scanSlotsFromExtractCache(
  outputDir: string,
  opts: ScanOptions = {},
): DiscoveredSlots {
  return scanSlotGraphFromExtractCache(outputDir, opts).slots;
}

/**
 * Compute which discovered component types are **slot-only**: every observed
 * appearance is as the fill of a synthesized slot field on a regular
 * component. These types stay fully usable — their schema type exists and
 * the parents' slot fields reference it — but they don't belong in the
 * page-level "+ Add" menu, so `migrateSchemas` adds them to
 * `pageBuilder.of[]`'s exclusion list.
 *
 * A type is kept OUT of the result (i.e. stays in the page builder) when it
 * is ever seen:
 * - directly under a structural wrapper (`pageBodyTypes`) — authored as a
 *   page-body block somewhere, excluding it would orphan those blocks; or
 * - inside a container's drop zone — container children render through the
 *   page-builder array type, so membership is load-bearing there.
 *
 * First run without an extract cache discovers no slots, so nothing is
 * excluded — same two-pass behavior as slot discovery itself.
 */
export function collectSlotOnlyResourceTypes(input: {
  /** Child resource types that landed on a synthesized slot field. */
  synthesizedSlotChildTypes: ReadonlySet<string>;
  /** Resource types seen as direct children of structural wrappers. */
  pageBodyTypes: ReadonlySet<string>;
  /** Full discovery map — consulted for container drop-zone children. */
  discoveredSlots: DiscoveredSlots;
  /** Parent resource types registered in `aem-component-containers.json`. */
  containerParents: ReadonlySet<string>;
}): string[] {
  const keepInPageBuilder = new Set(input.pageBodyTypes);
  for (const [parentType, slotMap] of input.discoveredSlots) {
    if (!input.containerParents.has(parentType)) continue;
    for (const entry of slotMap.values()) {
      for (const childType of entry.childTypes.keys()) {
        keepInPageBuilder.add(childType);
      }
    }
  }
  return [...input.synthesizedSlotChildTypes]
    .filter((rt) => !keepInPageBuilder.has(rt))
    .sort();
}

/**
 * Resolve a config-declared slot visibility rule (`aem-component-slots.json`
 * → `visibleWhen`) into the same {@link ShowHideCondition} shape the dialog
 * show/hide mapper produces, so the emitter renders one consistent
 * `hidden: ({ parent }) => …` callback either way.
 *
 * The controller must be a mapped sibling field of the right type — boolean
 * for the toggle shorthand, string for the `equals` form. A missing or
 * mismatched controller returns `undefined` after warning: attaching the
 * condition anyway would hide the slot unconditionally (the callback would
 * read a field that never holds the expected value), which is worse than
 * leaving it visible.
 *
 * Controller defaults carry over from the mapped field's `initialValue`
 * (AEM checkbox `checked` / select `selected`), so an unset value on a
 * migrated document lands on the same side of the toggle as a fresh AEM
 * dialog — identical to how dialog-declared show/hide conditions behave.
 */
export function resolveSlotVisibilityCondition(
  visibleWhen: SlotVisibleWhen,
  siblingFields: readonly SanityField[],
  warn: (message: string) => void,
): ShowHideCondition | undefined {
  const controller = siblingFields.find((f) => f.name === visibleWhen.field);
  if (!controller) {
    warn(
      `visibleWhen controller "${visibleWhen.field}" is not a field on this component — skipping (the slot stays visible).`,
    );
    return undefined;
  }
  if (visibleWhen.equals && visibleWhen.equals.length > 0) {
    if (controller.type !== "string") {
      warn(
        `visibleWhen controller "${visibleWhen.field}" is type "${controller.type}", but the "equals" form needs a string field — skipping (the slot stays visible).`,
      );
      return undefined;
    }
    const condition: ShowHideCondition = {
      controllerField: visibleWhen.field,
      kind: "dropdown",
      values: visibleWhen.equals,
    };
    if (typeof controller.initialValue === "string") {
      condition.controllerDefault = controller.initialValue;
    }
    return condition;
  }
  if (controller.type !== "boolean") {
    warn(
      `visibleWhen controller "${visibleWhen.field}" is type "${controller.type}", but the toggle shorthand needs a boolean field — use { "field": "${visibleWhen.field}", "equals": [...] } for value matching. Skipping (the slot stays visible).`,
    );
    return undefined;
  }
  const condition: ShowHideCondition = {
    controllerField: visibleWhen.field,
    kind: "checkbox",
    visibleWhenChecked: true,
  };
  if (controller.initialValue === true) {
    condition.controllerDefaultChecked = true;
  }
  return condition;
}

/**
 * @deprecated Pass `outputDir` to {@link scanSlotsFromExtractCache} instead.
 * Still accepts a legacy flat `cache/raw/` directory path for compatibility.
 */
export function scanSlotsFromRawDir(
  rawDir: string,
  opts: ScanOptions = {},
): DiscoveredSlots {
  let entries: string[];
  try {
    entries = readdirSync(rawDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw err;
  }
  const roots: AemNode[] = [];
  for (const file of entries) {
    if (!file.endsWith(".json")) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(rawDir, file), "utf8"));
    } catch {
      continue;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const tree = (raw as { tree?: unknown }).tree;
    if (tree && typeof tree === "object" && !Array.isArray(tree)) {
      roots.push(tree as AemNode);
    }
  }
  return discoverSlots(roots, opts);
}
