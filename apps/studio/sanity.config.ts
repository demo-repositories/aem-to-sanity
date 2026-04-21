import { defineConfig } from "sanity";
import { structureTool } from "sanity/structure";
import { sanitizeSchemaTypes } from "aem-to-sanity-schema/sanitize";
import { allSchemaTypes } from "./schemas/index.ts";

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
  title: "AEM → Sanity (davids-bridal example)",
  projectId:
    process.env.SANITY_STUDIO_PROJECT_ID ?? process.env.SANITY_PROJECT_ID ?? "",
  dataset:
    process.env.SANITY_STUDIO_DATASET ?? process.env.SANITY_DATASET ?? "production",
  plugins: [structureTool()],
  schema: {
    types: sanitizeSchemaTypes(allSchemaTypes),
  },
});
