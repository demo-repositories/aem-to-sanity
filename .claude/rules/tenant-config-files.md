---
paths:
  - "tenants/**"
  - "packages/aem-to-sanity-core/src/config/**"
---

# Tenant configuration files — the operator surface

Every per-tenant knob is a file in the tenant folder (copied from `tenants/template/`). All template JSON files ship as `{}`; the shapes below are the contract. Loaders live in `packages/aem-to-sanity-core/src/config/` (re-exported from `config/index.ts`), are synchronous, return empty on missing file, and **throw on malformed JSON or invalid entries** — never silently ignore bad config.

| File | Env override | Loader | Consumed by |
|---|---|---|---|
| `aem-component-paths` | `AEM_COMPONENT_PATHS_FILE` | `resolveConfig` | migrate:schema (the component list) |
| `aem-component-exceptions` | `AEM_COMPONENT_EXCEPTIONS_FILE` | inline read | schema + transform + eject-dialogs (skip entirely) |
| `aem-content-roots` | `AEM_CONTENT_ROOTS_FILE` | `resolveConfig` | extract (`@base` + relative/absolute grammar, see `.example`) |
| `aem-tag-roots` | `AEM_TAG_ROOTS_FILE` | `tags.ts` | tags (missing file → stage skips with warning) |
| `aem-component-containers.json` | `AEM_COMPONENT_CONTAINERS_FILE` | `loadContainerConfig` | schema + transform — see `containers-and-fragments.md` rule |
| `aem-component-hints.json` | `AEM_COMPONENT_HINTS_FILE` | `loadAuthoringHintConfig` | schema + transform |
| `aem-component-names.json` | `AEM_COMPONENT_NAMES_FILE` | `loadComponentNameConfig` | schema only — see `type-naming.md` rule |
| `aem-component-slots.json` | `AEM_COMPONENT_SLOTS_FILE` | `loadSlotConfig` | schema only (visibility layer over auto-discovered slots) |
| `aem-dialog-overrides.json` | `AEM_DIALOG_OVERRIDES_FILE` | `loadDialogOverrideConfig` | schema + `aem-probe` + `aem-eject-dialogs` — see `dialog-resolution-and-overrides.md` rule |
| `aem-page-components.json` | `AEM_PAGE_COMPONENTS_FILE` | `loadPageComponentConfig` | schema (per-template page doc types + page-builder membership) |

Conventions shared by the JSON configs:

- **Keys are `sling:resourceType`s.** Leading `/` and `apps/` are stripped at load (`normalizeKey`); duplicates after normalization throw. Write keys as `ns/components/foo`, not `/apps/ns/components/foo`.
- **Entries matching no listed component path are logged and dropped** at schema time (`api.ts`) — a typo'd key fails loudly in the log, not silently.
- **Adding a new config file or key shape?** Follow the existing pattern: loader in `packages/aem-to-sanity-core/src/config/`, env-var override defaulting to `./<file>` relative to the tenant cwd, throw-on-invalid validation with actionable messages, wire into `packages/aem-to-sanity-schema/src/cli.ts` (and `transform.ts` if transform-stage), then hit every doc trigger in CLAUDE.md (README tables, `docs/running-the-migration.md` § 1c-*, `.env.example`, `docs.ts` + regenerate mapping doc, doctor's `OPERATOR_FILES` in `packages/aem-to-sanity-cli/src/lib/tenant-template.ts`).

## `aem-component-hints.json` (attribute opt-in)

By default every colon-namespaced property (`cq:*`, `jcr:*`, `sling:*`) is dropped at transform — `isValidSanityAttributeKey` rejects `:`. Two escape hatches:

1. Global rename vocabulary `AEM_AUTHORING_HINTS` in `packages/aem-to-sanity-core/src/aem/authoring-hints.ts` (today: `cq:panelTitle` → `panelTitle`). A hint key must exist here to have a Sanity name.
2. Per-resource-type opt-in in this file: `{ "<resourceType>": ["cq:panelTitle"] }`.

Opting in does three coordinated things: schema emits a `readOnly` string field, transform lifts the value instead of dropping it, and the drift auditor (`diffProps`) skips it. If you add a new hint key, touch all three paths or the Studio shows "Unknown field" / the audit reports false drift.

`cq:tags` is different — it's in `AEM_AUTHORED_COLON_KEYS` (`transform.ts`), camelCased to `cqTags` and resolved to category references. Keep that an explicit allowlist; never add a blanket "camelCase every colon key" rule (replication bookkeeping would leak in).

## `aem-component-slots.json` (slot visibility)

Slot **discovery** is automatic (`scanSlotGraphFromExtractCache` in `packages/aem-to-sanity-schema/src/slots.ts`, reads `output/cache/aem/content/`). This file only layers Studio visibility on top of discovered slots — the promo-card pattern where hardcoded child components (primary/secondary button) appear only when a dialog flag is on:

```json
{
  "uxp/components/proxy/content/promocard": {
    "buttonPrimary":   { "visibleWhen": "enablePrimaryButton" },
    "banner":          { "visibleWhen": { "field": "cardStyle", "equals": "flood" } }
  }
}
```

String shorthand = boolean toggle; object form = dropdown match (`equals` may be a string array). Emitted as a conditional `hidden` callback. **Hiding is display-only — slot content is always migrated.** Don't make visibility affect the transform.

## `aem-page-components.json` (templates → page doc types)

AEM editable templates are **not** migrated (no `/conf/**` fetch anywhere); only the `cq:template` identity is. Each `(pageShellResourceType, cq:template)` pair emits one Sanity document type (`title`, `slug`, `tags`, `pageProperties`, `featuredImage`, `cqTemplate`, `pageBuilder`):

```json
{
  "uxp/components/structure/universalpage": {
    "discover": true,
    "templates": ["/conf/uxp/settings/wcm/templates/universal-page"],
    "names": { "/conf/uxp/settings/wcm/templates/universal-page": { "name": "universalPage", "title": "Universal Page" } }
  }
}
```

- `discover: true` scans the extract cache — **extract must run before migrate:schema** for discovery to find anything.
- Default type name: last template path segment camelCased + `Page`; explicit `names` claim first, and a reserved/colliding explicit name is a hard throw.
- Pages whose declared shell has an undeclared `cq:template` surface in `transform-report.json → unknownPageTemplates` with a CLI callout.
- Flipping an already-imported page from `page` to a per-template type needs `aem-import --recreate-on-type-change` (`_type` is immutable in Sanity; delete happens in a separate earlier transaction on purpose).

Entries may also carry a **`components` map** (`cq:template` path → component resource types) restricting those components to that template's page builder: listed components leave the shared base `pageBuilder.of[]`, and each keyed template's doc type gets a dedicated `{docType}Builder` array (base + extras, alphabetized) that its page-builder field references. The field NAME stays `MIGRATION_PAGE_BUILDER_NAME` — transform output and ingested content are untouched, so this is **not** a set-once knob; it only reshapes Studio "+ Add" menus. Like `names`, keys must match declared templates unless `discover: true` (load-time error); undiscovered templates / unmatched resource types warn at schema time and the component stays in the shared array. The shared array also backs container drop zones and the generic `page` doc — restricted components disappear from those too. Manifest entries in `page-templates.json` carry the array each doc uses in `pageBuilderType`.

## Set-once knobs (idempotency hazards)

These reshape ids or `_type` values; changing them after the first real import orphans previously imported documents. Flag this in any PR that touches their semantics:

- `MIGRATION_DOC_ID_PREFIX_STRIP` (doc `_id`s)
- `MIGRATION_TYPE_NAMING` (`path` default vs `title`)
- `MIGRATION_TYPE_SUFFIX` when `MIGRATION_TYPE_SUFFIX_MODE=type` (the default) — `file` mode only renames files/exports and is safe to change
- `name` overrides in `aem-component-names.json`
- renaming a `jcr:title` in AEM while `MIGRATION_TYPE_NAMING=title`

Safe-to-change knobs: `title`, `folder`, `file`, `icon`, `preview` overrides; `MIGRATION_SCHEMA_LAYOUT`; `MIGRATION_TYPE_SUFFIX_MODE=file` suffix.
