import { describe, expect, it, vi } from "vitest";
import { mergeDialogs } from "../src/aem/dialog-merge.ts";
import type { DialogNode } from "../src/aem/dialog-types.ts";

describe("mergeDialogs", () => {
  it("returns a single dialog verbatim — same reference, untouched", () => {
    const dialog: DialogNode = {
      "jcr:title": "Solo",
      content: { items: { field: { name: "./x", "sling:orderBefore": "y" } } },
    };
    const out = mergeDialogs([dialog]);
    // Identity is the no-regression guarantee for single-source chains —
    // even merge-control props survive untouched.
    expect(out).toBe(dialog);
  });

  it("throws on an empty input", () => {
    expect(() => mergeDialogs([])).toThrow(/at least one dialog/);
  });

  it("child properties win collisions; base-only and child-only both survive", () => {
    const base: DialogNode = {
      "jcr:title": "Base",
      helpPath: "base-help",
      baseOnly: "kept",
    };
    const child: DialogNode = { "jcr:title": "Child", childOnly: "added" };
    const out = mergeDialogs([child, base]);
    expect(out["jcr:title"]).toBe("Child");
    expect(out["helpPath"]).toBe("base-help");
    expect(out["baseOnly"]).toBe("kept");
    expect(out["childOnly"]).toBe("added");
  });

  it("merges same-named child nodes recursively, deep overrides winning", () => {
    const base: DialogNode = {
      content: {
        items: {
          tabs: {
            items: {
              tabA: {
                "jcr:title": "Base Tab",
                items: { fieldOne: { name: "./one", fieldLabel: "Base label" } },
              },
            },
          },
        },
      },
    };
    const child: DialogNode = {
      content: {
        items: {
          tabs: {
            items: {
              tabA: {
                "jcr:title": "Child Tab",
                items: { fieldOne: { fieldLabel: "Child label" } },
              },
            },
          },
        },
      },
    };
    const out = mergeDialogs([child, base]) as Record<string, any>;
    const tabA = out.content.items.tabs.items.tabA;
    expect(tabA["jcr:title"]).toBe("Child Tab");
    expect(tabA.items.fieldOne.fieldLabel).toBe("Child label");
    // Base-supplied property inside the overridden node survives the merge.
    expect(tabA.items.fieldOne.name).toBe("./one");
  });

  it("orders inherited children first, child-only children appended in child order", () => {
    const base: DialogNode = { alpha: { a: 1 }, beta: { b: 2 } };
    const child: DialogNode = { delta: { d: 4 }, gamma: { g: 3 } };
    const out = mergeDialogs([child, base]);
    expect(Object.keys(out)).toEqual(["alpha", "beta", "delta", "gamma"]);
  });

  it("honors sling:orderBefore against base-sourced and child-sourced siblings", () => {
    const base: DialogNode = { properties: { p: 1 }, styletab: { s: 1 } };
    const child: DialogNode = {
      display: { d: 1 },
      // Move before an inherited sibling.
      early: { e: 1, "sling:orderBefore": "properties" },
    };
    const out = mergeDialogs([child, base]);
    expect(Object.keys(out)).toEqual([
      "early",
      "properties",
      "styletab",
      "display",
    ]);
  });

  it("leaves a node in place when its sling:orderBefore target doesn't exist", () => {
    const base: DialogNode = { one: { a: 1 } };
    const child: DialogNode = { two: { b: 2, "sling:orderBefore": "ghost" } };
    const out = mergeDialogs([child, base]);
    expect(Object.keys(out)).toEqual(["one", "two"]);
  });

  it("hides inherited properties via sling:hideProperties (string, array, and *)", () => {
    const base: DialogNode = { keep: "k", dropOne: "d1", dropTwo: "d2" };

    const asString = mergeDialogs([
      { "sling:hideProperties": "dropOne" },
      base,
    ]);
    expect(asString["dropOne"]).toBeUndefined();
    expect(asString["keep"]).toBe("k");

    const asArray = mergeDialogs([
      { "sling:hideProperties": ["dropOne", "dropTwo"] },
      base,
    ]);
    expect(asArray["dropOne"]).toBeUndefined();
    expect(asArray["dropTwo"]).toBeUndefined();
    expect(asArray["keep"]).toBe("k");

    const wildcard = mergeDialogs([
      { "sling:hideProperties": "*", own: "mine" },
      base,
    ]);
    expect(wildcard["keep"]).toBeUndefined();
    expect(wildcard["own"]).toBe("mine");
  });

  it("hides inherited children via sling:hideChildren, while a local redefinition stands alone", () => {
    const base: DialogNode = {
      hidden: { fromBase: true, extra: { x: 1 } },
      kept: { k: 1 },
    };
    const child: DialogNode = {
      "sling:hideChildren": ["hidden"],
      hidden: { fromChild: true },
    };
    const out = mergeDialogs([child, base]) as Record<string, any>;
    expect(out.kept).toEqual({ k: 1 });
    // The inherited node is gone; the child's own node is NOT merged with it.
    expect(out.hidden).toEqual({ fromChild: true });
    expect(out.hidden.extra).toBeUndefined();
  });

  it("hides all inherited children with sling:hideChildren: '*'", () => {
    const base: DialogNode = { a: { x: 1 }, b: { y: 2 }, prop: "stays" };
    const child: DialogNode = { "sling:hideChildren": "*", mine: { m: 1 } };
    const out = mergeDialogs([child, base]);
    expect(Object.keys(out).filter((k) => !k.startsWith("sling:"))).toEqual([
      "prop",
      "mine",
    ]);
  });

  it("warns on and ignores unsupported !name negation entries", () => {
    const onWarning = vi.fn();
    const base: DialogNode = { a: { x: 1 }, b: { y: 2 } };
    const child: DialogNode = { "sling:hideChildren": ["!a", "b"] };
    const out = mergeDialogs([child, base], { onWarning });
    expect(out["a"]).toEqual({ x: 1 });
    expect(out["b"]).toBeUndefined();
    expect(onWarning).toHaveBeenCalledWith(
      expect.stringContaining('negation entry "!a"'),
    );
  });

  it("drops an inherited node whose override carries a truthy sling:hideResource", () => {
    const base: DialogNode = { gone: { g: 1 }, kept: { k: 1 } };
    for (const truthy of [true, "true", "{Boolean}true"]) {
      const child: DialogNode = { gone: { "sling:hideResource": truthy } };
      const out = mergeDialogs([child, base]);
      expect(out["gone"]).toBeUndefined();
      expect(out["kept"]).toEqual({ k: 1 });
    }
  });

  it("emits nothing for a hideResource marker with no inherited counterpart", () => {
    const base: DialogNode = { real: { r: 1 } };
    const child: DialogNode = { ghost: { "sling:hideResource": true } };
    const out = mergeDialogs([child, base]);
    expect(out["ghost"]).toBeUndefined();
  });

  it("strips all merge-control props at every depth of a merged result", () => {
    const base: DialogNode = { tab: { inner: { deep: "v" } } };
    const child: DialogNode = {
      "sling:hideProperties": "nothing",
      tab: {
        "sling:orderBefore": "x",
        inner: { "sling:hideChildren": ["none"], deep: "override" },
      },
    };
    const out = JSON.stringify(mergeDialogs([child, base]));
    expect(out).not.toContain("sling:hideProperties");
    expect(out).not.toContain("sling:hideChildren");
    expect(out).not.toContain("sling:hideResource");
    expect(out).not.toContain("sling:orderBefore");
  });

  it("replaces arrays wholesale — no element merging", () => {
    const base: DialogNode = { mimeTypes: ["image/png", "image/jpeg"] };
    const child: DialogNode = { mimeTypes: ["video/mp4"] };
    const out = mergeDialogs([child, base]);
    expect(out["mimeTypes"]).toEqual(["video/mp4"]);
  });

  it("folds a 3-level chain child-over-parent-over-grandparent", () => {
    const grandparent: DialogNode = {
      from: "grandparent",
      gpOnly: "gp",
      shared: { level: "gp", gpField: 1 },
    };
    const parent: DialogNode = {
      from: "parent",
      pOnly: "p",
      shared: { level: "p", pField: 2 },
    };
    const child: DialogNode = { from: "child", cOnly: "c" };
    const out = mergeDialogs([child, parent, grandparent]) as Record<
      string,
      any
    >;
    expect(out.from).toBe("child");
    expect(out.gpOnly).toBe("gp");
    expect(out.pOnly).toBe("p");
    expect(out.cOnly).toBe("c");
    expect(out.shared).toEqual({ level: "p", gpField: 1, pField: 2 });
  });
});
