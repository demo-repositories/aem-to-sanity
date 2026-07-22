---
"aem-to-sanity-schema": minor
---

Title-based type naming via `MIGRATION_TYPE_NAMING=title`.

By default, component Sanity type names (and schema file names, registry `sanityType`s, and ingested `_type`s) derive from the JCR path after `components/` — `proxy/content/cardcontainer` → `proxyContentCardcontainer`. Setting `MIGRATION_TYPE_NAMING=title` derives them from each component's `jcr:title` instead: `"Card Container"` → `cardContainer`, with the redundant trailing " component" stripped the same way Studio labels are.

Behavior in title mode:

- `migrate:schema` runs an extra pre-pass fetching component nodes so titles are known before names resolve; the main pass reuses the fetched nodes (no double fetch).
- Missing/blank `jcr:title` falls back to the path-derived name.
- Title collisions keep the first component (in `aem-component-paths` order) clean; later ones get their path-derived name as a suffix (`teaser`, `teaserProxyContentTeaser`). Reserved Sanity built-ins still get the `aem` prefix.
- Every fallback is logged at info level.

Operator notes:

- Default is unchanged (`path`) — existing tenants need no changes.
- **Pick the strategy once, before the first import.** Switching later — or renaming a component's `jcr:title` in AEM — renames the emitted types and orphans previously ingested `_type` values; recovering requires `--recreate-on-type-change` or a fresh dataset.
- Custom `_type` values must be mirrored in the consuming frontend's block dispatcher.
