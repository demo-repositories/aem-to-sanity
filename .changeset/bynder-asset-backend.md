---
"aem-to-sanity-core": minor
"aem-to-sanity-schema": minor
"aem-to-sanity-content": minor
"aem-to-sanity-cli": minor
---

New Bynder asset backend (`MIGRATION_ASSET_BACKEND=bynder`) for clients whose assets live in a Bynder portal instead of the Sanity Media Library.

The pipeline never uploads to Bynder — it assumes the DAM → Bynder migration happened out-of-band, with each migrated asset stamped with a metaproperty holding its legacy AEM DAM path. Configure with three new env vars: `BYNDER_BASE_URL` (portal origin), `BYNDER_TOKEN` (permanent or OAuth2 token, sent as Bearer), and `BYNDER_AEM_PATH_PROPERTY` (the metaproperty name — your choice, e.g. `aemDamPath`).

- `migrate:schema` emits image/file dialog fields (and the per-template `featuredImage`) as the `bynder.asset` type from `sanity-plugin-bynder-input` — install that plugin in the consuming Studio.
- `aem-assets` skips download/upload/dataset-link; phase 0 resolves each `/content/dam` path via `GET /api/v4/media/?property_<NAME>=<path>` (exact match on the echoed metaproperty, keyword-search fallback) and phase 4 rewrites fields to the plugin's persisted `bynder.asset` value shape. Resolution runs read-only under dry-run; misses surface like ML link failures (report + failures log). `--download-only` still works to cache AEM binaries for your own Bynder ingestion.
- `migrate:doctor` validates the new surface: unknown `MIGRATION_ASSET_BACKEND` values error, the `BYNDER_*` trio is required in bynder mode, and `SANITY_MEDIA_LIBRARY_ID` stops being required.

`MIGRATION_ASSET_BACKEND` is a set-once-before-first-import knob: switching backends changes emitted field types AND ingested field values. The default (`media-library`) is unchanged.
