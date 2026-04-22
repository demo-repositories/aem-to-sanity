import prettier from "prettier";
import type { SanityField } from "./mapper.ts";
import {
  displayTitleFromAemComponentJcrTitle,
  toTitleCase,
} from "./naming.ts";

export interface EmitInput {
  typeName: string;
  sourcePath: string;
  fields: SanityField[];
  groups: Array<{ name: string; title: string }>;
  /**
   * Studio document title, usually from the AEM component node's `jcr:title`.
   * When omitted, derived from `typeName` via {@link toTitleCase}.
   */
  schemaTitle?: string;
  /** Command the header comment tells readers to run to regenerate. */
  regenerateCommand?: string;
}

/**
 * Produces a TypeScript module exporting a Sanity object schema built with
 * `defineType` / `defineField`. Output is formatted with prettier so the
 * generated file is committable and diffable.
 */
export async function emitSchemaFile(input: EmitInput): Promise<string> {
  const { typeName, sourcePath, fields, groups } = input;
  const regenerateCommand = input.regenerateCommand ?? "pnpm migrate:schema";
  const title = input.schemaTitle?.trim()
    ? displayTitleFromAemComponentJcrTitle(input.schemaTitle.trim())
    : toTitleCase(typeName);
  const titleLiteral = JSON.stringify(title);

  const groupsLiteral =
    groups.length > 0 ? `  groups: ${stringifyGroups(groups)},\n` : "";
  const previewBlock = renderPreviewBlock(fields, title);

  const src = `import { defineField, defineType } from "sanity";

/**
 * Generated from AEM component: ${sourcePath}
 * DO NOT EDIT BY HAND — regenerate via \`${regenerateCommand}\`.
 */
export const ${typeName} = defineType({
  name: "${typeName}",
  title: ${titleLiteral},
  type: "object",
${groupsLiteral}${previewBlock}  fields: [
${fields.map((f) => renderField(f, 2)).join(",\n")}
  ],
});
`;

  return prettier.format(src, { parser: "typescript" });
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
 * Studio list / array picker preview (`select` + `prepare`).
 * Row title is always the AEM component `jcr:title` (see `displayTitleFromAemComponentJcrTitle`);
 * subtitle / media still come from mapped fields when useful.
 */
function renderPreviewBlock(
  fields: SanityField[],
  staticTitle: string,
): string {
  const subtitleField = pickSubtitleFieldName(fields, undefined);
  const mediaPath = pickMediaSelectPath(fields);
  const staticLit = JSON.stringify(staticTitle);

  const select: Record<string, string> = {};
  if (subtitleField) select.prSubtitle = subtitleField;
  if (mediaPath) select.prMedia = mediaPath;

  const keys = Object.keys(select);
  if (keys.length === 0) {
    return `  preview: {
    prepare() {
      return { title: ${staticLit} };
    },
  },
`;
  }

  const selectInner = keys
    .map((k) => `    ${k}: ${JSON.stringify(select[k])}`)
    .join(",\n");
  const destruct = keys.join(", ");

  const titleLine = `      title: ${staticLit},`;
  const subtitleLine = subtitleField
    ? `      subtitle:\n        typeof prSubtitle === "string" && prSubtitle.trim()\n          ? prSubtitle.trim()\n          : undefined,`
    : "";
  const mediaLine = mediaPath ? `      media: prMedia,` : "";

  const returnBody = [titleLine, subtitleLine, mediaLine]
    .filter(Boolean)
    .join("\n");

  return `  preview: {
    select: {
${selectInner}
    },
    prepare({ ${destruct} }) {
      return {
${returnBody}
      };
    },
  },
`;
}

function renderField(field: SanityField, indentLevel: number): string {
  const indent = "  ".repeat(indentLevel);
  const body = fieldBody(field, indentLevel + 1);
  return `${indent}defineField(${body})`;
}

function fieldBody(field: SanityField, _indentLevel: number): string {
  const props: Record<string, string> = {};

  props.name = JSON.stringify(field.name);
  if (field.title) props.title = JSON.stringify(field.title);
  if (field.description) props.description = JSON.stringify(field.description);
  if (field.group) props.group = JSON.stringify(field.group);

  switch (field.type) {
    case "string": {
      props.type = '"string"';
      if (field.readOnly) props.readOnly = "true";
      if (field.initialValue !== undefined)
        props.initialValue = JSON.stringify(field.initialValue);
      if (field.options?.list && field.options.list.length > 0) {
        const layout = field.options.layout
          ? `, layout: ${JSON.stringify(field.options.layout)}`
          : "";
        props.options = `{ list: ${JSON.stringify(field.options.list)}${layout} }`;
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
      props.of = '[{ type: "block" }]';
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
    case "placeholder": {
      props.type = '"string"';
      props.description = JSON.stringify(
        `TODO: no Sanity mapping for AEM resource type "${field.originalResourceType}". Falling back to string.`,
      );
      break;
    }
  }

  // Don't double-apply validation if it was already set for number min/max.
  if (
    field.required &&
    props.validation === undefined &&
    field.type !== "array-of-blocks" &&
    field.type !== "array-of-object"
  ) {
    props.validation = "(Rule) => Rule.required()";
  }
  if (
    field.required &&
    (field.type === "array-of-blocks" || field.type === "array-of-object") &&
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
    "readOnly",
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
