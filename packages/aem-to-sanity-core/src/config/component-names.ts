import { readFileSync } from "node:fs";

/**
 * Optional per-project overrides for the Sanity type name and/or Studio
 * title a component emits as. Keyed by `sling:resourceType` (a leading
 * `/apps/` prefix on the key is accepted and stripped). Values are either
 * the type name as a plain string, or an object carrying `name` and/or
 * `title`:
 *
 * ```json
 * {
 *   "uxp/components/proxy/content/list":  { "name": "list",  "title": "List" },
 *   "uxp/components/proxy/content/lists": "lists"
 * }
 * ```
 *
 * Explicit names win over the `MIGRATION_TYPE_NAMING` strategy (path- or
 * title-derived); other components that would have resolved to the same
 * name get the usual collision fallback. Like the naming strategy itself,
 * this is a **set-once-before-first-import** knob — changing an override
 * after content is ingested renames the emitted type and orphans existing
 * `_type` values.
 *
 * Entries may also carry a `folder` — a single directory segment the
 * component's generated `{type}.ts` is emitted under (e.g. `"folder":
 * "navigationObjects"` → `generated/navigationObjects/navBar.ts`). Folder
 * overrides apply in both `MIGRATION_SCHEMA_LAYOUT` layouts and, unlike
 * `name`, are safe to change between runs: moving a file never renames the
 * type, and the pruner cleans up the old location.
 *
 * Entries may also carry a `file` — the exact basename (no `.ts`, no path)
 * for the component's generated schema file, which doubles as the module's
 * `export const` identifier. Wins over the global
 * `MIGRATION_TYPE_SUFFIX_MODE=file` decoration, so an entry can pin type
 * name, title, folder, AND file independently. Like `folder`, safe to
 * change between runs — a file rename never touches the type name.
 *
 * Entries may also carry an `icon` — the name of a `@sanity/icons` export
 * (e.g. `"icon": "ControlsIcon"`). The generated schema imports it and sets
 * `defineType({ icon })`, so the component shows that icon in the Studio's
 * insert menus, array item previews, and structure lists. Safe to change
 * between runs — icons never touch type names or ingested content.
 *
 * Override the file path via the `AEM_COMPONENT_NAMES_FILE` env var
 * (default `./aem-component-names.json`).
 */
export interface ComponentNameOverride {
  /** Sanity type name to emit (letters/digits/underscore, must start with a letter). */
  name?: string;
  /** Studio display title; replaces the component's `jcr:title`. */
  title?: string;
  /** Subfolder of the schemas dir to emit into (single segment, no `/` or `.`). */
  folder?: string;
  /**
   * Basename for the generated file (no `.ts`) and its `export const`
   * identifier. Must be identifier-like and unique across components.
   */
  file?: string;
  /**
   * `@sanity/icons` export name (e.g. `ControlsIcon`) set as the emitted
   * type's `defineType({ icon })`. Must be a PascalCase identifier.
   */
  icon?: string;
}

export type ComponentNameConfig = Map<string, ComponentNameOverride>;

/** Sanity type names must be identifier-like; enforced at load so a typo fails fast. */
const VALID_TYPE_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Folders are a single path segment — no separators or dots, so a config
 * value can never escape or nest below the schemas dir.
 */
const VALID_FOLDER = /^[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * `@sanity/icons` exports are PascalCase identifiers (`ControlsIcon`,
 * `BlockElementIcon`, …). The value lands verbatim in a generated `import`
 * statement, so a kebab-case or dotted value must fail at config load —
 * a nonexistent-but-valid identifier is caught later by the Studio's
 * typecheck ("has no exported member").
 */
const VALID_ICON_NAME = /^[A-Z][A-Za-z0-9]*$/;

export interface LoadComponentNameConfigOptions {
  /** Absolute or relative path. Missing file → empty config. */
  file: string;
}

function normalizeKey(key: string): string {
  const trimmed = key.trim().replace(/^\/+/, "");
  return trimmed.startsWith("apps/") ? trimmed.slice("apps/".length) : trimmed;
}

/**
 * Synchronous load — matches `loadContainerConfig` / `loadAuthoringHintConfig`.
 * Returns an empty Map when the file is absent so opting in is fully
 * optional. Throws on malformed JSON or invalid entries so a typo doesn't
 * silently emit an unexpected type name.
 */
export function loadComponentNameConfig(
  opts: LoadComponentNameConfigOptions,
): ComponentNameConfig {
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
      `component-name config: ${file} is not valid JSON (${(err as Error).message})`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `component-name config: ${file} must be a JSON object keyed by sling:resourceType`,
    );
  }

  const out: ComponentNameConfig = new Map();
  const nameOwners = new Map<string, string>();
  const fileOwners = new Map<string, string>();
  for (const [rawKey, value] of Object.entries(parsed)) {
    const resourceType = normalizeKey(rawKey);
    if (!resourceType) {
      throw new Error(`component-name config: empty resource-type key in ${file}`);
    }
    if (out.has(resourceType)) {
      throw new Error(
        `component-name config: "${rawKey}" duplicates an earlier entry for "${resourceType}"`,
      );
    }

    let override: ComponentNameOverride;
    if (typeof value === "string") {
      override = { name: value };
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      const { name, title, folder, file, icon } = value as Record<string, unknown>;
      if (name !== undefined && typeof name !== "string") {
        throw new Error(
          `component-name config: "name" for "${rawKey}" must be a string`,
        );
      }
      if (title !== undefined && typeof title !== "string") {
        throw new Error(
          `component-name config: "title" for "${rawKey}" must be a string`,
        );
      }
      if (folder !== undefined && typeof folder !== "string") {
        throw new Error(
          `component-name config: "folder" for "${rawKey}" must be a string`,
        );
      }
      if (file !== undefined && typeof file !== "string") {
        throw new Error(
          `component-name config: "file" for "${rawKey}" must be a string`,
        );
      }
      if (icon !== undefined && typeof icon !== "string") {
        throw new Error(
          `component-name config: "icon" for "${rawKey}" must be a string`,
        );
      }
      if (
        name === undefined &&
        title === undefined &&
        folder === undefined &&
        file === undefined &&
        icon === undefined
      ) {
        throw new Error(
          `component-name config: entry for "${rawKey}" needs "name", "title", "folder", "file", and/or "icon"`,
        );
      }
      override = {
        ...(name !== undefined ? { name } : {}),
        ...(title !== undefined ? { title } : {}),
        ...(folder !== undefined ? { folder } : {}),
        ...(file !== undefined ? { file } : {}),
        ...(icon !== undefined ? { icon } : {}),
      };
    } else {
      throw new Error(
        `component-name config: entry for "${rawKey}" must be a string type name or an object with "name" / "title" / "folder" / "file" / "icon"`,
      );
    }

    if (override.name !== undefined) {
      if (!VALID_TYPE_NAME.test(override.name)) {
        throw new Error(
          `component-name config: "${override.name}" (for "${rawKey}") is not a valid Sanity type name — use letters/digits/underscore, starting with a letter`,
        );
      }
      const owner = nameOwners.get(override.name);
      if (owner) {
        throw new Error(
          `component-name config: "${override.name}" is assigned to both "${owner}" and "${rawKey}" — type names must be unique`,
        );
      }
      nameOwners.set(override.name, rawKey);
    }
    if (override.title !== undefined && override.title.trim().length === 0) {
      throw new Error(
        `component-name config: "title" for "${rawKey}" must not be empty`,
      );
    }
    if (override.folder !== undefined && !VALID_FOLDER.test(override.folder)) {
      throw new Error(
        `component-name config: "${override.folder}" (folder for "${rawKey}") is not a valid folder name — use a single segment of letters/digits/underscore/hyphen, starting with a letter`,
      );
    }
    if (override.file !== undefined) {
      // The basename doubles as the module's `export const` identifier, so
      // it needs the same identifier shape as a type name.
      if (!VALID_TYPE_NAME.test(override.file)) {
        throw new Error(
          `component-name config: "${override.file}" (file for "${rawKey}") is not a valid file basename — use letters/digits/underscore, starting with a letter, no ".ts" extension or path separators`,
        );
      }
      const owner = fileOwners.get(override.file);
      if (owner) {
        throw new Error(
          `component-name config: file "${override.file}" is assigned to both "${owner}" and "${rawKey}" — file basenames must be unique`,
        );
      }
      fileOwners.set(override.file, rawKey);
    }
    if (override.icon !== undefined && !VALID_ICON_NAME.test(override.icon)) {
      throw new Error(
        `component-name config: "${override.icon}" (icon for "${rawKey}") is not a valid @sanity/icons export name — use the PascalCase named export, e.g. "ControlsIcon" (see https://icons.sanity.io)`,
      );
    }

    out.set(resourceType, override);
  }
  return out;
}
