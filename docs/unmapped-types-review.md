# Unmapped AEM Resource Types — Review

Generated from `output/migration-report.json` (run 2026-04-21). Every field listed here was emitted as a **`string` placeholder** with a `TODO: no Sanity mapping for AEM resource type "…"` description. Review the suggested mappings, then update `src/mapping-table.ts` and `docs/plan.md` accordingly.

## Summary

| # | Resource type | Placeholder fields | Components affected | Suggested Sanity mapping |
|---|---|---:|---:|---|
| 1 | `granite/ui/components/coral/foundation/form/pathbrowser` | 78 | 25 | split by `rootPath` + field-name heuristic — `image` vs `string` |
| 2 | `/libs/commerce/gui/components/common/cifproductfield` | 53 | 30 | `string` (future: `reference` to product doc) |
| 3 | `/libs/commerce/gui/components/common/cifcategoryfield` | 50 | 28 | `string` (future: `reference` to category doc) |
| 4 | `granite/ui/components/foundation/form/pathbrowser` | 26 | 5 | same as #1 (non-Coral alias) |
| 5 | `(none)` — no `sling:resourceType` | 8 | 7 | skip; see [§ none](#none) |
| 6 | `granite/ui/components/foundation/section` | 8 | 5 | treat as `container` (flatten, title → fieldset group) |
| 7 | `aem-integration/components/dialog/dialogimage` | 4 | 1 | `hidden` (decorative preview, not data) |
| 8 | `aem-integration/components/dialog/space` | 3 | 2 | `hidden` (decorative spacer, not data) |

**Totals:** 230 placeholder emissions across 90 migrated components. Three resource types (`pathbrowser` coral+non-coral, `cifproductfield`, `cifcategoryfield`) account for **207 (90%)** of them.

---

## 1. `granite/ui/components/coral/foundation/form/pathbrowser`

Coral 3 path picker. Used for two distinct purposes in this repo:

**Example node** (from `.../3-column-staggered-grid-portrait-images-mobile-stacked`):
```json
{
  "rootPath": "/content",
  "name": "./desktopImage",
  "fieldLabel": "Desktop Image",
  "sling:resourceType": "granite/ui/components/coral/foundation/form/pathbrowser",
  "fieldDescription": "Give Desktop Image"
}
```

### Observed usage

By field-name pattern (across all 78 occurrences):

| Pattern | Count | Intent |
|---|---:|---|
| `...image` / `...Image` (desktop/mobile/shop/background/…) | ~55 | DAM asset path → should be `image` in Sanity |
| `...link` / `...Link` | ~21 | Internal content path → string (future: `reference`) |
| `navigationpath`, `addressLineThreeLink` etc. | ~2 | Link → string |

### Suggested mapping

Two options:

- **(simple)** Map to `string` unconditionally; downstream cleanup flags image fields by name. One-line addition to `mapping-table.ts`.
- **(smarter)** Route based on `rootPath` + field name:
  - `rootPath` starts with `/content/dam` **or** field name matches `/image/i` → `image`
  - otherwise → `string` (same as existing `pathfield` mapping)

  Requires a new "pathbrowser" kind in `SanityKind` and branch logic in `buildField`.

### Components affected (25)

<details><summary>Expand</summary>

- `/apps/dbi/components/content/3-column-staggered-grid-portrait-images-mobile-stacked` — `desktopimage`, `mobileimage`, `ctalink`
- `/apps/dbi/components/content/3-column-staggered-grid-portrait-images-mobile-carousel` — `desktopimage`, `mobileimage`, `ctalink`, `ctabuttonlink`
- `/apps/dbi/components/content/4-column-staggered-grid-2-column-mobile-full` — `mobileimage`, `desktopimage`
- `/apps/dbi/components/content/4-column-staggered-grid-2-column-mobile` — `styleimagemobile`, `styleimagedesktop`, `ctalink`
- `/apps/dbi/components/content/4-column-staggered-grid-full-width-mobile` — `mobileimage`, `desktopimage`
- `/apps/dbi/components/content/about` — `ctalink`, `desktopimage`, `mobileimage`, `buttonlink`
- `/apps/dbi/components/content/5-column-content` — `mobileimage`, `desktopimage`
- `/apps/dbi/components/content/4-column-staggered-grid-mobile-carousel` — `mobileimage`, `desktopimage`
- `/apps/dbi/components/content/bv-curation-carousel` — `ctalink`
- `/apps/dbi/components/content/captioned-image` — `desktopimage`, `mobileimage`
- `/apps/dbi/components/content/dbi-appointments-banner` — `addresslinethreelink`, `ctalink`, `ctabuttonlink`, `ctachatlink`, `appointmentsdesktopimage`, `appointmentsmobileimage`
- `/apps/dbi/components/universal/dbi-header` — `navigationpath`
- `/apps/dbi/components/content/dbi-our-partners` — `ourpartnersmobileimage`, `ourpartnersdesktopimage`
- `/apps/dbi/components/content/dbi-personalized-sales` — `desktopimage`, `mobileimage`
- `/apps/dbi/components/common/dbi-hero-banner` — `desktopimage`, `mobileimage`
- `/apps/dbi/components/content/dbi-real-story` — `realstoryimage`, `mobileimage`
- `/apps/dbi/components/content/dbi-shop-your-looks` — `ctalink`
- `/apps/dbi/components/content/dbi-trends-component` — `imageone`, `imagetwo`, `imagethree`
- `/apps/dbi/components/content/editorial-grid-3-points-small-text-layout` — `imagedesktop`, `imagemobile`, `secondimagedesktop`, `secondimagemobile`, `thirdimagedesktop`, `thirdimagemobile`
- `/apps/dbi/components/content/editorial-grid-5-points` — `desktopimage1..5`, `mobileimage1..5`, `ctalink1..5`, `ctabuttonlink`
- `/apps/dbi/components/content/full-width-messaging` — `desktopimage`, `mobileimage`, `ctalink`
- `/apps/dbi/components/content/full-width-text-component` — `desktopimage`, `mobileimage`, `ctalink`
- `/apps/dbi/components/content/icon-ctas` — `shopimage`, `ctalink`
- `/apps/dbi/components/content/image` — `desktopimage`, `mobileimage`
- `/apps/dbi/components/plp/disruptor/image-disruptor` — `desktopimage`, `mobileimage`

</details>

---

## 2. `/libs/commerce/gui/components/common/cifproductfield`

Commerce Integration Framework (CIF) product picker — authored value is a Magento product **slug** or path.

**Example node**:
```json
{
  "name": "./ctaProductPath",
  "selectionId": "slug",
  "fieldLabel": "Product Path",
  "sling:resourceType": "/libs/commerce/gui/components/common/cifproductfield",
  "fieldDescription": "Choose the PDP Page Path"
}
```

### Suggested mapping

- **Now:** `string` (same as existing `pathfield` entry). Authored value is a slug/path — round-trippable as a string. Add a field description noting "Magento product slug (was CIF product picker)".
- **Future:** `reference` to a `product` document once a Sanity product model exists (out of scope for the current migrator — see Out of scope in plan).

### Components affected (30)

<details><summary>Expand</summary>

Touches every major content module (hero-banner, editorial grids, appointments, trends, carousels, store-locator, seo-sitemap, personalized-sales/style, dbi-product-recommendations, message-banner, image-disruptor, …). See `scripts/aggregate-unmapped.json` for the full per-component field list.

</details>

---

## 3. `/libs/commerce/gui/components/common/cifcategoryfield`

CIF category picker — mirror of the product picker, value is a Magento category **path**.

**Example node**:
```json
{
  "name": "./ctaCategoryPath",
  "selectionId": "path",
  "fieldLabel": "PLP Path",
  "sling:resourceType": "/libs/commerce/gui/components/common/cifcategoryfield",
  "fieldDescription": "Choose the PLP Page Path"
}
```

### Suggested mapping

Same as #2 — `string` now, `reference` to a `category` doc later. The two always appear side-by-side (`ctaCategoryPath` + `ctaProductPath`), suggesting the dialog pattern is "pick one or the other for a CTA." Worth noting in the plan that a single Sanity `link` object with a discriminated union (`kind: 'product' | 'category' | 'internal' | 'external'`) would be more idiomatic than migrating each field 1:1 — but that's a modelling decision beyond the scope of this migrator.

---

## 4. `granite/ui/components/foundation/form/pathbrowser`

Same component as #1, just under the legacy (non-Coral) path. The suffix-match fallback in `lookup()` doesn't catch it because no existing entry shares its last two segments (`form/pathbrowser`).

**Example node** (from `.../dbi-personalized-sales`):
```json
{
  "rootPath": "/content/dbi",
  "name": "./ctaLink",
  "fieldLabel": "CTA Link",
  "sling:resourceType": "granite/ui/components/foundation/form/pathbrowser",
  "fieldDescription": "CTA Link"
}
```

### Suggested mapping

Add an alias entry (or reuse whichever handler #1 lands on). Same heuristic applies.

Components affected: `dbi-personalized-sales`, `dbi-personalized-style`, `dbi-store-locator`, `dbi-trends-component`, `editorial-grid-3-points-small-text-layout`.

---

## 5. `(none)` — nodes with no `sling:resourceType` {#none}

Eight emissions, two distinct causes:

### (a) Structural `content` wrapper (`cq/gui/…/dialog` → `content` → `items`)

Some dialogs wrap their field tree in a bare `content` node instead of inlining `items` directly under the root:

```
dialog root  (sling:resourceType = "cq/gui/components/authoring/dialog")
└─ content (no resourceType)      ← currently emits a placeholder
   └─ items
      └─ …fields…
```

Affected: `aem-integration/button`, `aem-integration/column-layout`, `aem-integration/content`, `aem-integration/icon-grid` (`content` / `properties` field names).

**Fix:** extend the existing transparent-`items` special case in `mapper.walk()` to also descend through bare `content` / `properties` nodes (same rule: no resourceType, no `name`, walk through). This is a **bug**, not a mapping — should be folded into the mapper rather than `mapping-table.ts`.

### (b) Overridden fields with `sling:hideResource: true`

Inherited dialogs in AEM hide parent fields by redeclaring them as an empty node with `sling:hideResource: "true"`. Affected: `dbi-hero-banner` (`metadata`), `aem-integration/image` (`metadata`), `dbi-content/image` (`asset`, `metadata`).

**Fix:** in `mapper.walk()`, if a child has `sling:hideResource === "true"`, skip it and record `reason: "hidden"`. Again, mapper change, not a new mapping entry.

---

## 6. `granite/ui/components/foundation/section`

Section wrappers (legacy equivalent of a tab). The node carries a `jcr:title` and wraps an `items` block with further fields.

**Example node** (from `.../dbi-footer`):
```json
{
  "jcr:title": "References",
  "sling:resourceType": "granite/ui/components/foundation/section",
  "layout": { "sling:resourceType": "granite/ui/components/foundation/layouts/fixedcolumns" },
  "items": { "column": { "items": { /* real fields */ } } }
}
```

### Suggested mapping

`container` — identical to the existing entries for `tabs` / `well` / `fixedcolumns`. Children flatten up, `jcr:title` becomes a fieldset group name. The mapper already has the container logic; this is just a one-line addition to `mapping-table.ts`.

Components affected: `dbi-footer` (tab1/tab2/tab3), `dbi-hero-banner`, `rich-text-with-header`, `rich-text-with-light-header`, `size-guide`.

---

## 7. `aem-integration/components/dialog/dialogimage`

Static decorative image inside a dialog — a preview thumbnail, not an authored field. The node is pure UI chrome.

**Example node** (from `.../hero-slide`):
```json
{
  "src": "/content/dam/aem-integration/template-previews/templateD.png",
  "href": "https://www.figma.com/file/...",
  "sling:resourceType": "aem-integration/components/dialog/dialogimage"
}
```

No `name`, no `fieldLabel` — it's a visual aid for the author, not data.

### Suggested mapping

`hidden`. All 4 occurrences are in `hero-slide` and should not produce Sanity fields.

---

## 8. `aem-integration/components/dialog/space`

Dialog spacer — adds vertical whitespace between groups in the AEM dialog UI.

**Example node**:
```json
{
  "height": "30px",
  "sling:resourceType": "aem-integration/components/dialog/space"
}
```

### Suggested mapping

`hidden`. Affected: `hero-video-banner`, `hero-slide`.

---

## Recommended changes to `docs/plan.md`

Based on the above, the mapping section of `docs/plan.md` needs:

1. A row for **`granite/ui/components/coral/foundation/form/pathbrowser`** (plus the non-Coral alias) with the chosen strategy (`string` vs rootPath-aware `image`/`string`).
2. Rows for **`cifproductfield`** and **`cifcategoryfield`** → `string` (+ note on future `reference` work).
3. A row for **`granite/ui/components/foundation/section`** → container (flatten).
4. Rows for **`dialogimage`** and **`space`** → hidden.
5. A new note under "Runner flow" or a new "Mapper transparency rules" subsection documenting that bare `content` / `properties` wrapper nodes are walked through (no resourceType, no name) and that `sling:hideResource: true` fields are skipped. These are mapper behaviors, not mapping-table entries.

After the plan is updated, applying these to `src/mapping-table.ts` (+ the two mapper fixes for `(none)`) should take the placeholder count from 230 → roughly 0 on a re-run.

---

## Source data

- Raw report: `output/migration-report.json`
- Aggregated (by resource type): `scripts/aggregate-unmapped.json`
- Per-component index: `scripts/per-component-unmapped.json`
- Example AEM nodes: `scripts/unmapped-examples.json`
