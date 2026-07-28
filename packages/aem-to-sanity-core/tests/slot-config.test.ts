import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSlotConfig } from "../src/config/slots.ts";

let tmp: string | undefined;

function configFile(content: unknown): string {
  tmp = mkdtempSync(join(tmpdir(), "slot-config-"));
  const file = join(tmp, "aem-component-slots.json");
  writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  return file;
}

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

describe("loadSlotConfig", () => {
  it("returns an empty map for a missing file", () => {
    expect(loadSlotConfig({ file: "/nonexistent/slots.json" }).size).toBe(0);
  });

  it("accepts the boolean-toggle shorthand and the equals object form", () => {
    const config = loadSlotConfig({
      file: configFile({
        "uxp/components/proxy/content/promocard": {
          buttonPrimary: { visibleWhen: "enablePrimaryButton" },
          banner: { visibleWhen: { field: "cardStyle", equals: "flood" } },
          badges: { visibleWhen: { field: "cardStyle", equals: ["flood", "split"] } },
        },
      }),
    });
    const promocard = config.get("uxp/components/proxy/content/promocard");
    expect(promocard?.get("buttonPrimary")).toEqual({
      visibleWhen: { field: "enablePrimaryButton" },
    });
    expect(promocard?.get("banner")).toEqual({
      visibleWhen: { field: "cardStyle", equals: ["flood"] },
    });
    expect(promocard?.get("badges")).toEqual({
      visibleWhen: { field: "cardStyle", equals: ["flood", "split"] },
    });
  });

  it("normalizes /apps/-prefixed resource-type keys", () => {
    const config = loadSlotConfig({
      file: configFile({
        "/apps/uxp/components/proxy/content/promocard": {
          image: { visibleWhen: "enableForegroundImage" },
        },
      }),
    });
    expect(config.has("uxp/components/proxy/content/promocard")).toBe(true);
  });

  it("throws on malformed JSON", () => {
    expect(() => loadSlotConfig({ file: configFile("{nope") })).toThrow(
      /not valid JSON/,
    );
  });

  it("rejects a non-object slot entry", () => {
    expect(() =>
      loadSlotConfig({
        file: configFile({ "a/b/c": { slot: "enableThing" } }),
      }),
    ).toThrow(/must be an object/);
  });

  it("rejects an empty visibleWhen field name", () => {
    expect(() =>
      loadSlotConfig({
        file: configFile({ "a/b/c": { slot: { visibleWhen: "  " } } }),
      }),
    ).toThrow(/non-empty controller field/);
  });

  it("rejects a non-string equals value", () => {
    expect(() =>
      loadSlotConfig({
        file: configFile({
          "a/b/c": { slot: { visibleWhen: { field: "x", equals: [true] } } },
        }),
      }),
    ).toThrow(/"equals" must be a string/);
  });
});
