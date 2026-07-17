import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapDialog } from "../src/mapper.ts";
import { lookup } from "../src/mapping-table.ts";
import { emitSchemaFile } from "../src/emitter.ts";
import type { DialogNode } from "aem-to-sanity-core";

// Fetcher used when no includes are expected. Throws loudly if called.
const noFetch = async () => {
  throw new Error("unexpected fetcher call");
};

/**
 * Build a minimal dialog root wrapping a single field node under
 * `root.items.<key>`. Mirrors the structure the mapper walks.
 */
function dialogWith(key: string, child: DialogNode): DialogNode {
  return {
    "sling:resourceType": "cq/gui/components/authoring/dialog",
    items: {
      [key]: child,
    },
  } as unknown as DialogNode;
}

/** Real-world single-selection buttongroup (text alignment picker). */
function textAlignmentNode(): DialogNode {
  return {
    "jcr:primaryType": "nt:unstructured",
    name: "./textAlignment",
    fieldLabel: "Text alignment:",
    selectionMode: "single",
    "sling:resourceType":
      "granite/ui/components/coral/foundation/form/buttongroup",
    fieldDescription: "Align text to a specific side of component.",
    items: {
      "jcr:primaryType": "nt:unstructured",
      inherit: {
        "jcr:primaryType": "nt:unstructured",
        text: "Inherit",
        value: "tdds:ta-inherit",
        selected: true,
      },
      left: {
        "jcr:primaryType": "nt:unstructured",
        text: "Left",
        value: "tdds:ta-left",
      },
      center: {
        "jcr:primaryType": "nt:unstructured",
        text: "Center",
        value: "tdds:ta-center",
      },
      right: {
        "jcr:primaryType": "nt:unstructured",
        text: "Right",
        value: "tdds:ta-right",
      },
    },
  } as unknown as DialogNode;
}

describe("mapping-table: buttongroup", () => {
  it("maps the Coral resource type to the buttongroup kind", () => {
    const entry = lookup(
      "granite/ui/components/coral/foundation/form/buttongroup",
    );
    assert.equal(entry?.kind, "buttongroup");
  });
});

describe("mapDialog: buttongroup", () => {
  it("maps single mode to a string with options.list and the aemWidget marker", async () => {
    const dialog = dialogWith("textAlignment", textAlignmentNode());
    const { fields, unmapped } = await mapDialog(dialog, noFetch);

    assert.equal(unmapped.length, 0);
    assert.equal(fields.length, 1);
    const f = fields[0];
    assert.equal(f.name, "textAlignment");
    assert.equal(f.type, "string");
    assert.equal(f.title, "Text alignment:");
    assert.equal(f.description, "Align text to a specific side of component.");
    if (f.type !== "string") throw new Error("unreachable");
    assert.deepEqual(f.options?.list, [
      { title: "Inherit", value: "tdds:ta-inherit" },
      { title: "Left", value: "tdds:ta-left" },
      { title: "Center", value: "tdds:ta-center" },
      { title: "Right", value: "tdds:ta-right" },
    ]);
    assert.equal(f.options?.aemWidget, "buttonGroup");
  });

  it("uses the `selected` item as the initialValue", async () => {
    const dialog = dialogWith("textAlignment", textAlignmentNode());
    const { fields } = await mapDialog(dialog, noFetch);
    const f = fields[0];
    if (f.type !== "string") throw new Error("expected string field");
    assert.equal(f.initialValue, "tdds:ta-inherit");
  });

  it("maps multiple mode to an array of strings with options.list", async () => {
    const dialog = dialogWith("disableImageOnViewport", {
      name: "./disableImageOnViewport",
      fieldLabel: "Disable image on viewport:",
      selectionMode: "multiple",
      "sling:resourceType":
        "granite/ui/components/coral/foundation/form/buttongroup",
      items: {
        mobile: { text: "Mobile", value: "mobile" },
        tablet: { text: "Tablet", value: "tablet" },
      },
    } as unknown as DialogNode);
    const { fields, unmapped } = await mapDialog(dialog, noFetch);

    assert.equal(unmapped.length, 0);
    assert.equal(fields.length, 1);
    const f = fields[0];
    assert.equal(f.type, "array-of-string");
    if (f.type !== "array-of-string") throw new Error("unreachable");
    assert.deepEqual(f.options?.list, [
      { title: "Mobile", value: "mobile" },
      { title: "Tablet", value: "tablet" },
    ]);
  });

  it("maps a buttongroup reached through a coral include whose fragment root IS the widget", async () => {
    // Real-world shape: uxp's shared textstyle dialogs. The dialog references
    // the fragment via granite include, and the fetched fragment's ROOT node
    // is the buttongroup itself (not a wrapper with field children).
    const fragmentPath =
      "/apps/uxp/components/commons/textstyle/v1/dialogs/textAlignment";
    const dialog = dialogWith("textAlignment", {
      "jcr:primaryType": "nt:unstructured",
      path: fragmentPath,
      "sling:resourceType":
        "granite/ui/components/coral/foundation/include",
    } as unknown as DialogNode);
    const fetcher = async (jcrPath: string) => {
      assert.equal(jcrPath, fragmentPath);
      return textAlignmentNode();
    };
    const { fields, unmapped } = await mapDialog(dialog, fetcher);

    assert.equal(unmapped.length, 0);
    assert.equal(fields.length, 1);
    const f = fields[0];
    assert.equal(f.name, "textAlignment");
    assert.equal(f.type, "string");
    if (f.type !== "string") throw new Error("unreachable");
    assert.equal(f.options?.aemWidget, "buttonGroup");
    assert.equal(f.options?.list?.length, 4);
    assert.equal(f.initialValue, "tdds:ta-inherit");
  });

  it("still walks structural include fragments whose fields are children", async () => {
    const fragmentPath = "/apps/demo/dialogs/shared-fields";
    const dialog = dialogWith("sharedFields", {
      path: fragmentPath,
      "sling:resourceType":
        "granite/ui/components/coral/foundation/include",
    } as unknown as DialogNode);
    const fetcher = async () =>
      ({
        "jcr:primaryType": "nt:unstructured",
        heading: {
          name: "./heading",
          fieldLabel: "Heading",
          "sling:resourceType":
            "granite/ui/components/coral/foundation/form/textfield",
        },
        alignment: textAlignmentNode(),
      }) as unknown as DialogNode;
    const { fields, unmapped } = await mapDialog(dialog, fetcher);

    assert.equal(unmapped.length, 0);
    assert.deepEqual(
      fields.map((f) => [f.name, f.type]),
      [
        ["heading", "string"],
        ["textAlignment", "string"],
      ],
    );
  });

  it("falls back to a plain string when items come from a datasource", async () => {
    const dialog = dialogWith("mobileColumnAlign", {
      name: "./mobilecolumnAlign",
      fieldLabel: "Column vertical alignment:",
      selectionMode: "single",
      "sling:resourceType":
        "granite/ui/components/coral/foundation/form/buttongroup",
      datasource: {
        path: "/etc/acs-commons/lists/demo/flex-align",
        "sling:resourceType":
          "acs-commons/components/utilities/genericlist/datasource",
      },
    } as unknown as DialogNode);
    const { fields, unmapped } = await mapDialog(dialog, noFetch);

    assert.equal(unmapped.length, 0);
    assert.equal(fields.length, 1);
    const f = fields[0];
    assert.equal(f.type, "string");
    if (f.type !== "string") throw new Error("unreachable");
    assert.equal(f.options, undefined);
    assert.equal(f.initialValue, undefined);
  });
});

describe("emitSchemaFile: buttongroup", () => {
  it("emits the aemWidget option with `{ strict: false }` for single mode", async () => {
    const dialog = dialogWith("textAlignment", textAlignmentNode());
    const { fields, groups } = await mapDialog(dialog, noFetch);
    const src = await emitSchemaFile({
      typeName: "textBlock",
      sourcePath: "/apps/demo/components/proxy/content/text",
      fields,
      groups,
    });

    assert.match(src, /aemWidget: "buttonGroup"/);
    assert.match(src, /\{ strict: false \}/);
    assert.match(src, /initialValue: "tdds:ta-inherit"/);
    assert.match(src, /title: "Inherit", value: "tdds:ta-inherit"/);
  });

  it("emits array of string with options.list for multiple mode", async () => {
    const dialog = dialogWith("disableImageOnViewport", {
      name: "./disableImageOnViewport",
      selectionMode: "multiple",
      "sling:resourceType":
        "granite/ui/components/coral/foundation/form/buttongroup",
      items: {
        mobile: { text: "Mobile", value: "mobile" },
      },
    } as unknown as DialogNode);
    const { fields, groups } = await mapDialog(dialog, noFetch);
    const src = await emitSchemaFile({
      typeName: "imageBlock",
      sourcePath: "/apps/demo/components/proxy/content/image",
      fields,
      groups,
    });

    assert.match(src, /type: "array"/);
    assert.match(src, /of: \[\{ type: "string" \}\]/);
    assert.match(src, /title: "Mobile", value: "mobile"/);
    // The multiple-mode array uses default Studio rendering — no marker.
    assert.doesNotMatch(src, /aemWidget/);
    assert.doesNotMatch(src, /strict: false/);
  });
});
