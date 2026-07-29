---
"aem-to-sanity-schema": minor
---

New generated types `contentFragment` (document) and `contentFragmentRef` (page-builder block): the escape hatch for Sanity's 20-level attribute-depth limit. When `aem-transform` cuts a too-deep subtree, the fragment document holds it (title + a page-builder `content` array) and the ref block replaces it in the parent. Both types are emitted on every `migrate:schema` run, the ref block joins the page-builder palette, and both names are reserved (an AEM component deriving one of them gets the `aem` prefix). Frontends need a `contentFragmentRef` resolver — one extra GROQ join to render the referenced fragment's `content`.
