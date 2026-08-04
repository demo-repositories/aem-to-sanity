import prettier from "prettier";
import type { PreviewOverride } from "aem-to-sanity-core";
import type {
  SanityField,
  SanityFieldset,
  ShowHideCondition,
} from "./mapper.ts";
import {
  displayTitleFromAemComponentJcrTitle,
  toTitleCase,
} from "./naming.ts";

export interface EmitInput {
  typeName: string;
  /**
   * Identifier for the module's `export const`. Defaults to `typeName`.
   * The `file` suffix mode passes `{typeName}{suffix}` here (matching the
   * file basename) while `defineType({ name })` keeps the bare `typeName`.
   */
  exportName?: string;
  sourcePath: string;
  fields: SanityField[];
  groups: Array<{ name: string; title: string }>;
  /** Sections from Coral accordion panels (collapsible) and wells (static boxes) — see {@link SanityFieldset}. */
  fieldsets?: SanityFieldset[];
  /**
   * Studio document title, usually from the AEM component node's `jcr:title`.
   * When omitted, derived from `typeName` via {@link toTitleCase}.
   */
  schemaTitle?: string;
  /**
   * `@sanity/icons` icon component name (e.g. `ControlsIcon`) from
   * `aem-component-names.json`. Emitted as a subpath import
   * (`@sanity/icons/Controls`) plus `defineType({ icon })`; omitted → no
   * icon property.
   */
  icon?: string;
  /**
   * Studio preview overrides from `aem-component-names.json` — select paths
   * for title/subtitle/media plus an item-count array field. Unset slots
   * keep the emitter's defaults (static component title, subtitle/media
   * heuristics).
   */
  previewOverride?: PreviewOverride;
  /** Command the header comment tells readers to run to regenerate. */
  regenerateCommand?: string;
}

/**
 * Produces a TypeScript module exporting a Sanity object schema built with
 * `defineType` / `defineField`. Output is formatted with prettier so the
 * generated file is committable and diffable.
 */
export async function emitSchemaFile(input: EmitInput): Promise<string> {
  const { typeName, sourcePath, groups } = input;
  const exportName = input.exportName ?? typeName;
  const fieldsets = input.fieldsets ?? [];
  // AEM authors sometimes give multiple dialog widgets the same `fieldLabel`
  // (e.g. a page-shell that declares both `./cq:tags` and `./tags` with
  // `fieldLabel="Tags"`). Sanity renders the title verbatim, so authors end
  // up with two identically-labeled fields stacked in the Studio. Detect
  // duplicates within each object and append the field name to all but the
  // first — `"Tags"` becomes `"Tags (cqTags)"` / `"Tags (tags)"` etc. so
  // each one is uniquely identifiable. Field NAMES are already unique
  // (enforced by `dedupeFieldNames` in mapper.ts); this is purely a display
  // tweak. Recurses into `array-of-object` so nested multifield items get
  // the same treatment.
  const fields = disambiguateDuplicateTitles(input.fields);
  const regenerateCommand = input.regenerateCommand ?? "pnpm migrate:schema";
  // Belt-and-suspenders: the preview row in Page Builder / array pickers
  // should always render as the component name, never "Untitled". Guarantee
  // a non-empty title by layering three fallbacks (AEM jcr:title →
  // title-cased type name → the raw type name).
  const title = resolveSchemaTitle(typeName, input.schemaTitle);
  const titleLiteral = JSON.stringify(title);

  const groupsLiteral =
    groups.length > 0 ? `  groups: ${stringifyGroups(groups)},\n` : "";
  const fieldsetsLiteral =
    fieldsets.length > 0
      ? `  fieldsets: ${stringifyFieldsets(fieldsets)},\n`
      : "";
  const previewBlock = renderPreviewBlock(fields, title, input.previewOverride);
  // Config-validated PascalCase `*Icon` identifier (`VALID_ICON_NAME` in
  // component-names.ts), so it lands verbatim in the import. Since
  // @sanity/icons v5, per-icon components live only in subpath modules
  // named after the icon minus the `Icon` suffix — the root module exports
  // just `Icon`/`icons` — so `ControlsIcon` imports from
  // `@sanity/icons/Controls`.
  const iconImport = input.icon
    ? `import { ${input.icon} } from "@sanity/icons/${input.icon.slice(0, -"Icon".length)}";\n`
    : "";
  const iconLiteral = input.icon ? `  icon: ${input.icon},\n` : "";

  const src = `import { defineField, defineType } from "sanity";
${iconImport}
/**
 * Generated from AEM component: ${sourcePath}
 * DO NOT EDIT BY HAND — regenerate via \`${regenerateCommand}\`.
 */
export const ${exportName} = defineType({
  name: "${typeName}",
  title: ${titleLiteral},
  type: "object",
${iconLiteral}${groupsLiteral}${fieldsetsLiteral}${previewBlock}  fields: [
${fields.map((f) => renderField(f, 2)).join(",\n")}
  ],
});
`;

  return prettier.format(src, { parser: "typescript" });
}

/**
 * Append the field name to every duplicate `title` within a field list so
 * the Studio can render distinct labels even when the AEM dialog used the
 * same `fieldLabel` on multiple widgets. Recurses into `array-of-object`
 * item fields. Pure — returns a new list without mutating the input.
 *
 * Heuristic for what counts as a duplicate: case-insensitive trimmed
 * comparison of the resolved display title. A missing `title` falls back
 * to the field's natural Studio rendering (title-cased name) — those are
 * left alone, since the camelCased name itself already disambiguates them
 * in the rendered title.
 */
export function disambiguateDuplicateTitles(
  fields: SanityField[],
): SanityField[] {
  const counts = new Map<string, number>();
  for (const f of fields) {
    if (typeof f.title !== "string" || f.title.trim().length === 0) continue;
    const key = f.title.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return fields.map((f) => {
    const recursed =
      f.type === "array-of-object"
        ? { ...f, itemFields: disambiguateDuplicateTitles(f.itemFields) }
        : f;
    if (typeof recursed.title !== "string" || recursed.title.trim().length === 0) {
      return recursed;
    }
    const key = recursed.title.trim().toLowerCase();
    if ((counts.get(key) ?? 0) <= 1) return recursed;
    return { ...recursed, title: `${recursed.title.trim()} (${recursed.name})` };
  });
}

export function resolveSchemaTitle(
  typeName: string,
  schemaTitle: string | undefined,
): string {
  const fromJcr = schemaTitle?.trim()
    ? displayTitleFromAemComponentJcrTitle(schemaTitle.trim())
    : "";
  if (fromJcr) return fromJcr;
  const titleCased = toTitleCase(typeName).trim();
  if (titleCased) return titleCased;
  return typeName;
}

function stringifyGroups(
  groups: Array<{ name: string; title: string }>,
): string {
  return (
    "[" +
    groups
      .map(
        (g) =>
          `{ name: ${JSON.stringify(g.name)}, title: ${JSON.stringify(g.title)} }`,
      )
      .join(", ") +
    "]"
  );
}

function stringifyFieldsets(fieldsets: SanityFieldset[]): string {
  return (
    "[" +
    fieldsets
      .map((f) =>
        f.collapsible
          ? `{ name: ${JSON.stringify(f.name)}, title: ${JSON.stringify(f.title)}, options: { collapsible: true, collapsed: ${f.collapsed} } }`
          : `{ name: ${JSON.stringify(f.name)}, title: ${JSON.stringify(f.title)} }`,
      )
      .join(", ") +
    "]"
  );
}

function isShortTextField(f: SanityField): boolean {
  return (
    f.type === "string" || f.type === "text" || f.type === "placeholder"
  );
}

/** Migrated AEM DAM path strings — never use as card title in Studio preview. */
function isAemPathTraceField(f: SanityField): boolean {
  return f.type === "string" && f.name.endsWith("AemPath");
}

function pickSubtitleFieldName(
  fields: SanityField[],
  titleField: string | undefined,
): string | undefined {
  const priority = ["eyebrow", "kicker", "caption"];
  for (const name of priority) {
    const f = fields.find((x) => x.name === name);
    if (
      f &&
      isShortTextField(f) &&
      f.name !== titleField &&
      !isAemPathTraceField(f)
    )
      return f.name;
  }
  const desc = fields.find((x) => x.name === "description");
  if (
    desc &&
    (desc.type === "string" || desc.type === "text") &&
    desc.name !== titleField &&
    !isAemPathTraceField(desc)
  ) {
    return desc.name;
  }
  if (titleField && /^headline1$/i.test(titleField)) {
    const h2 = fields.find((x) => /^headline2$/i.test(x.name));
    if (h2 && isShortTextField(h2)) return h2.name;
  }
  if (titleField && /^headline\d+$/i.test(titleField)) {
    const m = titleField.match(/^(headline)(\d+)$/i);
    if (m) {
      const nextNum = parseInt(m[2]!, 10) + 1;
      const nextName = `${m[1]!}${nextNum}`;
      const next = fields.find(
        (x) => x.name.toLowerCase() === nextName.toLowerCase(),
      );
      if (
        next &&
        isShortTextField(next) &&
        next.name !== titleField &&
        !isAemPathTraceField(next)
      )
        return next.name;
    }
  }
  return undefined;
}

function pickMediaSelectPath(fields: SanityField[]): string | undefined {
  for (const f of fields) {
    if (f.type === "image") return f.name;
    if (f.type === "file") return f.name;
  }
  for (const f of fields) {
    if (f.type === "array-of-object" && f.itemFields?.length) {
      const img = f.itemFields.find((i) => i.type === "image");
      if (img) return `${f.name}.0.${img.name}`;
      const file = f.itemFields.find((i) => i.type === "file");
      if (file) return `${f.name}.0.${file.name}`;
    }
  }
  return undefined;
}

/**
 * Preview `select` cannot fetch a whole array — the Studio's field observer
 * resolves leaf paths only, so a bare array select yields `undefined`
 * (Sanity docs: "Previewing from array values" recommends selecting an
 * indexed subset). Counts therefore probe `{field}.{i}._key` for the first
 * N indexes and count the defined ones; every migrated array item carries a
 * `_key`. Displays "10+" when all probes hit.
 */
const COUNT_PROBES = 10;

/**
 * Studio list / array picker preview (`select` + `prepare`).
 * Row title is the AEM component `jcr:title` by default (see
 * `displayTitleFromAemComponentJcrTitle`); subtitle / media come from
 * mapped-field heuristics. An `aem-component-names.json` `preview` override
 * replaces individual slots: `title` selects an authored field (falling
 * back to the static title when empty), `subtitle` / `media` replace the
 * heuristic picks, and `count` appends an item count to the title
 * (`"Accordion (3 items)"`).
 */
function renderPreviewBlock(
  fields: SanityField[],
  staticTitle: string,
  override?: PreviewOverride,
): string {
  const titlePath = override?.title;
  const subtitlePath = override?.subtitle ?? pickSubtitleFieldName(fields, undefined);
  const mediaPath = override?.media ?? pickMediaSelectPath(fields);
  const countPath = override?.count;
  const staticLit = JSON.stringify(staticTitle);

  const select: Record<string, string> = {};
  if (titlePath) select.prTitle = titlePath;
  if (subtitlePath) select.prSubtitle = subtitlePath;
  if (mediaPath) select.prMedia = mediaPath;

  const keys = Object.keys(select);
  if (keys.length === 0 && !countPath) {
    return `  preview: {
    prepare() {
      return { title: ${staticLit} };
    },
  },
`;
  }

  // Count probes are generated (`prCount0…prCount{N-1}` → `{field}.{i}._key`)
  // rather than enumerated, so the emitted file stays readable.
  const probeSpread = countPath
    ? `    ...Object.fromEntries(
      Array.from({ length: ${COUNT_PROBES} }, (_, i) => [
        \`prCount\${i}\`,
        \`${countPath}.\${i}._key\`,
      ]),
    ),\n`
    : "";
  const selectInner =
    keys.map((k) => `    ${k}: ${JSON.stringify(select[k])},\n`).join("") +
    probeSpread;
  const prepareArg = countPath
    ? "sel: Record<string, any>"
    : `{ ${keys.join(", ")} }`;

  const baseTitleExpr = (ref: string): string =>
    titlePath
      ? `typeof ${ref} === "string" && ${ref}.trim() ? ${ref}.trim() : ${staticLit}`
      : staticLit;
  let preLines = "";
  let titleLine: string;
  let subtitleRef = "prSubtitle";
  let mediaRef = "prMedia";
  if (countPath) {
    subtitleRef = "sel.prSubtitle";
    mediaRef = "sel.prMedia";
    preLines =
      `      const prBase = ${baseTitleExpr("sel.prTitle")};\n` +
      `      const prCountN = Array.from({ length: ${COUNT_PROBES} }, (_, i) => sel[\`prCount\${i}\`])\n` +
      `        .filter((k) => k != null).length;\n`;
    titleLine =
      '      title: `${prBase} (${prCountN === ' +
      String(COUNT_PROBES) +
      ' ? "' +
      String(COUNT_PROBES) +
      '+" : prCountN} item${prCountN === 1 ? "" : "s"})`,';
  } else {
    titleLine = `      title: ${baseTitleExpr("prTitle")},`;
  }
  const subtitleLine = subtitlePath
    ? `      subtitle:\n        typeof ${subtitleRef} === "string" && ${subtitleRef}.trim()\n          ? ${subtitleRef}.trim()\n          : undefined,`
    : "";
  const mediaLine = mediaPath ? `      media: ${mediaRef},` : "";

  const returnBody = [titleLine, subtitleLine, mediaLine]
    .filter(Boolean)
    .join("\n");

  return `  preview: {
    select: {
${selectInner}    },
    prepare(${prepareArg}) {
${preLines}      return {
${returnBody}
      };
    },
  },
`;
}

function renderField(field: SanityField, indentLevel: number): string {
  const indent = "  ".repeat(indentLevel);
  const body = fieldBody(field, indentLevel + 1);
  // `options.aemWidget` is not a standard Sanity string option, so the
  // defineField call opts out of strict definition typing for that field.
  // Slot references opt out too: their `type` is a generated alias name
  // `defineField` can't narrow, so the object-level `options.collapsible`
  // pair doesn't typecheck under strict definitions.
  const defineOptions =
    (field.type === "string" && field.options?.aemWidget) ||
    field.type === "note" ||
    field.type === "slot-reference"
      ? ", { strict: false }"
      : "";
  return `${indent}defineField(${body}${defineOptions})`;
}

function fieldBody(field: SanityField, _indentLevel: number): string {
  const props: Record<string, string> = {};

  props.name = JSON.stringify(field.name);
  if (field.title) props.title = JSON.stringify(field.title);
  if (field.description) props.description = JSON.stringify(field.description);
  if (field.group) props.group = JSON.stringify(field.group);
  if (field.fieldset) props.fieldset = JSON.stringify(field.fieldset);
  if (field.readOnly) props.readOnly = "true";

  switch (field.type) {
    case "string": {
      props.type = '"string"';
      if (field.initialValue !== undefined)
        props.initialValue = JSON.stringify(field.initialValue);
      if (field.options?.list && field.options.list.length > 0) {
        const layout = field.options.layout
          ? `, layout: ${JSON.stringify(field.options.layout)}`
          : "";
        const aemWidget = field.options.aemWidget
          ? `, aemWidget: ${JSON.stringify(field.options.aemWidget)}`
          : "";
        props.options = `{ list: ${JSON.stringify(field.options.list)}${layout}${aemWidget} }`;
      }
      break;
    }
    case "text": {
      props.type = '"text"';
      if (field.rows !== undefined) props.rows = String(field.rows);
      if (field.initialValue !== undefined)
        props.initialValue = JSON.stringify(field.initialValue);
      break;
    }
    case "number": {
      props.type = '"number"';
      if (field.initialValue !== undefined)
        props.initialValue = String(field.initialValue);
      if (field.min !== undefined || field.max !== undefined) {
        const parts: string[] = [];
        if (field.min !== undefined) parts.push(`.min(${field.min})`);
        if (field.max !== undefined) parts.push(`.max(${field.max})`);
        props.validation = `(Rule) => Rule${parts.join("")}${
          field.required ? ".required()" : ""
        }`;
      }
      break;
    }
    case "boolean": {
      props.type = '"boolean"';
      if (field.initialValue !== undefined)
        props.initialValue = String(field.initialValue);
      break;
    }
    case "date":
    case "datetime": {
      props.type = JSON.stringify(field.type);
      break;
    }
    case "image":
    case "file": {
      props.type = JSON.stringify(field.type);
      break;
    }
    case "array-of-blocks": {
      props.type = '"array"';
      // `table` is the canonical Portable Text table type (Sanity ≥ 6.6),
      // emitted alongside the component schemas by `pt-table.ts`; AEM
      // richtext HTML tables are converted to it by `aem-transform`.
      props.of = '[{ type: "block" }, { type: "table" }]';
      break;
    }
    case "array-of-string": {
      // Multi-select buttongroup → array of strings; `options.list` on the
      // array renders Sanity's built-in checkbox list.
      props.type = '"array"';
      props.of = '[{ type: "string" }]';
      if (field.options?.list && field.options.list.length > 0) {
        props.options = `{ list: ${JSON.stringify(field.options.list)} }`;
      }
      break;
    }
    case "array-of-object": {
      props.type = '"array"';
      const itemFields = field.itemFields
        .map((f) => renderField(f, 0))
        .join(", ");
      const memberTitle = field.itemTitle
        ? `, title: ${JSON.stringify(field.itemTitle)}`
        : "";
      props.of = `[{ type: "object"${memberTitle}, fields: [${itemFields}] }]`;
      break;
    }
    case "array-of-reference": {
      // AEM tagfield → Sanity array of refs. Always multiselect (AEM
      // tagfield has no single-value mode). Each member is its own
      // reference object, so they keep their own `_key`s. The referenced
      // type (`category`) is populated by the `aem-tags` CLI.
      props.type = '"array"';
      const refType = JSON.stringify(field.refType);
      props.of = `[{ type: "reference", to: [{ type: ${refType} }] }]`;
      break;
    }
    case "container-children": {
      // Emit a direct reference to the top-level page-builder array type.
      // Keeps the container's drop-zone palette in sync with the page's
      // automatically — one list, one source of truth.
      props.type = JSON.stringify(field.pageBuilderTypeName ?? "pageBuilder");
      break;
    }
    case "slot-reference": {
      // Direct type reference — the slot carries one nested block inline,
      // not an array. Transform writes `{slotKey: {_type, ...}}` under this
      // field; schema agrees by declaring the field as that block type.
      // Collapsed by default: the nested block's full field set expanded
      // inline would dwarf the parent's own dialog fields, so the Studio
      // shows a single row the author clicks to open — the closest native
      // equivalent of AEM's edit-child-in-its-own-dialog flow.
      props.type = JSON.stringify(field.slotTypeName);
      props.options = "{ collapsible: true, collapsed: true }";
      break;
    }
    case "slot-array": {
      // Repeated named slot collapsed to a single array of the child type.
      // Transform collects every author-named sibling (`content`,
      // `content1732069919C`, …) into this one array, keeping the schema
      // attribute count flat regardless of how many instances were authored.
      props.type = '"array"';
      props.of = `[{ type: ${JSON.stringify(field.slotTypeName)} }]`;
      break;
    }
    case "note": {
      // Display-only authoring note (Coral `text` widget). Emitted as a
      // read-only string whose `description` carries the message; the
      // `aemWidget: "note"` marker lets the consuming Studio swap the whole
      // field for a banner (see `apps/studio/components/inputs/NoteField.tsx`).
      // Studios without the resolver show an empty read-only input with the
      // message as its description — nothing is ever persisted either way.
      props.type = '"string"';
      props.readOnly = "true";
      props.description = JSON.stringify(field.noteText);
      props.options = `{ aemWidget: "note" }`;
      break;
    }
    case "placeholder": {
      props.type = '"string"';
      props.description = JSON.stringify(
        `TODO: no Sanity mapping for AEM resource type "${field.originalResourceType}". Falling back to string.`,
      );
      break;
    }
  }

  if (field.hiddenConditions && field.hiddenConditions.length > 0) {
    props.hidden = renderHiddenCallback(field.hiddenConditions);
  }

  // AEM core-image alt pattern: `required` is conditional on the
  // inherit/decorative toggles (see `resolveAltRequiredCompanions` in
  // mapper.ts). Tolerate both coerced booleans and legacy uncoerced "true"
  // strings on already-imported documents.
  if (
    field.required &&
    field.requiredUnless &&
    field.requiredUnless.length > 0 &&
    props.validation === undefined
  ) {
    const checks = field.requiredUnless
      .map((name) => `inherited(parent?.${name})`)
      .join(" || ");
    props.validation =
      `(Rule) =>\n` +
      `        Rule.custom((value, context) => {\n` +
      `          const parent = context.parent as Record<string, unknown> | undefined;\n` +
      `          const inherited = (v: unknown) => v === true || v === "true";\n` +
      `          if (${checks}) return true;\n` +
      `          return typeof value === "string" && value.trim().length > 0\n` +
      `            ? true\n` +
      `            : "Required unless the alternative text is inherited or the image is decorative";\n` +
      `        })`;
  }

  // `fieldOverrides` uuid sentinel — wins over any dialog-declared default,
  // so an operator can turn a plain id textfield into an auto-generated one.
  if (field.initialValueUuid) props.initialValue = "() => crypto.randomUUID()";

  // Don't double-apply validation if it was already set for number min/max.
  if (
    field.required &&
    props.validation === undefined &&
    field.type !== "array-of-blocks" &&
    field.type !== "array-of-string" &&
    field.type !== "array-of-object" &&
    field.type !== "array-of-reference"
  ) {
    props.validation = "(Rule) => Rule.required()";
  }
  if (
    field.required &&
    (field.type === "array-of-blocks" ||
      field.type === "array-of-string" ||
      field.type === "array-of-object" ||
      field.type === "array-of-reference") &&
    props.validation === undefined
  ) {
    props.validation = "(Rule) => Rule.required().min(1)";
  }

  const ordered = [
    "name",
    "title",
    "description",
    "type",
    "group",
    "fieldset",
    "readOnly",
    "hidden",
    "rows",
    "initialValue",
    "options",
    "of",
    "validation",
  ];
  const lines: string[] = [];
  for (const key of ordered) {
    if (props[key] !== undefined) lines.push(`${key}: ${props[key]}`);
  }
  return `{ ${lines.join(", ")} }`;
}

/**
 * ACS show/hide conditions → Sanity `hidden` callback. Each condition says
 * "visible when the sibling controller holds one of these values"; the
 * callback returns true (hidden) when ANY condition fails, so nested ACS
 * wrappers AND together.
 *
 * Dropdown predicates emit the minimal equivalent form:
 * - `parent?.x !== "v"` for a single value — the common case.
 * - `!["a", "b"].includes(parent?.x)` for multiple values.
 * - The `?? "<default>"` fallback appears ONLY when the controller's AEM
 *   default option is itself one of the visible values — that's the one
 *   case where an unset select must count as the default, or a fresh
 *   document would hide fields AEM shows. Otherwise unset is hidden with
 *   or without the fallback, so it's omitted.
 *
 * Checkbox predicates apply the same default rule: an unset boolean counts
 * as the controller's `checked` default. Default-unchecked (the common
 * case) compares against `true` (`x !== true` / `x === true`); a
 * default-CHECKED controller flips the comparison to `false`
 * (`x === false` / `x !== false`) so unset lands on the visible side —
 * migrated documents where AEM never persisted the property show what a
 * fresh AEM dialog shows.
 */
function renderHiddenCallback(conditions: ShowHideCondition[]): string {
  const parts = conditions.map(renderConditionExpr);
  return `({ parent }) => ${parts.join(" || ")}`;
}

function renderConditionExpr(c: ShowHideCondition): string {
  const access = `parent?.${c.controllerField}`;
  if (c.kind === "checkbox") {
    if (c.controllerDefaultChecked) {
      return c.visibleWhenChecked
        ? `${access} === false`
        : `${access} !== false`;
    }
    return c.visibleWhenChecked ? `${access} !== true` : `${access} === true`;
  }
  const values = c.values ?? [];
  const fallback = c.controllerDefault ?? "";
  const visibleWhenUnset = values.includes(fallback);
  const subject = visibleWhenUnset
    ? `(${access} ?? ${JSON.stringify(fallback)})`
    : access;
  if (values.length === 1) {
    return `${subject} !== ${JSON.stringify(values[0])}`;
  }
  return `!${JSON.stringify(values)}.includes(${subject})`;
}
