import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Integration test: `skipProperties` on a page-templates manifest entry
 * (operator-declared via `aem-page-components.json`) drops the matching
 * raw `jcr:content` properties from the lifted `pageProperties` object.
 * Non-skipped authored values still lift and coerce as before.
 */

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const transformTs = fileURLToPath(new URL("../src/transform.ts", import.meta.url));

function rawPage(): unknown {
  return {
    jcrPath: "/content/site/props-skip",
    slug: "props-skip",
    relativePath: "props-skip",
    fetchedAt: "2026-01-01T00:00:00.000Z",
    tree: {
      "jcr:primaryType": "cq:Page",
      "jcr:content": {
        "jcr:primaryType": "cq:PageContent",
        "sling:resourceType": "site/structure/page",
        "cq:template": "/conf/site/settings/wcm/templates/basic",
        "jcr:title": "Props Skip",
        pwaOrientation: "portrait",
        disableCache: "true",
        legacyRenderHint: "aem-only",
        root: {
          "jcr:primaryType": "nt:unstructured",
          text: {
            "jcr:primaryType": "nt:unstructured",
            "sling:resourceType": "site/components/text",
            text: "body text",
          },
        },
      },
    },
  };
}

interface Doc {
  _id: string;
  _type: string;
  pageProperties?: Record<string, unknown>;
}

describe("pageProperties skipProperties", () => {
  let tmp: string;
  let outputDir: string;
  let docs: Doc[];

  before(() => {
    tmp = mkdtempSync(join(tmpdir(), "aem-transform-props-skip-"));
    outputDir = join(tmp, "output");
    const contentDir = join(outputDir, "cache", "aem", "content", "content", "site");
    mkdirSync(contentDir, { recursive: true });
    writeFileSync(join(contentDir, "props-skip.json"), JSON.stringify(rawPage(), null, 2));

    const registryFile = join(tmp, "content-type-registry.json");
    writeFileSync(
      registryFile,
      JSON.stringify({
        entries: [
          { resourceType: "site/components/text", sanityType: "text", fields: [{ name: "text", type: "string" }] },
          {
            resourceType: "site/structure/page",
            sanityType: "structurePage",
            fields: [
              { name: "pwaOrientation", type: "string" },
              // `disableCache` deliberately absent — the schema side skipped it too.
            ],
          },
        ],
      }),
    );

    writeFileSync(
      join(outputDir, "cache", "page-templates.json"),
      JSON.stringify({
        entries: [
          {
            pageComponentResourceType: "site/structure/page",
            pageComponentSanityType: "structurePage",
            cqTemplate: "/conf/site/settings/wcm/templates/basic",
            sanityType: "basicPage",
            sanityTitle: "Basic Page",
            skipProperties: ["disableCache", "legacyRenderHint"],
          },
        ],
      }),
    );

    const env = { ...process.env, OUTPUT_DIR: outputDir };
    for (const key of Object.keys(env)) {
      if (key.startsWith("MIGRATION_") || key.startsWith("AEM_")) delete env[key];
    }
    execFileSync(
      process.execPath,
      ["--import", "tsx", transformTs, "--registry", registryFile],
      { cwd: packageDir, env, stdio: "pipe" },
    );

    docs = (
      JSON.parse(
        readFileSync(join(outputDir, "cache", "clean", "content", "site", "props-skip.json"), "utf8"),
      ) as { docs: Doc[] }
    ).docs;
  });

  after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("drops skipped raw properties from pageProperties, keeps the rest", () => {
    const page = docs.find((d) => d._type === "basicPage");
    assert.ok(page, "per-template page doc emitted");
    assert.equal(page.pageProperties?.pwaOrientation, "portrait");
    assert.ok(!("disableCache" in (page.pageProperties ?? {})), "disableCache skipped");
    assert.ok(!("legacyRenderHint" in (page.pageProperties ?? {})), "legacyRenderHint skipped");
  });
});
