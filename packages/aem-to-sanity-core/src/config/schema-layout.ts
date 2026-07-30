/** Default layout for the generated schemas directory: everything flat. */
export const DEFAULT_SCHEMA_LAYOUT = "flat";

/**
 * On-disk layout of the generated schemas directory.
 *
 * - `flat` — every emitted `{type}.ts` sits directly in the schemas dir
 *   (legacy behavior, the default).
 * - `kind` — files are grouped by the emitted Sanity type kind:
 *   `documents/` for document types (`page`, per-template page docs,
 *   `contentFragment`) and `objects/` for everything else (components,
 *   the page-builder array, Portable Text table types, `contentFragmentRef`).
 *
 * Per-component `folder` overrides in `aem-component-names.json` take
 * precedence in both layouts. The barrel `index.ts` always stays at the
 * root of the schemas dir, so Studio imports are unaffected.
 */
export type SchemaLayout = "flat" | "kind";

const VALID_LAYOUTS: ReadonlySet<string> = new Set(["flat", "kind"]);

/**
 * Resolve the generated-schemas layout from `MIGRATION_SCHEMA_LAYOUT`.
 *
 * Unlike the naming knobs, this is **not** set-once: switching layouts (or
 * a `folder` override) only moves files on disk — emitted type names and
 * ingested `_type` values are unchanged, and the pruner removes copies left
 * at the old locations on the next `migrate:schema` run.
 *
 * Unset / blank → {@link DEFAULT_SCHEMA_LAYOUT} (backward compatible).
 */
export function resolveSchemaLayout(
  env: NodeJS.ProcessEnv = process.env,
): SchemaLayout {
  const raw = env.MIGRATION_SCHEMA_LAYOUT?.trim();
  if (!raw) return DEFAULT_SCHEMA_LAYOUT;
  if (!VALID_LAYOUTS.has(raw)) {
    throw new Error(
      `MIGRATION_SCHEMA_LAYOUT="${raw}" is not a valid layout — use "flat" (everything at the top level) or "kind" (documents/ and objects/ subfolders).`,
    );
  }
  return raw as SchemaLayout;
}
