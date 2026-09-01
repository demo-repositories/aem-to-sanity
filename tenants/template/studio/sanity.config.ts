import { defineConfig } from "sanity";
import { structureTool } from "sanity/structure";
import { sanitizeSchemaTypes } from "aem-to-sanity-schema/sanitize";
import { allSchemaTypes } from "./schemas/index.ts";
import { aemBynderPlugin, aemFormComponents } from "aem-to-sanity-studio";

/**
 * Example Studio that consumes the schemas emitted by `aem-to-sanity-schema`.
 *
 * `sanitizeSchemaTypes` handles the two cases where an AEM → Sanity mapping
 * produces on-disk schemas that Sanity Studio refuses to load as-is:
 *   - type names colliding with Sanity built-ins (e.g. `image`) get an `aem`
 *     prefix;
 *   - object types with zero fields get a hidden placeholder field.
 * The emitted files stay faithful to AEM's shape; this transform is applied
 * at import time.
 */
export default defineConfig({
  name: "default",
  title: "AEM → Sanity Studio",
  projectId:
    process.env.SANITY_STUDIO_PROJECT_ID ?? process.env.SANITY_PROJECT_ID ?? "",
  dataset:
    process.env.SANITY_STUDIO_DATASET ?? process.env.SANITY_DATASET ?? "production",
  // `aemBynderPlugin()` is flag-gated wiring for MIGRATION_ASSET_BACKEND=bynder
  // migrations: it registers sanity-plugin-bynder-input (the `bynder.asset`
  // type + Bynder browse/pick input) only when SANITY_STUDIO_BYNDER_PORTAL_URL
  // is set in the Studio .env — a no-op otherwise. To customize the plugin
  // (asset filters, language, persistRawFields), replace the spread with your
  // own `bynderInputPlugin({...})` call.
  plugins: [structureTool(), ...aemBynderPlugin()],
  schema: {
    types: sanitizeSchemaTypes(allSchemaTypes),
  },
  // Custom inputs for migrated AEM widgets (e.g. buttongroup → toggle
  // buttons). Fields are routed by the `options.aemWidget` marker the schema
  // emitter writes; everything else renders the Studio default.
  form: {
    components: aemFormComponents,
  },
});
