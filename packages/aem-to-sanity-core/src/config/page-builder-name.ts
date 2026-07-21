/** Default name for the generated page-builder array type and page-doc field. */
export const DEFAULT_PAGE_BUILDER_NAME = "pageBuilder";

/**
 * Sanity type / field names must be valid identifiers: the name is used as
 * the exported `const` in the generated `{name}.ts`, as the Sanity type
 * name, and as the page-document field key.
 */
const VALID_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * File-name collisions inside the generated schemas dir: `page.ts` is the
 * generic page document, `index.ts` is the barrel. Using either as the
 * page-builder name would overwrite them.
 */
const DISALLOWED_NAMES = new Set(["page", "index"]);

/**
 * Resolve the page-builder name from `MIGRATION_PAGE_BUILDER_NAME`.
 *
 * The value names three things that must agree: the generated Sanity array
 * type (`{name}.ts`, `defineType({ name })`), the field on every emitted
 * page document schema, and the key `aem-transform` writes page blocks
 * under. Both `migrate:schema` and `aem-transform` read it from the same
 * env var so the schema and the ingested content stay in sync — set it once
 * in the tenant `.env` before the first run and leave it alone (changing it
 * between a schema run and a transform run desyncs the two).
 *
 * Unset / blank → {@link DEFAULT_PAGE_BUILDER_NAME} (backward compatible).
 */
export function resolvePageBuilderName(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env.MIGRATION_PAGE_BUILDER_NAME?.trim();
  if (!raw) return DEFAULT_PAGE_BUILDER_NAME;
  if (!VALID_NAME_RE.test(raw)) {
    throw new Error(
      `MIGRATION_PAGE_BUILDER_NAME="${raw}" is not a valid Sanity type name — use letters, digits, and underscores, starting with a letter (e.g. "sections", "pageBlocks").`,
    );
  }
  if (DISALLOWED_NAMES.has(raw)) {
    throw new Error(
      `MIGRATION_PAGE_BUILDER_NAME="${raw}" collides with the generated ${raw}.ts in the schemas directory — pick a different name.`,
    );
  }
  return raw;
}
