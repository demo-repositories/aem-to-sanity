# aem-to-sanity-studio

Studio-side primitives for AEM → Sanity migrations. Tenant Studios import these instead of carrying file copies, so **migration-critical Studio surface updates with the toolkit**: when a pipeline stage starts depending on a new type, aspect, or input component, `pnpm -w toolkit:update` (or bumping the pinned release) delivers it — nothing to copy into operator studios by hand.

## Exports

| Export | What it is | Which stage needs it |
|---|---|---|
| `category` | Parent-child taxonomy document type ([pattern](https://www.sanity.io/docs/developer-guides/parent-child-taxonomy)) | `aem-tags` writes one `category` doc per `cq:Tag`; tagfield widgets emit `array of reference-to-category` |
| `aemFormComponents` | `form.components` for `defineConfig` — routes fields marked `options.aemWidget` (`buttonGroup` → toggle group, `note` → caution banner) to their inputs, and enables the built-in Portable Text table plugin (sanity ≥ 6.6) so migrated richtext tables are editable in place | Studio rendering of migrated Coral widgets + tables |
| `StringToggleGroupInput`, `NoteField`, `isNoteField` | The individual components behind `aemFormComponents`, exported for custom routing | — |
| `aemSourceAspect` (also `aem-to-sanity-studio/aspects/aemSource`) | Media Library aspect stamped on every uploaded asset (`damPath`, `assetInstanceId`) | `aem-assets` dedup + link steps |
| `aemBynderPlugin` | Flag-gated wiring for [`sanity-plugin-bynder-input`](https://github.com/sanity-io/plugins/tree/main/plugins/sanity-plugin-bynder-input): returns `[bynderInputPlugin({...})]` when `SANITY_STUDIO_BYNDER_PORTAL_URL` is set (options override env: `portalUrl`, `language`, `persistRawFields`), `[]` otherwise — spread into `plugins`. Registers the `bynder.asset` type the generated schemas reference and gives authors the Bynder Compact View to browse/pick assets. For full control, skip the helper and register `bynderInputPlugin(...)` yourself | Studios consuming a `MIGRATION_ASSET_BACKEND=bynder` migration |

## Usage in a tenant Studio

```ts
// schemas/index.ts
import { category } from "aem-to-sanity-studio";
export const allSchemaTypes = [...generatedSchemaTypes, category];

// sanity.config.ts
import { aemBynderPlugin, aemFormComponents } from "aem-to-sanity-studio";
export default defineConfig({
  // …
  // Bynder-backed migrations only: activates when
  // SANITY_STUDIO_BYNDER_PORTAL_URL is set in the Studio .env; no-op otherwise.
  plugins: [structureTool(), ...aemBynderPlugin()],
  form: { components: aemFormComponents },
});

// aspects/aemSource.ts — thin re-export; `sanity.cli.ts` points
// `mediaLibrary.aspectsPath` at the aspects/ directory
export { default } from "aem-to-sanity-studio/aspects/aemSource";
```

The tenant Studio template (`tenants/template/studio/`) ships wired this way already. Peer dependencies: `sanity` v6, `react`, `@sanity/ui`, `styled-components`.
