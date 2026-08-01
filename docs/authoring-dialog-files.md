# Authoring dialog files — a cookbook

A **dialog file** is a plain JSON snapshot of an AEM `cq:dialog` node that the schema migrator maps instead of fetching the dialog from AEM. You wire one up per component in `aem-dialog-overrides.json`:

```json
{
  "<site>/components/proxy/content/hero": {
    "dialogFile": "./dialog-overrides/<site>/components/proxy/content/hero.json"
  }
}
```

Once a component has a dialog file, that file is the **single source of truth** for its Sanity schema: add a field to the JSON, re-run `pnpm migrate:schema`, and the field appears on the emitted type. No supertype walks, no Sling Resource Merger, no datasource servlets — just the JSON you see.

This page is a recipe book for editing these files by hand. For the exhaustive widget → Sanity mapping table, see the generated [`aem-to-sanity-mapping.md`](./aem-to-sanity-mapping.md).

## Getting a starting point

Don't write a dialog file from scratch — generate one:

```bash
cd tenants/<your-tenant>
pnpm eject-dialogs /apps/<site>/components/proxy/content/hero
```

This writes the component's *effective* dialog (resolution + merged tabs + resolvable datasource options baked in) to `./dialog-overrides/…` and updates `aem-dialog-overrides.json` for you. `scripts/aem-probe.ts <path> --save` gives you a raw single-dialog snapshot if you want one without the config wiring.

## Anatomy of a dialog file

```json
{
  "//": "Optional comment keys — string values are ignored by the mapper.",
  "content": {
    "items": {
      "tabs": {
        "sling:resourceType": "granite/ui/components/coral/foundation/tabs",
        "items": {

          "content": {
            "jcr:title": "Content",
            "sling:resourceType": "granite/ui/components/coral/foundation/container",
            "items": {
              "title":       { "…": "widget node — see recipes below" },
              "description": { "…": "widget node" }
            }
          },

          "style": {
            "jcr:title": "Style",
            "sling:resourceType": "granite/ui/components/coral/foundation/container",
            "items": { }
          }

        }
      }
    }
  }
}
```

Rules the mapper lives by:

- **Structure**: `content → items → tabs → items → <tab> → items → <widgets>`. Each **tab** is a titled container; its `jcr:title` becomes a Studio group (tab). Wrapper nodes without a `sling:resourceType` are walked through transparently, so extra `columns`/`column` layers from AEM are harmless — you can also delete them.
- **Order is meaning**: JSON key order = field order in the Studio, and tab order = group order. Insert a key where you want the field to appear.
- **Field identity**: `"name": "./subtitle"` → Sanity field `subtitle` (leading `./` stripped, camelCased). This must match the JCR property authored content uses — for **new** fields (nothing authored in AEM) pick any name you like.
- **Common attributes** on every widget: `fieldLabel` → Studio title, `fieldDescription` → help text, `required: true` → required validation.
- A dialog without tabs is fine too — widgets directly under `content/items` map into a single unnamed group.

## Recipes

Each snippet is one entry to paste under a tab's `items`. The key (`"subtitle"`, `"cta"`, …) is the JCR node name — by convention the same as the field name, but the `name` attribute is what counts.

### Text field → `string`

```json
"subtitle": {
  "sling:resourceType": "granite/ui/components/coral/foundation/form/textfield",
  "name": "./subtitle",
  "fieldLabel": "Subtitle",
  "fieldDescription": "Shown under the heading.",
  "required": true
}
```

`"value": "Fallback"` adds an `initialValue`.

### Multi-line text → `text`

```json
"summary": {
  "sling:resourceType": "granite/ui/components/coral/foundation/form/textarea",
  "name": "./summary",
  "fieldLabel": "Summary",
  "rows": 4
}
```

### Rich text → Portable Text (`array` of blocks)

```json
"body": {
  "sling:resourceType": "cq/gui/components/authoring/dialog/richtext",
  "name": "./body",
  "fieldLabel": "Body"
}
```

(`granite/ui/components/coral/foundation/form/richtext` works identically.) Authored HTML is converted to Portable Text at transform time.

### Number → `number`

```json
"columns": {
  "sling:resourceType": "granite/ui/components/coral/foundation/form/numberfield",
  "name": "./columns",
  "fieldLabel": "Columns",
  "min": 1,
  "max": 4,
  "value": 2
}
```

### Checkbox / switch → `boolean`

```json
"openInNewTab": {
  "sling:resourceType": "granite/ui/components/coral/foundation/form/checkbox",
  "name": "./openInNewTab",
  "fieldLabel": "Open in new tab",
  "text": "Open in new tab",
  "checked": true
}
```

Two label attributes: `text` is what AEM renders beside the checkbox, but the **Sanity title comes from `fieldLabel`** — include both (omit `fieldLabel` and Sanity derives a title from the field name). The **default** comes from `checked` — not `value`, which is the constant AEM persists when ticked. `…/form/switch` is identical but renders as a toggle.

### Dropdown → `string` with `options.list`

```json
"headingElement": {
  "sling:resourceType": "granite/ui/components/coral/foundation/form/select",
  "name": "./headingElement",
  "fieldLabel": "Heading Element",
  "items": {
    "h2": { "text": "H2", "value": "h2", "selected": true },
    "h3": { "text": "H3", "value": "h3" },
    "h4": { "text": "H4", "value": "h4" }
  }
}
```

Each option: `text` → title, `value` → stored value. `selected: true` marks the AEM default — used when resolving show/hide conditions (an unset controller counts as its default); it does **not** set a Sanity `initialValue` on selects (button groups do, see below). This is also the recipe for **pinning options on a datasource-driven select** — replace the `datasource` node with literal `items` like the above.

### Radio group → `string` with radio layout

```json
"alignment": {
  "sling:resourceType": "granite/ui/components/coral/foundation/form/radiogroup",
  "name": "./alignment",
  "fieldLabel": "Alignment",
  "items": {
    "left":  { "text": "Left",  "value": "left", "selected": true },
    "right": { "text": "Right", "value": "right" }
  }
}
```

### Toggle-button group → `string` (single) or `array` of `string` (multiple)

```json
"textAlignment": {
  "sling:resourceType": "granite/ui/components/coral/foundation/form/buttongroup",
  "name": "./textAlignment",
  "fieldLabel": "Text alignment",
  "selectionMode": "single",
  "items": {
    "start":  { "text": "Start",  "value": "flex-start" },
    "center": { "text": "Center", "value": "center" }
  }
}
```

`"selectionMode": "multiple"` → array of strings rendered as Sanity's checkbox list. In single mode an option flagged `"selected": true` becomes the field's `initialValue`. Single mode renders as a toggle-button group in Studios that ship the toolkit's input resolver, a dropdown otherwise.

### Date / datetime → `date` / `datetime`

```json
"publishDate": {
  "sling:resourceType": "granite/ui/components/coral/foundation/form/datepicker",
  "name": "./publishDate",
  "fieldLabel": "Publish date",
  "type": "date",
  "valueFormat": "YYYY-MM-DD"
}
```

`"type": "datetime"` → Sanity `datetime`. `valueFormat` describes how authored AEM values are formatted so the transform can parse them; for brand-new fields (no authored data) you can omit it.

### Image / file upload → `image` (+ read-only DAM-path companion)

```json
"heroImage": {
  "sling:resourceType": "cq/gui/components/authoring/dialog/fileupload",
  "name": "./heroImage",
  "fieldLabel": "Hero image",
  "mimeTypes": ["image/*"],
  "fileReferenceParameter": "./heroImageReference"
}
```

Emits **two** fields: `heroImageReferenceAemPath` (read-only string, the migrated DAM path) and `heroImageReference` (the Sanity image asset, linked by `aem-assets`). Non-image `mimeTypes` → `file` instead of `image`.

### Path picker → `string` (or `image` for DAM paths)

```json
"linkTarget": {
  "sling:resourceType": "granite/ui/components/coral/foundation/form/pathfield",
  "name": "./linkTarget",
  "fieldLabel": "Link",
  "rootPath": "/content/<site>"
}
```

A `pathbrowser` whose `rootPath` is under `/content/dam` (or whose field name ends in image/img) maps to `image` instead.

### Color picker → `string` (hex)

```json
"accentColor": {
  "sling:resourceType": "granite/ui/components/coral/foundation/form/colorfield",
  "name": "./accentColor",
  "fieldLabel": "Accent color"
}
```

### Tag picker → `array` of references to `category`

```json
"tags": {
  "sling:resourceType": "cq/gui/components/coral/common/form/tagfield",
  "name": "./cq:tags",
  "fieldLabel": "Tags"
}
```

References the taxonomy documents that `aem-tags` migrates from `/content/cq:tags`.

### Repeating rows (multifield) → `array` of objects

```json
"ctaButtons": {
  "sling:resourceType": "granite/ui/components/coral/foundation/form/multifield",
  "fieldLabel": "CTA buttons",
  "composite": true,
  "field": {
    "sling:resourceType": "granite/ui/components/coral/foundation/container",
    "name": "./ctaButtons",
    "items": {
      "label": {
        "sling:resourceType": "granite/ui/components/coral/foundation/form/textfield",
        "name": "./label",
        "fieldLabel": "Label"
      },
      "url": {
        "sling:resourceType": "granite/ui/components/coral/foundation/form/pathfield",
        "name": "./url",
        "fieldLabel": "URL"
      }
    }
  }
}
```

The **inner `field.name`** (`./ctaButtons`) is the array's Sanity field name; the widgets inside become the row object's fields. Nested richtext/number/boolean inside rows are coerced at transform just like top-level fields.

### A whole new tab

```json
"seo": {
  "jcr:title": "SEO",
  "sling:resourceType": "granite/ui/components/coral/foundation/container",
  "items": {
    "metaTitle": {
      "sling:resourceType": "granite/ui/components/coral/foundation/form/textfield",
      "name": "./metaTitle",
      "fieldLabel": "Meta title"
    }
  }
}
```

Paste under `tabs.items` at the position you want; the `jcr:title` becomes the Studio tab.

### Collapsible section within a tab → fieldset

```json
"advanced": {
  "jcr:title": "Advanced",
  "sling:resourceType": "granite/ui/components/coral/foundation/accordion",
  "items": {
    "advancedPanel": {
      "jcr:title": "Advanced options",
      "sling:resourceType": "granite/ui/components/coral/foundation/container",
      "items": { "…": "widgets" }
    }
  }
}
```

Accordion panels emit collapsible fieldsets (start collapsed); a `…/foundation/well` with a `jcr:title` emits a static (non-collapsible) fieldset.

### Author-facing note (nothing persisted)

```json
"migrationNote": {
  "sling:resourceType": "granite/ui/components/coral/foundation/text",
  "text": "Image dimensions must be 16:9 — cropping happens at render time."
}
```

Renders as a read-only note banner in Studios with the toolkit's field resolver.

### Removing / hiding a field

Just **delete the node** from the file. (AEM's `granite:hidden: true` and `…/form/hidden` widgets are also skipped, but in a hand-owned file deletion is clearer.) Caveat below about already-ingested values.

## Verify your edits

```bash
pnpm migrate:schema        # re-emit; the run log shows "dialog replaced by local override file …"
```

Then check:

- `output/cache/migration-report.json` → your component's `results[]` entry: `fieldNames` lists what was emitted; `unmapped` lists anything skipped and why; `renamed` shows duplicate-name dedupes.
- `pnpm --filter studio exec sanity schema validate` (or your tenant studio) for schema-level errors.

## Gotchas

- **JSON, not XML.** These files are the `.infinity.json` *serialization* of a dialog — if you're copying from a `_cq_dialog.xml` in a code repo, convert attribute syntax (`sling:resourceType="…"`) into JSON keys.
- **Duplicate `name`s dedupe.** The same `./name` twice (e.g. across tabs) keeps the first and renames later ones (`foo` → `foo2`, recorded in `renamed`). Position decides the winner.
- **Unknown `sling:resourceType`** → placeholder `string` field with a TODO description + an `unmapped` report entry. Stick to the widgets above (full list in the [mapping doc](./aem-to-sanity-mapping.md)).
- **New fields start empty.** Adding a field only extends the Sanity schema — authored AEM content has no value for it, so migrated documents show it blank until authors fill it in Sanity.
- **Removing fields orphans values.** Ingested documents keep the data; the Studio flags it as "Unknown field" until you clean it up or restore the field.
- **The file is frozen.** AEM-side dialog changes no longer flow for this component. Re-ejecting with `--force` refreshes from AEM but **discards your hand edits** — diff first.
- **Comment keys are fine.** Any key with a string value (like `"//"`) is ignored by the mapper — use them to annotate hand edits.
- **Set-once naming still applies.** A field's `name` becomes part of ingested document shape; renaming it after content is imported orphans the old values, same as any schema rename.
