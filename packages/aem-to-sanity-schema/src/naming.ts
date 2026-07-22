/**
 * Sanity built-in type names that can't be re-used for user-defined types.
 * Shared across the emitter pipeline (`resolveSanityTypeNames`) and the
 * Studio-side `sanitizeSchemaTypes` defense-in-depth step so both agree on
 * what counts as a collision.
 */
export const RESERVED_SANITY_TYPE_NAMES: ReadonlySet<string> = new Set<string>([
  "image",
  "file",
  "geopoint",
  "reference",
  "slug",
  "url",
  "text",
  "string",
  "number",
  "boolean",
  "date",
  "datetime",
  "block",
  "object",
  "array",
  "email",
  "span",
]);

/**
 * Convert an AEM component path into a stable, camelCase Sanity type name.
 *
 *   /apps/aem-integration/components/promo           → "promo"
 *   /apps/aem-integration/components/variable-column → "variableColumn"
 *   /apps/.../components/hero/banner                 → "heroBanner"
 */
export function componentPathToTypeName(componentPath: string): string {
  const segments = componentPath.split("/").filter(Boolean);
  const marker = segments.lastIndexOf("components");
  const tail = marker >= 0 ? segments.slice(marker + 1) : segments.slice(-1);
  if (tail.length === 0) {
    throw new Error(`Cannot derive type name from path: ${componentPath}`);
  }
  const joined = tail.join("-");
  return toCamelCase(joined);
}

/**
 * General-purpose camelCase for AEM `name` values (e.g. `./contentPosition`),
 * hyphenated paths (`hero-video-banner`), and slugs. Inserts word breaks at
 * camelCase / PascalCase boundaries so `contentPosition` → `contentPosition`,
 * not `contentposition`.
 */
export function toCamelCase(input: string): string {
  const spaced = input
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
  const words = spaced.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      return i === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
}

export function toTitleCase(input: string): string {
  const words = input
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/);
  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * AEM `cq:Component` nodes often use `jcr:title` like "Hero video banner component".
 * Strip a trailing " component" for Studio labels (redundant with the context).
 */
export function displayTitleFromAemComponentJcrTitle(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  const stripped = t.replace(/\s+component$/i, "").trim();
  return stripped.length > 0 ? stripped : t;
}

/**
 * How `resolveSanityTypeNames` derives each component's base name.
 *
 * - `"path"` (default): from the JCR path segments after `components/`
 *   (`proxy/content/cardcontainer` → `proxyContentCardcontainer`). Paths are
 *   unique by construction, so names are maximally stable.
 * - `"title"`: from the component's `jcr:title` (`"Card Container"` →
 *   `cardContainer`), falling back to the path-derived name when the title
 *   is missing/empty. Titles are NOT unique — collisions keep the
 *   first-in-file-order winner clean and suffix later ones with their
 *   path-derived name. Titles are also mutable in AEM: renaming a
 *   component after content has been imported renames its Sanity type and
 *   orphans the previously ingested `_type` values. Opt-in via
 *   `MIGRATION_TYPE_NAMING=title`; set before the first import and treat a
 *   later change like a full re-migration.
 */
export type TypeNamingStrategy = "path" | "title";

export interface ResolveSanityTypeNamesOptions {
  strategy?: TypeNamingStrategy;
  /**
   * `componentPath → jcr:title`, required for the `"title"` strategy (the
   * caller pre-fetches component nodes to know titles). Paths absent from
   * the map fall back to path-derived names.
   */
  titleByPath?: ReadonlyMap<string, string>;
  /**
   * Called once per path whose final name deviated from the strategy's
   * clean derivation (missing title, title collision, reserved name).
   * Lets the CLI surface every fallback so operators aren't surprised by
   * the emitted names.
   */
  onFallback?: (path: string, reason: string, finalName: string) => void;
}

function aemPrefix(name: string): string {
  return "aem" + name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Resolve every AEM component path to a final, collision-free Sanity type
 * name. Returns a `Map<path, typeName>` preserving the input paths verbatim
 * as keys.
 *
 * The emitted name is the authoritative identifier: it's what lands on disk
 * (`{name}.ts`), what gets registered in `pageBuilder.of[]`, what the
 * content registry writes as `sanityType`, and what the ingest pipeline
 * stamps onto `_type` in every document. Resolving up front (rather than
 * per-path inside the Studio with `sanitizeSchemaTypes`) is what keeps all
 * those artifacts in lockstep — otherwise a later rename leaves ingested
 * data orphaned as "unknown type" in the Studio.
 *
 * Resolution rules (`"path"` strategy, the default):
 *   1. Base name: `componentPathToTypeName(path)`.
 *   2. If the base collides with a Sanity built-in (`RESERVED_SANITY_TYPE_NAMES`)
 *      or with a name already assigned to another path, prefix with `aem`.
 *   3. If that's still taken, append a numeric suffix (`aemImage2`, etc.).
 *
 * Resolution rules (`"title"` strategy):
 *   1. Base name: `toCamelCase` of the component's `jcr:title` (with the
 *      redundant trailing " component" stripped, same as Studio labels);
 *      missing/empty title falls back to the path-derived base.
 *   2. Reserved built-in → `aem` prefix (same rule as paths).
 *   3. Name already assigned to another path → append the PascalCased
 *      path-derived name (`image` + `ProxyContentImage` →
 *      `imageProxyContentImage`), so the suffix itself is meaningful and
 *      deterministic. When the base already IS the path-derived name (title
 *      was missing), the `aem` prefix applies instead — no doubled segments.
 *   4. Still taken (identical title AND identical path tail) → numeric
 *      suffix, as a last resort.
 *
 * Iteration order is the input order — earlier paths win ties, which gives
 * deterministic output for a given `aem-component-paths` list.
 */
export function resolveSanityTypeNames(
  componentPaths: readonly string[],
  opts: ResolveSanityTypeNamesOptions = {},
): Map<string, string> {
  const { strategy = "path", titleByPath, onFallback } = opts;
  const assigned = new Map<string, string>();
  const taken = new Set<string>();

  for (const path of componentPaths) {
    const pathBase = componentPathToTypeName(path);
    let base = pathBase;
    let fallbackReason: string | undefined;

    if (strategy === "title") {
      const rawTitle = titleByPath?.get(path)?.trim();
      const titleBase = rawTitle
        ? toCamelCase(displayTitleFromAemComponentJcrTitle(rawTitle))
        : "";
      if (titleBase) {
        base = titleBase;
      } else {
        fallbackReason = "no usable jcr:title — using the path-derived name";
      }
    }

    let name = base;
    if (strategy === "path") {
      if (RESERVED_SANITY_TYPE_NAMES.has(name) || taken.has(name)) {
        name = aemPrefix(base);
      }
    } else {
      if (RESERVED_SANITY_TYPE_NAMES.has(name)) {
        name = aemPrefix(base);
        fallbackReason ??= `"${base}" is a built-in Sanity type — prefixed with "aem"`;
      }
      if (taken.has(name)) {
        name =
          base !== pathBase
            ? base + pathBase.charAt(0).toUpperCase() + pathBase.slice(1)
            : aemPrefix(base);
        fallbackReason = `title-derived name already taken by an earlier component — disambiguated with the path-derived suffix`;
      }
    }
    if (taken.has(name)) {
      const root = name;
      let suffix = 2;
      do {
        name = `${root}${suffix++}`;
      } while (taken.has(name));
      fallbackReason ??= "name collision — numeric suffix appended";
    }

    assigned.set(path, name);
    taken.add(name);
    if (fallbackReason) onFallback?.(path, fallbackReason, name);
  }

  return assigned;
}
