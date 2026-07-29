import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Integration test: containers configured `document: true` extract EVERY
 * instance into a `contentFragment` document — by design, not depth
 * pressure. One consistent shape: the parent array always holds a
 * `contentFragmentRef`, nested instances become their own documents (the
 * outer fragment holds a ref where the inner sat), fragment ids derive
 * from the page id + the block's stable `_key` (idempotent re-runs), and
 * each extraction is reported under `configExtractedFragments`.
 */

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const transformTs = fileURLToPath(new URL("../src/transform.ts", import.meta.url));

function rawPage(): unknown {
  return {
    jcrPath: "/content/site/doc-extract",
    slug: "doc-extract",
    relativePath: "doc-extract",
    fetchedAt: "2026-01-01T00:00:00.000Z",
    tree: {
      "jcr:primaryType": "cq:Page",
      "jcr:content": {
        "jcr:primaryType": "cq:PageContent",
        "sling:resourceType": "site/structure/page",
        "cq:template": "/conf/site/settings/wcm/templates/basic",
        "jcr:title": "Doc Extract",
        root: {
          "jcr:primaryType": "nt:unstructured",
          tabs: {
            "jcr:primaryType": "nt:unstructured",
            "sling:resourceType": "site/components/tabs",
            accessibilityLabel: "Outer tabs",
            item_1: {
              "jcr:primaryType": "nt:unstructured",
              "sling:resourceType": "site/components/container",
              "cq:panelTitle": "Panel A",
              tabs: {
                "jcr:primaryType": "nt:unstructured",
                "sling:resourceType": "site/components/tabs",
                accessibilityLabel: "Inner tabs",
                item_inner: {
                  "jcr:primaryType": "nt:unstructured",
                  "sling:resourceType": "site/components/container",
                  "cq:panelTitle": "Inner panel",
                  text: {
                    "jcr:primaryType": "nt:unstructured",
                    "sling:resourceType": "site/components/text",
                    text: "deep text",
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

interface Block {
  _type: string;
  _key?: string;
  panelTitle?: string;
  items?: Block[];
  fragment?: { _type: string; _ref: string };
}

interface Doc {
  _id: string;
  _type: string;
  title?: string;
  pageBuilder?: Block[];
  content?: Block[];
}

describe("document: true containers extract every instance", () => {
  let tmp: string;
  let outputDir: string;
  let docs: Doc[];

  before(() => {
    tmp = mkdtempSync(join(tmpdir(), "aem-transform-docextract-"));
    outputDir = join(tmp, "output");
    const contentDir = join(outputDir, "cache", "aem", "content", "content", "site");
    mkdirSync(contentDir, { recursive: true });
    writeFileSync(join(contentDir, "doc-extract.json"), JSON.stringify(rawPage(), null, 2));

    const registryFile = join(tmp, "content-type-registry.json");
    writeFileSync(
      registryFile,
      JSON.stringify({
        entries: [
          { resourceType: "site/components/text", sanityType: "text", fields: [{ name: "text", type: "string" }] },
          {
            resourceType: "site/components/container",
            sanityType: "container",
            fields: [
              { name: "items", type: "container-children" },
              { name: "panelTitle", type: "string" },
            ],
          },
          {
            resourceType: "site/components/tabs",
            sanityType: "tabs",
            fields: [
              { name: "accessibilityLabel", type: "string" },
              { name: "items", type: "container-children" },
            ],
          },
          { resourceType: "site/structure/page", sanityType: "sitePage", fields: [] },
        ],
      }),
    );

    const containersFile = join(tmp, "aem-component-containers.json");
    writeFileSync(
      containersFile,
      JSON.stringify({
        "site/components/container": { childrenField: "items", flatten: true },
        "site/components/tabs": { childrenField: "items", document: true },
      }),
    );
    const hintsFile = join(tmp, "aem-component-hints.json");
    writeFileSync(hintsFile, JSON.stringify({ "site/components/container": ["cq:panelTitle"] }));

    writeFileSync(
      join(outputDir, "cache", "page-templates.json"),
      JSON.stringify({
        entries: [
          {
            pageComponentResourceType: "site/structure/page",
            pageComponentSanityType: "sitePage",
            cqTemplate: "/conf/site/settings/wcm/templates/basic",
            sanityType: "basicPage",
            sanityTitle: "Basic Page",
          },
        ],
      }),
    );

    const env = { ...process.env, OUTPUT_DIR: outputDir };
    for (const key of Object.keys(env)) {
      if (key.startsWith("MIGRATION_") || key.startsWith("AEM_")) delete env[key];
    }
    env.AEM_COMPONENT_CONTAINERS_FILE = containersFile;
    env.AEM_COMPONENT_HINTS_FILE = hintsFile;
    execFileSync(
      process.execPath,
      ["--import", "tsx", transformTs, "--registry", registryFile],
      { cwd: packageDir, env, stdio: "pipe" },
    );

    docs = (
      JSON.parse(
        readFileSync(join(outputDir, "cache", "clean", "content", "site", "doc-extract.json"), "utf8"),
      ) as { docs: Doc[] }
    ).docs;
  });

  after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("emits one fragment doc per tabs instance, titled from the dialog", () => {
    const fragments = docs.filter((d) => d._type === "contentFragment");
    assert.deepEqual(fragments.map((f) => f.title).sort(), ["Inner tabs", "Outer tabs"]);
    const pageId = docs[0]!._id;
    for (const f of fragments) {
      assert.ok(f._id.startsWith(`${pageId}-frag-`), f._id);
      assert.equal(f.content!.length, 1);
      assert.equal(f.content![0]!._type, "tabs");
    }
  });

  it("puts a ref block on the page where the outer tabs sat", () => {
    const page = docs[0]!;
    const ref = page.pageBuilder!.find((b) => b._type === "contentFragmentRef");
    assert.ok(ref);
    const outer = docs.find((d) => d._id === ref.fragment!._ref);
    assert.equal(outer?.title, "Outer tabs");
  });

  it("extracts nested instances separately — the outer fragment holds a ref where the inner sat", () => {
    const outer = docs.find((d) => d.title === "Outer tabs")!;
    const panelA = outer.content![0]!.items![0]!;
    assert.equal(panelA.panelTitle, "Panel A");
    const innerRef = panelA.items![0]!;
    assert.equal(innerRef._type, "contentFragmentRef");
    const inner = docs.find((d) => d._id === innerRef.fragment!._ref)!;
    assert.equal(inner.title, "Inner tabs");
    assert.ok(JSON.stringify(inner).includes('"deep text"'));
  });

  it("reports every extraction under configExtractedFragments", () => {
    const report = JSON.parse(
      readFileSync(join(outputDir, "cache", "transform-report.json"), "utf8"),
    ) as { configExtractedFragments: Array<{ fragmentId: string; blockType: string }> };
    assert.equal(report.configExtractedFragments.length, 2);
    assert.ok(report.configExtractedFragments.every((f) => f.blockType === "tabs"));
  });
});
