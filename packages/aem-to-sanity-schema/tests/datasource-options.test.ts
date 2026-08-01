import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapDialog } from "../src/mapper.ts";
import type { DialogNode } from "aem-to-sanity-core";

/**
 * Datasource-driven selection widgets: ACS Commons generic lists resolve
 * from the list page's JCR (memoized per mapping run), core policy
 * datasources emit the no-policy h1–h6 default, everything else falls back
 * to a plain field with an `unmapped: datasource-unresolved` record.
 */

const FLEX_ALIGN_LIST = "/etc/acs-commons/lists/uxp/flex-align";

function dialogWith(children: Record<string, DialogNode>): DialogNode {
  return {
    "sling:resourceType": "cq/gui/components/authoring/dialog",
    items: children,
  } as unknown as DialogNode;
}

function selectNode(
  name: string,
  datasource: Record<string, unknown>,
): DialogNode {
  return {
    "jcr:primaryType": "nt:unstructured",
    name: `./${name}`,
    fieldLabel: name,
    "sling:resourceType": "granite/ui/components/coral/foundation/form/select",
    datasource: { "jcr:primaryType": "nt:unstructured", ...datasource },
  } as unknown as DialogNode;
}

function genericListDatasource(path: string): Record<string, unknown> {
  return {
    "sling:resourceType":
      "acs-commons/components/utilities/genericlist/datasource",
    path,
  };
}

/** Canonical ACS generic list page: cq:Page → jcr:content → list → items. */
const flexAlignPage = {
  "jcr:primaryType": "cq:Page",
  "jcr:content": {
    "jcr:primaryType": "cq:PageContent",
    "sling:resourceType": "acs-commons/components/utilities/genericlist",
    list: {
      "jcr:primaryType": "nt:unstructured",
      item0: { "jcr:title": "Start", value: "flex-start" },
      item1: { "jcr:title": "Center", value: "center" },
      item2: { "jcr:title": "End", value: "flex-end" },
      // No `value` → skipped, never emitted as an option.
      broken: { "jcr:title": "No value here" },
    },
  },
} as unknown as DialogNode;

function listFetcher(pages: Record<string, DialogNode>) {
  const calls: string[] = [];
  const fetcher = async (path: string): Promise<DialogNode> => {
    calls.push(path);
    const page = pages[path];
    if (!page) throw new Error(`404 ${path}`);
    return page;
  };
  return { fetcher, calls };
}

describe("datasource-driven options", () => {
  it("resolves an ACS generic list into options.list", async () => {
    const { fetcher, calls } = listFetcher({ [FLEX_ALIGN_LIST]: flexAlignPage });
    const { fields, unmapped } = await mapDialog(
      dialogWith({
        align: selectNode("desktopAlign", genericListDatasource(FLEX_ALIGN_LIST)),
      }),
      fetcher,
    );
    assert.equal(fields.length, 1);
    const field = fields[0]!;
    assert.equal(field.type, "string");
    assert.deepEqual((field as { options?: { list?: unknown } }).options?.list, [
      { title: "Start", value: "flex-start" },
      { title: "Center", value: "center" },
      { title: "End", value: "flex-end" },
    ]);
    assert.deepEqual(calls, [FLEX_ALIGN_LIST]);
    assert.equal(unmapped.length, 0);
  });

  it("fetches a shared list once across fields (memoized per run)", async () => {
    const { fetcher, calls } = listFetcher({ [FLEX_ALIGN_LIST]: flexAlignPage });
    const { fields } = await mapDialog(
      dialogWith({
        a: selectNode("desktopAlign", genericListDatasource(FLEX_ALIGN_LIST)),
        b: selectNode("mobileAlign", genericListDatasource(FLEX_ALIGN_LIST)),
      }),
      fetcher,
    );
    assert.equal(fields.length, 2);
    for (const f of fields) {
      assert.equal(
        (f as { options?: { list?: unknown[] } }).options?.list?.length,
        3,
      );
    }
    assert.deepEqual(calls, [FLEX_ALIGN_LIST]);
  });

  it("resolves a buttongroup's generic-list datasource with the aemWidget marker", async () => {
    const { fetcher } = listFetcher({ [FLEX_ALIGN_LIST]: flexAlignPage });
    const node = {
      "jcr:primaryType": "nt:unstructured",
      name: "./columnAlign",
      selectionMode: "single",
      "sling:resourceType":
        "granite/ui/components/coral/foundation/form/buttongroup",
      datasource: genericListDatasource(FLEX_ALIGN_LIST),
    } as unknown as DialogNode;
    const { fields } = await mapDialog(dialogWith({ columnAlign: node }), fetcher);
    const field = fields[0] as {
      type: string;
      options?: { list?: unknown[]; aemWidget?: string };
    };
    assert.equal(field.type, "string");
    assert.equal(field.options?.list?.length, 3);
    assert.equal(field.options?.aemWidget, "buttonGroup");
  });

  it("tolerates a list path pointing directly at jcr:content", async () => {
    const contentRooted = (flexAlignPage as Record<string, unknown>)[
      "jcr:content"
    ] as DialogNode;
    const { fetcher } = listFetcher({
      [`${FLEX_ALIGN_LIST}/jcr:content`]: contentRooted,
    });
    const { fields } = await mapDialog(
      dialogWith({
        align: selectNode(
          "align",
          genericListDatasource(`${FLEX_ALIGN_LIST}/jcr:content`),
        ),
      }),
      fetcher,
    );
    assert.equal(
      (fields[0] as { options?: { list?: unknown[] } }).options?.list?.length,
      3,
    );
  });

  it("emits the h1–h6 default for core allowedheadingelements", async () => {
    const noFetch = async (): Promise<DialogNode> => {
      throw new Error("unexpected fetch");
    };
    const { fields, unmapped } = await mapDialog(
      dialogWith({
        headingElement: selectNode("headingElement", {
          "sling:resourceType":
            "core/wcm/components/commons/datasources/allowedheadingelements/v1",
        }),
      }),
      noFetch,
    );
    const list = (fields[0] as { options?: { list?: Array<{ value: string }> } })
      .options?.list;
    assert.deepEqual(
      list?.map((o) => o.value),
      ["h1", "h2", "h3", "h4", "h5", "h6"],
    );
    assert.equal(unmapped.length, 0);
  });

  it("emits the h1–h6 default for the title component's allowedtypes", async () => {
    const noFetch = async (): Promise<DialogNode> => {
      throw new Error("unexpected fetch");
    };
    const { fields } = await mapDialog(
      dialogWith({
        titleType: selectNode("titleType", {
          "sling:resourceType":
            "core/wcm/components/title/v1/datasource/allowedtypes",
        }),
      }),
      noFetch,
    );
    assert.equal(
      (fields[0] as { options?: { list?: unknown[] } }).options?.list?.length,
      6,
    );
  });

  it("falls back to a plain field for custom datasources and reports it", async () => {
    const noFetch = async (): Promise<DialogNode> => {
      throw new Error("unexpected fetch");
    };
    const { fields, unmapped } = await mapDialog(
      dialogWith({
        fontFamily: selectNode("fontFamily", {
          "sling:resourceType":
            "demo-site-a/components/datasources/fontfamilydatasource",
        }),
      }),
      noFetch,
    );
    const field = fields[0] as { type: string; options?: { list?: unknown[] } };
    assert.equal(field.type, "string");
    assert.equal(field.options?.list?.length ?? 0, 0);
    assert.equal(unmapped.length, 1);
    assert.equal(unmapped[0]?.reason, "datasource-unresolved");
    assert.equal(
      unmapped[0]?.resourceType,
      "demo-site-a/components/datasources/fontfamilydatasource",
    );
  });

  it("falls back and reports when the generic list is missing, fetching once", async () => {
    const { fetcher, calls } = listFetcher({});
    const { fields, unmapped } = await mapDialog(
      dialogWith({
        a: selectNode("desktopAlign", genericListDatasource(FLEX_ALIGN_LIST)),
        b: selectNode("mobileAlign", genericListDatasource(FLEX_ALIGN_LIST)),
      }),
      fetcher,
    );
    assert.equal(fields.length, 2);
    assert.deepEqual(calls, [FLEX_ALIGN_LIST]);
    assert.equal(unmapped.length, 2);
    for (const u of unmapped) {
      assert.equal(u.reason, "datasource-unresolved");
      assert.match(u.detail ?? "", /flex-align/);
    }
  });

  it("prefers literal items over the datasource", async () => {
    const noFetch = async (): Promise<DialogNode> => {
      throw new Error("unexpected fetch");
    };
    const node = {
      ...selectNode("align", genericListDatasource(FLEX_ALIGN_LIST)),
      items: {
        left: { text: "Left", value: "left" },
        right: { text: "Right", value: "right" },
      },
    } as unknown as DialogNode;
    const { fields, unmapped } = await mapDialog(
      dialogWith({ align: node }),
      noFetch,
    );
    assert.deepEqual(
      (fields[0] as { options?: { list?: unknown } }).options?.list,
      [
        { title: "Left", value: "left" },
        { title: "Right", value: "right" },
      ],
    );
    assert.equal(unmapped.length, 0);
  });
});
