import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapDialog } from "../src/mapper.ts";
import type { DialogNode } from "aem-to-sanity-core";

// Fetcher used when no includes are expected. Throws loudly if called.
const noFetch = async () => {
  throw new Error("unexpected fetcher call");
};

/**
 * AEM core-components list editor pattern: a bookkeeping multifield whose
 * only inner field is `form/hidden` (`./pages`, mirroring the real
 * `./static` composite next to it). It must not emit a field — an array of
 * a zero-field object is invalid in Sanity — while the composite sibling
 * still maps normally.
 */
function listEditorDialog(): DialogNode {
  return {
    "sling:resourceType": "cq/gui/components/authoring/dialog",
    items: {
      pages: {
        "jcr:primaryType": "nt:unstructured",
        "granite:class": "cmp-list__editor-static-hidden-pages",
        "sling:resourceType": "granite/ui/components/coral/foundation/form/multifield",
        field: {
          "jcr:primaryType": "nt:unstructured",
          name: "./pages",
          "sling:resourceType": "granite/ui/components/coral/foundation/form/hidden",
        },
      },
      multi: {
        "jcr:primaryType": "nt:unstructured",
        composite: true,
        "sling:resourceType": "granite/ui/components/coral/foundation/form/multifield",
        field: {
          "jcr:primaryType": "nt:unstructured",
          name: "./static",
          "sling:resourceType": "granite/ui/components/coral/foundation/container",
          items: {
            text: {
              "jcr:primaryType": "nt:unstructured",
              name: "linkText",
              emptyText: "Text",
              "sling:resourceType": "granite/ui/components/coral/foundation/form/textfield",
            },
          },
        },
      },
    },
  } as unknown as DialogNode;
}

describe("mapDialog: multifield with no mappable inner fields", () => {
  it("skips the hidden bookkeeping multifield and keeps the composite", async () => {
    const { fields, unmapped } = await mapDialog(listEditorDialog(), noFetch);

    assert.deepEqual(
      fields.map((f) => ({ name: f.name, type: f.type })),
      [{ name: "static", type: "array-of-object" }],
    );
    const staticField = fields[0]!;
    assert.equal(staticField.type, "array-of-object");
    assert.deepEqual(
      staticField.itemFields.map((f) => f.name),
      ["linkText"],
    );

    const skipped = unmapped.find((u) => u.name === "pages");
    assert.ok(skipped, "hidden multifield should surface in unmapped");
    assert.equal(skipped.reason, "hidden");
    assert.equal(skipped.detail, "multifield with no mappable inner fields");
  });
});
