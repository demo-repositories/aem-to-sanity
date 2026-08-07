import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPageComponentConfig } from "../src/config/page-components.ts";

let tmp: string | undefined;

function configFile(content: unknown): string {
  tmp = mkdtempSync(join(tmpdir(), "page-components-"));
  const file = join(tmp, "aem-page-components.json");
  writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  return file;
}

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

const RT = "uxp/components/structure/page";
const TEMPLATE = "/conf/uxp/settings/wcm/templates/universal-page";

describe("loadPageComponentConfig", () => {
  it("returns an empty map when the file is missing", () => {
    const config = loadPageComponentConfig({ file: "/nonexistent/aem-page-components.json" });
    expect(config.size).toBe(0);
  });

  it("loads templates and discover", () => {
    const config = loadPageComponentConfig({
      file: configFile({ [RT]: { templates: [TEMPLATE], discover: true } }),
    });
    expect(config.get(RT)).toEqual({ templates: [TEMPLATE], discover: true });
  });

  it("rejects an entry with neither templates nor discover", () => {
    expect(() =>
      loadPageComponentConfig({ file: configFile({ [RT]: { templates: [] } }) }),
    ).toThrow(/needs either a non-empty "templates" array or "discover": true/);
  });

  describe("names overrides", () => {
    it("accepts the string shorthand", () => {
      const config = loadPageComponentConfig({
        file: configFile({
          [RT]: { templates: [TEMPLATE], names: { [TEMPLATE]: "universalPage" } },
        }),
      });
      expect(config.get(RT)?.names).toEqual({ [TEMPLATE]: { name: "universalPage" } });
    });

    it("accepts the object form with name and title", () => {
      const config = loadPageComponentConfig({
        file: configFile({
          [RT]: {
            templates: [TEMPLATE],
            names: { [TEMPLATE]: { name: "universalPage", title: "Universal Page" } },
          },
        }),
      });
      expect(config.get(RT)?.names).toEqual({
        [TEMPLATE]: { name: "universalPage", title: "Universal Page" },
      });
    });

    it("accepts a title-only override", () => {
      const config = loadPageComponentConfig({
        file: configFile({
          [RT]: { templates: [TEMPLATE], names: { [TEMPLATE]: { title: "Universal Page" } } },
        }),
      });
      expect(config.get(RT)?.names).toEqual({ [TEMPLATE]: { title: "Universal Page" } });
    });

    it("rejects a key that matches no declared template when discover is off", () => {
      expect(() =>
        loadPageComponentConfig({
          file: configFile({
            [RT]: { templates: [TEMPLATE], names: { "/conf/uxp/typo": "universalPage" } },
          }),
        }),
      ).toThrow(/is not in its "templates" list/);
    });

    it("allows a key outside the templates list when discover is on", () => {
      const config = loadPageComponentConfig({
        file: configFile({
          [RT]: {
            templates: [],
            discover: true,
            names: { [TEMPLATE]: "universalPage" },
          },
        }),
      });
      expect(config.get(RT)?.names).toEqual({ [TEMPLATE]: { name: "universalPage" } });
    });

    it("rejects a non-identifier type name", () => {
      expect(() =>
        loadPageComponentConfig({
          file: configFile({
            [RT]: { templates: [TEMPLATE], names: { [TEMPLATE]: "universal-page" } },
          }),
        }),
      ).toThrow(/not a valid Sanity type name/);
    });

    it("rejects the same name assigned to two templates", () => {
      const other = "/conf/uxp/settings/wcm/templates/news-article";
      expect(() =>
        loadPageComponentConfig({
          file: configFile({
            [RT]: {
              templates: [TEMPLATE, other],
              names: { [TEMPLATE]: "universalPage", [other]: "universalPage" },
            },
          }),
        }),
      ).toThrow(/type names must be unique/);
    });

    it("rejects an empty override object", () => {
      expect(() =>
        loadPageComponentConfig({
          file: configFile({ [RT]: { templates: [TEMPLATE], names: { [TEMPLATE]: {} } } }),
        }),
      ).toThrow(/needs "name" and\/or "title"/);
    });

    it("rejects an empty title", () => {
      expect(() =>
        loadPageComponentConfig({
          file: configFile({
            [RT]: { templates: [TEMPLATE], names: { [TEMPLATE]: { title: "  " } } },
          }),
        }),
      ).toThrow(/must not be empty/);
    });
  });

  describe("components restrictions", () => {
    const NEWSCARD = "uxp/components/proxy/content/newscard";

    it("loads a components map keyed by template", () => {
      const config = loadPageComponentConfig({
        file: configFile({
          [RT]: { templates: [TEMPLATE], components: { [TEMPLATE]: [NEWSCARD] } },
        }),
      });
      expect(config.get(RT)?.components).toEqual({ [TEMPLATE]: [NEWSCARD] });
    });

    it("normalizes leading / and apps/ on resource types, and dedupes", () => {
      const config = loadPageComponentConfig({
        file: configFile({
          [RT]: {
            templates: [TEMPLATE],
            components: { [TEMPLATE]: [`/apps/${NEWSCARD}`, ` ${NEWSCARD} `] },
          },
        }),
      });
      expect(config.get(RT)?.components).toEqual({ [TEMPLATE]: [NEWSCARD] });
    });

    it("rejects a components key not in templates without discover", () => {
      expect(() =>
        loadPageComponentConfig({
          file: configFile({
            [RT]: {
              templates: [TEMPLATE],
              components: { "/conf/uxp/settings/wcm/templates/other": [NEWSCARD] },
            },
          }),
        }),
      ).toThrow(/not in its "templates" list/);
    });

    it("allows an unlisted components key with discover: true", () => {
      const other = "/conf/uxp/settings/wcm/templates/other";
      const config = loadPageComponentConfig({
        file: configFile({
          [RT]: { discover: true, components: { [other]: [NEWSCARD] } },
        }),
      });
      expect(config.get(RT)?.components).toEqual({ [other]: [NEWSCARD] });
    });

    it("rejects an empty resource-type list", () => {
      expect(() =>
        loadPageComponentConfig({
          file: configFile({
            [RT]: { templates: [TEMPLATE], components: { [TEMPLATE]: [] } },
          }),
        }),
      ).toThrow(/needs at least one resource type/);
    });

    it("rejects a non-array value", () => {
      expect(() =>
        loadPageComponentConfig({
          file: configFile({
            [RT]: { templates: [TEMPLATE], components: { [TEMPLATE]: NEWSCARD } },
          }),
        }),
      ).toThrow(/must be an array of component sling:resourceTypes/);
    });

    it("rejects non-string resource types", () => {
      expect(() =>
        loadPageComponentConfig({
          file: configFile({
            [RT]: { templates: [TEMPLATE], components: { [TEMPLATE]: [42] } },
          }),
        }),
      ).toThrow(/non-string \/ empty resource type/);
    });
  });
});
