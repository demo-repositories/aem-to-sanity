---
paths:
  - "packages/aem-to-sanity-schema/src/naming.ts"
  - "packages/aem-to-sanity-schema/src/emitter.ts"
  - "packages/aem-to-sanity-schema/src/layout.ts"
  - "packages/aem-to-sanity-core/src/config/component-names.ts"
  - "**/aem-component-names.json"
---

# Type naming, suffixes, icons, previews

## Naming pipeline (`resolveSanityTypeNames`, naming.ts)

Resolution order, per component:
1. **Explicit override** from `aem-component-names.json` — claimed first, used verbatim (exempt from suffix). Reserved built-in or duplicate override → hard throw.
2. **Strategy-derived name** (`MIGRATION_TYPE_NAMING`):
   - `path` (default): segments after the last `components/` in the JCR path, camelCased (`proxy/content/cardcontainer` → `proxyContentCardcontainer`).
   - `title`: camelCased `jcr:title` (trailing " component" stripped). Requires the component-node pre-fetch pass; missing title falls back to path-derived.
3. **Reserved names** get an `aem` prefix: Sanity built-ins (`image`, `file`, `reference`, …) plus toolkit-claimed `table`/`row`/`cell` (native PT tables) and `contentFragment`/`contentFragmentRef`. So `/apps/.../image` → `aemImage`.
4. **Collisions**: path strategy → `aem` prefix; title strategy → append PascalCased path name (`imageProxyContentImage`); final tiebreaker numeric suffix from `2`. Every deviation fires `onFallback` so the CLI can surface it.

The prefix happens **at emission time** so schema files, `content-type-registry.json`, `pageBuilder.of[]`, and ingested `_type` values all agree. Don't reintroduce per-import renames in `sanitize.ts` (defense-in-depth for hand-authored schemas only).

## Suffix knobs

- `MIGRATION_TYPE_SUFFIX` (e.g. `Block`) appends to every *derived* name; `/^[A-Za-z0-9_]+$/`.
- `MIGRATION_TYPE_SUFFIX_MODE`:
  - `type` (default): suffix is part of the Sanity type name → part of ingested `_type`. **Set-once hazard.**
  - `file`: suffix decorates only the file basename + `export const` identifier (`accordionType.ts` exporting `accordionType`, `defineType({ name: "accordion" })` stays bare). Cosmetic — exists so generated files can drop into a hand-authored convention (file/export named `xType`) without renaming imports. Safe to change between runs.
- Per-component `file` override in `aem-component-names.json` wins over `file`-mode suffix.
- Invariant relied on by the barrel, typegen, and the pruner: **export identifier == file basename** (`scanGeneratedSchemaFiles` throws on duplicate basenames). Keep `EmitInput.exportName` and the path planner in sync if you touch either.

## `aem-component-names.json` — six optional keys per resource type

`name` (set-once; verbatim, suffix-exempt), `title`, `folder` (single segment, beats `MIGRATION_SCHEMA_LAYOUT`), `file`, `icon`, `preview`. A bare string value means `{ name }`. Keys normalized (leading `/`, `apps/` stripped); duplicates throw; entries matching no listed component path are logged + dropped.

- **`icon`** must match `/^[A-Z][A-Za-z0-9]*Icon$/` because the emitter derives the `@sanity/icons` v5 subpath from it: `ControlsIcon` → `import { ControlsIcon } from "@sanity/icons/Controls"`. A well-formed but nonexistent icon fails at Studio typecheck, not config load. Consuming Studio must depend on `@sanity/icons`.
- **`preview`**: `title`/`subtitle`/`media` are dot-notation select paths (`items.0.panelTitle` allowed); `count` is a plain top-level array field name.

## Preview emission (`renderPreviewBlock`, emitter.ts)

- Heuristics when no override: subtitle from `eyebrow`/`kicker`/`caption` → `description` → next `headlineN`; media from first `image` then `file` field (also inside array-of-object items). Fields ending `AemPath` are trace fields — always excluded.
- Select keys are namespaced `prTitle`/`prSubtitle`/`prMedia` to avoid clashing with real field names.
- **Count probes**: Studio previews can't select a whole array (field observer resolves leaf paths only), so `count` emits 10 compact probes `{countField}.{i}._key` (`COUNT_PROBES = 10`, generated via `Object.fromEntries(Array.from(...))`, not enumerated) and renders `"Accordion (3 items)"` with a `"10+"` cap. Every migrated array item carries a `_key` — that's the property being counted; don't probe anything else.

## When you touch naming or emission

- Naming strategy/suffix semantics are **operator-facing**: update `packages/aem-to-sanity-schema/README.md` (lines ~33-39), root README, `.env.example` comments, `docs/running-the-migration.md` env table. (These knobs are deliberately *not* in the generated mapping doc.)
- Any change that alters emitted `name:` values orphans ingested `_type`s — call it out as a breaking changeset.
- Generated files carry a `// Generated from AEM component:` banner and are GENERATED-marker guarded — files without the marker (hand-authored) are never overwritten or pruned. Preserve that guard.
