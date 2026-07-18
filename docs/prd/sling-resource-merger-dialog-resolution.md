# PRD: Sling Resource Merger semantics for dialog resolution

| | |
|---|---|
| **Status** | Implemented |
| **Packages** | `aem-to-sanity-core` (resolver + merge), `aem-to-sanity-schema` (call sites) |
| **Changeset** | `.changeset/sling-resource-merger.md` (minor) |
| **Reference** | [Sling Resource Merger (Adobe docs)](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/developing/full-stack/sling-resource-merger) |

## 1. Problem

`resolveDialogViaSuperType` (`packages/aem-to-sanity-core/src/aem/dialog-resolution.ts`) was **first-hit-wins**: it walked the `sling:resourceSuperType` chain and returned the FIRST `cq:dialog` it found. AEM does something fundamentally different at request time — it resolves dialogs through `/mnt/override`, which **merges** the dialogs of every component on the supertype chain, the more-derived dialog overlaying its ancestors'.

The practical consequence: a component whose own dialog only declares its *additions* — the AEMaaCS norm for versioned bases extending Adobe Core Components — silently lost every tab and field defined only in an ancestor's dialog.

### Motivating evidence (t-mobile tenant, `title` component)

Probed live against the tenant's AEM author instance:

| Chain hop | Has dialog? | Tabs |
|---|---|---|
| `/apps/uxp/components/proxy/content/title` | no | — |
| `/apps/uxp/components/content/title/v1/title` | **yes — old walker stopped here** | `display` (Display), `tabStyle` (Styles, carries `sling:orderBefore: "cq:include"`), `cq:include` |
| `/libs/core/wcm/components/title/v3/title` | **yes — never reached** | `properties` (Properties), `styletab` |

AEM's authoring dialog shows **Properties + Display + Styles** merged. The generated `proxyContentTitle.ts` had no Properties fields (`jcr:title` text, heading `type`, link, `id`) — authors migrating to Sanity lost them.

The real data also uses merge-control properties, so "just concatenate the tabs" was never going to be correct:

- `title/v1` uses `sling:orderBefore: "cq:include"` on its Styles tab.
- `promocard/v1` declares `sling:hideChildren: ["tabDisplay","asset","metadata","styletab"]` on its tabs node to suppress ALL tabs inherited from its `image` ancestor chain. Ignoring hide semantics would have flooded promocard with image tabs its authors never see in AEM.

## 2. Requirements

1. Collect dialogs along the **entire** supertype chain and merge them with Sling Resource Merger (override picker) semantics — child (more-derived) wins.
2. **Zero regressions**: a chain that supplies only one dialog must produce a byte-identical result to the old behavior.
3. Failures *after* at least one dialog is found (broken ancestor, cycle, hop cap, auth error deeper in the chain) must not fail the component — degrade with a logged warning and merge what was collected. Failures *before* any dialog keep the old throwing behavior and messages.
4. Components with an **embedded** `cq:dialog` AND a supertype must merge too (previously the embedded dialog short-circuited the walk entirely — AEM merges in that case).
5. Operators must be able to see what happened: which chain entries supplied dialogs, and any degradation warnings.

## 3. Merge semantics implemented

`mergeDialogs(dialogs)` in `packages/aem-to-sanity-core/src/aem/dialog-merge.ts` — `dialogs[0]` is the most-derived (leaf), last is the base-most ancestor, folded via `reduceRight`:

| Rule | Behavior |
|---|---|
| Property collision | Child value wins. Arrays replaced wholesale, never element-merged. |
| Same-named child node | Merged recursively. |
| Ordering | Ancestor's declared child order first; child-only nodes appended in the child's declared order. |
| `sling:orderBefore` | Node moves immediately before the named sibling (works against both inherited and child-sourced siblings). Unknown target → left in place, no error (matches Sling). |
| `sling:hideProperties` | `string \| string[]`, `*` wildcard — drops inherited properties. |
| `sling:hideChildren` | `string \| string[]`, `*` wildcard — drops named inherited children. A local redefinition of a hidden child stands alone (unmerged) — Sling's hide removes only the underlying resource. |
| `sling:hideResource` | Truthy (`true`, `"true"`, `"{Boolean}true"` via `isTruthyAttr`) on the overriding node drops the inherited node entirely. A marker with nothing inherited to hide emits nothing. |
| Control-prop stripping | All `sling:hide*` / `sling:orderBefore` removed from the merged output at every depth — the dialog mapper and the saved snapshots never see merge bookkeeping. |
| `!name` negation entries | **Not supported** (rare, ambiguous to partially apply). Logged via `onWarning` and ignored. |

**Identity guarantee:** a single-entry input returns the dialog **verbatim — same object reference**, no cloning, control props untouched. This is what makes requirement 2 checkable: components with single-source chains emit byte-identical schemas.

A "child node" is a plain non-array object whose key isn't `jcr:*`/`sling:*` — the same predicate `childNodes()` in `dialog-types.ts` uses, so the merge and the mapper agree on what's structure vs. attribute.

## 4. Resolver changes

`resolveDialogViaSuperType` (`dialog-resolution.ts`) now:

- Collects `{path, dialog}` at every hop. A 404 on `${path}/_cq_dialog` means "no dialog at this level", not an error.
- Stops at the chain end (no supertype), merges everything collected.
- **Error policy** — the regression-critical part:
  - Before any dialog is collected: throw, with the exact pre-existing messages (dead end, cycle, hop cap, unresolvable supertype, non-404 fetch errors including auth). The original error object propagates for fetch failures.
  - After ≥1 dialog: `degradeOrThrow` records a warning (`supertype walk stopped early — inherited dialog fields beyond <path> may be missing: <cause>`), forwards it to `onWarning`, stops the walk, and merges what it has.

New result shape:

```ts
interface DialogResolution {
  dialog: DialogNode;           // merged (same reference when single source)
  resolvedPath: string;         // unchanged meaning: nearest path that supplied a dialog
  chain: string[];              // full walk — now extends PAST the first dialog
  contributingPaths: string[];  // chain entries that supplied a dialog, most-derived first
  warnings: string[];           // degradation notes
}
interface ResolveDialogOptions {
  maxHops?: number;             // default 10
  seed?: { dialog: DialogNode; superType?: string | null };
  onWarning?: (message: string) => void;
}
```

**`seed`** implements requirement 4: `processOne` (`packages/aem-to-sanity-schema/src/api.ts`) passes the already-fetched embedded `cq:dialog` plus the component's `sling:resourceSuperType` (`null` = known absent), so the walk starts at hop 1 without re-fetching the leaf. When the component has an embedded dialog and *no* supertype, the old zero-extra-fetch fast path is preserved.

### Fetch memoization

`memoizeFetcher` (`packages/aem-to-sanity-core/src/aem/fetcher-memo.ts`): full-chain walking means every proxy component in a site re-visits the same `/libs/core/wcm/...` ancestors. The memo caches successes AND 404 rejections (a missing node stays missing for the run) in a `Map<string, Promise<DialogNode>>`; transient failures (auth/5xx) are evicted so retries reach the network. Wrapped once in the schema CLI (`cli.ts`) and `scripts/aem-probe.ts`. There was previously **no** caching anywhere — every call was a live fetch.

### Reporting & observability

- `migration-report.json` success records gain `contributingPaths` next to `supertypeChain`. `supertypeChain` now records the **full** walk (it used to stop at the first dialog) — operator-facing only; nothing reads it programmatically.
- The per-component info log gains a merge note:
  `… dialog inherited via supertype — chain a → b → c (merged 2 dialogs: b + c)`
- `scripts/aem-probe.ts` prints `merged dialogs from: <p1> + <p2>` and flags saved output as a merged dialog.
- Dialog snapshots under `output/cache/aem/apps/...` now hold the **merged** dialog (post-strip). They were already write-only regenerable artifacts; nothing reads them back.
- `audit.ts` gets merged dialogs automatically (it only consumes `dialog`); its walk warnings go to debug.

## 5. Latent bug exposed and fixed

The merged core accordion dialog surfaced `expandedItems`: a non-composite multifield whose only inner field is a `form/hidden` input written by a dialog edit hook. The mapper emitted `array-of-object` with zero `itemFields` — **invalid Sanity schema** ("Object should have at least one field"), caught by `sanity schema validate`.

Fix (`mapper.ts`, multifield case): a multifield whose inner field yields no mappable children falls back to **`array-of-string`** — non-composite multifields persist a multi-value scalar property in JCR, so that matches the authored shape, and the schema stays valid.

## 6. Verification (all performed against tenants/t-mobile)

- `pnpm -r typecheck` — 4 workspaces clean. `pnpm -r test` — core 94 (16 new merge, 8 new resolver, 3 memo), schema 46 (2 new multifield). Only one pre-existing test needed updating (direct-hit resolution now also reads the component node to check for a supertype: 1 fetch → 2).
- `pnpm migrate:schema` re-run: **13 components now merge 2–3 dialogs** (title, text, image, accordion, actioncard, cardcontainer, container, promocard, separator, table, video, wrapper, structure/page).
- **Title regression fixed**: `proxyContentTitle.ts` gains the `properties` group with `jcrTitle`, `type`, `linkUrl`, `linkTarget`, `id`; merged snapshot tab order is `properties, styletab, display, tabStyle, cq:include` with no `sling:orderBefore` remnants.
- **Identity check**: diff of `apps/studio/schemas/generated/` against a pre-change snapshot — exactly the merged components differ; all single-source components byte-identical.
- **Hide semantics validated in the wild**: promocard merges 3 dialogs yet emits an unchanged schema, because its dialog's `sling:hideChildren: ["tabDisplay","asset","metadata","styletab"]` suppresses all inherited image tabs — precisely what AEM renders.
- `sanity schema validate` — 0 errors, 0 warnings (after the § 5 fix).

## 7. Known consequences & follow-ups

- **Unmapped types 12 → 30.** Merged `/libs` page/admin dialogs surface widgets the mapping table has never seen — notably `cq/gui/components/authoring/dialog/style/styleselector` (×9), `cq/gui/components/coral/common/form/pagefield` (×7), `pageimagethumbnail` (×4), and the MSM/live-copy page-properties suite. These emit placeholder string fields per the existing fallback contract and are listed in `migration-report.json`. Follow-up: add mapping-table entries for the author-relevant ones (`pagefield` → string/reference is the obvious first).
- **`sling:orderBefore` inside base-only subtrees** (nodes with no counterpart in any overlay) is stripped without being applied — ordering there stays declared-order. Sling would apply it; in practice declared order is the authored intent and the identity guarantee for single-source chains takes priority.
- **`!name` negation** in hide lists is warned and ignored (documented in the merge module).
- **Warning-degradation** could mask an AEM outage that begins mid-run: warnings carry the underlying error text in both the log and `DialogResolution.warnings`, and auth failures before any dialog still abort the component as before.

## 8. Alternatives considered

- **Keep first-hit-wins, hand-list ancestor paths in `aem-component-paths`** — loses the proxy's identity as registry key, forces operators to understand AEM inheritance internals, and still doesn't merge (an ancestor listed separately becomes a *second* Sanity type, not extra fields on the proxy's type).
- **Merge without hide/order semantics** — demonstrably wrong on the real data (promocard would gain four tabs its AEM authors never see).
- **Fail the component on mid-chain errors** — turns a broken `/libs` ancestor (or a transient 500) into a lost component; degrading costs only the inherited fields and says so in the log.
