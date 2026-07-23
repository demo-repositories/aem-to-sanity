import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveSanityTypeNames } from "../src/naming.ts";

const LIST = "/apps/uxp/components/proxy/content/list";
const LISTS = "/apps/uxp/components/proxy/content/lists";

describe("resolveSanityTypeNames: explicit overrides", () => {
  it("override wins over the title strategy and derived collisions defer", () => {
    // Without overrides: `lists` (title "List") claims `list`, and `list`
    // (title "Page List") becomes `pageList`. The operator flips both.
    const names = resolveSanityTypeNames([LISTS, LIST], {
      strategy: "title",
      titleByPath: new Map([
        [LISTS, "List"],
        [LIST, "Page List"],
      ]),
      overrides: new Map([
        [LIST, "list"],
        [LISTS, "lists"],
      ]),
    });
    assert.equal(names.get(LIST), "list");
    assert.equal(names.get(LISTS), "lists");
  });

  it("a derived name colliding with an override takes the collision fallback", () => {
    // `lists`' title-derived name (`list`) is claimed by the override on
    // `list`, so `lists` gets the path-derived disambiguation suffix.
    const fallbacks: string[] = [];
    const names = resolveSanityTypeNames([LISTS, LIST], {
      strategy: "title",
      titleByPath: new Map([
        [LISTS, "List"],
        [LIST, "Page List"],
      ]),
      overrides: new Map([[LIST, "list"]]),
      onFallback: (path, reason) => fallbacks.push(`${path}: ${reason}`),
    });
    assert.equal(names.get(LIST), "list");
    assert.equal(names.get(LISTS), "listProxyContentLists");
    assert.ok(fallbacks.some((f) => f.includes("already taken")));
  });

  it("throws on an override naming a built-in Sanity type", () => {
    assert.throws(
      () =>
        resolveSanityTypeNames([LIST], {
          overrides: new Map([[LIST, "image"]]),
        }),
      /built-in Sanity type/,
    );
  });

  it("throws when two overrides claim the same name", () => {
    assert.throws(
      () =>
        resolveSanityTypeNames([LIST, LISTS], {
          overrides: new Map([
            [LIST, "list"],
            [LISTS, "list"],
          ]),
        }),
      /assigned to both/,
    );
  });
});
