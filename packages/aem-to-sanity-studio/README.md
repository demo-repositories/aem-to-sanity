# aem-to-sanity-studio

Studio-side primitives for AEM → Sanity migrations. Tenant Studios import these instead of carrying file copies, so **migration-critical Studio surface updates with the toolkit**: when a pipeline stage starts depending on a new type, aspect, or input component, `pnpm -w toolkit:update` (or bumping the pinned release) delivers it — nothing to copy into operator studios by hand.

## Exports

| Export | What it is | Which stage needs it |
|---|---|---|
| `category` | Parent-child taxonomy document type ([pattern](https://www.sanity.io/docs/developer-guides/parent-child-taxonomy)) | `aem-tags` writes one `category` doc per `cq:Tag`; tagfield widgets emit `array of reference-to-category` |
| `aemFormComponents` | `form.components` for `defineConfig` — routes fields marked `options.aemWidget` (`buttonGroup` → toggle group, `note` → caution banner) to their inputs, and enables the built-in Portable Text table plugin (sanity ≥ 6.6) so migrated richtext tables are editable in place | Studio rendering of migrated Coral widgets + tables |
| `StringToggleGroupInput`, `NoteField`, `isNoteField` | The individual components behind `aemFormComponents`, exported for custom routing | — |
| `aemSourceAspect` (also `aem-to-sanity-studio/aspects/aemSource`) | Media Library aspect stamped on every uploaded asset (`damPath`, `assetInstanceId`) | `aem-assets` dedup + link steps |

## Usage in a tenant Studio

```ts
// schemas/index.ts
import { category } from "aem-to-sanity-studio";
export const allSchemaTypes = [...generatedSchemaTypes, category];

// sanity.config.ts
import { aemFormComponents } from "aem-to-sanity-studio";
export default defineConfig({
  // …
  form: { components: aemFormComponents },
});

// aspects/aemSource.ts — thin re-export; `sanity.cli.ts` points
// `mediaLibrary.aspectsPath` at the aspects/ directory
export { default } from "aem-to-sanity-studio/aspects/aemSource";
```

The tenant Studio template (`tenants/template/studio/`) ships wired this way already. Peer dependencies: `sanity` v6, `react`, `@sanity/ui`, `styled-components`.
