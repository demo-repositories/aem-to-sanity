/**
 * One-off: walks every component dialog that produced a placeholder field in
 * the last run and captures one real example JSON node per unmapped
 * sling:resourceType. Output is written to scripts/unmapped-examples.json and
 * is used to author the "types falling back to string" review doc.
 */
import { readFile, writeFile } from "node:fs/promises";
import { loadConfig } from "../src/config.ts";
import { fetchComponentDialog } from "../src/aem/fetcher.ts";
import type { DialogNode } from "../src/aem/types.ts";

interface ReportEntry {
  status: string;
  path: string;
  unmapped?: Array<{ name: string; resourceType: string; reason: string }>;
}

interface Report {
  results: ReportEntry[];
}

type Example = {
  componentPath: string;
  fieldName: string;
  node: DialogNode;
};

async function main() {
  const config = loadConfig();
  const report: Report = JSON.parse(
    await readFile("output/migration-report.json", "utf8"),
  );

  // Group successful components by each unmapped resource type they contain,
  // but only keep `unknown-type` entries — those are the placeholders.
  const need: Map<string, Set<string>> = new Map(); // resourceType -> component paths
  const wantFieldName: Map<string, Map<string, string>> = new Map(); // rt -> (componentPath -> fieldName)
  for (const r of report.results) {
    if (r.status !== "success") continue;
    for (const u of r.unmapped ?? []) {
      if (u.reason !== "unknown-type") continue;
      if (!need.has(u.resourceType)) need.set(u.resourceType, new Set());
      need.get(u.resourceType)!.add(r.path);
      if (!wantFieldName.has(u.resourceType))
        wantFieldName.set(u.resourceType, new Map());
      const m = wantFieldName.get(u.resourceType)!;
      if (!m.has(r.path)) m.set(r.path, u.name);
    }
  }

  const examples: Record<string, Example> = {};

  // For each unmapped resource type, pull the first component that has it,
  // walk the dialog, and snapshot one matching node.
  for (const [resourceType, comps] of need) {
    for (const componentPath of comps) {
      let dialog: DialogNode;
      try {
        dialog = await fetchComponentDialog(config, componentPath);
      } catch {
        continue;
      }
      const found = findFirstByResourceType(dialog, resourceType);
      if (found) {
        examples[resourceType] = {
          componentPath,
          fieldName: wantFieldName.get(resourceType)!.get(componentPath)!,
          node: found,
        };
        break;
      }
    }
  }

  await writeFile(
    "scripts/unmapped-examples.json",
    JSON.stringify(examples, null, 2),
    "utf8",
  );
  console.log(`Captured ${Object.keys(examples).length} example node(s).`);
}

function findFirstByResourceType(
  node: DialogNode,
  target: string,
): DialogNode | undefined {
  const stack: DialogNode[] = [node];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const [, v] of Object.entries(cur)) {
      if (!v || typeof v !== "object" || Array.isArray(v)) continue;
      const child = v as DialogNode;
      if (child["sling:resourceType"] === target) return child;
      stack.push(child);
    }
  }
  return undefined;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
