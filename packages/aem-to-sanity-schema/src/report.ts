import { writeJson } from "aem-to-sanity-core";
import type { RenamedField, UnmappedField } from "./mapper.ts";

export type Outcome =
  | {
      status: "success";
      path: string;
      sanityTypeName: string;
      outputFile: string;
      /** Names of the fields that landed on the emitted Sanity type. */
      fieldNames: string[];
      unmapped: UnmappedField[];
      renamed: RenamedField[];
    }
  | {
      status: "failure";
      path: string;
      kind: FailureKind;
      message: string;
      bodyExcerpt?: string;
    };

export type FailureKind =
  | "network"
  | "auth"
  | "parseError"
  | "tooLarge"
  | "mappingError"
  | "writeError";

export interface ReportSummary {
  total: number;
  successes: number;
  failures: number;
  unmappedTypes: Record<string, number>;
}

export class Report {
  private readonly items: Outcome[] = [];

  add(outcome: Outcome): void {
    this.items.push(outcome);
  }

  get results(): readonly Outcome[] {
    return this.items;
  }

  summary(): ReportSummary {
    const unmapped: Record<string, number> = {};
    let successes = 0;
    let failures = 0;
    for (const item of this.items) {
      if (item.status === "success") {
        successes += 1;
        for (const u of item.unmapped) {
          if (u.reason === "unknown-type") {
            unmapped[u.resourceType] = (unmapped[u.resourceType] ?? 0) + 1;
          }
        }
      } else {
        failures += 1;
      }
    }
    return {
      total: this.items.length,
      successes,
      failures,
      unmappedTypes: unmapped,
    };
  }

  async write(outputFile: string): Promise<void> {
    const payload = {
      generatedAt: new Date().toISOString(),
      summary: this.summary(),
      results: this.items,
    };
    await writeJson(outputFile, payload, { pretty: true });
  }
}
