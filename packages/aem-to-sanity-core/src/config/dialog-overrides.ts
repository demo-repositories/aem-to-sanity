import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import type { DialogNode } from "../aem/dialog-types.ts";

/**
 * Optional per-component dialog overrides. Keyed by `sling:resourceType`
 * (a leading `/apps/` prefix on the key is accepted and stripped).
 *
 * AEM's runtime resolves authoring dialogs through the **Sling Resource
 * Merger**: a proxy component with its own `cq:dialog` still inherits tabs
 * from ancestor dialogs in its `sling:resourceSuperType` chain. The
 * migrator deliberately does not reimplement merger semantics — it stops at
 * the first dialog the chain yields — so inherited tabs are invisible to
 * it. This config is the escape hatch: name the merged-in pieces
 * explicitly.
 *
 * ```json
 * {
 *   "uxp/components/proxy/content/accordion": {
 *     "supplementaryTabs": [
 *       {
 *         "path": "/libs/core/wcm/components/accordion/v1/accordion/cq:dialog/content/items/tabs/items/properties",
 *         "insertAfter": "theme"
 *       }
 *     ]
 *   },
 *   "uxp/components/proxy/content/hero": {
 *     "dialogFile": "./dialog-overrides/hero.json"
 *   }
 * }
 * ```
 *
 * Two capabilities, combinable per entry:
 *
 * - `supplementaryTabs` — tab nodes to fetch from AEM (each `path` is an
 *   absolute JCR path, fetched as `${path}.infinity.json`) and splice into
 *   the resolved dialog's tabs container at the stated position.
 * - `dialogFile` — a local JSON file holding the complete `cq:dialog` node
 *   (same shape as `_cq_dialog.infinity.json`). Replaces dialog resolution
 *   entirely. When both are set, the file is the base and the tabs splice
 *   on top.
 *
 * Overriding a dialog changes which fields the component's Sanity type
 * carries — like the mapping table itself, treat entries as
 * set-early-and-keep knobs: removing one later drops fields from the
 * emitted schema while ingested content keeps the values.
 *
 * Override the file path via the `AEM_DIALOG_OVERRIDES_FILE` env var
 * (default `./aem-dialog-overrides.json`).
 */
export interface SupplementaryTab {
  /**
   * Absolute JCR path of the tab node to fetch (e.g.
   * `/libs/core/wcm/components/accordion/v1/accordion/cq:dialog/content/items/tabs/items/properties`).
   */
  path: string;
  /**
   * Node name of the existing tab to insert after (e.g. `"theme"`).
   * Mutually exclusive with `insertBefore`; omit both to append.
   */
  insertAfter?: string;
  /** Node name of the existing tab to insert before. */
  insertBefore?: string;
  /**
   * Node name the spliced tab gets in the tabs container's `items`.
   * Defaults to the last segment of `path`.
   */
  key?: string;
}

export interface DialogOverrideEntry {
  /**
   * The `dialogFile` value as written in the config — kept for logging and
   * the migration report; the parsed contents live in `dialog`.
   */
  dialogFile?: string;
  /** Parsed contents of `dialogFile`, loaded eagerly at config-load time. */
  dialog?: DialogNode;
  supplementaryTabs?: SupplementaryTab[];
}

export type DialogOverrideConfig = Map<string, DialogOverrideEntry>;

export interface LoadDialogOverrideConfigOptions {
  /** Absolute or relative path. Missing file → empty config. */
  file: string;
}

function normalizeKey(key: string): string {
  const trimmed = key.trim().replace(/^\/+/, "");
  return trimmed.startsWith("apps/") ? trimmed.slice("apps/".length) : trimmed;
}

/**
 * Synchronous load — matches `loadContainerConfig` / `loadComponentNameConfig`.
 * Returns an empty Map when the file is absent so opting in is fully
 * optional. Throws on malformed JSON or invalid entries so a typo doesn't
 * silently leave a dialog un-overridden. `dialogFile` targets are read and
 * parsed here, not at migration time, so a missing or broken file fails the
 * run at startup with a path-naming error instead of mid-migration.
 */
export function loadDialogOverrideConfig(
  opts: LoadDialogOverrideConfigOptions,
): DialogOverrideConfig {
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
      `dialog-overrides config: ${file} is not valid JSON (${(err as Error).message})`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `dialog-overrides config: ${file} must be a JSON object keyed by sling:resourceType`,
    );
  }

  const configDir = dirname(resolve(file));
  const out: DialogOverrideConfig = new Map();
  for (const [rawKey, value] of Object.entries(parsed)) {
    const resourceType = normalizeKey(rawKey);
    if (!resourceType) {
      throw new Error(`dialog-overrides config: empty resource-type key in ${file}`);
    }
    if (out.has(resourceType)) {
      throw new Error(
        `dialog-overrides config: "${rawKey}" duplicates an earlier entry for "${resourceType}"`,
      );
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(
        `dialog-overrides config: entry for "${rawKey}" must be an object with "dialogFile" and/or "supplementaryTabs"`,
      );
    }

    const { dialogFile, supplementaryTabs } = value as Record<string, unknown>;
    if (dialogFile !== undefined && typeof dialogFile !== "string") {
      throw new Error(
        `dialog-overrides config: "dialogFile" for "${rawKey}" must be a string path`,
      );
    }
    if (
      supplementaryTabs !== undefined &&
      (!Array.isArray(supplementaryTabs) || supplementaryTabs.length === 0)
    ) {
      throw new Error(
        `dialog-overrides config: "supplementaryTabs" for "${rawKey}" must be a non-empty array`,
      );
    }
    if (dialogFile === undefined && supplementaryTabs === undefined) {
      throw new Error(
        `dialog-overrides config: entry for "${rawKey}" needs "dialogFile" and/or "supplementaryTabs"`,
      );
    }

    const entry: DialogOverrideEntry = {};
    if (dialogFile !== undefined) {
      entry.dialogFile = dialogFile;
      entry.dialog = loadDialogFile(dialogFile, configDir, rawKey);
    }
    if (supplementaryTabs !== undefined) {
      entry.supplementaryTabs = supplementaryTabs.map((tab, i) =>
        validateSupplementaryTab(tab, rawKey, i),
      );
    }
    out.set(resourceType, entry);
  }
  return out;
}

function validateSupplementaryTab(
  value: unknown,
  rawKey: string,
  index: number,
): SupplementaryTab {
  const where = `supplementaryTabs[${index}] for "${rawKey}"`;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `dialog-overrides config: ${where} must be an object with a "path"`,
    );
  }
  const { path, insertAfter, insertBefore, key } = value as Record<string, unknown>;
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new Error(
      `dialog-overrides config: ${where} needs an absolute JCR "path" (starting with "/")`,
    );
  }
  for (const [prop, v] of [
    ["insertAfter", insertAfter],
    ["insertBefore", insertBefore],
    ["key", key],
  ] as const) {
    if (v !== undefined && (typeof v !== "string" || v.trim().length === 0)) {
      throw new Error(
        `dialog-overrides config: "${prop}" in ${where} must be a non-empty string`,
      );
    }
  }
  if (insertAfter !== undefined && insertBefore !== undefined) {
    throw new Error(
      `dialog-overrides config: ${where} sets both "insertAfter" and "insertBefore" — pick one`,
    );
  }
  // Node names may carry a JCR namespace (`cq:include`) but never a path
  // separator — a `/` means the operator pasted a path where a sibling node
  // name belongs.
  for (const [prop, v] of [
    ["insertAfter", insertAfter],
    ["insertBefore", insertBefore],
    ["key", key],
  ] as const) {
    if (typeof v === "string" && v.includes("/")) {
      throw new Error(
        `dialog-overrides config: "${prop}" in ${where} must be a node name (no "/"), e.g. "theme"`,
      );
    }
  }
  const fallbackKey = path.split("/").filter(Boolean).at(-1);
  if (!fallbackKey) {
    throw new Error(
      `dialog-overrides config: ${where} has a "path" with no usable last segment`,
    );
  }
  return {
    path,
    ...(insertAfter !== undefined ? { insertAfter: insertAfter as string } : {}),
    ...(insertBefore !== undefined ? { insertBefore: insertBefore as string } : {}),
    key: (key as string | undefined) ?? fallbackKey,
  };
}

/**
 * Resolve `dialogFile` against the config file's directory first (so the
 * config folder is self-contained and relocatable), then against the
 * working directory for operators who wrote cwd-relative paths.
 */
function loadDialogFile(
  dialogFile: string,
  configDir: string,
  rawKey: string,
): DialogNode {
  const candidates = isAbsolute(dialogFile)
    ? [dialogFile]
    : [resolve(configDir, dialogFile), resolve(dialogFile)];
  let raw: string | undefined;
  let found: string | undefined;
  for (const candidate of candidates) {
    try {
      raw = readFileSync(candidate, "utf8");
      found = candidate;
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  if (raw === undefined || found === undefined) {
    throw new Error(
      `dialog-overrides config: dialogFile for "${rawKey}" not found — tried ${candidates.join(", ")}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `dialog-overrides config: dialogFile ${found} (for "${rawKey}") is not valid JSON (${(err as Error).message})`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `dialog-overrides config: dialogFile ${found} (for "${rawKey}") must be a JSON object shaped like a cq:dialog node`,
    );
  }
  return parsed as DialogNode;
}
