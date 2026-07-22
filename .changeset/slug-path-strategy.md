---
"aem-to-sanity-content": minor
---

New `MIGRATION_SLUG_STRATEGY` env var controls how each page doc's `slug.current` is derived at `aem-transform`. `segment` (default, unchanged behavior) uses the last segment of the JCR path. `path` uses the path relative to the roots-file `@base`, exactly as authored in `aem-content-roots` (e.g. `us/en/company-culture/belonging/chapters`) — for frontends that route nested pages off the full sub-path.

`aem-extract` now records that base-relative path as `relativePath` in each raw cache file (additive; old caches still load). With `MIGRATION_SLUG_STRATEGY=path`, raw files extracted before this release (and absolute roots entries outside any `@base`) fall back to the last segment with a warning — run `aem-extract --overwrite` once to capture the base-relative paths.

Pick the strategy once before the first import: switching later rewrites `slug.current` on every page (doc `_id`s are unaffected, so re-imports overwrite in place rather than orphaning), and frontend routing keyed on slugs must move in the same deploy.
