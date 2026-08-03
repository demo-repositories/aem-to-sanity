---
"aem-to-sanity-core": minor
"aem-to-sanity-schema": minor
"aem-to-sanity-content": minor
"aem-to-sanity-studio": minor
"aem-to-sanity-cli": minor
---

Per-template document type names can now be pinned in `aem-page-components.json` via a new `names` map on each page-shell entry, keyed by `cq:template` path. Values are a type name string or `{ "name", "title" }` — the same shape as `aem-component-names.json`:

```json
{
  "uxp/components/structure/page": {
    "discover": true,
    "names": {
      "/conf/uxp/settings/wcm/templates/universal-page": { "name": "universalPage", "title": "Universal Page" }
    }
  }
}
```

Without an override the type name still derives from the template path with a `Page` suffix, which doubles up when the template name already ends in "-page" (`universal-page` → `universalPagePage`). Explicit names are used verbatim and claim first; a reserved or colliding explicit name fails `migrate:schema` with a clear error. The override flows through the `page-templates.json` manifest so `aem-transform` stamps the same `_type` automatically.

Operators: no action needed — existing configs keep their derived names. If you rename a type on an already-imported tenant, re-run `migrate:schema` → `transform` → `import --recreate-on-type-change` (destroys publish history and drafts of the affected page docs).
