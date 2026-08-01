import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadDialogOverrideConfig } from "../src/config/dialog-overrides.ts";

let tmp: string | undefined;

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

function tmpDir(): string {
  tmp = mkdtempSync(join(tmpdir(), "dialog-override-config-"));
  return tmp;
}

function configFile(config: unknown): string {
  const dir = tmpDir();
  const file = join(dir, "aem-dialog-overrides.json");
  writeFileSync(
    file,
    typeof config === "string" ? config : JSON.stringify(config),
  );
  return file;
}

const TAB_PATH =
  "/libs/core/wcm/components/accordion/v1/accordion/cq:dialog/content/items/tabs/items/properties";

describe("loadDialogOverrideConfig", () => {
  it("returns an empty map when the file is absent", () => {
    const config = loadDialogOverrideConfig({
      file: "/nonexistent/aem-dialog-overrides.json",
    });
    expect(config.size).toBe(0);
  });

  it("throws on malformed JSON", () => {
    const file = configFile("{not json");
    expect(() => loadDialogOverrideConfig({ file })).toThrow(/not valid JSON/);
  });

  it("throws on a non-object root", () => {
    const file = configFile([{ path: TAB_PATH }]);
    expect(() => loadDialogOverrideConfig({ file })).toThrow(
      /must be a JSON object keyed by sling:resourceType/,
    );
  });

  it("parses supplementaryTabs and derives the key from the path", () => {
    const file = configFile({
      "uxp/components/proxy/content/accordion": {
        supplementaryTabs: [{ path: TAB_PATH, insertAfter: "theme" }],
      },
    });
    const config = loadDialogOverrideConfig({ file });
    const entry = config.get("uxp/components/proxy/content/accordion");
    expect(entry?.supplementaryTabs).toEqual([
      { path: TAB_PATH, insertAfter: "theme", key: "properties" },
    ]);
    expect(entry?.dialogFile).toBeUndefined();
  });

  it("normalizes /apps/-prefixed keys", () => {
    const file = configFile({
      "/apps/uxp/components/proxy/content/accordion": {
        supplementaryTabs: [{ path: TAB_PATH }],
      },
    });
    const config = loadDialogOverrideConfig({ file });
    expect(config.has("uxp/components/proxy/content/accordion")).toBe(true);
  });

  it("rejects duplicate keys after normalization", () => {
    const file = configFile({
      "uxp/components/foo": { supplementaryTabs: [{ path: TAB_PATH }] },
      "/apps/uxp/components/foo": { supplementaryTabs: [{ path: TAB_PATH }] },
    });
    expect(() => loadDialogOverrideConfig({ file })).toThrow(/duplicates/);
  });

  it("rejects an entry with neither capability", () => {
    const file = configFile({ "uxp/components/foo": {} });
    expect(() => loadDialogOverrideConfig({ file })).toThrow(
      /needs "dialogFile" and\/or "supplementaryTabs"/,
    );
  });

  it("rejects an empty supplementaryTabs array", () => {
    const file = configFile({
      "uxp/components/foo": { supplementaryTabs: [] },
    });
    expect(() => loadDialogOverrideConfig({ file })).toThrow(
      /must be a non-empty array/,
    );
  });

  it("rejects a relative tab path", () => {
    const file = configFile({
      "uxp/components/foo": {
        supplementaryTabs: [{ path: "libs/core/accordion" }],
      },
    });
    expect(() => loadDialogOverrideConfig({ file })).toThrow(
      /absolute JCR "path"/,
    );
  });

  it("rejects insertAfter + insertBefore on the same tab", () => {
    const file = configFile({
      "uxp/components/foo": {
        supplementaryTabs: [
          { path: TAB_PATH, insertAfter: "theme", insertBefore: "content" },
        ],
      },
    });
    expect(() => loadDialogOverrideConfig({ file })).toThrow(/pick one/);
  });

  it("rejects anchors and keys containing a path separator", () => {
    const file = configFile({
      "uxp/components/foo": {
        supplementaryTabs: [{ path: TAB_PATH, insertAfter: "items/theme" }],
      },
    });
    expect(() => loadDialogOverrideConfig({ file })).toThrow(/node name/);
  });

  it("accepts JCR-namespaced anchors like cq:include", () => {
    const file = configFile({
      "uxp/components/foo": {
        supplementaryTabs: [{ path: TAB_PATH, insertBefore: "cq:include" }],
      },
    });
    const config = loadDialogOverrideConfig({ file });
    expect(
      config.get("uxp/components/foo")?.supplementaryTabs?.[0]?.insertBefore,
    ).toBe("cq:include");
  });

  it("eagerly loads dialogFile relative to the config file's directory", () => {
    const dir = tmpDir();
    const dialog = { content: { items: {} }, "jcr:title": "Hero" };
    writeFileSync(join(dir, "hero-dialog.json"), JSON.stringify(dialog));
    const file = join(dir, "aem-dialog-overrides.json");
    writeFileSync(
      file,
      JSON.stringify({
        "uxp/components/hero": { dialogFile: "./hero-dialog.json" },
      }),
    );
    const config = loadDialogOverrideConfig({ file });
    const entry = config.get("uxp/components/hero");
    expect(entry?.dialogFile).toBe("./hero-dialog.json");
    expect(entry?.dialog).toEqual(dialog);
  });

  it("fails at load time when dialogFile is missing, naming the attempted paths", () => {
    const file = configFile({
      "uxp/components/hero": { dialogFile: "./missing.json" },
    });
    expect(() => loadDialogOverrideConfig({ file })).toThrow(
      /dialogFile for "uxp\/components\/hero" not found — tried/,
    );
  });

  it("fails at load time on a malformed dialogFile", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "bad.json"), "{nope");
    const file = join(dir, "aem-dialog-overrides.json");
    writeFileSync(
      file,
      JSON.stringify({ "uxp/components/hero": { dialogFile: "./bad.json" } }),
    );
    expect(() => loadDialogOverrideConfig({ file })).toThrow(/not valid JSON/);
  });

  it("accepts an entry combining dialogFile and supplementaryTabs", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "base.json"), JSON.stringify({ content: {} }));
    const file = join(dir, "aem-dialog-overrides.json");
    writeFileSync(
      file,
      JSON.stringify({
        "uxp/components/hero": {
          dialogFile: "./base.json",
          supplementaryTabs: [{ path: TAB_PATH }],
        },
      }),
    );
    const config = loadDialogOverrideConfig({ file });
    const entry = config.get("uxp/components/hero");
    expect(entry?.dialog).toEqual({ content: {} });
    expect(entry?.supplementaryTabs).toHaveLength(1);
  });
});
