import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapDialog } from "../src/mapper.ts";
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
  return fields[0]! as { initialValue?: boolean };
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
