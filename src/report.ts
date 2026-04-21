import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { RenamedField, UnmappedField } from "./sanity/mapper.ts";

export type Outcome =
  | {
      status: "success";
      path: string;
      sanityTypeName: string;
      outputFile: string;
      unmapped: UnmappedField[];
      renamed: RenamedField[];
    }
  | { status: "failure"; path: string; kind: FailureKind; message: string; bodyExcerpt?: string };

export type FailureKind =
  | "network"
  | "auth"
  | "parseError"
  | "mappingError"
  | "writeError";

export class Report {
  private readonly items: Outcome[] = [];

  add(outcome: Outcome): void {
    this.items.push(outcome);
  }

  summary(): {
    total: number;
    successes: number;
    failures: number;
    unmappedTypes: Record<string, number>;
  } {
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
    return { total: this.items.length, successes, failures, unmappedTypes: unmapped };
  }

  async write(outputFile: string): Promise<void> {
    await mkdir(dirname(outputFile), { recursive: true });
    const payload = {
      generatedAt: new Date().toISOString(),
      summary: this.summary(),
      results: this.items,
    };
    await writeFile(outputFile, JSON.stringify(payload, null, 2) + "\n", "utf8");
  }
}
