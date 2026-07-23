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
 * Override the file path via the `AEM_COMPONENT_NAMES_FILE` env var
 * (default `./aem-component-names.json`).
 */
export interface ComponentNameOverride {
  /** Sanity type name to emit (letters/digits/underscore, must start with a letter). */
  name?: string;
  /** Studio display title; replaces the component's `jcr:title`. */
  title?: string;
}

export type ComponentNameConfig = Map<string, ComponentNameOverride>;

/** Sanity type names must be identifier-like; enforced at load so a typo fails fast. */
const VALID_TYPE_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

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
      const { name, title } = value as Record<string, unknown>;
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
      if (name === undefined && title === undefined) {
        throw new Error(
          `component-name config: entry for "${rawKey}" needs "name" and/or "title"`,
        );
      }
      override = {
        ...(name !== undefined ? { name } : {}),
        ...(title !== undefined ? { title } : {}),
      };
    } else {
      throw new Error(
        `component-name config: entry for "${rawKey}" must be a string type name or an object with "name" / "title"`,
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

    out.set(resourceType, override);
  }
  return out;
}
