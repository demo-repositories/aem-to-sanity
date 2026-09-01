import { bynderInputPlugin } from "sanity-plugin-bynder-input";
import type { PluginOptions } from "sanity";

export interface AemBynderPluginOptions {
  /**
   * Bynder portal origin (e.g. `https://acme.bynder.com`). Defaults to
   * `SANITY_STUDIO_BYNDER_PORTAL_URL`. The `SANITY_STUDIO_` prefix is
   * required — it's the only env namespace Sanity's bundler exposes to the
   * browser, and the Compact View picker runs client-side.
   */
  portalUrl?: string;
  /** Compact View UI language. Defaults to `SANITY_STUDIO_BYNDER_LANGUAGE`, else `en_US`. */
  language?: string;
  /**
   * Persist the full raw Bynder payload alongside the canonical
   * `bynder.asset` fields when an author re-picks an asset. Defaults to the
   * plugin's own default (`true`).
   */
  persistRawFields?: boolean;
}

/**
 * Flag-gated wiring for `sanity-plugin-bynder-input`, for migrations run
 * with `MIGRATION_ASSET_BACKEND=bynder` (the schema emitter declares asset
 * fields as `bynder.asset`, and `aem-assets` ingests matching values).
 *
 * Spread into `defineConfig({ plugins })`:
 *
 * ```ts
 * plugins: [structureTool(), ...aemBynderPlugin()],
 * ```
 *
 * Activation is driven by `SANITY_STUDIO_BYNDER_PORTAL_URL` (set it in the
 * Studio's `.env`): unset → returns `[]` and the Studio is exactly as before
 * (Media Library-backed migrations need no change). Set → registers the
 * plugin, which provides the `bynder.asset` schema type and the Bynder
 * Compact View browse/pick input for every migrated asset field.
 *
 * Overridable: pass explicit options here, or drop the helper and register
 * `bynderInputPlugin(...)` yourself for full control (asset filters,
 * `compactViewOptions`, etc.) — the helper is convenience wiring, not a
 * requirement. In bynder-backend migrations the plugin itself IS required
 * one way or the other: without it the generated schemas reference an
 * unknown `bynder.asset` type and the Studio fails to load.
 */
export function aemBynderPlugin(
  options: AemBynderPluginOptions = {},
): PluginOptions[] {
  const portalUrl =
    options.portalUrl ?? process.env.SANITY_STUDIO_BYNDER_PORTAL_URL;
  if (!portalUrl?.trim()) return [];
  const language =
    options.language ?? process.env.SANITY_STUDIO_BYNDER_LANGUAGE ?? "en_US";
  return [
    bynderInputPlugin({
      // The Compact View wants the portal URL with a trailing slash.
      portalConfig: { url: portalUrl.trim().replace(/\/*$/, "/") },
      compactViewOptions: { language },
      ...(options.persistRawFields !== undefined
        ? { persistRawFields: options.persistRawFields }
        : {}),
    }),
  ];
}
