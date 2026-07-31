import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveSanityTypeNames } from "../src/naming.ts";

/**
 * MIGRATION_TYPE_NAMING=title names Sanity types from each component's
 * `jcr:title` instead of its JCR path. Collisions keep the first-in-order
 * winner clean and suffix later ones with their path-derived name; missing
 * titles fall back to path-derived naming. The default `path` strategy must
 * stay byte-identical to the historical behavior.
 */
describe("resolveSanityTypeNames: title strategy", () => {
  it("camelCases jcr:title for the type name", () => {
    const names = resolveSanityTypeNames(
      ["/apps/uxp/components/proxy/content/cardcontainer"],
      {
        strategy: "title",
        titleByPath: new Map([
          ["/apps/uxp/components/proxy/content/cardcontainer", "Card Container"],
        ]),
      },
    );
    assert.equal(
      names.get("/apps/uxp/components/proxy/content/cardcontainer"),
      "cardContainer",
    );
  });

  it('strips the redundant trailing " component" like Studio labels do', () => {
    const names = resolveSanityTypeNames(["/apps/x/components/hero-banner"], {
      strategy: "title",
      titleByPath: new Map([
        ["/apps/x/components/hero-banner", "Hero Banner Component"],
      ]),
    });
    assert.equal(names.get("/apps/x/components/hero-banner"), "heroBanner");
  });

  it("falls back to the path-derived name when the title is missing or blank", () => {
    const paths = [
      "/apps/x/components/proxy/content/spacer",
      "/apps/x/components/proxy/content/separator",
    ];
    const names = resolveSanityTypeNames(paths, {
      strategy: "title",
      titleByPath: new Map([["/apps/x/components/proxy/content/separator", "   "]]),
    });
    assert.equal(names.get(paths[0]!), "proxyContentSpacer");
    assert.equal(names.get(paths[1]!), "proxyContentSeparator");
  });

  it("suffixes the second colliding title with its path-derived name", () => {
    const paths = [
      "/apps/x/components/content/teaser",
      "/apps/x/components/proxy/content/teaser",
    ];
    const names = resolveSanityTypeNames(paths, {
      strategy: "title",
      titleByPath: new Map([
        [paths[0]!, "Teaser"],
        [paths[1]!, "Teaser"],
      ]),
    });
    assert.equal(names.get(paths[0]!), "teaser");
    assert.equal(names.get(paths[1]!), "teaserProxyContentTeaser");
  });

  it("applies the aem prefix for reserved built-ins, then the path suffix on collision", () => {
    const paths = [
      "/apps/x/components/content/image",
      "/apps/x/components/proxy/content/image",
    ];
    const names = resolveSanityTypeNames(paths, {
      strategy: "title",
      titleByPath: new Map([
        [paths[0]!, "Image"],
        [paths[1]!, "Image"],
      ]),
    });
    assert.equal(names.get(paths[0]!), "aemImage");
    assert.equal(names.get(paths[1]!), "imageProxyContentImage");
  });

  it("reports every fallback through onFallback", () => {
    const paths = [
      "/apps/x/components/content/teaser",
      "/apps/x/components/proxy/content/teaser",
      "/apps/x/components/content/untitled",
    ];
    const fallbacks: Array<{ path: string; finalName: string }> = [];
    resolveSanityTypeNames(paths, {
      strategy: "title",
      titleByPath: new Map([
        [paths[0]!, "Teaser"],
        [paths[1]!, "Teaser"],
      ]),
      onFallback: (path, _reason, finalName) => fallbacks.push({ path, finalName }),
    });
    assert.deepEqual(fallbacks, [
      { path: paths[1]!, finalName: "teaserProxyContentTeaser" },
      { path: paths[2]!, finalName: "contentUntitled" },
    ]);
  });

  it("path strategy stays unchanged (reserved prefix + numeric suffix)", () => {
    const paths = [
      "/apps/a/components/image",
      "/apps/b/components/image",
      "/apps/c/components/image",
    ];
    const names = resolveSanityTypeNames(paths);
    assert.equal(names.get(paths[0]!), "aemImage");
    assert.equal(names.get(paths[1]!), "aemImage2");
    assert.equal(names.get(paths[2]!), "aemImage3");
  });
});

/**
 * MIGRATION_TYPE_SUFFIX appends a global, verbatim suffix to every
 * strategy-derived type name so generated types can match an existing
 * customer schema. Explicit names from aem-component-names.json are exempt;
 * reserved-name and collision checks run against the suffixed names.
 */
describe("resolveSanityTypeNames: global suffix", () => {
  it("appends the suffix to path-derived names", () => {
    const names = resolveSanityTypeNames(
      ["/apps/x/components/proxy/content/hero"],
      { suffix: "Block" },
    );
    assert.equal(
      names.get("/apps/x/components/proxy/content/hero"),
      "proxyContentHeroBlock",
    );
  });

  it("appends the suffix to title-derived names", () => {
    const path = "/apps/x/components/proxy/content/cardcontainer";
    const names = resolveSanityTypeNames([path], {
      strategy: "title",
      suffix: "Block",
      titleByPath: new Map([[path, "Card Container"]]),
    });
    assert.equal(names.get(path), "cardContainerBlock");
  });

  it("leaves explicit overrides untouched", () => {
    const paths = ["/apps/x/components/hero", "/apps/x/components/teaser"];
    const names = resolveSanityTypeNames(paths, {
      suffix: "Block",
      overrides: new Map([[paths[0]!, "customHero"]]),
    });
    assert.equal(names.get(paths[0]!), "customHero");
    assert.equal(names.get(paths[1]!), "teaserBlock");
  });

  it("skips the aem prefix when the suffix already clears the reserved name", () => {
    const names = resolveSanityTypeNames(["/apps/x/components/image"], {
      suffix: "Block",
    });
    assert.equal(names.get("/apps/x/components/image"), "imageBlock");
  });

  it("keeps the suffix last through collision fallbacks", () => {
    const paths = [
      "/apps/a/components/image",
      "/apps/b/components/image",
      "/apps/c/components/image",
    ];
    const names = resolveSanityTypeNames(paths, { suffix: "Block" });
    assert.equal(names.get(paths[0]!), "imageBlock");
    assert.equal(names.get(paths[1]!), "aemImageBlock");
    assert.equal(names.get(paths[2]!), "aemImageBlock2");
  });

  it("keeps the suffix last on title-collision path disambiguation", () => {
    const paths = [
      "/apps/x/components/content/teaser",
      "/apps/x/components/proxy/content/teaser",
    ];
    const names = resolveSanityTypeNames(paths, {
      strategy: "title",
      suffix: "Block",
      titleByPath: new Map([
        [paths[0]!, "Teaser"],
        [paths[1]!, "Teaser"],
      ]),
    });
    assert.equal(names.get(paths[0]!), "teaserBlock");
    assert.equal(names.get(paths[1]!), "teaserProxyContentTeaserBlock");
  });

  it("rejects a suffix that would break identifier-like type names", () => {
    assert.throws(
      () =>
        resolveSanityTypeNames(["/apps/x/components/hero"], { suffix: "-block" }),
      /letters\/digits\/underscore/,
    );
  });
});
