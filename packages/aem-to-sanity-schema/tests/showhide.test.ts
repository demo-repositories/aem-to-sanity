import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapDialog, type SanityField } from "../src/mapper.ts";
import { emitSchemaFile } from "../src/emitter.ts";
import type { DialogNode } from "aem-to-sanity-core";

const noFetch = async () => {
  throw new Error("unexpected fetcher call");
};

function dialogWith(items: Record<string, unknown>): DialogNode {
  return {
    "sling:resourceType": "cq/gui/components/authoring/dialog",
    items,
  } as unknown as DialogNode;
}

/** Select controller à la uxp promocard `cardStyle`. */
function cardStyleSelect(): Record<string, unknown> {
  return {
    name: "./cardStyle",
    fieldLabel: "Card style",
    "sling:resourceType": "granite/ui/components/coral/foundation/form/select",
    items: {
      default: { text: "Default", value: "default", selected: true },
      flood: { text: "Flood", value: "flood" },
    },
    "granite:data": {
      "jcr:primaryType": "nt:unstructured",
      "acs-cq-dialog-dropdown-checkbox-showhide-target":
        ".cardStyle-showhide-target",
      "acs-cq-dialog-dropdown-checkbox-showhide": "",
    },
  };
}

/** Checkbox controller à la uxp promocard `isSplit`. */
function isSplitCheckbox(): Record<string, unknown> {
  return {
    name: "./isSplit",
    text: "Is split?",
    uncheckedValue: "false",
    value: "true",
    "sling:resourceType":
      "granite/ui/components/coral/foundation/form/checkbox",
    "granite:data": {
      "acs-cq-dialog-dropdown-checkbox-showhide-target":
        ".isSplit-showhide-target",
      "acs-cq-dialog-dropdown-checkbox-showhide": "",
    },
  };
}

function textfield(name: string): Record<string, unknown> {
  return {
    name: `./${name}`,
    fieldLabel: name,
    "sling:resourceType":
      "granite/ui/components/coral/foundation/form/textfield",
  };
}

function conditionsOf(field: SanityField) {
  return field.hiddenConditions ?? [];
}

describe("mapDialog: ACS show/hide", () => {
  it("attaches dropdown conditions to fields inside a target well", async () => {
    const dialog = dialogWith({
      cardStyle: cardStyleSelect(),
      defaultOptions: {
        "granite:class": "cardStyle-showhide-target",
        "sling:resourceType": "granite/ui/components/coral/foundation/well",
        items: {
          imageAlignment: textfield("imageAlignment"),
        },
        "granite:data": {
          "acs-dropdownshowhidetargetvalue": "default",
        },
      },
    });
    const { fields } = await mapDialog(dialog, noFetch);

    const imageAlignment = fields.find((f) => f.name === "imageAlignment")!;
    assert.deepEqual(conditionsOf(imageAlignment), [
      {
        controllerField: "cardStyle",
        kind: "dropdown",
        values: ["default"],
        controllerDefault: "default",
      },
    ]);
    // The controller itself carries no conditions, and internal linkage
    // props never leak out of mapDialog.
    const cardStyle = fields.find((f) => f.name === "cardStyle")!;
    assert.equal(cardStyle.hiddenConditions, undefined);
    for (const f of fields) {
      assert.equal(f.showHideTargets, undefined);
      assert.equal(f.showHideController, undefined);
    }
  });

  it("splits space-separated dropdown target values", async () => {
    const dialog = dialogWith({
      cardStyle: cardStyleSelect(),
      shared: {
        ...textfield("shared"),
        "granite:class": "cardStyle-showhide-target",
        "granite:data": {
          "acs-dropdownshowhidetargetvalue": "default flood",
        },
      },
    });
    const { fields } = await mapDialog(dialog, noFetch);
    const shared = fields.find((f) => f.name === "shared")!;
    assert.deepEqual(conditionsOf(shared)[0]!.values, ["default", "flood"]);
  });

  it("maps checkbox targets: 'true' → visible when checked, '' → visible when unchecked", async () => {
    const dialog = dialogWith({
      isSplit: isSplitCheckbox(),
      whenChecked: {
        ...textfield("whenChecked"),
        "granite:class": "isSplit-showhide-target",
        "granite:data": { "acs-checkboxshowhidetargetvalue": "true" },
      },
      whenUnchecked: {
        ...textfield("whenUnchecked"),
        "granite:class": "isSplit-showhide-target",
        "granite:data": { "acs-checkboxshowhidetargetvalue": "" },
      },
    });
    const { fields } = await mapDialog(dialog, noFetch);

    assert.deepEqual(
      conditionsOf(fields.find((f) => f.name === "whenChecked")!),
      [
        {
          controllerField: "isSplit",
          kind: "checkbox",
          visibleWhenChecked: true,
        },
      ],
    );
    assert.deepEqual(
      conditionsOf(fields.find((f) => f.name === "whenUnchecked")!),
      [
        {
          controllerField: "isSplit",
          kind: "checkbox",
          visibleWhenChecked: false,
        },
      ],
    );
  });

  it("ANDs conditions from nested target wrappers (promocard groupNoAspect)", async () => {
    const dialog = dialogWith({
      cardStyle: cardStyleSelect(),
      isSplit: isSplitCheckbox(),
      floodOptions: {
        "granite:class": "cardStyle-showhide-target",
        "sling:resourceType": "granite/ui/components/coral/foundation/well",
        "granite:data": { "acs-dropdownshowhidetargetvalue": "flood" },
        items: {
          groupNoAspect: {
            "granite:class": "isSplit-showhide-target",
            "sling:resourceType":
              "granite/ui/components/coral/foundation/container",
            "granite:data": { "acs-checkboxshowhidetargetvalue": "true" },
            items: {
              warning: {
                text: "Aspect ratio is ignored in split mode.",
                "sling:resourceType":
                  "granite/ui/components/coral/foundation/text",
              },
            },
          },
        },
      },
    });
    const { fields } = await mapDialog(dialog, noFetch);
    const warning = fields.find((f) => f.type === "note")!;
    assert.deepEqual(conditionsOf(warning), [
      {
        controllerField: "cardStyle",
        kind: "dropdown",
        values: ["flood"],
        controllerDefault: "default",
      },
      {
        controllerField: "isSplit",
        kind: "checkbox",
        visibleWhenChecked: true,
      },
    ]);
  });

  it("scopes resolution per object: multifield row targets only match row controllers", async () => {
    const dialog = dialogWith({
      // Top-level controller whose selector collides with the row's class.
      cardStyle: cardStyleSelect(),
      rows: {
        "sling:resourceType":
          "granite/ui/components/coral/foundation/form/multifield",
        composite: true,
        field: {
          name: "./rows",
          "sling:resourceType":
            "granite/ui/components/coral/foundation/container",
          items: {
            rowToggle: {
              name: "./rowToggle",
              value: "true",
              uncheckedValue: "false",
              "sling:resourceType":
                "granite/ui/components/coral/foundation/form/checkbox",
              "granite:data": {
                "acs-cq-dialog-dropdown-checkbox-showhide-target":
                  ".row-showhide-target",
              },
            },
            rowDetail: {
              ...textfield("rowDetail"),
              "granite:class": "row-showhide-target cardStyle-showhide-target",
              "granite:data": {
                "acs-checkboxshowhidetargetvalue": "true",
                "acs-dropdownshowhidetargetvalue": "default",
              },
            },
          },
        },
      },
    });
    const { fields } = await mapDialog(dialog, noFetch);
    const rows = fields.find((f) => f.name === "rows")!;
    assert.equal(rows.type, "array-of-object");
    const rowDetail = (
      rows as Extract<SanityField, { type: "array-of-object" }>
    ).itemFields.find((f) => f.name === "rowDetail")!;
    // Only the same-row checkbox resolves; the top-level select is out of
    // scope (Sanity `hidden` reads the controller off `parent`, i.e. the row).
    assert.deepEqual(conditionsOf(rowDetail), [
      {
        controllerField: "rowToggle",
        kind: "checkbox",
        visibleWhenChecked: true,
      },
    ]);
  });

  it("leaves fields visible when no controller matches the target class", async () => {
    const dialog = dialogWith({
      orphan: {
        ...textfield("orphan"),
        "granite:class": "nothing-controls-this",
        "granite:data": { "acs-dropdownshowhidetargetvalue": "x" },
      },
    });
    const { fields } = await mapDialog(dialog, noFetch);
    assert.equal(fields[0]!.hiddenConditions, undefined);
  });
});

describe("emitSchemaFile: ACS show/hide", () => {
  it("emits a hidden callback for dropdown targets with the controller default as fallback", async () => {
    const dialog = dialogWith({
      cardStyle: cardStyleSelect(),
      defaultOptions: {
        "granite:class": "cardStyle-showhide-target",
        "sling:resourceType": "granite/ui/components/coral/foundation/well",
        "granite:data": { "acs-dropdownshowhidetargetvalue": "default" },
        items: { imageAlignment: textfield("imageAlignment") },
      },
    });
    const { fields, groups } = await mapDialog(dialog, noFetch);
    const src = await emitSchemaFile({
      typeName: "promoCard",
      sourcePath: "/apps/uxp/components/proxy/content/promocard",
      fields,
      groups,
    });

    assert.match(src, /hidden: \(\{ parent \}\) =>/);
    // The controller's default option IS the visible value, so an unset
    // select must count as the default — the fallback is required here.
    assert.match(
      src,
      /\(parent\?\.cardStyle \?\? "default"\) !== "default"/,
    );
  });

  it("emits boolean comparisons for checkbox targets and ORs multiple conditions", async () => {
    const dialog = dialogWith({
      cardStyle: cardStyleSelect(),
      isSplit: isSplitCheckbox(),
      both: {
        ...textfield("both"),
        "granite:class": "cardStyle-showhide-target isSplit-showhide-target",
        "granite:data": {
          "acs-dropdownshowhidetargetvalue": "flood",
          "acs-checkboxshowhidetargetvalue": "true",
        },
      },
      whenUnchecked: {
        ...textfield("whenUnchecked"),
        "granite:class": "isSplit-showhide-target",
        "granite:data": { "acs-checkboxshowhidetargetvalue": "" },
      },
    });
    const { fields, groups } = await mapDialog(dialog, noFetch);
    const src = await emitSchemaFile({
      typeName: "promoCard",
      sourcePath: "/apps/uxp/components/proxy/content/promocard",
      fields,
      groups,
    });

    assert.match(src, /parent\?\.isSplit !== true/);
    assert.match(src, /parent\?\.isSplit === true/);
    // "flood" is not the controller's default, so an unset select is hidden
    // either way — no fallback emitted, just the minimal comparison. Both
    // conditions on one field OR together inside one callback (hidden when
    // either visibility requirement fails).
    assert.match(
      src,
      /parent\?\.cardStyle !== "flood" \|\| parent\?\.isSplit !== true/,
    );
  });

  it("flips the comparison for a default-checked controller so unset stays visible", async () => {
    const dialog = dialogWith({
      inheritAlt: {
        ...isSplitCheckbox(),
        name: "./inheritAlt",
        checked: "true",
        "granite:data": {
          "acs-cq-dialog-dropdown-checkbox-showhide-target":
            ".inheritAlt-showhide-target",
        },
      },
      whenChecked: {
        ...textfield("whenChecked"),
        "granite:class": "inheritAlt-showhide-target",
        "granite:data": { "acs-checkboxshowhidetargetvalue": "true" },
      },
      whenUnchecked: {
        ...textfield("whenUnchecked"),
        "granite:class": "inheritAlt-showhide-target",
        "granite:data": { "acs-checkboxshowhidetargetvalue": "" },
      },
    });
    const { fields, groups } = await mapDialog(dialog, noFetch);
    const src = await emitSchemaFile({
      typeName: "testType",
      sourcePath: "/apps/test",
      fields,
      groups,
    });

    // Controller defaults to checked, so an unset boolean must count as
    // checked: shown-when-checked hides only on explicit false...
    assert.match(src, /parent\?\.inheritAlt === false/);
    // ...and shown-when-unchecked hides on everything except explicit false.
    assert.match(src, /parent\?\.inheritAlt !== false/);
  });

  it("treats an EL-expression checked default as unchecked (conservative)", async () => {
    const dialog = dialogWith({
      decorative: {
        ...isSplitCheckbox(),
        name: "./decorative",
        checked: "${not empty cqDesign.isDecorative ? cqDesign.isDecorative : false}",
        "granite:data": {
          "acs-cq-dialog-dropdown-checkbox-showhide-target":
            ".decorative-showhide-target",
        },
      },
      dependent: {
        ...textfield("dependent"),
        "granite:class": "decorative-showhide-target",
        "granite:data": { "acs-checkboxshowhidetargetvalue": "true" },
      },
    });
    const { fields, groups } = await mapDialog(dialog, noFetch);
    const src = await emitSchemaFile({
      typeName: "testType",
      sourcePath: "/apps/test",
      fields,
      groups,
    });

    assert.match(src, /parent\?\.decorative !== true/);
  });

  it("emits an includes() check only for multi-value dropdown targets", async () => {
    const dialog = dialogWith({
      cardStyle: cardStyleSelect(),
      shared: {
        ...textfield("shared"),
        "granite:class": "cardStyle-showhide-target",
        "granite:data": { "acs-dropdownshowhidetargetvalue": "default flood" },
      },
    });
    const { fields, groups } = await mapDialog(dialog, noFetch);
    const src = await emitSchemaFile({
      typeName: "promoCard",
      sourcePath: "/apps/uxp/components/proxy/content/promocard",
      fields,
      groups,
    });

    // Multi-value keeps includes(); the default is in the visible set, so
    // the unset fallback stays.
    assert.match(
      src,
      /!\["default", "flood"\]\.includes\(parent\?\.cardStyle \?\? "default"\)/,
    );
  });
});
