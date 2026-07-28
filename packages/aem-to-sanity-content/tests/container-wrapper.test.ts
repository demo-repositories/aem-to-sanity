import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Integration test: the "wrapper" container pattern — a styled container
 * component that carries its own dialog fields (responsive layout config:
 * per-breakpoint height, margins, spacing, …) around a drop zone. Registered
 * as a NON-flatten entry in `aem-component-containers.json`, it must:
 *
 *   1. keep its own block (`_type` + dialog fields, with type coercion),
 *   2. collect its drop-zone children into `childrenField`,
 *   3. collapse a nested `flatten: true` layout container transparently —
 *      the wrapper's items are the layout container's children, not a
 *      container block,
 *   4. emit an empty array for a childless wrapper (stable shape), and
 *   5. keep pure-layout `flatten` containers hoisting into the parent array.
 *
 * Runs the real CLI as a subprocess (transform.ts executes `main()` at module
 * top level, so it can't be imported directly), same harness as
 * child-page-boundary.test.ts.
 */

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const transformTs = fileURLToPath(new URL("../src/transform.ts", import.meta.url));

function rawPage(): unknown {
  const textBlock = (text: string) => ({
    "jcr:primaryType": "nt:unstructured",
    "sling:resourceType": "site/components/text",
    text,
  });
  return {
    jcrPath: "/content/site/wrapper-page",
    slug: "wrapper-page",
    relativePath: "wrapper-page",
    fetchedAt: "2026-01-01T00:00:00.000Z",
    tree: {
      "jcr:primaryType": "cq:Page",
      "jcr:content": {
        "jcr:primaryType": "cq:PageContent",
        "sling:resourceType": "site/structure/page",
        "cq:template": "/conf/site/settings/wcm/templates/basic",
        "jcr:title": "Wrapper Page",
        root: {
          "jcr:primaryType": "nt:unstructured",
          // Pure-layout container (flatten: true) — hoists into the page's
          // pageBuilder, so the wrappers below surface as top-level blocks.
          "sling:resourceType": "site/components/container",
          // Wrapper whose drop zone is an AEM responsive-grid container:
          // wrapper → container (flatten) → children. The container must
          // collapse into the wrapper's `items`.
          wrapper_grid: {
            "jcr:primaryType": "nt:unstructured",
            "sling:resourceType": "site/components/wrapper",
            marginTop: "mt-2",
            mobileheightValue: "2000",
            inheritTablet: "true",
            container: {
              "jcr:primaryType": "nt:unstructured",
              "sling:resourceType": "site/components/container",
              // Layout-only nt:unstructured node (responsive-grid shape) —
              // descended through transparently.
              grid_layout: {
                "jcr:primaryType": "nt:unstructured",
                text_a: textBlock("inside grid a"),
                text_b: textBlock("inside grid b"),
              },
            },
          },
          // Wrapper with direct drop-zone children (no intermediate
          // container node).
          wrapper_direct: {
            "jcr:primaryType": "nt:unstructured",
            "sling:resourceType": "site/components/wrapper",
            marginTop: "mt-4",
            text: textBlock("direct child"),
          },
          // Childless wrapper — items must still be present (empty array).
          wrapper_empty: {
            "jcr:primaryType": "nt:unstructured",
            "sling:resourceType": "site/components/wrapper",
            marginTop: "mt-0",
          },
        },
      },
    },
  };
}

interface Block {
  _type: string;
  _key: string;
  text?: string;
  marginTop?: string;
  mobileheightValue?: number;
  inheritTablet?: boolean;
  items?: Block[];
}

describe("wrapper containers keep their fields and collect children", () => {
  let tmp: string;
  let outputDir: string;
  let doc: { _type: string; pageBuilder: Block[] };

  before(() => {
    tmp = mkdtempSync(join(tmpdir(), "aem-transform-wrapper-"));
    outputDir = join(tmp, "output");
    const contentDir = join(outputDir, "cache", "aem", "content", "content", "site");
    mkdirSync(contentDir, { recursive: true });
    writeFileSync(join(contentDir, "wrapper-page.json"), JSON.stringify(rawPage(), null, 2));

    const registryFile = join(tmp, "content-type-registry.json");
    writeFileSync(
      registryFile,
      JSON.stringify({
        entries: [
          {
            resourceType: "site/components/text",
            sanityType: "text",
            fields: [{ name: "text", type: "string" }],
          },
          {
            resourceType: "site/components/container",
            sanityType: "container",
            fields: [{ name: "items", type: "container-children" }],
          },
          {
            resourceType: "site/components/wrapper",
            sanityType: "wrapper",
            fields: [
              { name: "marginTop", type: "string" },
              { name: "mobileheightValue", type: "number" },
              { name: "inheritTablet", type: "boolean" },
              { name: "items", type: "container-children" },
            ],
          },
          {
            resourceType: "site/structure/page",
            sanityType: "sitePage",
            fields: [],
          },
        ],
      }),
    );

    const containersFile = join(tmp, "aem-component-containers.json");
    writeFileSync(
      containersFile,
      JSON.stringify({
        "site/components/container": { childrenField: "items", flatten: true },
        "site/components/wrapper": { childrenField: "items" },
      }),
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
    execFileSync(
      process.execPath,
      ["--import", "tsx", transformTs, "--registry", registryFile],
      { cwd: packageDir, env, stdio: "pipe" },
    );

    const clean = JSON.parse(
      readFileSync(
        join(outputDir, "cache", "clean", "content", "site", "wrapper-page.json"),
        "utf8",
      ),
    ) as { docs: Array<{ _type: string; pageBuilder: Block[] }> };
    assert.equal(clean.docs.length, 1);
    doc = clean.docs[0]!;
  });

  after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("hoists the flattened root container so wrappers are top-level blocks", () => {
    assert.deepEqual(
      doc.pageBuilder.map((b) => b._type),
      ["wrapper", "wrapper", "wrapper"],
    );
  });

  it("keeps the wrapper's own dialog fields with type coercion", () => {
    const [grid] = doc.pageBuilder;
    assert.equal(grid!.marginTop, "mt-2");
    assert.equal(grid!.mobileheightValue, 2000);
    assert.equal(grid!.inheritTablet, true);
  });

  it("collapses a nested flatten container into the wrapper's items", () => {
    const [grid] = doc.pageBuilder;
    assert.deepEqual(
      grid!.items!.map((b) => ({ _type: b._type, text: b.text })),
      [
        { _type: "text", text: "inside grid a" },
        { _type: "text", text: "inside grid b" },
      ],
    );
  });

  it("collects direct drop-zone children into items", () => {
    const direct = doc.pageBuilder[1]!;
    assert.equal(direct.marginTop, "mt-4");
    assert.deepEqual(
      direct.items!.map((b) => ({ _type: b._type, text: b.text })),
      [{ _type: "text", text: "direct child" }],
    );
  });

  it("emits an empty items array for a childless wrapper", () => {
    const empty = doc.pageBuilder[2]!;
    assert.equal(empty.marginTop, "mt-0");
    assert.deepEqual(empty.items, []);
  });
});
