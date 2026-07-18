import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapDialog, type SanityField } from "../src/mapper.ts";
import { emitSchemaFile } from "../src/emitter.ts";
import { lookup } from "../src/mapping-table.ts";
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

/**
 * Real-world well shape (uxp banner masking dialog): a heading widget as the
 * first item supplies the box title, followed by the grouped fields.
 */
function overlayOptionsWell(): DialogNode {
  return {
    "jcr:primaryType": "nt:unstructured",
    "sling:resourceType": "granite/ui/components/coral/foundation/well",
    items: {
      "jcr:primaryType": "nt:unstructured",
      heading: {
        "jcr:primaryType": "nt:unstructured",
        "sling:resourceType": "granite/ui/components/coral/foundation/heading",
        level: "3",
        text: "Overlay Options:",
      },
      overlayColor: {
        "jcr:primaryType": "nt:unstructured",
        name: "./overlayColor",
        fieldLabel: "Overlay color:",
        "sling:resourceType":
          "granite/ui/components/coral/foundation/form/colorfield",
      },
      overlayOpacity: {
        "jcr:primaryType": "nt:unstructured",
        name: "./overlayOpacity",
        fieldLabel: "Opacity:",
        min: 0,
        max: 1,
        "sling:resourceType":
          "granite/ui/components/coral/foundation/form/numberfield",
      },
    },
  } as unknown as DialogNode;
}

describe("mapping-table: well", () => {
  it("maps the Coral well resource type to the container kind", () => {
    const entry = lookup("granite/ui/components/coral/foundation/well");
    assert.equal(entry?.kind, "container");
  });

  it("keeps the Coral heading skipped as a field", () => {
    const entry = lookup("granite/ui/components/coral/foundation/heading");
    assert.equal(entry?.kind, "hidden");
  });
});

describe("mapDialog: well", () => {
  it("becomes a non-collapsible fieldset titled from its heading item (trailing colon stripped)", async () => {
    const dialog = dialogWith("well", overlayOptionsWell());
    const { fields, groups, fieldsets } = await mapDialog(dialog, noFetch);

    // A well is a box within its tab, not a tab of its own.
    assert.deepEqual(groups, []);
    assert.deepEqual(fieldsets, [
      {
        name: "overlayOptions",
        title: "Overlay Options",
        collapsed: false,
        collapsible: false,
      },
    ]);

    assert.deepEqual(
      fields.map((f) => f.name),
      ["overlayColor", "overlayOpacity"],
    );
    for (const f of fields) {
      assert.equal(f.fieldset, "overlayOptions");
    }
  });

  it("prefers the well's own jcr:title over a heading item", async () => {
    const node = overlayOptionsWell() as unknown as Record<string, unknown>;
    node["jcr:title"] = "Masking";
    const dialog = dialogWith("well", node as unknown as DialogNode);

    const { fieldsets } = await mapDialog(dialog, noFetch);
    assert.deepEqual(fieldsets, [
      {
        name: "masking",
        title: "Masking",
        collapsed: false,
        collapsible: false,
      },
    ]);
  });

  it("keeps the surrounding tab group on fields inside the well", async () => {
    const dialog = {
      "sling:resourceType": "cq/gui/components/authoring/dialog",
      items: {
        tabs: {
          "sling:resourceType": "granite/ui/components/coral/foundation/tabs",
          items: {
            display: {
              "jcr:title": "Display",
              "sling:resourceType":
                "granite/ui/components/coral/foundation/container",
              items: {
                well: overlayOptionsWell(),
              },
            },
          },
        },
      },
    } as unknown as DialogNode;

    const { fields, groups, fieldsets } = await mapDialog(dialog, noFetch);

    assert.deepEqual(groups, [{ name: "display", title: "Display" }]);
    assert.deepEqual(
      fieldsets.map((f) => f.name),
      ["overlayOptions"],
    );
    for (const f of fields) {
      assert.equal(f.group, "display");
      assert.equal(f.fieldset, "overlayOptions");
    }
  });

  it("finds the heading through a nested wrapper container (uxp promocard shape)", async () => {
    // Real uxp promocard `defaultOptions` well: the heading is not a direct
    // item — it sits inside a structural `column` container.
    const well = {
      "jcr:primaryType": "nt:unstructured",
      "sling:resourceType": "granite/ui/components/coral/foundation/well",
      items: {
        column: {
          "jcr:primaryType": "nt:unstructured",
          "sling:resourceType":
            "granite/ui/components/coral/foundation/container",
          items: {
            defaultHeading: {
              "jcr:primaryType": "nt:unstructured",
              "sling:resourceType":
                "granite/ui/components/coral/foundation/heading",
              level: "3",
              text: "Default Promocard Options",
            },
            imageAlignment: {
              "jcr:primaryType": "nt:unstructured",
              name: "./imageAlignment",
              fieldLabel: "Image alignment:",
              "sling:resourceType":
                "granite/ui/components/coral/foundation/form/textfield",
            },
          },
        },
      },
    } as unknown as DialogNode;
    const dialog = dialogWith("defaultOptions", well);

    const { fields, fieldsets } = await mapDialog(dialog, noFetch);
    assert.deepEqual(fieldsets, [
      {
        name: "defaultPromocardOptions",
        title: "Default Promocard Options",
        collapsed: false,
        collapsible: false,
      },
    ]);
    assert.deepEqual(
      fields.map((f) => f.name),
      ["imageAlignment"],
    );
    assert.equal(fields[0].fieldset, "defaultPromocardOptions");
  });

  it("does not steal the heading of a nested well", async () => {
    const inner = overlayOptionsWell();
    const outer = {
      "jcr:primaryType": "nt:unstructured",
      "sling:resourceType": "granite/ui/components/coral/foundation/well",
      items: {
        innerWell: inner,
      },
    } as unknown as DialogNode;
    const dialog = dialogWith("outerWell", outer);

    const { fields, fieldsets } = await mapDialog(dialog, noFetch);
    // Only the inner well is titled; the outer one stays transparent.
    assert.deepEqual(
      fieldsets.map((f) => f.name),
      ["overlayOptions"],
    );
    for (const f of fields) {
      assert.equal(f.fieldset, "overlayOptions");
    }
  });

  it("stays transparent when the well has neither jcr:title nor a heading item", async () => {
    const node = overlayOptionsWell() as unknown as {
      items: Record<string, unknown>;
    };
    delete node.items["heading"];
    const dialog = dialogWith("well", node as unknown as DialogNode);

    const { fields, fieldsets } = await mapDialog(dialog, noFetch);
    assert.deepEqual(fieldsets, []);
    assert.deepEqual(
      fields.map((f) => f.name),
      ["overlayColor", "overlayOpacity"],
    );
    for (const f of fields) {
      assert.equal(f.fieldset, undefined);
    }
  });

  it("emits the well fieldset without collapsible options", async () => {
    const dialog = dialogWith("well", overlayOptionsWell());
    const { fields, groups, fieldsets } = await mapDialog(dialog, noFetch);
    const src = await emitSchemaFile({
      typeName: "banner",
      sourcePath: "/apps/uxp/components/banner",
      fields: fields as SanityField[],
      groups,
      fieldsets,
    });
    assert.match(src, /fieldsets:\s*\[\s*{ name: "overlayOptions", title: "Overlay Options" }/);
    assert.doesNotMatch(src, /collapsible/);
  });
});
