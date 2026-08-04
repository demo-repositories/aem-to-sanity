# Developer onboarding — maintaining the AEM → Sanity toolkit

Who this is for: a developer taking over or contributing to **this repo's code** — the pipeline, the schema generator, the configs. If you only need to *run* a migration, read [`running-the-migration.md`](running-the-migration.md) instead. If you want the 10-minute visual tour first, open [`aem-to-sanity-standalone.html`](aem-to-sanity-standalone.html).

This doc has two halves: **how the repo works** (§ 1–4) and **the AEM knowledge that's hardcoded in it** (§ 5–6) — the domain facts you need before any change makes sense. § 7–8 are a task cookbook and debugging playbook.

---

## 1. The 30-second mental model

The toolkit is a batch pipeline. Each stage reads AEM (or a local cache), writes an artifact under `output/cache/`, and the next stage reads that artifact. Nothing talks to Sanity until the final stages, and even then **dry-run is the default** (`MIGRATION_DRY_RUN=false` to actually write).

```
aem-extract      AEM content tree        → output/cache/aem/content/**   (raw .infinity.json per page)
aem-tags         AEM cq:Tag taxonomy     → output/cache/categories/ + manifest.json
migrate:schema   AEM component dialogs   → apps/studio/schemas/generated/*.ts
                                          + output/cache/content-type-registry.json
                                          + output/cache/migration-report.json
aem-transform    raw content + registry  → output/cache/clean/**         (Sanity-shaped docs)
aem-assets       DAM refs in clean docs  → Media Library uploads + asset refs (mutates clean/ in place)
aem-import       clean docs              → Sanity dataset (one transaction per page)
```

Order matters: **schema runs after extract** because template auto-discovery and slot discovery scan the extract cache. The registry produced by `migrate:schema` is what lets `aem-transform` coerce string values into real types — the two stages are coupled through that file.

Everything under `output/cache/` and `apps/studio/schemas/generated/` is regenerable and gitignored. Never hand-edit artifacts; fix the stage that produces them.

## 2. Repo layout

```
packages/
  aem-to-sanity-core      AEM fetcher/auth, config loaders, dialog resolution, shared utils
  aem-to-sanity-schema    migrate:schema: dialog → Sanity schema emitter, mapping table,
                          slots, templates, audit, generated mapping doc (docs.ts)
  aem-to-sanity-content   extract / tags / transform / assets / import stages
  aem-to-sanity-studio    migration-critical Studio code (taxonomy type, AEM widget inputs,
                          aemSource ML aspect) — imported by all studios
  aem-to-sanity-cli       `aem-to-sanity` bin: doctor, studio-sync, run, wipe-media-library
  create-aem-to-sanity    npm scaffolder (versions independently)
apps/studio               dev Studio for this repo
tenants/template/         committed tenant template (the operator surface)
tenants/<name>/           gitignored operator working copies — your test beds
docs/                     hand-authored docs + the generated mapping doc
.claude/rules/            scoped maintainer rules (see § 8)
```

The five toolkit packages version in lockstep via Changesets and publish to npm on release. Operators consume them via the scaffolder — repo clones are the development mode, not the distribution mode.

**Per-tenant behavior lives in config files, not code.** The tenant folder holds ~10 config files (`aem-component-paths`, `aem-component-containers.json`, `aem-dialog-overrides.json`, …). Loaders are in `packages/aem-to-sanity-core/src/config/`; all throw on malformed input and warn-and-drop entries that match nothing. The full catalog with shapes is in `.claude/rules/tenant-config-files.md` and `docs/running-the-migration.md` § 1c.

## 3. Working setup

```bash
pnpm install                      # root prepare writes a stub generated/ barrel so Studio typechecks
pnpm -r build                     # Node runs from dist/ — rebuild before testing changes
cp -R tenants/template tenants/<you>   # gitignored; fill .env from .env.example
cd tenants/<you>
pnpm migrate:schema && pnpm extract && pnpm tags && pnpm transform
pnpm assets -- --link-only        # skip AEM downloads / ML uploads on re-runs
pnpm import                       # dry-run unless MIGRATION_DRY_RUN=false
```

No AEM access? `AEM_FIXTURES_DIR` replays captured REST responses from disk (the demo tenant's cached dialogs are useful offline). The doctor (`pnpm doctor`) checks a tenant folder against the template — keep it in sync when the template grows (rules in CLAUDE.md).

Before any PR: `pnpm -r typecheck && pnpm -r test`, and **actually run the affected stage against a tenant** — typecheck doesn't exercise the tree walks. User-facing changes need a changeset and the doc updates listed in CLAUDE.md's trigger table.

## 4. Data-flow contracts between stages

- `content-type-registry.json` — `migrate:schema` → `aem-transform`. A **tree** of `{name, type, itemFields?}` per component; transform coercion recurses it. Change a field's emitted type and coercion behavior changes with it.
- `migration-report.json` — per-component outcomes (`success` with `fields[]`/`unmapped[]`/`supertypeChain`/`supplementaryTabs`, or `failure` with `kind`). First place to look when a schema run misbehaves.
- `output/cache/audit/unmapped-examples.json` — one real AEM node per unmapped widget type. Raw material for extending the mapping table.
- `output/cache/clean/**` — one file per page: `{ jcrPath, slug, docs: [pageDoc, ...fragments] }`. Fragments deliberately share the page's file so `aem-import` writes them in one transaction.
- `output/cache/assets/manifest.json` — per-DAM-path state; makes `aem-assets` resumable and deduped. ML is the source of truth; the manifest is reconciled against it (phase 0).

---

## 5. AEM knowledge hardcoded in this repo

This is the domain model. Each concept: what it is in AEM, and what the toolkit does about it (with the owning file).

### 5.1 JCR — everything is a tree of nodes

AEM stores content in a Java Content Repository: a tree where every node has a type (`cq:Page`, `nt:unstructured`, `cq:Tag`, …) and arbitrary properties, addressed by path (`/content/site/us/en/page`). A page's real content hangs under its `jcr:content` child node. Component instances are nodes whose `sling:resourceType` property names the component that renders them.

Toolkit consequences:
- Sanity `_id`s derive from JCR paths (`pathToDocId`, `transform.ts`) — with `MIGRATION_DOC_ID_PREFIX_STRIP` to drop the site/locale root. **Hyphens, never dots**: a `.` in a Sanity `_id` makes the document private (token-only reads).
- Nested `cq:Page` nodes inside a page subtree are *other pages* — the transform skips them (`childPageSkipped` audit) because they're their own migration roots.
- Namespaced properties (`jcr:*`, `cq:*`, `sling:*`) are bookkeeping by default. The transform drops them via explicit allowlists (`JCR_METADATA`, `JCR_CONTENT_BOOKKEEPING_KEYS` in `transform.ts`); the only opt-ins are `cq:tags` (camelCased to `cqTags`) and per-tenant hint keys like `cq:panelTitle` (`aem-component-hints.json`). Never replace these lists with a heuristic — replication timestamps and version refs would leak into documents.

### 5.2 `.infinity.json` — the reason coercion exists

Appending `.infinity.json` to any JCR path returns the whole subtree as JSON. Critically, **JCR dialog inputs are schemaless: every authored value serializes as a string** — a numberfield gives `"10"`, a checkbox `"true"`, a richtext field an HTML string. The emitted Sanity schemas declare real types, so without conversion the Studio rejects every value.

`coerceFieldTypes` (`packages/aem-to-sanity-content/src/transform.ts`) is the single entry point: registry-driven, recursive, in-place. HTML → Portable Text lives in `portable-text.ts`. The contract is **keep-original-on-failure** — an unparseable value stays as-is and surfaces as a Studio validation error, never silent data loss.

Two more `.infinity.json` quirks the code handles:
- **Named-key multifields**: some multifields serialize as an object (`{ weddingDresses: {...}, promDresses: {...} }`) instead of an array — `Object.values` materializes them in authored order. Others use `item0/item1/...` keys — `deepCoerceAemMultifieldMapsToArrays` converts those.
- **Dialog runtime sidecars**: AEM writes bookkeeping next to authored values (e.g. `textIsRich: "true"` beside richtext). These have no Sanity counterpart; they're dropped via the `AEM_DIALOG_RUNTIME_KEYS` list. When a new one leaks, add it there.

### 5.3 Proxy components and `sling:resourceSuperType`

AEM teams almost never point content at Adobe's out-of-the-box components under `/libs` directly — Adobe updates those with product versions. Instead they create a **proxy component** under `/apps`: an almost-empty node whose `sling:resourceSuperType` points at the real implementation. Content references the proxy; behavior (scripts, and crucially the **dialog**) is inherited from the supertype, possibly through several hops (`/apps/...` proxy → `/apps/.../v1/...` → `/libs/core/wcm/components/...`).

Toolkit handling (`resolveDialogViaSuperType`, `packages/aem-to-sanity-core/src/aem/dialog-resolution.ts`): try `{path}/_cq_dialog`; on 404 read `sling:resourceSuperType`, resolve relative paths against `/apps/<rt>` then `/libs/<rt>`, recurse with cycle guard and a 10-hop cap. The registry key stays the **proxy's** resource type — that's what authored content references. Two proxies sharing one supertype correctly produce two distinct Sanity types.

### 5.4 Sling Resource Merger — the part we deliberately do NOT implement

At request time AEM doesn't just take the first dialog in the chain — it **merges dialogs node-by-node across the whole supertype chain**, like method overriding in a class hierarchy: a tab defined in the child overrides the parent's same-named tab; tabs only in the parent still appear. Plus merge directives (`sling:hideResource`, `sling:orderBefore`, …). This is why an accordion proxy with a 3-tab dialog shows 4 tabs in AEM — the fourth comes from an ancestor.

Reimplementing that merger was judged too complex and fragile. The toolkit's walk is **first-hit, whole-dialog** (stated at the top of `dialog-resolution.ts`), and the gap is closed by *operator config*, on the theory that these components aren't changing during a migration:

- `supplementaryTabs` in `aem-dialog-overrides.json` — "there's one more tab at this JCR path; splice it in after tab X".
- `dialogFile` — hand over the whole effective dialog as a local JSON file.

Don't "fix" the walk to merge; extend the override config. All consumers (migrator, audit, probe, eject) share one entry point, `resolveEffectiveDialog` — never fork it, or the probe stops showing what the migrator sees.

### 5.5 `cq:dialog` and Granite UI — where schemas come from

A component's authoring form is its `cq:dialog` node: a tree of **Granite UI widgets**, each a node with a `sling:resourceType` like `granite/ui/components/coral/foundation/form/textfield`. The dialog tree *is* the schema source — `migrate:schema` maps each widget to a Sanity field via `MAPPING` in `packages/aem-to-sanity-schema/src/mapping-table.ts` (exact match, then suffix match on the last two path segments to catch vendor copies).

Facts encoded around this:
- In URLs the dialog node is fetched as `_cq_dialog` (the `cq:` namespace colon isn't URL-safe).
- Tabs/accordions/wells are *layout* containers inside the dialog — the mapper flattens them into Studio field groups. **`Object.entries` key order is load-bearing**: dialog node order becomes Studio group/field order.
- Some selects don't carry literal options; they point at a **datasource** (ACS generic lists, core policy defaults). `datasources.ts` resolves the known ones; `aem-eject-dialogs` bakes resolved options into literal `items` so ejected dialogs are AEM-independent.
- Unknown widget types aren't dropped silently — they're reported (`unmapped[]`) and the audit snapshots a real example node to `unmapped-examples.json` so you can extend the mapping table from evidence, not guesswork.

### 5.6 Containers, responsive grid, and panels

AEM layouts nest heavily: pages hold responsive grids (`wcm/foundation/components/responsivegrid`), grids hold containers, containers hold containers. Sanity has a hard **20-level attribute depth limit** and flat page-builder arrays are the idiomatic model, so replicating AEM nesting is both impossible and undesirable.

`aem-component-containers.json` declares per-container-type behavior (implemented in `collectPageBuilder`, `transform.ts`):
- default — keep the container block, children in `childrenField`;
- `flatten: true` — drop the wrapper, hoist children (layout-only containers);
- `document: true` — extract each instance as a standalone `contentFragment` document referenced by a `contentFragmentRef` block (for tabs-in-tabs-in-tabs structures that blow the depth limit even flattened).

Hardcoded AEM subtlety: tabs/accordion **panels** reuse the same container resource type as plain layout containers, distinguishable only by carrying a **`cq:panelTitle`** property. A flatten container with `cq:panelTitle` therefore keeps its block — removing that exception silently merges tab panels. `cq:panelTitle` is also the one entry in the global authoring-hints rename vocabulary (`panelTitle`).

Independent of config, `enforceAttributeDepthBudget` auto-extracts fragments whenever a document still exceeds depth 20.

### 5.7 Hardcoded child components ("slots")

Some components aren't drag-and-drop containers but still have fixed child components — a promo card whose primary/secondary buttons are child nodes that appear when a dialog flag is on. There's no AEM manifest for this; the toolkit **discovers** slots by scanning extracted content for direct child nodes with their own `sling:resourceType` (`slots.ts`), emits them as `slot-reference`/`slot-array` fields, and lets `aem-component-slots.json` add the show/hide behavior (`visibleWhen` → Sanity conditional `hidden`). Visibility is display-only; slot content always migrates.

### 5.8 Editable templates (`cq:template`)

Every AEM page records which editable template created it (`cq:template` on `jcr:content`, pointing under `/conf/**`). The toolkit does **not** migrate template structure or policies — nothing fetches `/conf`. It migrates the template *identity*: `aem-page-components.json` maps page-shell resource types + templates to per-template Sanity **document** types (`universalPage`, `planDetailsPage`, …), with `discover: true` scanning the extract cache for template values. In the target model, "templates" become document types + Studio initial values; new-page creation in AEM's template picker has no direct equivalent and is a Studio-design concern.

Sanity constraint encoded here: **`_type` is immutable**. Flipping already-imported pages to a per-template type needs `aem-import --recreate-on-type-change`, which deletes old docs in a *separate earlier transaction* (the content lake validates immutability against pre-transaction state).

### 5.9 Tags (`cq:Tag`) and the DAM

- **Tags**: AEM tags are JCR nodes under `/content/cq_tags`, forming a taxonomy; content references them via `cq:tags` string arrays (`ns:parent/child`). `aem-tags` emits one Sanity `category` document per tag (parent-child preserved) plus a manifest; the transform resolves authored `cq:tags` into references through it, following `cq:movedTo` aliases (AEM's tag-rename breadcrumb) with a cycle guard.
- **DAM**: authored images/files are DAM paths (`/content/dam/...`) in `fileReference`-style properties. The transform splits these into `{base}AemPath` trace fields; `aem-assets` downloads from AEM, uploads to the Sanity **Media Library** (org-level, `SANITY_MEDIA_LIBRARY_ID`), stamps an `aemSource` aspect for provenance, links assets to the dataset, and rewrites `clean/` docs to real asset refs. Fields ending in `AemPath` are trace metadata everywhere — e.g. preview heuristics exclude them.

### 5.10 AEM environments and auth

Author vs publish instances (`AEM_ENV`); AEM-as-a-Cloud-Service vs on-prem/AMS. Encoded flows (`AEM_AUTH_FLOWS` in `packages/aem-to-sanity-cli/src/lib/tenant-template.ts`): AEMaaCS **Service Credentials** JSON exchanged with Adobe IMS (recommended; file or inline), short-lived dev token (`AEM_TOKEN`, ~24h — a frequent "it worked yesterday" cause), and basic auth (on-prem only; AEMaaCS rejects it). Per-component 401/403s can be real ACL denials — `--continue-on-auth` treats them as skips, with a circuit breaker on consecutive failures.

## 6. Sanity constraints hardcoded here (the other direction)

- Dots in `_id` = private document; hyphens everywhere (§ 5.1).
- `_type` immutable after creation (§ 5.8).
- 20-level attribute depth limit (§ 5.6).
- **Drafts shadow published docs**: the Studio shows `drafts.{id}` when one exists, so a re-import "changes nothing" until `--discard-drafts`. First thing to check on that complaint.
- Reserved type names: Sanity built-ins (`image`, `file`, …) plus toolkit-claimed `table`/`row`/`cell` (native PT tables) and `contentFragment`/`contentFragmentRef` — colliding AEM components get an `aem` prefix at emission (`naming.ts`).
- Studio previews can only select **leaf paths**, not whole arrays — hence the ten `{field}.{i}._key` count probes with a `10+` cap (`emitter.ts`).
- Deterministic `_key`s (SHA1-seeded) keep re-import diffs clean.

## 7. Cookbook — common maintenance tasks

| Task | Where | Don't forget |
|---|---|---|
| Support a new dialog widget | Add to `MAPPING` in `mapping-table.ts`; check `unmapped-examples.json` for a real node first | Regenerate `docs/aem-to-sanity-mapping.md`; changeset |
| New coerced value type | Extend `coerceFieldTypes` in `transform.ts` | Keep-original-on-failure; docs.ts prose + regenerate; content README + runbook § 4b |
| Field exists in Studio schema but not in AEM | It must come via `aem-dialog-overrides.json` (`fieldOverrides` / ejected `dialogFile`) — never hand-edit generated files | If nobody can justify it, it's a bug or belongs in an override |
| Missing dialog tab (inherited in AEM, absent here) | `supplementaryTabs` entry, or eject the dialog and hand-add | § 5.4 — don't touch the walk |
| New tenant config file | Loader in `core/src/config/` + env override + throw-on-invalid; wire into schema `cli.ts`/`transform.ts` | Doctor's `OPERATOR_FILES`; template + README + runbook + `.env.example`; rebuild cli (embeds template) |
| New pipeline stage | Bin in the owning package; template `package.json` scripts + `migrate`/`migrate:content` chains | Doctor propagates via `--fix`; runbook § 2/§ 4 outputs |
| New AEM bookkeeping key leaking into docs | Add to the matching drop-list in `transform.ts` | Keep lists explicit; no heuristics |
| New block `_type` rendered on the frontend | Frontend lives in `aem-to-sanity-demo-web` — flag in the PR description | |

## 8. Debugging playbook

| Symptom | Likely cause |
|---|---|
| "Expected type X, got String" in Studio | Coercion gap (registry type vs `coerceFieldTypes`) — or the emitted type is wrong; fix at `mapping-table.ts`, not with per-field transform hacks |
| Re-import "changed nothing" | Shadowing draft — `--discard-drafts` |
| "Unknown field found" in Studio | New dialog-runtime sidecar (add to `AEM_DIALOG_RUNTIME_KEYS`) or an un-opted hint key |
| Component fields all missing | Dialog resolution failed — check `migration-report.json` `supertypeChain`/failure `kind`; probe with `scripts/aem-probe.ts` (same resolution path) |
| Whole run aborts early on AEM errors | Auth circuit breaker; expired ~24h dev token is the classic cause |
| Import rejects a doc for depth | Depth budget/fragment extraction — see `depthExtractedFragments` / `depthFlattenedPanels` in the transform report |
| Docs orphaned after a rerun | Someone changed a set-once knob (`MIGRATION_DOC_ID_PREFIX_STRIP`, type naming/suffix, name overrides) |
| Empty registry / no schemas on fresh clone | Expected — regenerate against your tenant; the studio stub barrel is written by `prepare` |

**Further reading:** scoped maintainer rules in `.claude/rules/` (auto-loaded per path by Claude Code; readable by anyone), CLAUDE.md for doc-refresh/changeset/commit conventions, [`overview.md`](overview.md) for architecture, [`running-the-migration.md`](running-the-migration.md) for the operator view.
