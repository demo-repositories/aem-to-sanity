/**
 * Schema extraction worker. This file is NOT meant to be bundled — it is
 * written to `{outputDir}/.typegen/extract.ts` at runtime and invoked via
 * `tsx` so that it can dynamically import the emitted schema TS files.
 *
 * Its job is to avoid `sanity schema extract`, which performs workspace
 * resolution (and thus a network call to validate the project id) before
 * giving us the JSON we actually want. We skip all of that and call
 * `createSchema` + `@sanity/schema/_internal` `extractSchema` directly.
 *
 * This file is kept as source (not tsup-bundled) so its imports resolve
 * relative to the `.typegen/` directory at run time, where a symlinked
 * `node_modules` makes `sanity` and `@sanity/schema` discoverable.
 */
export const EXTRACT_SCRIPT_SRC = `import { readdir, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { createSchema, defineField } from "sanity";
import { extractSchema } from "@sanity/schema/_internal";

const [, , schemasDirArg, outFileArg, optionsJson] = process.argv;
if (!schemasDirArg || !outFileArg) {
  console.error("usage: extract.ts <schemasDir> <outFile> [optionsJson]");
  process.exit(2);
}

const options = optionsJson ? JSON.parse(optionsJson) : {};

const RESERVED = new Set([
  "image", "file", "geopoint", "reference", "slug", "url",
  "text", "string", "number", "boolean", "date", "datetime",
  "block", "object", "array", "email", "span",
]);

function sanitize(raw) {
  const t = raw;
  const renamed = RESERVED.has(t.name)
    ? { ...t, name: "aem" + t.name.charAt(0).toUpperCase() + t.name.slice(1) }
    : t;
  const isContainer = renamed.type === "object" || renamed.type === "document";
  if (!isContainer) return renamed;
  const fields = Array.isArray(renamed.fields) ? renamed.fields : [];
  if (fields.length === 0) {
    return {
      ...renamed,
      fields: [
        defineField({
          name: "aemPlaceholder",
          type: "string",
          description:
            "TODO: AEM dialog had no mappable fields; placeholder for schema validity.",
          hidden: true,
        }),
      ],
    };
  }
  return renamed;
}

const files = (await readdir(schemasDirArg))
  .filter((f) => f.endsWith(".ts"))
  .sort();

const types = [];
for (const f of files) {
  const mod = await import(join(schemasDirArg, f));
  const exportName = basename(f, ".ts");
  const t = mod[exportName] ?? mod.default;
  if (!t) {
    console.warn("extract: skipping " + f + " (no export '" + exportName + "')");
    continue;
  }
  types.push(sanitize(t));
}

const schema = createSchema({ name: "default", types });
const groups = schema._validation ?? [];
const errors = [];
for (const g of groups) {
  for (const p of g.problems ?? []) {
    if (p.severity === "error" || p.type === "error") {
      errors.push({ path: g.path, message: p.message ?? JSON.stringify(p) });
    }
  }
}
if (errors.length) {
  console.error("extract: schema has " + errors.length + " validation error(s):");
  for (const e of errors.slice(0, 25)) {
    console.error("  [" + JSON.stringify(e.path) + "] " + e.message);
  }
  process.exit(3);
}

const extracted = extractSchema(schema, {
  enforceRequiredFields: options.enforceRequiredFields === true,
});

await writeFile(outFileArg, JSON.stringify(extracted, null, 2) + "\\n", "utf8");
console.log("extract: wrote " + outFileArg);
`;
