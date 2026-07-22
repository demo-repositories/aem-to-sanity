---
"aem-to-sanity-schema": patch
"aem-to-sanity-content": patch
---

Date and datetime fields no longer fail Studio validation with `Invalid date. Must be on the format "YYYY-MM-DD"`. AEM datepickers persist whatever their `valueFormat` dialog attribute says — the standard ISO-8601-with-offset JCR date when unset, but a display-style string when set (`valueFormat="MMM DD, yyyy"` persists `"May 23, 2024"`), which Sanity's strict `date` / `datetime` types rejected.

`migrate:schema` now records the datepicker's `valueFormat` in `content-type-registry.json` (additive; old registries still load), and `aem-transform` parses authored values with it, re-emitting `YYYY-MM-DD` for `date` fields and UTC ISO for `datetime`. ISO inputs coerce even without a recorded format, and a `MMM DD, YYYY` month-name fallback covers the most common display format on registries that predate the capture. Dates parsed from ISO-with-time inputs keep the literal date part (no timezone conversion), and unparseable values keep the original so they surface in Studio validation instead of being silently remapped.

To pick up the fix on an existing migration: re-run `migrate:schema`, then `transform` + `import`.
