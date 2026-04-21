import type { Logger } from "aem-to-sanity-core";
import type { SanityDoc } from "./types.ts";

export interface SanityWriter {
  /** Upsert a batch of documents. Implementations MUST be idempotent. */
  writeBatch(docs: SanityDoc[]): Promise<void>;
  /** Flush any buffered work. Called once at end-of-run. */
  flush?(): Promise<void>;
}

export interface BatchingWriterOptions {
  /** Maximum number of documents per Sanity transaction. */
  batchSize?: number;
  logger?: Logger;
}

/** Minimal subset of `@sanity/client`'s `Transaction` we need. */
export interface MinimalTransaction {
  createOrReplace(doc: SanityDoc): MinimalTransaction;
  commit(): Promise<unknown>;
}

/** Minimal subset of `@sanity/client`'s `SanityClient` we need. */
export interface MinimalSanityClient {
  transaction(): MinimalTransaction;
}

/**
 * Default writer that buffers docs and emits them in `createOrReplace` batches.
 * Accepts the Sanity client as an opaque handle — the content package stays
 * free of a hard dependency on `@sanity/client`, and callers can wrap their
 * own instrumentation (retries, rate limiting, observability) around it.
 */
export function createBatchingWriter(
  client: MinimalSanityClient,
  opts: BatchingWriterOptions = {},
): SanityWriter {
  const batchSize = opts.batchSize ?? 50;
  const logger = opts.logger;
  let buffer: SanityDoc[] = [];

  async function commit(docs: SanityDoc[]): Promise<void> {
    if (docs.length === 0) return;
    let tx = client.transaction();
    for (const doc of docs) {
      tx = tx.createOrReplace(doc);
    }
    await tx.commit();
    logger?.info(`writer: committed ${docs.length} docs`);
  }

  return {
    async writeBatch(docs) {
      buffer.push(...docs);
      while (buffer.length >= batchSize) {
        const chunk = buffer.slice(0, batchSize);
        buffer = buffer.slice(batchSize);
        await commit(chunk);
      }
    },
    async flush() {
      const remaining = buffer;
      buffer = [];
      await commit(remaining);
    },
  };
}

/**
 * Dry-run writer: records every doc for later inspection and never touches
 * Sanity. This is what the CLI uses until the caller passes `--confirm-write`.
 */
export function createDryRunWriter(opts: {
  onDoc?: (doc: SanityDoc) => void;
  logger?: Logger;
}): SanityWriter & { recorded: SanityDoc[] } {
  const recorded: SanityDoc[] = [];
  return {
    recorded,
    async writeBatch(docs) {
      for (const d of docs) {
        recorded.push(d);
        opts.onDoc?.(d);
      }
      opts.logger?.debug(`dryRun: buffered ${docs.length} docs`);
    },
    async flush() {},
  };
}
