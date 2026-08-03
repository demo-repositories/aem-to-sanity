---
"aem-to-sanity-core": minor
"aem-to-sanity-schema": minor
"aem-to-sanity-content": minor
"aem-to-sanity-studio": minor
"aem-to-sanity-cli": minor
---

Page-shell entries in `aem-page-components.json` now accept a `skipProperties` array naming `jcr:content` properties the migration should leave behind (tenant bookkeeping, legacy toggles, AEM-only rendering hints):

```json
{
  "uxp/components/structure/page": {
    "discover": true,
    "skipProperties": ["disableCache", "pwaOrientation"]
  }
}
```

Each listed property is dropped end-to-end: `migrate:schema` omits the matching field from the emitted page-shell object (camelCase-matched, so `cq:designPath` matches the emitted `cqDesignPath`), and `aem-transform` skips lifting the authored value into `pageProperties` (raw-name-matched, carried via the `page-templates.json` manifest). The doc-level carve-outs (`cq:tags`, `cq:featuredimage`, `cq:template`) are unaffected.

Operators: no action needed — the field is optional. Unlike name overrides, `skipProperties` is safe to change between runs: rerun `migrate:schema` → `transform` → `import` and the fields appear/disappear without any type rename (already-imported values stay on existing docs until re-imported).
