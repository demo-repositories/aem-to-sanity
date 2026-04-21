import { defineField } from "sanity";

/**
 * Sanity built-in type names that can't be re-used for user types. Any AEM
 * component whose emitted name collides with one of these is renamed at
 * import time so the Studio schema validates.
 */
const RESERVED = new Set<string>([
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

function aemPrefix(name: string): string {
  return "aem" + name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Post-process emitted Sanity schemas so that they validate under `sanity
 * schema validate`:
 *
 *   1. Types whose name collides with a Sanity built-in are prefixed with
 *      `aem` (e.g. `image` → `aemImage`).
 *   2. Object types with zero fields get a hidden `aemPlaceholder` string
 *      field. AEM dialogs occasionally consist entirely of hidden/unmapped
 *      children and would otherwise fail Sanity's "at least one field" rule.
 *
 * The schema files on disk are untouched — the fix is applied at import time
 * so the emitted artifact remains a faithful AEM-shape snapshot. Call this
 * from your Studio config when wiring `allSchemaTypes` into `defineConfig`.
 */
export function sanitizeSchemaTypes<T>(types: T[]): T[] {
  return types.map((raw) => {
    const t = { ...(raw as Record<string, unknown>) };
    if (typeof t.name === "string" && RESERVED.has(t.name)) {
      t.name = aemPrefix(t.name);
    }
    const isContainer = t.type === "object" || t.type === "document";
    if (isContainer) {
      const fields = Array.isArray(t.fields) ? t.fields : [];
      if (fields.length === 0) {
        t.fields = [
          defineField({
            name: "aemPlaceholder",
            type: "string",
            description:
              "AEM dialog had no mappable fields; this placeholder exists so the schema validates.",
            hidden: true,
          }),
        ];
      }
    }
    return t as T;
  });
}
