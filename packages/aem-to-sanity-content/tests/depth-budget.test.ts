import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Integration test: documents that would exceed Sanity's hard 20-level
 * attribute-depth limit (import rejects the whole doc) are repaired
 * LOSSLESSLY — the deepest chain is cut into a standalone `contentFragment`
 * document (written into the same clean file, imported in the same
 * transaction) and a `contentFragmentRef` block takes its place. No panel
 * titles or structure are lost; each cut is reported under
 * `depthExtractedFragments`.
 *
 * Fixture: five levels of tabs → titled panel → tabs → … with a text block
 * at the bottom. Each tabs+panel pair costs 4 attribute levels, so the raw
 * doc measures 24 — over budget, forcing at least one cut.
 */

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const transformTs = fileURLToPath(new URL("../src/transform.ts", import.meta.url));

const NEST = 5;

function nestedTabs(level: number): Record<string, unknown> {
  const panelChildren: Record<string, unknown> =
    level < NEST
      ? { tabs: nestedTabs(level + 1) }
      : {
          text: {
            "jcr:primaryType": "nt:unstructured",
            "sling:resourceType": "site/components/text",
            text: "bottom",
          },
        };
  return {
    "jcr:primaryType": "nt:unstructured",
    "sling:resourceType": "site/components/tabs",
    item_1: {
      "jcr:primaryType": "nt:unstructured",
      "sling:resourceType": "site/components/container",
      "cq:panelTitle": `Level ${level}`,
      ...panelChildren,
    },
  };
}

function rawPage(): unknown {
  return {
    jcrPath: "/content/site/deep-page",
    slug: "deep-page",
    relativePath: "deep-page",
    fetchedAt: "2026-01-01T00:00:00.000Z",
    tree: {
      "jcr:primaryType": "cq:Page",
      "jcr:content": {
        "jcr:primaryType": "cq:PageContent",
        "sling:resourceType": "site/structure/page",
        "cq:template": "/conf/site/settings/wcm/templates/basic",
        "jcr:title": "Deep Page",
        root: { "jcr:primaryType": "nt:unstructured", tabs: nestedTabs(1) },
      },
    },
  };
}

function jsonDepth(v: unknown): number {
  if (Array.isArray(v)) return 1 + Math.max(0, ...v.map(jsonDepth));
  if (v !== null && typeof v === "object")
    return 1 + Math.max(0, ...Object.values(v as Record<string, unknown>).map(jsonDepth));
  return 0;
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

describe("attribute-depth budget: deep subtrees cut into contentFragment docs", () => {
  let tmp: string;
  let outputDir: string;
  let docs: Doc[];
  let doc: Doc;
  let report: {
    depthExtractedFragments: Array<{ path: string; fragmentId: string; title: string }>;
    depthFlattenedPanels: Array<{ path: string; panelTitle: string }>;
  };

  before(() => {
    tmp = mkdtempSync(join(tmpdir(), "aem-transform-depth-"));
    outputDir = join(tmp, "output");
    const contentDir = join(outputDir, "cache", "aem", "content", "content", "site");
    mkdirSync(contentDir, { recursive: true });
    writeFileSync(join(contentDir, "deep-page.json"), JSON.stringify(rawPage(), null, 2));

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
        readFileSync(join(outputDir, "cache", "clean", "content", "site", "deep-page.json"), "utf8"),
      ) as { docs: Doc[] }
    ).docs;
    doc = docs[0]!;
    report = JSON.parse(
      readFileSync(join(outputDir, "cache", "transform-report.json"), "utf8"),
    ) as typeof report;
  });

  after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("keeps every emitted doc at or under 20 attribute levels", () => {
    for (const d of docs) {
      assert.ok(jsonDepth(d) <= 20, `${d._id}: depth ${jsonDepth(d)} > 20`);
    }
  });

  it("writes contentFragment docs alongside the page and reports each cut", () => {
    const fragments = docs.filter((d) => d._type === "contentFragment");
    assert.ok(fragments.length >= 1);
    assert.equal(report.depthExtractedFragments.length, fragments.length);
    assert.deepEqual(
      report.depthExtractedFragments.map((f) => f.fragmentId).sort(),
      fragments.map((f) => f._id).sort(),
    );
    // Lossless repair — the lossy fallback must not have fired.
    assert.deepEqual(report.depthFlattenedPanels, []);
  });

  it("replaces the cut subtree with a contentFragmentRef pointing at the fragment", () => {
    const refs: Block[] = [];
    const walk = (b: Block): void => {
      if (b._type === "contentFragmentRef") refs.push(b);
      for (const c of b.items ?? []) walk(c);
    };
    for (const b of doc.pageBuilder!) walk(b);
    assert.equal(refs.length, docs.filter((d) => d._type === "contentFragment").length);
    for (const ref of refs) {
      assert.equal(ref.fragment!._type, "reference");
      assert.ok(docs.some((d) => d._id === ref.fragment!._ref));
    }
  });

  it("loses nothing: every panel title and the bottom text survive across the docs", () => {
    const all = JSON.stringify(docs);
    for (let level = 1; level <= NEST; level++) {
      assert.ok(all.includes(`"Level ${level}"`), `Level ${level} missing`);
    }
    assert.ok(all.includes('"bottom"'));
    // The outermost panel is untouched on the page doc itself.
    const outer = doc.pageBuilder![0]!.items![0]!;
    assert.equal(outer._type, "container");
    assert.equal(outer.panelTitle, "Level 1");
  });
});
