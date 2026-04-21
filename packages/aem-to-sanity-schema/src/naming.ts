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

export function toCamelCase(input: string): string {
  const words = input
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/);
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
