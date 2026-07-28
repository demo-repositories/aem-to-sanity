import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Integration test: AEM tabs / accordion components drop the SAME container
 * resource type into their panels that responsive grids use for pure layout
 * — distinguished only by the `cq:panelTitle` the tab editor stamps on
 * panel nodes. A `flatten: true` container must therefore:
 *
 *   1. keep its block when it carries `cq:panelTitle` (it's a panel — the
 *      title and the boundary are authored content), with the title lifted
 *      to `panelTitle` via the authoring-hints opt-in, and
 *   2. still flatten when it doesn't (plain layout wrapper), including
 *      INSIDE a kept panel.
 *
 * Nested tabs (tabs → panel → tabs → panel) must survive recursively.
 *
 * Runs the real CLI as a subprocess (transform.ts executes `main()` at
 * module top level), same harness as child-page-boundary.test.ts.
 */

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const transformTs = fileURLToPath(new URL("../src/transform.ts", import.meta.url));

function textBlock(text: string): Record<string, unknown> {
  return {
    "jcr:primaryType": "nt:unstructured",
    "sling:resourceType": "site/components/text",
    text,
  };
}

function rawPage(): unknown {
  return {
    jcrPath: "/content/site/tabs-page",
    slug: "tabs-page",
    relativePath: "tabs-page",
    fetchedAt: "2026-01-01T00:00:00.000Z",
    tree: {
      "jcr:primaryType": "cq:Page",
      "jcr:content": {
        "jcr:primaryType": "cq:PageContent",
        "sling:resourceType": "site/structure/page",
        "cq:template": "/conf/site/settings/wcm/templates/basic",
        "jcr:title": "Tabs Page",
        root: {
          "jcr:primaryType": "nt:unstructured",
          "sling:resourceType": "site/components/container",
          tabs: {
            "jcr:primaryType": "nt:unstructured",
            "sling:resourceType": "site/components/tabs",
            item_1: {
              "jcr:primaryType": "nt:unstructured",
              "sling:resourceType": "site/components/container",
              "cq:panelTitle": "First tab",
              // Layout-only container INSIDE the panel — must still flatten.
              layout: {
                "jcr:primaryType": "nt:unstructured",
                "sling:resourceType": "site/components/container",
                text: textBlock("first tab body"),
              },
            },
            item_2: {
              "jcr:primaryType": "nt:unstructured",
              "sling:resourceType": "site/components/container",
              "cq:panelTitle": "Second tab",
              // Nested tabs inside a panel.
              tabs: {
                "jcr:primaryType": "nt:unstructured",
                "sling:resourceType": "site/components/tabs",
                item_inner: {
                  "jcr:primaryType": "nt:unstructured",
                  "sling:resourceType": "site/components/container",
                  "cq:panelTitle": "Inner tab",
                  text: textBlock("inner tab body"),
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
  text?: string;
  panelTitle?: string;
  items?: Block[];
}

describe("tabs panels: flatten containers with cq:panelTitle keep their block", () => {
  let tmp: string;
  let outputDir: string;
  let tabs: Block;

  before(() => {
    tmp = mkdtempSync(join(tmpdir(), "aem-transform-tabs-"));
    outputDir = join(tmp, "output");
    const contentDir = join(outputDir, "cache", "aem", "content", "content", "site");
    mkdirSync(contentDir, { recursive: true });
    writeFileSync(join(contentDir, "tabs-page.json"), JSON.stringify(rawPage(), null, 2));

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
            fields: [{ name: "items", type: "container-children" }],
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
        "site/components/tabs": { childrenField: "items" },
      }),
    );

    const hintsFile = join(tmp, "aem-component-hints.json");
    writeFileSync(
      hintsFile,
      JSON.stringify({ "site/components/container": ["cq:panelTitle"] }),
    );

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

    const clean = JSON.parse(
      readFileSync(join(outputDir, "cache", "clean", "content", "site", "tabs-page.json"), "utf8"),
    ) as { docs: Array<{ pageBuilder: Block[] }> };
    // Root layout container flattens, so tabs is the lone top-level block.
    assert.deepEqual(clean.docs[0]!.pageBuilder.map((b) => b._type), ["tabs"]);
    tabs = clean.docs[0]!.pageBuilder[0]!;
  });

  after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("keeps panel containers as blocks with lifted panelTitle, in order", () => {
    assert.deepEqual(
      tabs.items!.map((b) => ({ _type: b._type, panelTitle: b.panelTitle })),
      [
        { _type: "container", panelTitle: "First tab" },
        { _type: "container", panelTitle: "Second tab" },
      ],
    );
  });

  it("still flattens title-less layout containers inside a panel", () => {
    const first = tabs.items![0]!;
    assert.deepEqual(
      first.items!.map((b) => ({ _type: b._type, text: b.text })),
      [{ _type: "text", text: "first tab body" }],
    );
  });

  it("preserves nested tabs recursively", () => {
    const second = tabs.items![1]!;
    assert.deepEqual(second.items!.map((b) => b._type), ["tabs"]);
    const inner = second.items![0]!.items![0]!;
    assert.equal(inner._type, "container");
    assert.equal(inner.panelTitle, "Inner tab");
    assert.deepEqual(
      inner.items!.map((b) => ({ _type: b._type, text: b.text })),
      [{ _type: "text", text: "inner tab body" }],
    );
  });
});
