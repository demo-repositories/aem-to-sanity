import { describe, expect, it, vi } from "vitest";
import { AemFetchError } from "../src/aem/fetcher.ts";
import { memoizeFetcher } from "../src/aem/fetcher-memo.ts";
import type { DialogNode } from "../src/aem/dialog-types.ts";

describe("memoizeFetcher", () => {
  it("fetches each path once and shares the result", async () => {
    const inner = vi.fn(async (p: string): Promise<DialogNode> => ({ path: p }));
    const fetcher = memoizeFetcher(inner);
    const [a, b] = await Promise.all([fetcher("/apps/x"), fetcher("/apps/x")]);
    await fetcher("/apps/x");
    expect(inner).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("caches 404 rejections — a missing node stays missing for the run", async () => {
    const inner = vi.fn(async (): Promise<DialogNode> => {
      throw new AemFetchError("network", "not found", { status: 404 });
    });
    const fetcher = memoizeFetcher(inner);
    await expect(fetcher("/apps/gone")).rejects.toThrow("not found");
    await expect(fetcher("/apps/gone")).rejects.toThrow("not found");
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("evicts transient failures so retries reach the network", async () => {
    let calls = 0;
    const inner = vi.fn(async (): Promise<DialogNode> => {
      calls++;
      if (calls === 1) {
        throw new AemFetchError("network", "boom", { status: 503 });
      }
      return { ok: true };
    });
    const fetcher = memoizeFetcher(inner);
    await expect(fetcher("/apps/flaky")).rejects.toThrow("boom");
    await expect(fetcher("/apps/flaky")).resolves.toEqual({ ok: true });
    expect(inner).toHaveBeenCalledTimes(2);
  });
});
