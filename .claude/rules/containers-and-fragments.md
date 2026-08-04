---
paths:
  - "packages/aem-to-sanity-core/src/config/containers.ts"
  - "packages/aem-to-sanity-content/src/transform.ts"
  - "**/aem-component-containers.json"
---

# Container modes and content-fragment extraction

`aem-component-containers.json` declares how nested (component-in-component) AEM structures migrate. Entry shape (`ContainerConfigEntry`, `packages/aem-to-sanity-core/src/config/containers.ts`):

```json
{
  "uxp/components/structure/page":          { "childrenField": "items" },
  "uxp/components/proxy/content/container": { "childrenField": "items", "flatten": true },
  "uxp/components/proxy/content/tabs":      { "childrenField": "items", "document": true }
}
```

- `childrenField` (required) — field name that carries child blocks. At schema time a synthetic `pageBuilder`-typed field with this name is appended (skipped if the dialog already declares that field name). At transform time children are collected through `nt:unstructured` layout wrappers (`collectContainerItems`) into `inline[childrenField]`.
- `flatten: true` — drop the container's own block, hoist children into the parent array. Purpose: layout containers are everywhere in AEM; don't replicate that nesting in Sanity, and stay under Sanity's 20-level attribute-depth limit.
- `document: true` — extract every instance into a standalone `contentFragment` document, replaced in-place by a `contentFragmentRef` block referencing it. Purpose: deeply nested components (tabs-in-tabs-in-tabs) that would blow the depth limit even after flattening.
- **`flatten` + `document` together is a hard load error** — a flattened container has no block to extract.

## Invariants to preserve in `collectPageBuilder` (transform.ts)

1. **Panel exception on flatten**: a flatten container carrying `cq:panelTitle` keeps its block (`isPanel`). Tabs/accordion panels reuse the same layout resource type as plain containers, and the panel title + boundary are authored content. Removing this exception silently merges tab panels together.
2. **Deterministic fragment ids**: fragment `_id` = `${pageDocId}-frag-${blockKey}` where `blockKey` is stable (`jcr:uuid` or JCR path). This is what makes `document: true` idempotent across re-runs — never derive fragment ids from array position or randomness.
3. **Fragments import atomically with their page**: `ctx.fragments` are written into the *same* clean file (`{ jcrPath, slug, docs: [pageDoc, ...fragments] }`) so `aem-import` puts them in one transaction. Don't move fragments to separate files — a half-imported page with dangling refs is worse than a failed page.
4. **Fragment title precedence**: `inline.title` → `inline.panelTitle` → `inline.accessibilityLabel` → `` `${nearest enclosing cq:panelTitle ?? pageTitle} — ${sanityType}` ``. Titles are what operators see in the Studio document list; keep them human.
5. **Depth safety net is independent of config**: `enforceAttributeDepthBudget` (SANITY_MAX_ATTRIBUTE_DEPTH = 20) auto-extracts the deepest chain into fragments even with no `document: true` config, cutting where the subtree fits within limit − 2. It also runs over config-extracted fragments. Audit keys: `configExtractedFragments`, `depthExtractedFragments`, `depthFlattenedPanels` (lossy last resort). If you change the budget math, keep the −2 headroom (fragment doc + its `content` array re-add depth).
6. `contentFragment` / `contentFragmentRef` are reserved type names (`naming.ts`) and their schema types are emitted unconditionally by `migrate:schema` — a component named "contentFragment" in AEM must not collide.

## Other structural rules in the same walk

- Nested `cq:Page` subtrees are skipped + audited (`childPageSkipped`) — child pages are their own migration roots.
- `aem-component-exceptions` resource types skip the whole subtree.
- Declared page-shell resource types are walked through without emitting a block.

## When container behavior changes

Per CLAUDE.md triggers: update the "Container components" section in `packages/aem-to-sanity-schema/src/docs.ts`, regenerate `docs/aem-to-sanity-mapping.md`, mirror in `docs/running-the-migration.md` § 1c-quater + content package README. Then actually re-run `transform` against a local tenant — typecheck alone doesn't exercise the tree walk.
