import { describe, expect, it } from "vitest";
import {
  DialogOverrideError,
  resolveEffectiveDialog,
  spliceSupplementaryTabs,
} from "../src/aem/dialog-overrides.ts";
import { AemFetchError } from "../src/aem/fetcher.ts";
import type { DialogNode } from "../src/aem/dialog-types.ts";

const TABS_RT = "granite/ui/components/coral/foundation/tabs";
const CONTAINER_RT = "granite/ui/components/coral/foundation/container";

const PROPERTIES_PATH =
  "/libs/core/wcm/components/accordion/v1/accordion/cq:dialog/content/items/tabs/items/properties";

function tabNode(title: string): DialogNode {
  return {
    "jcr:primaryType": "nt:unstructured",
    "jcr:title": title,
    "sling:resourceType": CONTAINER_RT,
    items: {},
  } as DialogNode;
}

/** Dialog with a properly-typed tabs container. */
function typedDialog(): DialogNode {
  return {
    content: {
      items: {
        tabs: {
          "sling:resourceType": TABS_RT,
          items: {
            content: tabNode("Content"),
            theme: tabNode("Theme"),
          },
        },
      },
    },
  } as DialogNode;
}

/**
 * The exact t-mobile proxy accordion shape: the `tabs` node carries NO
 * `sling:resourceType` (the Sling Resource Merger supplies it from /libs at
 * runtime) and its `items` mixes a scalar `jcr:primaryType` in with the tab
 * children.
 */
function rtLessDialog(): DialogNode {
  return {
    content: {
      items: {
        tabs: {
          "jcr:primaryType": "nt:unstructured",
          items: {
            "jcr:primaryType": "nt:unstructured",
            content: tabNode("Content"),
            theme: tabNode("Theme"),
            "cq:include": {
              "sling:resourceType":
                "granite/ui/components/coral/foundation/include",
              path: "/mnt/overlay/uxp/permission/cq:dialog/permission",
            },
          },
        },
      },
    },
  } as DialogNode;
}

function fetcherFor(nodes: Record<string, DialogNode>) {
  const calls: string[] = [];
  const fetcher = async (path: string): Promise<DialogNode> => {
    calls.push(path);
    const node = nodes[path];
    if (!node) {
      throw new AemFetchError("network", `404 ${path}`, { status: 404 });
    }
    return node;
  };
  return { fetcher, calls };
}

function tabsItemsKeys(dialog: DialogNode): string[] {
  const content = dialog["content"] as DialogNode;
  const items = content["items"] as DialogNode;
  const tabs = items["tabs"] as DialogNode;
  return Object.keys(tabs["items"] as object);
}

describe("spliceSupplementaryTabs", () => {
  it("appends by default", async () => {
    const { fetcher } = fetcherFor({ [PROPERTIES_PATH]: tabNode("Properties") });
    const { dialog, applied } = await spliceSupplementaryTabs(
      typedDialog(),
      [{ path: PROPERTIES_PATH, key: "properties" }],
      fetcher,
    );
    expect(tabsItemsKeys(dialog)).toEqual(["content", "theme", "properties"]);
    expect(applied).toEqual([
      { path: PROPERTIES_PATH, key: "properties", position: "append" },
    ]);
  });

  it("inserts after the anchor", async () => {
    const { fetcher } = fetcherFor({ [PROPERTIES_PATH]: tabNode("Properties") });
    const { dialog, applied } = await spliceSupplementaryTabs(
      typedDialog(),
      [{ path: PROPERTIES_PATH, key: "properties", insertAfter: "content" }],
      fetcher,
    );
    expect(tabsItemsKeys(dialog)).toEqual(["content", "properties", "theme"]);
    expect(applied[0]?.position).toBe("after:content");
  });

  it("inserts before the anchor", async () => {
    const { fetcher } = fetcherFor({ [PROPERTIES_PATH]: tabNode("Properties") });
    const { dialog, applied } = await spliceSupplementaryTabs(
      typedDialog(),
      [{ path: PROPERTIES_PATH, key: "properties", insertBefore: "content" }],
      fetcher,
    );
    expect(tabsItemsKeys(dialog)).toEqual(["properties", "content", "theme"]);
    expect(applied[0]?.position).toBe("before:content");
  });

  it("derives the key from the path's last segment when unset", async () => {
    const { fetcher } = fetcherFor({ [PROPERTIES_PATH]: tabNode("Properties") });
    const { dialog } = await spliceSupplementaryTabs(
      typedDialog(),
      [{ path: PROPERTIES_PATH }],
      fetcher,
    );
    expect(tabsItemsKeys(dialog)).toContain("properties");
  });

  it("warns and appends when the anchor is missing", async () => {
    const { fetcher } = fetcherFor({ [PROPERTIES_PATH]: tabNode("Properties") });
    const warnings: string[] = [];
    const { dialog, applied } = await spliceSupplementaryTabs(
      typedDialog(),
      [{ path: PROPERTIES_PATH, key: "properties", insertAfter: "nope" }],
      fetcher,
      (m) => warnings.push(m),
    );
    expect(tabsItemsKeys(dialog)).toEqual(["content", "theme", "properties"]);
    expect(applied[0]?.position).toBe("append");
    expect(warnings.join("\n")).toMatch(/anchor "nope".*not found.*appending/s);
  });

  it("throws on a duplicate tab key", async () => {
    const { fetcher } = fetcherFor({ [PROPERTIES_PATH]: tabNode("Theme Two") });
    await expect(
      spliceSupplementaryTabs(
        typedDialog(),
        [{ path: PROPERTIES_PATH, key: "theme" }],
        fetcher,
      ),
    ).rejects.toThrow(DialogOverrideError);
    await expect(
      spliceSupplementaryTabs(
        typedDialog(),
        [{ path: PROPERTIES_PATH, key: "theme" }],
        fetcher,
      ),
    ).rejects.toThrow(/already exists/);
  });

  it("throws when the dialog has no tabs container", async () => {
    const { fetcher } = fetcherFor({ [PROPERTIES_PATH]: tabNode("Properties") });
    const flat = {
      content: {
        items: {
          columns: { "sling:resourceType": CONTAINER_RT, items: {} },
        },
      },
    } as DialogNode;
    await expect(
      spliceSupplementaryTabs(flat, [{ path: PROPERTIES_PATH }], fetcher),
    ).rejects.toThrow(/no tabs container.*dialogFile/s);
  });

  it("wraps a 404 on the tab path as a DialogOverrideError", async () => {
    const { fetcher } = fetcherFor({});
    await expect(
      spliceSupplementaryTabs(typedDialog(), [{ path: PROPERTIES_PATH }], fetcher),
    ).rejects.toThrow(/does not exist \(404\)/);
  });

  it("propagates non-404 fetch errors untouched", async () => {
    const fetcher = async (): Promise<DialogNode> => {
      throw new AemFetchError("auth", "401", { status: 401 });
    };
    await expect(
      spliceSupplementaryTabs(typedDialog(), [{ path: PROPERTIES_PATH }], fetcher),
    ).rejects.toThrow(AemFetchError);
  });

  it("falls back to the RT-less `tabs` node (t-mobile proxy shape) with a warning", async () => {
    const { fetcher } = fetcherFor({ [PROPERTIES_PATH]: tabNode("Properties") });
    const warnings: string[] = [];
    const { dialog, applied } = await spliceSupplementaryTabs(
      rtLessDialog(),
      [{ path: PROPERTIES_PATH, key: "properties", insertAfter: "theme" }],
      fetcher,
      (m) => warnings.push(m),
    );
    // Scalar jcr:primaryType keeps its slot; properties lands right after theme.
    expect(tabsItemsKeys(dialog)).toEqual([
      "jcr:primaryType",
      "content",
      "theme",
      "properties",
      "cq:include",
    ]);
    expect(applied[0]?.position).toBe("after:theme");
    expect(warnings.join("\n")).toMatch(/matched by node name/);
  });

  it("never mutates the input dialog", async () => {
    const { fetcher } = fetcherFor({ [PROPERTIES_PATH]: tabNode("Properties") });
    const input = typedDialog();
    const before = JSON.stringify(input);
    await spliceSupplementaryTabs(input, [{ path: PROPERTIES_PATH }], fetcher);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("applies multiple tabs sequentially; later entries may anchor on earlier splices", async () => {
    const OTHER = "/libs/core/other/cq:dialog/content/items/tabs/items/advanced";
    const { fetcher } = fetcherFor({
      [PROPERTIES_PATH]: tabNode("Properties"),
      [OTHER]: tabNode("Advanced"),
    });
    const { dialog } = await spliceSupplementaryTabs(
      typedDialog(),
      [
        { path: PROPERTIES_PATH, key: "properties", insertAfter: "theme" },
        { path: OTHER, key: "advanced", insertAfter: "properties" },
      ],
      fetcher,
    );
    expect(tabsItemsKeys(dialog)).toEqual([
      "content",
      "theme",
      "properties",
      "advanced",
    ]);
  });
});

describe("resolveEffectiveDialog", () => {
  const COMPONENT = "/apps/site/components/proxy/accordion";

  it("uses the dialogFile override without any fetch", async () => {
    const { fetcher, calls } = fetcherFor({});
    const base = typedDialog();
    const result = await resolveEffectiveDialog(COMPONENT, fetcher, {
      override: { dialogFile: "./accordion.json", dialog: base },
    });
    expect(result.dialog).toEqual(base);
    expect(result.dialogFileApplied).toBe("./accordion.json");
    expect(result.chain).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("dialogFile wins over an embedded dialog", async () => {
    const { fetcher } = fetcherFor({});
    const base = typedDialog();
    const result = await resolveEffectiveDialog(COMPONENT, fetcher, {
      override: { dialogFile: "./accordion.json", dialog: base },
      embeddedDialog: { content: {} } as DialogNode,
    });
    expect(result.dialog).toEqual(base);
  });

  it("splices supplementary tabs on top of an embedded dialog", async () => {
    const { fetcher, calls } = fetcherFor({
      [PROPERTIES_PATH]: tabNode("Properties"),
    });
    const result = await resolveEffectiveDialog(COMPONENT, fetcher, {
      embeddedDialog: rtLessDialog(),
      override: {
        supplementaryTabs: [
          { path: PROPERTIES_PATH, key: "properties", insertAfter: "theme" },
        ],
      },
    });
    expect(tabsItemsKeys(result.dialog)).toContain("properties");
    expect(result.appliedTabs).toHaveLength(1);
    expect(result.chain).toBeUndefined();
    // Only the tab node itself was fetched — never the component dialog.
    expect(calls).toEqual([PROPERTIES_PATH]);
  });

  it("preserves the supertype chain alongside a splice", async () => {
    const BASE = "/apps/site/components/accordion/v1/accordion";
    const { fetcher } = fetcherFor({
      [COMPONENT]: {
        "sling:resourceSuperType": "site/components/accordion/v1/accordion",
      } as DialogNode,
      [BASE]: {} as DialogNode,
      [`${BASE}/_cq_dialog`]: typedDialog(),
      [PROPERTIES_PATH]: tabNode("Properties"),
    });
    const result = await resolveEffectiveDialog(COMPONENT, fetcher, {
      override: {
        supplementaryTabs: [{ path: PROPERTIES_PATH, key: "properties" }],
      },
    });
    expect(result.chain).toEqual([COMPONENT, BASE]);
    expect(tabsItemsKeys(result.dialog)).toEqual([
      "content",
      "theme",
      "properties",
    ]);
  });

  it("resolves via the supertype walk when there is no override", async () => {
    const { fetcher } = fetcherFor({
      [`${COMPONENT}/_cq_dialog`]: typedDialog(),
    });
    const result = await resolveEffectiveDialog(COMPONENT, fetcher);
    expect(result.chain).toEqual([COMPONENT]);
    expect(result.dialogFileApplied).toBeUndefined();
    expect(result.appliedTabs).toBeUndefined();
  });
});
