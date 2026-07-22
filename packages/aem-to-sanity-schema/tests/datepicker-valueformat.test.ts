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

function datepicker(
  name: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: `./${name}`,
    fieldLabel: name,
    "sling:resourceType":
      "granite/ui/components/coral/foundation/form/datepicker",
    ...extra,
  };
}

async function mapOne(node: Record<string, unknown>) {
  const { fields } = await mapDialog(dialogWith({ field: node }), noFetch);
  assert.equal(fields.length, 1);
  return fields[0]! as { type: string; valueFormat?: string };
}

describe("mapDialog: datepicker valueFormat capture", () => {
  it("records the persisted-string pattern for date fields", async () => {
    const f = await mapOne(
      datepicker("revisionDate", {
        valueFormat: "MMM DD, yyyy",
        displayedFormat: "MMM DD, yyyy",
      }),
    );
    assert.equal(f.type, "date");
    assert.equal(f.valueFormat, "MMM DD, yyyy");
  });

  it("records it on datetime fields too (type='datetime')", async () => {
    const f = await mapOne(
      datepicker("publishAt", { type: "datetime", valueFormat: "YYYY-MM-DD HH:mm" }),
    );
    assert.equal(f.type, "datetime");
    assert.equal(f.valueFormat, "YYYY-MM-DD HH:mm");
  });

  it("omits valueFormat when the dialog doesn't set one (JCR stores ISO)", async () => {
    const f = await mapOne(datepicker("expiresOn"));
    assert.equal(f.type, "date");
    assert.equal(f.valueFormat, undefined);
  });

  it("ignores Granite EL expressions and empty strings", async () => {
    assert.equal(
      (await mapOne(datepicker("a", { valueFormat: "${cqDesign.fmt}" }))).valueFormat,
      undefined,
    );
    assert.equal(
      (await mapOne(datepicker("b", { valueFormat: "  " }))).valueFormat,
      undefined,
    );
  });

  it("carries valueFormat into describeSchemaFields (registry shape)", async () => {
    const { fields } = await mapDialog(
      dialogWith({
        field: datepicker("revisionDate", { valueFormat: "MMM DD, yyyy" }),
      }),
      noFetch,
    );
    const [info] = describeSchemaFields(fields);
    assert.equal(info!.valueFormat, "MMM DD, yyyy");
  });
});
