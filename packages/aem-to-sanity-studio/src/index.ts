/**
 * Studio-side primitives for AEM → Sanity migrations.
 *
 * Tenant Studios (and the repo's verification Studio) import these instead of
 * carrying copies, so migration-critical Studio surface ships with the
 * toolkit: when a pipeline stage starts depending on a new type, aspect, or
 * input component, `pnpm -w toolkit:update` + `pnpm install` delivers it —
 * no file copying into operator studios.
 *
 * - `category` — parent-child taxonomy document type populated by `aem-tags`;
 *   tagfield widgets emit `array of reference-to-category`.
 * - `aemFormComponents` — `form.components` for `defineConfig`; routes fields
 *   the schema emitter marked with `options.aemWidget` (buttonGroup, note) to
 *   their Studio inputs.
 * - `aemSourceAspect` — Media Library aspect stamped by `aem-assets` for
 *   cross-run dedup. Also exposed as the `./aspects/aemSource` entry point so
 *   an aspect file can re-export it without pulling in React.
 * - `aemBynderPlugin` — flag-gated `sanity-plugin-bynder-input` wiring for
 *   `MIGRATION_ASSET_BACKEND=bynder` migrations; activates only when
 *   `SANITY_STUDIO_BYNDER_PORTAL_URL` is set.
 */
export { category } from "./schemas/category.js";
export { aemBynderPlugin } from "./plugins/bynder.js";
export type { AemBynderPluginOptions } from "./plugins/bynder.js";
export {
  aemFormComponents,
  StringToggleGroupInput,
} from "./components/StringToggleGroupInput.js";
export { NoteField, isNoteField } from "./components/NoteField.js";
export { default as aemSourceAspect } from "./aspects/aemSource.js";
