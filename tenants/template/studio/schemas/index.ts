/**
 * Re-exports from the generated schemas barrel that lives alongside this
 * Studio (`./generated/`). The `aem-to-sanity-schema` CLI writes there when
 * the tenant's `.env` sets `SCHEMAS_OUT_DIR` to
 * `./studio/schemas/generated`.
 *
 * `category` is hand-authored — it implements Sanity's parent-child taxonomy
 * pattern and is populated by `aem-tags` from `/content/cq:tags`. Tagfield
 * widgets on AEM dialogs emit `array of reference-to-category` fields that
 * resolve to these docs.
 *
 * Studio consumers should import `allSchemaTypes` from here (or inline their
 * own mapping when they want to filter / rename before handing it to
 * `defineConfig({ schema: { types } })`).
 */
import { allSchemaTypes as generatedSchemaTypes } from "./generated/index.ts";
import { category } from "./category.ts";

export const allSchemaTypes = [...generatedSchemaTypes, category];
export { category };
