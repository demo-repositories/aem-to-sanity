import { readFileSync } from "node:fs";

/**
 * Config for AEM "container" components — ones that author drop-zone children
 * rather than declaring child content in a dialog multifield. Example from
 * David's Bridal: `aem-integration/components/expander`. Its JCR node holds
 * both dialog values (`headline2`, `theme`, ...) and a set of child nodes
 * with keys like `item_1657754806454`, each of which is itself a full
 * component instance with its own `sling:resourceType`.
 *
 * AEM declares this via `cq:isContainer` on the component definition, but
 * that flag isn't in the dialog payload we already fetch, so we mirror it
 * explicitly here. One flat JSON file, keyed by `sling:resourceType`:
 *
 * ```json
 * {
 *   "aem-integration/components/expander":     { "childrenField": "items" },
 *   "aem-integration/components/container":    { "childrenField": "items" },
 *   "aem-integration/components/column-layout":{ "childrenField": "items" }
 * }
 * ```
 *
 * The schema emitter appends an `items`-shaped array field to each listed
 * type (using `type: "pageBuilder"` so the palette matches the top-level
 * page builder). The content transform descends into child nodes of each
 * listed node and emits them as pageBuilder-style blocks under the same
 * field name.
 */
export interface ContainerConfigEntry {
  /** Field name on the Sanity object that carries the child blocks. Typically `"items"`. */
  childrenField: string;
  /**
   * When true, the container's own block is NOT emitted — its drop-zone
   * children are hoisted directly into the parent's pageBuilder array.
   *
   * Use this for pure layout containers (AEM responsive grid, `proxy/content/container`)
   * where the wrapping component carries no authored content of its own. Without
   * `flatten`, deeply nested layouts produce nested-block-in-block trees that
   * can hit Sanity's 20-level attribute-depth limit during import. With it,
   * the layout wrapper is dropped at transform time and the actual content
   * blocks sit at a manageable depth.
   *
   * Default: false. Containers with dialog fields you want preserved
   * (accordions, expanders) should stay non-flatten.
   */
  flatten?: boolean;
  /**
   * When true, every instance of this container is extracted into its own
   * `contentFragment` document and a `contentFragmentRef` block takes its
   * place in the parent array — ALWAYS, not just when a page runs over
   * Sanity's attribute-depth limit.
   *
   * Use this for recursive structural components (tabs, accordions) whose
   * nesting would otherwise approach the hard 20-level attribute-depth
   * limit: depth is counted per document, so each extracted level resets
   * the budget by construction, the Studio always shows the component as a
   * click-through reference (one consistent shape), and the frontend needs
   * exactly one join per configured type.
   *
   * Mutually exclusive with `flatten`. Default: false.
   */
  document?: boolean;
}

export type ContainerConfig = Map<string, ContainerConfigEntry>;

export interface LoadContainerConfigOptions {
  /** Absolute or relative path. Missing file → empty config. */
  file: string;
}

/**
 * Synchronous load — matches the rest of the content CLIs (transform runs
 * sync top-to-bottom). Returns an empty Map when the file is absent; throws
 * on malformed JSON or structurally invalid entries so a typo in the config
 * doesn't silently disable container behavior.
 */
export function loadContainerConfig(
  opts: LoadContainerConfigOptions,
): ContainerConfig {
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
      `container config: ${file} is not valid JSON (${(err as Error).message})`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `container config: ${file} must be a JSON object keyed by sling:resourceType`,
    );
  }

  const out: ContainerConfig = new Map();
  for (const [resourceType, value] of Object.entries(parsed)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(
        `container config: entry for "${resourceType}" must be an object with a childrenField`,
      );
    }
    const v = value as Record<string, unknown>;
    const childrenField = v.childrenField;
    if (typeof childrenField !== "string" || childrenField.trim().length === 0) {
      throw new Error(
        `container config: entry for "${resourceType}" needs a non-empty string childrenField`,
      );
    }
    const flatten = v.flatten === true ? true : undefined;
    const document = v.document === true ? true : undefined;
    if (flatten && document) {
      throw new Error(
        `container config: entry for "${resourceType}" sets both "flatten" and "document" — a flattened container has no block to extract; pick one`,
      );
    }
    out.set(resourceType, {
      childrenField,
      ...(flatten ? { flatten } : {}),
      ...(document ? { document } : {}),
    });
  }
  return out;
}
