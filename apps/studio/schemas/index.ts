/**
 * Re-exports from the `davids-bridal` example's generated schemas barrel.
 *
 * Studio consumers should import `allSchemaTypes` from here (or inline their
 * own mapping when they want to filter / rename before handing it to
 * `defineConfig({ schema: { types } })`).
 *
 * This shim exists so the Studio's imports stay stable regardless of where
 * the schemas were emitted — change the example path in one place and every
 * downstream reference follows.
 */
export { allSchemaTypes } from "../../../examples/davids-bridal/output/schemas/index.ts";
