import type { FetchDeps, Logger } from "aem-to-sanity-core";
import type { SanityDoc, ExtractedDoc } from "./types.ts";
import { extract } from "./extractor.ts";
import type { SchemaTypeRegistry } from "./type-registry.ts";
import {
  createBatchingWriter,
  createDryRunWriter,
  type MinimalSanityClient,
  type SanityWriter,
} from "./writer.ts";
import {
  createAuditor,
  diffProps,
  type AuditFinding,
  type AuditReport,
  type Auditor,
} from "./audit.ts";

export interface MigrateContentOptions {
  /** Root JCR paths to walk. */
  rootPaths: string[];
  /** AEM fetch dependencies (config + optional fetch override). */
  fetcher: FetchDeps;
  /** Registry mapping `sling:resourceType` → Sanity schema type. */
  registry: SchemaTypeRegistry;
  /**
   * Sanity client compatible with `@sanity/client`'s transaction API.
   * Only required when `dryRun: false`.
   */
  sanityClient?: MinimalSanityClient;
  /**
   * When `true` (the DEFAULT), no writes leave the process. Callers must
   * opt-in to writing with `dryRun: false` to prevent an accidental
   * destination-smashing run.
   */
  dryRun?: boolean;
  /** Notified for every doc produced. Useful for NDJSON streaming in CLIs. */
  onDoc?: (doc: ExtractedDoc) => void;
  /** Batch size when a real Sanity client is supplied. */
  batchSize?: number;
  /** Restrict the walk to specific resource types. */
  includeResourceTypes?: string[];
  /** Max follow-up rounds to expand AEM depth-truncation markers. */
  maxDepthExpansions?: number;
  /** Concurrent follow-up fetches per round. */
  concurrency?: number;
  /** Notified on every depth follow-up issued by the fetcher. */
  onFollowUp?: (path: string, depth: number) => void;
  /**
   * Enable the drift auditor. `true` uses the default auditor (NDJSON to
   * stderr + in-memory report); pass your own `Auditor` to override the
   * stream sink or example cap. `false`/omitted disables auditing entirely.
   */
  audit?: boolean | Auditor;
  /**
   * Called for every audit finding — even when `audit` is a custom auditor
   * that has its own stream, this fires as a drop-in observer hook.
   */
  onAudit?: (finding: AuditFinding) => void;
  logger?: Logger;
}

export interface MigrateContentResult {
  /** Number of docs produced by the extractor. */
  extracted: number;
  /** Number of docs actually written (always 0 in dry-run). */
  written: number;
  /** Docs buffered during a dry run. Empty when `dryRun: false`. */
  dryRunDocs: SanityDoc[];
  /** Audit report, present when `audit` was enabled. */
  auditReport?: AuditReport;
}

/**
 * Orchestrates the content migration pipeline: extract → transform → write.
 * Dry-run by default. The depth-aware fetcher and the audit step are added
 * in Steps 6 and 7; this v1 works on any AEM subtree that fits under
 * `.infinity.json`'s depth-5 budget.
 */
export async function migrateContent(
  opts: MigrateContentOptions,
): Promise<MigrateContentResult> {
  const dryRun = opts.dryRun ?? true;
  const logger = opts.logger;

  const dryRunWriter = dryRun
    ? createDryRunWriter({ logger })
    : undefined;

  const writer: SanityWriter = (() => {
    if (dryRun) return dryRunWriter!;
    if (!opts.sanityClient) {
      throw new Error(
        "migrateContent: sanityClient is required when dryRun is false",
      );
    }
    return createBatchingWriter(opts.sanityClient, {
      batchSize: opts.batchSize,
      logger,
    });
  })();

  const auditor: Auditor | undefined = (() => {
    if (!opts.audit) return undefined;
    if (opts.audit === true) return createAuditor({ logger });
    return opts.audit;
  })();
  const emitFinding = (finding: AuditFinding): void => {
    auditor?.record(finding);
    opts.onAudit?.(finding);
  };

  let extracted = 0;
  let written = 0;
  const batch: SanityDoc[] = [];
  const flushSize = opts.batchSize ?? 50;

  async function flushBatch(): Promise<void> {
    if (batch.length === 0) return;
    await writer.writeBatch(batch);
    written += batch.length;
    batch.length = 0;
  }

  for await (const item of extract(opts.fetcher, {
    rootPaths: opts.rootPaths,
    registry: opts.registry,
    includeResourceTypes: opts.includeResourceTypes,
    maxDepthExpansions: opts.maxDepthExpansions,
    concurrency: opts.concurrency,
    onFollowUp: opts.onFollowUp,
    onUnmapped: auditor
      ? (resourceType, path) =>
          emitFinding({ t: "unknownResourceType", resourceType, path })
      : undefined,
    logger,
  })) {
    extracted += 1;
    auditor?.tick();
    if (auditor) {
      const resourceType = item.raw["sling:resourceType"];
      if (typeof resourceType === "string") {
        const drift = diffProps(item.raw, resourceType, opts.registry);
        if (drift.length > 0) {
          emitFinding({
            t: "unknownProps",
            component: item.type,
            path: item.jcrPath,
            unknownProps: drift,
          });
        }
      }
    }
    opts.onDoc?.(item);
    batch.push(item.doc);
    if (batch.length >= flushSize) await flushBatch();
  }
  await flushBatch();
  await writer.flush?.();

  return {
    extracted,
    written: dryRun ? 0 : written,
    dryRunDocs: dryRunWriter?.recorded ?? [],
    auditReport: auditor?.report(),
  };
}
