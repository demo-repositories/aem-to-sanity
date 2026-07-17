# aem-to-sanity-schema

Reads AEM Granite UI component dialog definitions and emits:

- Sanity object schemas (`defineType` / `defineField` TypeScript files — one per AEM component)
- Matching TypeScript types via official Sanity TypeGen (`sanity schema extract` + `sanity typegen generate`)
- A migration report (`migration-report.json`) with per-component outcome and unmapped fields
- An audit artifact pointing at concrete JSON examples of unmapped AEM resource types — makes extending the mapping table straightforward

Usage (programmatic):

```ts
import { migrateSchemas } from "aem-to-sanity-schema";
```

Usage (CLI):

```sh
aem-to-sanity-schema                  # read config from env/.env
aem-to-sanity-schema --verbose        # + log every AEM GET
aem-to-sanity-schema --continue-on-auth
```

Flags:

- `--verbose` / `-v` (or `AEM_VERBOSE=true`) — elevate logger to `debug`; surfaces every `GET {url}` + Sling `.N.json` depth-fallback retries issued by `aem-to-sanity-core`'s AEM fetcher.
- `--continue-on-auth` (or `AEM_CONTINUE_ON_AUTH=true`) — treat per-component 401/403 as per-path ACL skips and keep going, as long as at least one component succeeds. A circuit breaker still aborts on `N` consecutive auth failures with zero successes.

Startup banner (always printed at info level) shows what the run is about to connect to: AEM env + base URL, auth kind (basic: username only; bearer: `len=N, prefix=abcd…`), paths / roots files, output dir, concurrency. A Sanity preflight block reports `SANITY_PROJECT_ID` / `SANITY_DATASET` / token presence — the schema stage never calls Sanity, it's a config sanity check for the downstream content ingest.

Reserved-name handling: `resolveSanityTypeNames` (exported from this package) maps each AEM component path to its final Sanity type name up front. Bases that collide with Sanity built-ins (`image`, `file`, `slug`, `text`, etc.) are prefixed with `aem` at emission time, and the same resolved name lands in `schemas/*.ts`, `pageBuilder.of[]`, and `content-type-registry.json` — so the Studio never has to rename and ingested `_type` values match what the schema registers.

Content registry carries Sanity types: each entry's `fields` is `Array<{name, type}>`, not just names. `aem-transform` reads those types to coerce AEM values into the exact Sanity shape — for example, HTML strings on `array-of-blocks` fields (AEM's `cq/gui/components/authoring/dialog/richtext`) are converted into Portable Text at ingest. Legacy `fields: string[]` registries are still read, minus the coercion.

**Coral buttongroup (`granite/ui/components/coral/foundation/form/buttongroup`).** Single selection mode emits a `string` with `options.list` from the dialog's literal `items` (an item flagged `selected` becomes the `initialValue`) plus a non-standard `options.aemWidget: "buttonGroup"` marker — the example Studio's `form.components.input` resolver routes marked fields to a toggle-button-group input (`apps/studio/components/inputs/StringToggleGroupInput.tsx`); Studios without the resolver fall back to the default dropdown. Multiple selection mode emits `array` of `string` with the same list (Sanity's built-in checkbox rendering). Datasource-driven items (ACS Commons generic lists etc.) are resolved server-side in AEM and opaque over `.infinity.json`, so those fields emit without options; values still migrate.

Container components are declared in `aem-component-containers.json` (override with `AEM_COMPONENT_CONTAINERS_FILE`). For each listed `sling:resourceType`, the emitter appends a synthetic `defineField({ name: childrenField, type: "pageBuilder" })` so the Studio palette inside the container mirrors the top-level page builder. The content transform consumes the same file to recursively emit drop-zone children (cq:isContainer pattern: JCR keys whose values are nodes carrying their own `sling:resourceType`) as nested pageBuilder blocks. Missing file → no container behavior.

**Authoring hints (`cq:panelTitle` and friends).** AEM stores some authoring metadata outside the dialog — most notably the panel heading on accordion / expander panel children, which lives on `cq:panelTitle` rather than a dialog property. Per-project opt-ins live in `aem-component-hints.json` (override with `AEM_COMPONENT_HINTS_FILE`); listed components get a `readOnly` `string` field declared per hint (rename vocabulary `cq:panelTitle` → `panelTitle` is global in `packages/aem-to-sanity-core/src/aem/authoring-hints.ts`). The content transform consumes the same file to lift the value at migration time. Non-listed components stay clean — no extra fields added, no transform-time renames.

**Page-shell components (`aem-page-components.json`).** AEM pages put their dialog on `jcr:content` via a "page" component (e.g. `/apps/uxp/components/structure/page`); a sibling `cq:template` identifies what kind of page it is. Declare each page-shell `sling:resourceType` and its templates in `aem-page-components.json` (override with `AEM_PAGE_COMPONENTS_FILE`). Two modes supported and combinable: `"templates": [...]` lists templates explicitly, `"discover": true` auto-enumerates them by scanning `output/cache/aem/content/` (populated by `aem-extract`) for `cq:template` values on matching `jcr:content` nodes. For every (resourceType, template) pair — explicit or discovered — the emitter renders one Sanity *document type* (`planDetailsPage.ts`, `newsArticlePage.ts`, …) whose fields are: `title` / `slug` / `tags` / `pageProperties` (an inline object typed against the page-shell dialog) / `featuredImage` (image) / `cqTemplate` (read-only string) / `pageBuilder`. The page-shell object type is automatically excluded from `pageBuilder.of[]` since it belongs on `jcr:content`, not in the body. A `page-templates.json` manifest is written to `output/cache/` so `aem-transform` can route each raw page to the right `_type`. Missing / empty file → no per-template docs, every page uses the generic `page` doc (fully backwards compatible).

**Named-slot auto-discovery.** Some AEM components nest a single fixed-name child component under a JCR key (e.g. `media-paragraph.content` = a `content` block). These aren't dialog fields and aren't drop-zones — they're slots, and they only show up in authored content. `migrate:schema` scans `output/cache/aem/content/` after the dialog pass and emits a `defineField({ name: slotKey, type: childTypeName })` for each discovered slot so the Studio shows typed inline data instead of "Unknown fields" warnings. No config. First run has no content to scan (returns empty); rerun after `aem-extract` and slots materialize. Container parents skip slot synthesis — their drop-zone logic already claims resourceType-carrying children.

**Dialog inheritance via `sling:resourceSuperType`.** When a component listed in `aem-component-paths` has no `cq:dialog` of its own, the migrator walks the `sling:resourceSuperType` chain (across `/apps` then `/libs`, AEM's lookup order) until it finds a dialog. This is what AEM does at request time to resolve which dialog opens for an authored instance — proxy components like `/apps/<site>/components/proxy/foo` that extend a versioned base or an Adobe Core component would otherwise fail with a 404. Resolution chains are recorded in `migration-report.json` under each component's `supertypeChain` field (omitted for direct hits) and logged at info level during the run. Registry keys remain the original proxy path's resource type — so authored content with `sling:resourceType: <proxy>` keeps matching its emitted Sanity type even though the dialog fields came from an ancestor.

> Status: scaffold. See repo root for the refactor plan.
