import { readFileSync } from "node:fs";

/**
 * Config for named-slot fields — the child components some AEM components
 * embed directly under a fixed JCR key instead of a dialog multifield or a
 * drop-zone. Example from uxp: `proxy/content/promocard` carries
 * `buttonPrimary`, `buttonSecondary`, and `image` children, each a full
 * component instance with its own `sling:resourceType`. Slot *discovery* is
 * automatic (the schema emitter scans extracted content); this file only
 * layers optional per-slot behavior on top.
 *
 * Currently one knob: `visibleWhen`, which mirrors AEM's enable-toggles
 * (`enablePrimaryButton` etc.) as a Sanity conditional `hidden` callback so
 * the Studio folds a slot field the same way the AEM component hides its
 * child. One flat JSON file, keyed by the parent `sling:resourceType`, then
 * by the **emitted Sanity field name** of the slot (the camelCased slot
 * base — for hand-named slots like `buttonPrimary` that's just the JCR key):
 *
 * ```json
 * {
 *   "uxp/components/proxy/content/promocard": {
 *     "buttonPrimary":   { "visibleWhen": "enablePrimaryButton" },
 *     "buttonSecondary": { "visibleWhen": "enableSecondaryButton" },
 *     "image":           { "visibleWhen": "enableForegroundImage" },
 *     "banner":          { "visibleWhen": { "field": "cardStyle", "equals": "flood" } }
 *   }
 * }
 * ```
 *
 * `visibleWhen` forms:
 * - `"<field>"` — shorthand for a boolean toggle: the slot is visible only
 *   while the sibling boolean field is `true` (checkbox semantics).
 * - `{ "field": "<field>", "equals": "<value>" | ["<v1>", "<v2>"] }` — the
 *   slot is visible while the sibling string field holds one of the listed
 *   values (dropdown semantics).
 *
 * Hiding is a Studio display concern only — authored slot content is always
 * migrated and persisted regardless of the toggle's value, matching AEM,
 * where a disabled child node stays in the JCR.
 */
export interface SlotVisibleWhen {
  /** Sibling field on the same object that controls visibility. */
  field: string;
  /** Present → dropdown semantics (visible on match); absent → boolean toggle. */
  equals?: string[];
}

export interface SlotConfigEntry {
  visibleWhen?: SlotVisibleWhen;
}

/** parent `sling:resourceType` → emitted slot field name → per-slot config. */
export type SlotConfig = Map<string, Map<string, SlotConfigEntry>>;

export interface LoadSlotConfigOptions {
  /** Absolute or relative path. Missing file → empty config. */
  file: string;
}

/**
 * Synchronous load, matching the other `aem-component-*.json` loaders.
 * Returns an empty Map when the file is absent; throws on malformed JSON or
 * structurally invalid entries so a typo doesn't silently disable slot
 * visibility behavior.
 */
export function loadSlotConfig(opts: LoadSlotConfigOptions): SlotConfig {
  const { file } = opts;
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `slot config: ${file} is not valid JSON (${(err as Error).message})`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `slot config: ${file} must be a JSON object keyed by sling:resourceType`,
    );
  }

  const out: SlotConfig = new Map();
  for (const [rawKey, slots] of Object.entries(parsed)) {
    // Accept `/apps/`-prefixed keys (operators copy component paths around)
    // and normalize to the bare resource type, same as aem-component-names.
    const resourceType = rawKey.startsWith("/apps/")
      ? rawKey.slice("/apps/".length)
      : rawKey;
    if (!slots || typeof slots !== "object" || Array.isArray(slots)) {
      throw new Error(
        `slot config: entry for "${rawKey}" must be an object keyed by slot field name`,
      );
    }
    const bySlot = new Map<string, SlotConfigEntry>();
    for (const [slotName, entry] of Object.entries(slots)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(
          `slot config: "${resourceType}" → "${slotName}" must be an object (e.g. { "visibleWhen": "enablePrimaryButton" })`,
        );
      }
      const e = entry as Record<string, unknown>;
      const parsedEntry: SlotConfigEntry = {};
      if (e.visibleWhen !== undefined) {
        parsedEntry.visibleWhen = parseVisibleWhen(
          e.visibleWhen,
          `slot config: "${resourceType}" → "${slotName}" visibleWhen`,
        );
      }
      bySlot.set(slotName, parsedEntry);
    }
    if (bySlot.size > 0) out.set(resourceType, bySlot);
  }
  return out;
}

function parseVisibleWhen(value: unknown, context: string): SlotVisibleWhen {
  if (typeof value === "string") {
    if (value.trim().length === 0) {
      throw new Error(`${context} must name a non-empty controller field`);
    }
    return { field: value.trim() };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `${context} must be a field-name string or { field, equals }`,
    );
  }
  const v = value as Record<string, unknown>;
  if (typeof v.field !== "string" || v.field.trim().length === 0) {
    throw new Error(`${context} needs a non-empty string "field"`);
  }
  const field = v.field.trim();
  if (v.equals === undefined) return { field };
  const rawEquals = Array.isArray(v.equals) ? v.equals : [v.equals];
  if (
    rawEquals.length === 0 ||
    rawEquals.some((x) => typeof x !== "string")
  ) {
    throw new Error(
      `${context} "equals" must be a string or a non-empty array of strings`,
    );
  }
  return { field, equals: rawEquals as string[] };
}
