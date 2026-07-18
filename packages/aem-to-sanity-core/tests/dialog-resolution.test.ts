import { describe, expect, it, vi } from "vitest";
import { AemFetchError } from "../src/aem/fetcher.ts";
import { resolveDialogViaSuperType } from "../src/aem/dialog-resolution.ts";
import type { DialogNode } from "../src/aem/dialog-types.ts";

/**
 * Builds a stub fetcher backed by an in-memory map. Each key is a JCR path;
 * the value is what the fetcher returns (a DialogNode) or `undefined` for
 * 404. Anything not in the map throws a non-404 AemFetchError so we can
 * verify "treat unknown errors as failures, not as missing-dialog signals".
 */
function buildFetcher(table: Record<string, DialogNode | undefined>) {
  return vi.fn(async (jcrPath: string): Promise<DialogNode> => {
    if (!(jcrPath in table)) {
      throw new AemFetchError(
        "network",
        `Unexpected fetch in test: ${jcrPath}`,
        { status: 500 },
      );
    }
    const v = table[jcrPath];
    if (v === undefined) {
      throw new AemFetchError(
        "network",
        `Authentication failed (404) for ${jcrPath}`,
        { status: 404 },
      );
    }
    return v;
  });
}

const SAMPLE_DIALOG: DialogNode = {
  "jcr:title": "Sample",
  "sling:resourceType": "cq/gui/components/authoring/dialog",
};

describe("resolveDialogViaSuperType", () => {
  it("returns directly when the component owns a cq:dialog and has no supertype", async () => {
    const fetcher = buildFetcher({
      "/apps/site/components/promo/_cq_dialog": SAMPLE_DIALOG,
      // The walk always checks for a supertype now (dialogs merge along the
      // chain), so the component node itself is read once.
      "/apps/site/components/promo": { "jcr:title": "Promo" },
    });
    const out = await resolveDialogViaSuperType(
      "/apps/site/components/promo",
      fetcher,
    );
    // Single-source chain → identity merge, same reference.
    expect(out.dialog).toBe(SAMPLE_DIALOG);
    expect(out.resolvedPath).toBe("/apps/site/components/promo");
    expect(out.chain).toEqual(["/apps/site/components/promo"]);
    expect(out.contributingPaths).toEqual(["/apps/site/components/promo"]);
    expect(out.warnings).toEqual([]);
    // Dialog + supertype lookup → two calls.
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("follows sling:resourceSuperType via /apps when component is dialogless", async () => {
    const fetcher = buildFetcher({
      // Proxy has no dialog → 404
      "/apps/site/components/proxy/pageinfo/_cq_dialog": undefined,
      // But declares a supertype.
      "/apps/site/components/proxy/pageinfo": {
        "sling:resourceSuperType": "site/components/content/pageinfo/v1/pageinfo",
      },
      // The supertype exists under /apps.
      "/apps/site/components/content/pageinfo/v1/pageinfo": {
        "sling:resourceType": "cq:Component",
      },
      "/apps/site/components/content/pageinfo/v1/pageinfo/_cq_dialog": SAMPLE_DIALOG,
    });
    const out = await resolveDialogViaSuperType(
      "/apps/site/components/proxy/pageinfo",
      fetcher,
    );
    expect(out.dialog).toBe(SAMPLE_DIALOG);
    expect(out.resolvedPath).toBe(
      "/apps/site/components/content/pageinfo/v1/pageinfo",
    );
    expect(out.chain).toEqual([
      "/apps/site/components/proxy/pageinfo",
      "/apps/site/components/content/pageinfo/v1/pageinfo",
    ]);
  });

  it("falls back to /libs when the supertype isn't under /apps", async () => {
    const fetcher = buildFetcher({
      "/apps/site/components/text/_cq_dialog": undefined,
      "/apps/site/components/text": {
        "sling:resourceSuperType": "foundation/components/text",
      },
      // /apps/foundation/components/text does NOT exist.
      "/apps/foundation/components/text": undefined,
      // …but /libs does.
      "/libs/foundation/components/text": { "sling:resourceType": "cq:Component" },
      "/libs/foundation/components/text/_cq_dialog": SAMPLE_DIALOG,
    });
    const out = await resolveDialogViaSuperType(
      "/apps/site/components/text",
      fetcher,
    );
    expect(out.resolvedPath).toBe("/libs/foundation/components/text");
    expect(out.chain).toEqual([
      "/apps/site/components/text",
      "/libs/foundation/components/text",
    ]);
  });

  it("respects absolute supertype paths", async () => {
    const fetcher = buildFetcher({
      "/apps/site/components/quote/_cq_dialog": undefined,
      "/apps/site/components/quote": {
        // Absolute path — should NOT be re-rooted under /apps or /libs.
        "sling:resourceSuperType": "/apps/another/components/quote/v2/quote",
      },
      "/apps/another/components/quote/v2/quote": { "sling:resourceType": "cq:Component" },
      "/apps/another/components/quote/v2/quote/_cq_dialog": SAMPLE_DIALOG,
    });
    const out = await resolveDialogViaSuperType(
      "/apps/site/components/quote",
      fetcher,
    );
    expect(out.resolvedPath).toBe("/apps/another/components/quote/v2/quote");
  });

  it("walks multi-hop chains until a dialog is found", async () => {
    // proxy → base v1 → base (no version) — three hops total.
    const fetcher = buildFetcher({
      "/apps/site/components/foo/_cq_dialog": undefined,
      "/apps/site/components/foo": {
        "sling:resourceSuperType": "site/components/foo/v1/foo",
      },
      "/apps/site/components/foo/v1/foo": {
        "sling:resourceSuperType": "site/components/base/foo",
      },
      "/apps/site/components/foo/v1/foo/_cq_dialog": undefined,
      "/apps/site/components/base/foo": {
        "sling:resourceType": "cq:Component",
      },
      "/apps/site/components/base/foo/_cq_dialog": SAMPLE_DIALOG,
    });
    const out = await resolveDialogViaSuperType(
      "/apps/site/components/foo",
      fetcher,
    );
    expect(out.resolvedPath).toBe("/apps/site/components/base/foo");
    expect(out.chain).toHaveLength(3);
  });

  it("throws a clear error when the chain dead-ends with no supertype", async () => {
    const fetcher = buildFetcher({
      "/apps/site/components/structural/_cq_dialog": undefined,
      "/apps/site/components/structural": {
        // No sling:resourceSuperType — dialogless leaf.
        "jcr:title": "Structural component",
      },
    });
    await expect(
      resolveDialogViaSuperType("/apps/site/components/structural", fetcher),
    ).rejects.toThrow(/no `sling:resourceSuperType` to follow/);
  });

  it("throws when a supertype is declared but doesn't resolve under /apps or /libs", async () => {
    const fetcher = buildFetcher({
      "/apps/site/components/orphan/_cq_dialog": undefined,
      "/apps/site/components/orphan": {
        "sling:resourceSuperType": "does/not/exist/anywhere",
      },
      "/apps/does/not/exist/anywhere": undefined,
      "/libs/does/not/exist/anywhere": undefined,
    });
    await expect(
      resolveDialogViaSuperType("/apps/site/components/orphan", fetcher),
    ).rejects.toThrow(/couldn't resolve it under \/apps\/ or \/libs\//);
  });

  it("detects supertype cycles", async () => {
    const fetcher = buildFetcher({
      "/apps/a/_cq_dialog": undefined,
      "/apps/a": { "sling:resourceSuperType": "b" },
      "/apps/b": { "sling:resourceSuperType": "a" },
      "/apps/b/_cq_dialog": undefined,
    });
    await expect(
      resolveDialogViaSuperType("/apps/a", fetcher),
    ).rejects.toThrow(/Cycle in sling:resourceSuperType chain/);
  });

  it("aborts when hop budget is exhausted", async () => {
    // Build a chain that always points one hop deeper.
    const table: Record<string, DialogNode | undefined> = {};
    for (let i = 0; i < 15; i++) {
      table[`/apps/c${i}/_cq_dialog`] = undefined;
      table[`/apps/c${i}`] = {
        "sling:resourceSuperType": `c${i + 1}`,
      };
    }
    const fetcher = buildFetcher(table);
    await expect(
      resolveDialogViaSuperType("/apps/c0", fetcher, { maxHops: 5 }),
    ).rejects.toThrow(/Aborting after 5 supertype hops/);
  });

  it("propagates auth errors instead of treating them as missing dialogs", async () => {
    const fetcher = vi.fn(async (jcrPath: string): Promise<DialogNode> => {
      throw new AemFetchError("auth", `Authentication failed (401) for ${jcrPath}`, {
        status: 401,
      });
    });
    await expect(
      resolveDialogViaSuperType("/apps/site/components/x", fetcher),
    ).rejects.toThrow(/Authentication failed/);
  });

  // ── Sling Resource Merger semantics along the chain ────────────────────

  it("merges dialogs along the whole chain (t-mobile title regression)", async () => {
    // Mirrors the real uxp title component: proxy (no dialog) → uxp v1
    // (Display/Styles tabs, tabStyle carries sling:orderBefore) → /libs core
    // v3 (Properties tab that first-hit-wins resolution used to drop).
    const v1Dialog: DialogNode = {
      "jcr:title": "Title",
      content: {
        items: {
          tabs: {
            items: {
              display: { "jcr:title": "Display", items: {} },
              tabStyle: {
                "jcr:title": "Styles",
                "sling:orderBefore": "cq:include",
                items: {},
              },
              "cq:include": { path: "/mnt/overlay/..." },
            },
          },
        },
      },
    };
    const coreDialog: DialogNode = {
      "jcr:title": "Title",
      helpPath: "core-help",
      content: {
        items: {
          tabs: {
            items: {
              properties: {
                "jcr:title": "Properties",
                items: { title: { name: "./jcr:title" } },
              },
              styletab: { "jcr:title": "Styles (core)" },
            },
          },
        },
      },
    };
    const fetcher = buildFetcher({
      "/apps/uxp/components/proxy/content/title/_cq_dialog": undefined,
      "/apps/uxp/components/proxy/content/title": {
        "sling:resourceSuperType": "uxp/components/content/title/v1/title",
      },
      "/apps/uxp/components/content/title/v1/title": {
        "sling:resourceSuperType": "core/wcm/components/title/v3/title",
      },
      "/apps/uxp/components/content/title/v1/title/_cq_dialog": v1Dialog,
      "/apps/core/wcm/components/title/v3/title": undefined,
      "/libs/core/wcm/components/title/v3/title": {
        "sling:resourceType": "cq:Component",
      },
      "/libs/core/wcm/components/title/v3/title/_cq_dialog": coreDialog,
    });
    const out = await resolveDialogViaSuperType(
      "/apps/uxp/components/proxy/content/title",
      fetcher,
    );

    expect(out.resolvedPath).toBe("/apps/uxp/components/content/title/v1/title");
    expect(out.chain).toEqual([
      "/apps/uxp/components/proxy/content/title",
      "/apps/uxp/components/content/title/v1/title",
      "/libs/core/wcm/components/title/v3/title",
    ]);
    expect(out.contributingPaths).toEqual([
      "/apps/uxp/components/content/title/v1/title",
      "/libs/core/wcm/components/title/v3/title",
    ]);
    expect(out.warnings).toEqual([]);

    const merged = out.dialog as Record<string, any>;
    // Inherited-first tab order, child-only tabs appended, orderBefore
    // honored (tabStyle already precedes cq:include here — asserting the
    // exact order pins the whole contract).
    expect(Object.keys(merged.content.items.tabs.items)).toEqual([
      "properties",
      "styletab",
      "display",
      "tabStyle",
      "cq:include",
    ]);
    // The ancestor-only Properties tab (the original bug) survives intact.
    expect(merged.content.items.tabs.items.properties.items.title.name).toBe(
      "./jcr:title",
    );
    // Base-only root property inherited.
    expect(merged.helpPath).toBe("core-help");
    // Merge-control bookkeeping never reaches the mapper.
    expect(
      merged.content.items.tabs.items.tabStyle["sling:orderBefore"],
    ).toBeUndefined();
  });

  it("merges same-named tabs recursively — child wins, base-only fields survive", async () => {
    const fetcher = buildFetcher({
      "/apps/site/components/hero/_cq_dialog": {
        content: {
          items: {
            tabA: { "jcr:title": "Child A", items: { childField: { name: "./c" } } },
          },
        },
      },
      "/apps/site/components/hero": {
        "sling:resourceSuperType": "site/components/base/hero",
      },
      "/apps/site/components/base/hero": { "sling:resourceType": "cq:Component" },
      "/apps/site/components/base/hero/_cq_dialog": {
        content: {
          items: {
            tabA: { "jcr:title": "Base A", items: { baseField: { name: "./b" } } },
          },
        },
      },
    });
    const out = await resolveDialogViaSuperType("/apps/site/components/hero", fetcher);
    const tabA = (out.dialog as Record<string, any>).content.items.tabA;
    expect(tabA["jcr:title"]).toBe("Child A");
    expect(Object.keys(tabA.items)).toEqual(["baseField", "childField"]);
  });

  it("degrades with a warning when a supertype is unresolvable after a dialog was found", async () => {
    const onWarning = vi.fn();
    const fetcher = buildFetcher({
      "/apps/site/components/promo/_cq_dialog": SAMPLE_DIALOG,
      "/apps/site/components/promo": {
        "sling:resourceSuperType": "does/not/exist",
      },
      "/apps/does/not/exist": undefined,
      "/libs/does/not/exist": undefined,
    });
    const out = await resolveDialogViaSuperType(
      "/apps/site/components/promo",
      fetcher,
      { onWarning },
    );
    expect(out.dialog).toBe(SAMPLE_DIALOG);
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toMatch(/couldn't resolve it under \/apps\/ or \/libs\//);
    expect(onWarning).toHaveBeenCalledTimes(1);
  });

  it("degrades with a warning on a cycle after a dialog was found", async () => {
    const fetcher = buildFetcher({
      "/apps/a/_cq_dialog": undefined,
      "/apps/a": { "sling:resourceSuperType": "b" },
      "/apps/b/_cq_dialog": SAMPLE_DIALOG,
      "/apps/b": { "sling:resourceSuperType": "a" },
    });
    const out = await resolveDialogViaSuperType("/apps/a", fetcher);
    expect(out.dialog).toBe(SAMPLE_DIALOG);
    expect(out.warnings[0]).toMatch(/Cycle in sling:resourceSuperType chain/);
  });

  it("degrades with a warning when the hop budget runs out after a dialog was found", async () => {
    const table: Record<string, DialogNode | undefined> = {
      "/apps/c0/_cq_dialog": SAMPLE_DIALOG,
    };
    for (let i = 0; i < 15; i++) {
      if (i > 0) table[`/apps/c${i}/_cq_dialog`] = undefined;
      table[`/apps/c${i}`] = { "sling:resourceSuperType": `c${i + 1}` };
    }
    const fetcher = buildFetcher(table);
    const out = await resolveDialogViaSuperType("/apps/c0", fetcher, {
      maxHops: 3,
    });
    expect(out.dialog).toBe(SAMPLE_DIALOG);
    expect(out.warnings[0]).toMatch(/Aborting after 3 supertype hops/);
  });

  it("degrades with a warning on an auth error deeper in the chain", async () => {
    // Contrast with the propagation test above: here the 401 arrives AFTER
    // a dialog was already collected, so the walk keeps what it has.
    const fetcher = vi.fn(async (jcrPath: string): Promise<DialogNode> => {
      if (jcrPath === "/apps/site/components/promo/_cq_dialog") {
        return SAMPLE_DIALOG;
      }
      throw new AemFetchError("auth", `Authentication failed (401) for ${jcrPath}`, {
        status: 401,
      });
    });
    const out = await resolveDialogViaSuperType(
      "/apps/site/components/promo",
      fetcher,
    );
    expect(out.dialog).toBe(SAMPLE_DIALOG);
    expect(out.warnings[0]).toMatch(/Authentication failed/);
  });

  it("seeds the walk with an embedded leaf dialog without re-fetching it", async () => {
    const leafDialog: DialogNode = {
      content: { items: { childTab: { "jcr:title": "Child" } } },
    };
    const baseDialog: DialogNode = {
      content: { items: { baseTab: { "jcr:title": "Base" } } },
    };
    const fetcher = buildFetcher({
      "/apps/site/components/base/x": { "sling:resourceType": "cq:Component" },
      "/apps/site/components/base/x/_cq_dialog": baseDialog,
    });
    const out = await resolveDialogViaSuperType(
      "/apps/site/components/x",
      fetcher,
      { seed: { dialog: leafDialog, superType: "site/components/base/x" } },
    );
    // Neither the leaf's _cq_dialog nor the leaf component node is fetched.
    const fetchedPaths = fetcher.mock.calls.map((c) => c[0]);
    expect(fetchedPaths).not.toContain("/apps/site/components/x/_cq_dialog");
    expect(fetchedPaths).not.toContain("/apps/site/components/x");
    expect(out.contributingPaths).toEqual([
      "/apps/site/components/x",
      "/apps/site/components/base/x",
    ]);
    expect(out.resolvedPath).toBe("/apps/site/components/x");
    expect(
      Object.keys((out.dialog as Record<string, any>).content.items),
    ).toEqual(["baseTab", "childTab"]);
  });

  it("seed with superType: null resolves immediately with the leaf dialog alone", async () => {
    const leafDialog: DialogNode = { "jcr:title": "Standalone" };
    const fetcher = buildFetcher({});
    const out = await resolveDialogViaSuperType(
      "/apps/site/components/solo",
      fetcher,
      { seed: { dialog: leafDialog, superType: null } },
    );
    expect(out.dialog).toBe(leafDialog);
    expect(out.chain).toEqual(["/apps/site/components/solo"]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
