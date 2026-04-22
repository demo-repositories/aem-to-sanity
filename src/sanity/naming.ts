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

export function displayTitleFromAemComponentJcrTitle(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  const stripped = t.replace(/\s+component$/i, "").trim();
  return stripped.length > 0 ? stripped : t;
}
