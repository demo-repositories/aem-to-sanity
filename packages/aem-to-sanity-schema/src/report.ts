import { writeJson } from "aem-to-sanity-core";
import type { RenamedField, SchemaFieldInfo, UnmappedField } from "./mapper.ts";

export type Outcome =
  | {
      status: "success";
      path: string;
      sanityTypeName: string;
      /**
       * Friendly Studio title — the string rendered in array pickers,
       * Page Builder rows, etc. Sourced from AEM `jcr:title` with a
       * title-cased `sanityTypeName` fallback; always non-empty.
       */
      schemaTitle: string;
      outputFile: string;
      /** Names of the fields that landed on the emitted Sanity type. */
      fieldNames: string[];
      /**
       * Tree of fields with Sanity types; nested array-of-object members
       * are carried under `itemFields`. The content registry writes this
       * shape so `aem-transform` can coerce AEM values at any depth — HTML
       * strings → Portable Text, string numbers → number, etc. — including
       * inside nested multifields.
       */
      fields: SchemaFieldInfo[];
      unmapped: UnmappedField[];
      renamed: RenamedField[];
      /**
       * Set when the dialog involved the `sling:resourceSuperType` chain
       * rather than only the component's own `cq:dialog`. First entry is
       * the original `path` above; the walk continues past the nearest
       * dialog, so the chain covers every ancestor visited. Omitted for
       * direct dialog hits with no supertype.
       */
      supertypeChain?: string[];
      /**
       * Chain entries that actually supplied a dialog (most-derived first).
       * More than one entry means the emitted schema came from a Sling
       * Resource Merger-style merge of those dialogs. Set alongside
       * `supertypeChain`.
       */
      contributingPaths?: string[];
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
