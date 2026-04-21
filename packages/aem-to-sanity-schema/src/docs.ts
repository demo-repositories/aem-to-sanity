import { writeTextFile } from "aem-to-sanity-core";
import { MAPPING } from "./mapping-table.ts";

export async function writeMappingDocs(outputFile: string): Promise<void> {
  const rows = Object.entries(MAPPING)
    .map(
      ([aemType, entry]) =>
        `| \`${aemType}\` | \`${entry.kind}\` | ${entry.description} |`,
    )
    .join("\n");

  const md = `# AEM → Sanity field mapping

> Auto-generated from \`packages/aem-to-sanity-schema/src/mapping-table.ts\` on every \`pnpm migrate:schema\` run. Do not edit by hand — update the mapping table and re-run.

Each AEM Granite UI \`sling:resourceType\` is mapped to a Sanity field kind. Unknown types become a string placeholder and are reported in \`output/migration-report.json\` so you can extend the table.

| AEM resource type | Sanity kind | Description |
|---|---|---|
${rows}

## Fallback behaviour

- **Unknown resource type** → emitted as a \`string\` field with a TODO description and recorded under \`unmapped\` in the run report.
- **Missing \`name\`** → field is skipped and recorded.
- **Hidden field** → skipped (not emitted, not a failure).
`;

  await writeTextFile(outputFile, md);
}
