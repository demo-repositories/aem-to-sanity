# aem-to-sanity-content

AEM → Sanity content migration as four flat scripts. Each step is inspectable on disk, so you can stop between phases and re-run just one.

```
aem-extract    AEM  → output/raw/*.json           + output/extract-report.json
aem-transform  raw  → output/clean/*.json         + output/transform-report.json
aem-assets     DAM  → output/assets/* + Sanity    + output/assets/manifest.json (resumable)
aem-import     clean → Sanity (dry-run by default)
```

## Configure

Env vars (can live in `.env`):

```
AEM_ENV=author                                # or publish
AEM_AUTHOR_URL=https://author.example.com
AEM_AUTHOR_USERNAME=...
AEM_AUTHOR_PASSWORD=...
# or: AEM_TOKEN=...

AEM_CONTENT_ROOTS_FILE=./aem-content-roots    # default
OUTPUT_DIR=./output                           # default

# Writes (import only)
SANITY_PROJECT_ID=...
SANITY_DATASET=production
SANITY_TOKEN=...
MIGRATION_DRY_RUN=false                       # opt-in to commit. Default: dry-run.

# Optional
# AEM_MAX_RESPONSE_MB=100                     # abort any single response larger than this
```

## Roots file

`aem-content-roots` — one page per line:

```
@base /content/site/us/en
home
about-us
/content/other-site/top           # absolute path also fine
```

## Run

```sh
pnpm aem-extract                                         # fetches everything in roots file
pnpm aem-transform --registry ./content-type-registry.json
pnpm aem-assets                                          # dry run: downloads only
MIGRATION_DRY_RUN=false pnpm aem-assets                  # uploads to Sanity, rewrites clean docs
pnpm aem-import                                          # dry run
MIGRATION_DRY_RUN=false pnpm aem-import                  # commit docs
```

`--overwrite` on `aem-extract` re-fetches roots that already exist on disk. `--include <resourceTypes>` on `aem-transform` restricts the walk to a comma-separated allow-list. `aem-assets` processes one file at a time (sequential, low memory) and is resumable via `manifest.json`; pass `--upload-only` to skip re-downloading or `--no-rewrite` to skip the in-place rewrite of `clean/*.json`.

## Reports

- `output/extract-report.json` — per-root outcome; HTTP 300/404/auth/too-large failures grouped by category.
- `output/extract-404.log` — one `<jcrPath>\t<fullUrl>` per 404 (only written when 404s occur).
- `output/transform-report.json` — unknown `sling:resourceType`s, unknown properties per mapped component, transform bails (max-depth or cycle).
- `output/assets-report.json` — asset download/upload counts, failures.
- `output/assets/manifest.json` — per-asset state (damPath → cachedFile, sanityRef). Drives resumability.
