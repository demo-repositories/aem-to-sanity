# Changesets

This folder holds [changeset](https://github.com/changesets/changesets) files that drive versioning and publishing for the packages in this monorepo.

- `pnpm changeset` — record a new changeset (pick packages, pick a bump type, write a short note)
- `pnpm version` — apply pending changesets: bumps versions, updates CHANGELOGs, removes changeset files
- `pnpm release` — build all packages, then publish any that have a new version (runs `changeset publish`)

The `access: public` setting in `config.json` ensures unscoped public packages (`aem-to-sanity-core`, `aem-to-sanity-schema`, `aem-to-sanity-content`) publish as public. The `ignore` list keeps the example Studio app and example site out of publishing.
