import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { describeSchemaFields, mapDialog } from "../src/mapper.ts";
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

function checkbox(
  name: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: `./${name}`,
    text: name,
    // The constant persisted when checked — present on virtually every AEM
    // checkbox and NOT its default state.
    value: "true",
    uncheckedValue: "false",
    "sling:resourceType":
      "granite/ui/components/coral/foundation/form/checkbox",
    ...extra,
  };
}

async function mapOne(node: Record<string, unknown>) {
  const { fields } = await mapDialog(dialogWith({ field: node }), noFetch);
  assert.equal(fields.length, 1);
  return fields[0]! as {
    initialValue?: boolean;
    checkedValue?: string;
    uncheckedValue?: string;
  };
}

describe("mapDialog: boolean default from `checked`", () => {
  it("omits initialValue when `checked` is absent (value:'true' is not a default)", async () => {
    const f = await mapOne(checkbox("isSplit"));
    assert.equal(f.initialValue, undefined);
  });

  it("emits initialValue: true for literal checked=true / 'true'", async () => {
    assert.equal((await mapOne(checkbox("a", { checked: true }))).initialValue, true);
    assert.equal(
      (await mapOne(checkbox("b", { checked: "true" }))).initialValue,
      true,
    );
  });

  it("emits initialValue: false for literal checked=false / 'false'", async () => {
    assert.equal(
      (await mapOne(checkbox("a", { checked: false }))).initialValue,
      false,
    );
    assert.equal(
      (await mapOne(checkbox("b", { checked: "false" }))).initialValue,
      false,
    );
  });

  it("omits initialValue for Granite EL expressions (unresolvable offline)", async () => {
    const el = await mapOne(
      checkbox("decorative", {
        checked: "${not empty cqDesign.isDecorative ? cqDesign.isDecorative : false}",
      }),
    );
    assert.equal(el.initialValue, undefined);
    const elFalse = await mapOne(checkbox("x", { checked: "${false}" }));
    assert.equal(elFalse.initialValue, undefined);
  });

  it("applies the same rule to switches", async () => {
    const f = await mapOne({
      name: "./isFlipped",
      value: "true",
      uncheckedValue: "false",
      "sling:resourceType":
        "granite/ui/components/coral/foundation/form/switch",
    });
    assert.equal(f.initialValue, undefined);
  });
});

describe("mapDialog: custom checkbox constants (value / uncheckedValue)", () => {
  it("omits checkedValue/uncheckedValue for the standard 'true'/'false' pair", async () => {
    const f = await mapOne(checkbox("isSplit"));
    assert.equal(f.checkedValue, undefined);
    assert.equal(f.uncheckedValue, undefined);
  });

  it("records custom constants like a link-target checkbox's '_blank'/'_self'", async () => {
    const f = await mapOne(
      checkbox("linkTarget", { value: "_blank", uncheckedValue: "_self" }),
    );
    assert.equal(f.checkedValue, "_blank");
    assert.equal(f.uncheckedValue, "_self");
  });

  it("ignores Granite EL expressions and empty strings", async () => {
    const f = await mapOne(
      checkbox("x", { value: "${cqDesign.target}", uncheckedValue: "" }),
    );
    assert.equal(f.checkedValue, undefined);
    assert.equal(f.uncheckedValue, undefined);
  });

  it("carries the constants into describeSchemaFields (registry shape)", async () => {
    const { fields } = await mapDialog(
      dialogWith({
        field: checkbox("linkTarget", { value: "_blank", uncheckedValue: "_self" }),
      }),
      noFetch,
    );
    const [info] = describeSchemaFields(fields);
    assert.equal(info!.checkedValue, "_blank");
    assert.equal(info!.uncheckedValue, "_self");
  });
});
