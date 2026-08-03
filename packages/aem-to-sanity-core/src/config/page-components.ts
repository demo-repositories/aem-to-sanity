import { readFileSync } from "node:fs";

/**
 * Per-project config declaring which AEM components are "page shells" —
 * components that live on the `jcr:content` node of an authored page and
 * carry page-level dialog properties (`pwaOrientation`, `disableCache`,
 * `pinPage`, ...) rather than appearing inside a page body.
 *
 * Each declared page-shell is paired with one or more `cq:template` paths.
 * For every (resource type, template) pair the schema emitter renders one
 * Sanity document type whose fields are: title / slug / tags / pageBuilder
 * + an inline `pageProperties` object holding the page-shell dialog +
 * `featuredImage` lifted from `cq:featuredimage` + a `cqTemplate` traceback.
 *
 * Operators declare the pairing explicitly so the migrator doesn't have to
 * walk content during schema generation. Templates seen in extracted
 * content that aren't declared here surface as `unknownPageTemplates`
 * findings in the transform audit.
 *
 * Example (`tenants/<your-tenant>/aem-page-components.json`):
 *
 * ```json
 * {
 *   "uxp/components/structure/page": {
 *     "templates": [
 *       "/conf/uxp/settings/wcm/templates/plan-details",
 *       "/conf/uxp/settings/wcm/templates/news-article"
 *     ],
 *     "names": {
 *       "/conf/uxp/settings/wcm/templates/plan-details": "planDetails",
 *       "/conf/uxp/settings/wcm/templates/news-article": { "name": "newsArticle", "title": "News Article" }
 *     }
 *   }
 * }
 * ```
 *
 * Override the file path via the `AEM_PAGE_COMPONENTS_FILE` env var.
 */
export interface TemplatePageNameOverride {
  /** Sanity document type name to emit (letters/digits/underscore, must start with a letter). */
  name?: string;
  /** Studio display title; replaces the template-path-derived "… Page" title. */
  title?: string;
}

export interface PageComponentConfigEntry {
  /**
   * Explicit `cq:template` paths this page-shell is used with. Each entry
   * here becomes one Sanity document type at `migrate:schema` time.
   *
   * Optional when {@link discover} is `true` — the schema pass scans
   * `output/cache/aem/content/` (extracted content) and auto-adds any templates it
   * finds on `jcr:content` nodes whose `sling:resourceType` matches this
   * entry. Listing some explicitly + setting `discover: true` is allowed
   * (and useful for nailing down known templates while still picking up
   * new ones automatically).
   */
  templates: ReadonlyArray<string>;
  /**
   * Auto-discover templates by scanning extracted raw content for distinct
   * `cq:template` values on `jcr:content` nodes that carry this entry's
   * resource type. Requires `aem-extract` to have populated
   * `output/cache/aem/content/` first — first-run schema with `discover: true` and
   * no explicit `templates` emits nothing and logs a hint to run extract.
   *
   * Default: false.
   */
  discover?: boolean;
  /**
   * Per-template overrides for the emitted Sanity document type name and/or
   * Studio title, keyed by `cq:template` path. Values are either the type
   * name as a plain string or an object carrying `name` and/or `title` —
   * same shape as `aem-component-names.json`. Without an override the name
   * derives from the template path with a `Page` suffix
   * (`.../templates/universal-page` → `universalPagePage`).
   *
   * Keys must match a path in {@link templates} unless {@link discover} is
   * `true` (a discovered template can be named before it's ever listed).
   * Like the component-name overrides, this is a
   * **set-once-before-first-import** knob — changing a name after content
   * is ingested renames the document type; re-import then needs
   * `--recreate-on-type-change`.
   */
  names?: Readonly<Record<string, TemplatePageNameOverride>>;
}

export type PageComponentConfig = Map<string, PageComponentConfigEntry>;

/** Sanity type names must be identifier-like; enforced at load so a typo fails fast. */
const VALID_TYPE_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

export interface LoadPageComponentConfigOptions {
  /** Absolute or relative path. Missing file → empty config. */
  file: string;
}

/**
 * Synchronous load — matches `loadContainerConfig` / `loadAuthoringHintConfig`.
 * Returns an empty Map when the file is absent so the feature is fully
 * optional. Throws on malformed JSON or invalid entries so a typo doesn't
 * silently disable per-template document emission.
 */
export function loadPageComponentConfig(
  opts: LoadPageComponentConfigOptions,
): PageComponentConfig {
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
      `page-components config: ${file} is not valid JSON (${(err as Error).message})`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `page-components config: ${file} must be a JSON object keyed by sling:resourceType`,
    );
  }

  const out: PageComponentConfig = new Map();
  const nameOwners = new Map<string, string>();
  for (const [resourceType, value] of Object.entries(parsed)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(
        `page-components config: entry for "${resourceType}" must be an object with a templates array`,
      );
    }
    const v = value as Record<string, unknown>;
    const rawTemplates = v.templates;
    const discover = v.discover === true;
    if (rawTemplates !== undefined && !Array.isArray(rawTemplates)) {
      throw new Error(
        `page-components config: entry for "${resourceType}" — "templates" must be an array when set`,
      );
    }
    const list: string[] = [];
    const seen = new Set<string>();
    for (const t of (rawTemplates ?? []) as unknown[]) {
      if (typeof t !== "string" || t.trim().length === 0) {
        throw new Error(
          `page-components config: entry for "${resourceType}" has a non-string / empty template path`,
        );
      }
      const trimmed = t.trim();
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
      list.push(trimmed);
    }
    if (list.length === 0 && !discover) {
      throw new Error(
        `page-components config: entry for "${resourceType}" needs either a non-empty "templates" array or "discover": true (or both)`,
      );
    }

    let names: Record<string, TemplatePageNameOverride> | undefined;
    if (v.names !== undefined) {
      if (!v.names || typeof v.names !== "object" || Array.isArray(v.names)) {
        throw new Error(
          `page-components config: "names" for "${resourceType}" must be an object keyed by cq:template path`,
        );
      }
      names = {};
      for (const [rawTemplate, rawOverride] of Object.entries(v.names)) {
        const template = rawTemplate.trim();
        if (!template) {
          throw new Error(
            `page-components config: "names" for "${resourceType}" has an empty cq:template key`,
          );
        }
        if (names[template]) {
          throw new Error(
            `page-components config: "names" for "${resourceType}" has duplicate entries for "${template}"`,
          );
        }
        if (!seen.has(template) && !discover) {
          throw new Error(
            `page-components config: "names" for "${resourceType}" targets "${template}", which is not in its "templates" list — fix the path or set "discover": true if the template should be picked up from extracted content`,
          );
        }

        let override: TemplatePageNameOverride;
        if (typeof rawOverride === "string") {
          override = { name: rawOverride };
        } else if (rawOverride && typeof rawOverride === "object" && !Array.isArray(rawOverride)) {
          const { name, title } = rawOverride as Record<string, unknown>;
          if (name !== undefined && typeof name !== "string") {
            throw new Error(
              `page-components config: "name" for template "${template}" (under "${resourceType}") must be a string`,
            );
          }
          if (title !== undefined && typeof title !== "string") {
            throw new Error(
              `page-components config: "title" for template "${template}" (under "${resourceType}") must be a string`,
            );
          }
          if (name === undefined && title === undefined) {
            throw new Error(
              `page-components config: names entry for template "${template}" (under "${resourceType}") needs "name" and/or "title"`,
            );
          }
          override = {
            ...(name !== undefined ? { name } : {}),
            ...(title !== undefined ? { title } : {}),
          };
        } else {
          throw new Error(
            `page-components config: names entry for template "${template}" (under "${resourceType}") must be a string type name or an object with "name" / "title"`,
          );
        }

        if (override.name !== undefined) {
          if (!VALID_TYPE_NAME.test(override.name)) {
            throw new Error(
              `page-components config: "${override.name}" (for template "${template}") is not a valid Sanity type name — use letters/digits/underscore, starting with a letter`,
            );
          }
          const owner = nameOwners.get(override.name);
          if (owner) {
            throw new Error(
              `page-components config: "${override.name}" is assigned to both "${owner}" and "${template}" — type names must be unique`,
            );
          }
          nameOwners.set(override.name, template);
        }
        if (override.title !== undefined && override.title.trim().length === 0) {
          throw new Error(
            `page-components config: "title" for template "${template}" (under "${resourceType}") must not be empty`,
          );
        }
        names[template] = override;
      }
    }

    out.set(resourceType, {
      templates: list,
      ...(discover ? { discover: true } : {}),
      ...(names && Object.keys(names).length > 0 ? { names } : {}),
    });
  }
  return out;
}
