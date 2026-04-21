import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Logger } from "aem-to-sanity-core";
import type { AemContentNode } from "./types.ts";
import type { SchemaTypeRegistry } from "./type-registry.ts";

/**
 * One audit finding. The `t` discriminator keeps downstream tooling simple
 * (pipe NDJSON to `jq 'select(.t=="unknownProps")'`).
 */
export type AuditFinding =
  | {
      t: "unknownProps";
      component: string;
      path: string;
      unknownProps: Array<{ prop: string; value: unknown }>;
    }
  | {
      t: "unknownResourceType";
      resourceType: string;
      path: string;
    };

export interface AuditReport {
  summary: {
    totalDocs: number;
    totalFindings: number;
    componentsAffected: number;
  };
  byComponent: Record<string, ComponentAudit>;
  unknownResourceTypes: Array<{
    resourceType: string;
    examples: Array<{ path: string }>;
  }>;
}

export interface ComponentAudit {
  /** Every property name the transformer saw that isn't in the schema. */
  unknownProps: Array<{
    prop: string;
    examples: Array<{ path: string; value: unknown }>;
  }>;
}

export interface AuditorOptions {
  /** Max examples stored per (component, finding) pair. Default 3. */
  maxExamplesPerFinding?: number;
  /**
   * Sink for streamed NDJSON findings. Defaults to `process.stderr.write`
   * — the plan's "pipeable through jq". Pass a no-op to silence.
   */
  stream?: (line: string) => void;
  logger?: Logger;
}

export interface Auditor {
  record(finding: AuditFinding): void;
  tick(): void;
  report(): AuditReport;
}

/**
 * JCR housekeeping properties we never surface as "unknown" — they're
 * stripped in the transformer and are not meant to be on a Sanity doc.
 * Kept in sync with `transformer.ts`'s JCR_METADATA_PROPS.
 */
const IGNORED_PROPS = new Set<string>([
  "jcr:primaryType",
  "jcr:mixinTypes",
  "jcr:uuid",
  "jcr:created",
  "jcr:createdBy",
  "jcr:lastModified",
  "jcr:lastModifiedBy",
  "cq:lastModified",
  "cq:lastModifiedBy",
  "cq:lastReplicated",
  "cq:lastReplicatedBy",
  "cq:lastReplicationAction",
  "sling:resourceType",
  "sling:resourceSuperType",
]);

/**
 * Build an auditor. `record()` both streams the finding (for live piping) and
 * aggregates it into the report returned by `report()`. Examples are capped
 * so a full-site migration doesn't balloon the persisted report.
 */
export function createAuditor(opts: AuditorOptions = {}): Auditor {
  const maxExamples = opts.maxExamplesPerFinding ?? 3;
  const stream =
    opts.stream ??
    ((line: string) => {
      process.stderr.write(line + "\n");
    });

  let totalDocs = 0;
  let totalFindings = 0;
  const byComponent = new Map<string, Map<string, ComponentAudit["unknownProps"][number]>>();
  const unknownResourceTypes = new Map<string, Array<{ path: string }>>();

  function bumpExample<T>(list: T[], item: T): void {
    if (list.length < maxExamples) list.push(item);
  }

  return {
    tick() {
      totalDocs++;
    },
    record(finding) {
      totalFindings++;
      stream(JSON.stringify(finding));

      if (finding.t === "unknownProps") {
        let propMap = byComponent.get(finding.component);
        if (!propMap) {
          propMap = new Map();
          byComponent.set(finding.component, propMap);
        }
        for (const { prop, value } of finding.unknownProps) {
          let rec = propMap.get(prop);
          if (!rec) {
            rec = { prop, examples: [] };
            propMap.set(prop, rec);
          }
          bumpExample(rec.examples, { path: finding.path, value });
        }
      } else if (finding.t === "unknownResourceType") {
        let list = unknownResourceTypes.get(finding.resourceType);
        if (!list) {
          list = [];
          unknownResourceTypes.set(finding.resourceType, list);
        }
        bumpExample(list, { path: finding.path });
      }
    },
    report() {
      const byComp: Record<string, ComponentAudit> = {};
      for (const [component, propMap] of byComponent) {
        byComp[component] = { unknownProps: [...propMap.values()] };
      }
      return {
        summary: {
          totalDocs,
          totalFindings,
          componentsAffected: byComponent.size,
        },
        byComponent: byComp,
        unknownResourceTypes: [...unknownResourceTypes.entries()].map(
          ([resourceType, examples]) => ({ resourceType, examples }),
        ),
      };
    },
  };
}

/**
 * Compute the set of AEM properties that the mapped Sanity schema doesn't
 * know about. Returns `[]` when the registry doesn't carry field metadata
 * for this resource type — we can't flag drift against an unknown expected
 * shape.
 */
export function diffProps(
  aemNode: AemContentNode,
  resourceType: string,
  registry: SchemaTypeRegistry,
): Array<{ prop: string; value: unknown }> {
  const meta = registry.lookup(resourceType);
  if (!meta?.fields) return [];
  const expectedSet = new Set(meta.fields);
  const unknown: Array<{ prop: string; value: unknown }> = [];
  for (const [key, value] of Object.entries(aemNode)) {
    if (IGNORED_PROPS.has(key)) continue;
    if (expectedSet.has(key)) continue;
    // Nested child nodes are expected-by-construction in AEM (they're
    // components, not properties). We don't flag them as unknown props.
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      continue;
    }
    unknown.push({ prop: key, value });
  }
  return unknown;
}

/** Persist the report to `{outputDir}/audit/content-audit.json`. */
export async function writeAuditReport(
  outputDir: string,
  report: AuditReport,
): Promise<string> {
  const file = `${outputDir}/audit/content-audit.json`;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(report, null, 2) + "\n", "utf8");
  return file;
}
