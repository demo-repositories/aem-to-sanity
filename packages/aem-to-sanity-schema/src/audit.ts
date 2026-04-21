import { join } from "node:path";
import { writeJson, type DialogNode, type Logger } from "aem-to-sanity-core";
import type { Report } from "./report.ts";
import type { NodeFetcher } from "./mapper.ts";

export interface AuditExample {
  componentPath: string;
  fieldName: string;
  node: DialogNode;
}

export interface AuditResult {
  examplesPath: string;
  count: number;
}

export interface AuditOptions {
  report: Report;
  /**
   * Fetches the `_cq_dialog` for a given component path (NOT a raw JCR path).
   * i.e. `(componentPath) => fetchInfinityJson(deps, componentPath + "/_cq_dialog", DialogNodeSchema.parse)`.
   */
  dialogFetcher: NodeFetcher;
  outputDir: string;
  logger?: Logger;
}

/**
 * Promoted first-class audit step (used to live in `scripts/collect-unmapped-examples.ts`).
 * Walks each component dialog that produced placeholder fields in the current
 * run, snapshots one real example JSON node per unmapped `sling:resourceType`,
 * and writes them to `{outputDir}/audit/unmapped-examples.json`. The file is
 * the raw material for extending `mapping-table.ts`.
 */
export async function auditUnmappedTypes(
  opts: AuditOptions,
): Promise<AuditResult> {
  const { report, dialogFetcher, outputDir, logger } = opts;

  // Group successful components by each unmapped resource type they contain,
  // but only keep `unknown-type` entries — those are the placeholders.
  const need = new Map<string, Set<string>>();
  const wantFieldName = new Map<string, Map<string, string>>();
  for (const r of report.results) {
    if (r.status !== "success") continue;
    for (const u of r.unmapped) {
      if (u.reason !== "unknown-type") continue;
      if (!need.has(u.resourceType)) need.set(u.resourceType, new Set());
      need.get(u.resourceType)!.add(r.path);
      if (!wantFieldName.has(u.resourceType))
        wantFieldName.set(u.resourceType, new Map());
      const m = wantFieldName.get(u.resourceType)!;
      if (!m.has(r.path)) m.set(r.path, u.name);
    }
  }

  const examples: Record<string, AuditExample> = {};

  for (const [resourceType, comps] of need) {
    for (const componentPath of comps) {
      let dialog: DialogNode;
      try {
        dialog = await dialogFetcher(`${componentPath}/_cq_dialog`);
      } catch (err) {
        logger?.debug(
          `audit: failed to fetch ${componentPath} for ${resourceType}: ${(err as Error).message}`,
        );
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

  const examplesPath = join(outputDir, "audit", "unmapped-examples.json");
  await writeJson(examplesPath, examples);
  const count = Object.keys(examples).length;
  logger?.info(
    `audit: captured ${count} example node(s) for unmapped resource types`,
    { path: examplesPath },
  );
  return { examplesPath, count };
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
