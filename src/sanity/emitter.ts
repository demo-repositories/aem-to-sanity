import prettier from "prettier";
import type { SanityField } from "./mapper.ts";
import { displayTitleFromAemComponentJcrTitle, toTitleCase } from "./naming.ts";

export interface EmitInput {
  typeName: string;
  sourcePath: string;
  fields: SanityField[];
  groups: Array<{ name: string; title: string }>;
  /** AEM `cq:Component` `jcr:title` when available. */
  schemaTitle?: string;
}

/**
 * Produces a TypeScript module exporting a Sanity object schema built with
 * `defineType` / `defineField`. Output is formatted with prettier so the
 * generated file is committable and diffable.
 */
export async function emitSchemaFile(input: EmitInput): Promise<string> {
  const { typeName, sourcePath, fields, groups } = input;
  const title = input.schemaTitle?.trim()
    ? displayTitleFromAemComponentJcrTitle(input.schemaTitle.trim())
    : toTitleCase(typeName);

  const groupsLiteral = groups.length > 0
    ? `  groups: ${stringifyGroups(groups)},\n`
    : "";

  const src = `import { defineField, defineType } from "sanity";

/**
 * Generated from AEM component: ${sourcePath}
 * DO NOT EDIT BY HAND — regenerate via \`npm run migrate\`.
 */
export const ${typeName} = defineType({
  name: "${typeName}",
  title: "${title}",
  type: "object",
${groupsLiteral}  fields: [
${fields.map((f) => renderField(f, 2)).join(",\n")}
  ],
});
`;

  return prettier.format(src, { parser: "typescript" });
}

function stringifyGroups(groups: Array<{ name: string; title: string }>): string {
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
      const itemFields = field.itemFields.map((f) => renderField(f, 0)).join(", ");
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
