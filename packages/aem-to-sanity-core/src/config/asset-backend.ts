/**
 * Which platform migrated assets live on — decides what `migrate:schema`
 * emits for image/file dialog fields and what `aem-assets` rewrites
 * `/content/dam/...` references into.
 *
 * - `"media-library"` (default): binaries are downloaded from AEM, uploaded
 *   to the Sanity Media Library, and linked into the project dataset;
 *   image/file fields emit as native `image` / `file` types and clean docs
 *   get `{_type: 'image', asset: {_ref}}` references.
 * - `"bynder"`: assets are assumed to already live in a Bynder portal
 *   (migrated out-of-band, each stamped with a metaproperty holding its
 *   legacy AEM DAM path). `aem-assets` skips download/upload entirely and
 *   resolves each DAM path against Bynder; image/file fields emit as
 *   `bynder.asset` objects (the type registered by
 *   `sanity-plugin-bynder-input`) and clean docs get the plugin's persisted
 *   value shape.
 */
export type AssetBackend = "media-library" | "bynder";

export const DEFAULT_ASSET_BACKEND: AssetBackend = "media-library";

/**
 * Sanity type name registered by `sanity-plugin-bynder-input`. Emitted for
 * image/file dialog fields when the backend is `bynder`, and used as the
 * `_type` of the rewritten field values, so the Studio renders migrated
 * assets in the plugin's Bynder picker.
 */
export const BYNDER_ASSET_TYPE_NAME = "bynder.asset";

/**
 * Resolve the asset backend from `MIGRATION_ASSET_BACKEND`.
 *
 * Read by BOTH `migrate:schema` (emitted field types) and `aem-assets`
 * (rewritten field values), so the schema and the ingested content stay in
 * sync. Set-once-before-first-import knob: switching backends later changes
 * every emitted asset field type and orphans previously ingested field
 * values (a `bynder.asset` object won't validate against an `image` field
 * and vice versa).
 *
 * Unset / blank → {@link DEFAULT_ASSET_BACKEND} (backward compatible).
 */
export function resolveAssetBackend(
  env: NodeJS.ProcessEnv = process.env,
): AssetBackend {
  const raw = env.MIGRATION_ASSET_BACKEND?.trim();
  if (!raw) return DEFAULT_ASSET_BACKEND;
  if (raw === "media-library" || raw === "bynder") return raw;
  throw new Error(
    `MIGRATION_ASSET_BACKEND="${raw}" is invalid — use "media-library" (default; Sanity Media Library upload + dataset link) or "bynder" (resolve assets already migrated into a Bynder portal).`,
  );
}
