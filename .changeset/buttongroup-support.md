---
"aem-to-sanity-schema": minor
"aem-to-sanity-content": minor
---

Support AEM's Coral buttongroup widget (`granite/ui/components/coral/foundation/form/buttongroup`):

- **Single selection mode** → Sanity `string` with `options.list` built from the dialog's literal `items`; an item flagged `selected` becomes the field's `initialValue`. Fields carry an `options.aemWidget: "buttonGroup"` marker that the example Studio routes to a new toggle-button-group input (`apps/studio/components/inputs/StringToggleGroupInput.tsx`, adapted from sanity-io/sanetti-3), so authors keep the one-click row of buttons they had in AEM. Studios without the resolver fall back to the default dropdown.
- **Multiple selection mode** → Sanity `array` of `string` with the same `options.list` (built-in checkbox rendering). `aem-transform` coerces the bare-string shape JCR produces when exactly one value is picked into a one-item array.
- **Datasource-driven items** (ACS Commons generic lists etc.) are opaque over `.infinity.json`; those fields fall back to a plain field without options — authored values still migrate.

No action needed for existing migrations; re-run `migrate:schema` + `transform` to pick up the new mapping (previously these dialogs emitted TODO placeholder strings).
