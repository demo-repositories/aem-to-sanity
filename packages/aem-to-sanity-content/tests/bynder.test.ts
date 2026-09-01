import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bynderAssetValue,
  findBynderMediaByAemPath,
  resolveBynderConfig,
  type BynderConfig,
  type BynderMedia,
} from "../src/bynder.ts";

const CFG: BynderConfig = {
  baseUrl: "https://acme.bynder.com",
  token: "tok",
  aemPathProperty: "aemDamPath",
};

const DAM = "/content/dam/site/hero.jpg";

function media(overrides: Partial<BynderMedia> & Record<string, unknown> = {}): BynderMedia {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    name: "hero",
    type: "image",
    width: 1200,
    height: 600,
    thumbnails: { webimage: "https://acme.bynder.com/m/abc/webimage-hero.jpg" },
    property_aemDamPath: DAM,
    ...overrides,
  };
}

/** fetch stub keyed on query-string content; records requested URLs. */
function fetchStub(
  routes: Array<{ match: (url: string) => boolean; body: unknown; status?: number }>,
  calls: string[] = [],
): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const route = routes.find((r) => r.match(url));
    if (!route) throw new Error(`no stub for ${url}`);
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

describe("resolveBynderConfig", () => {
  it("reads the three vars and strips the trailing slash", () => {
    const cfg = resolveBynderConfig({
      BYNDER_BASE_URL: "https://acme.bynder.com/",
      BYNDER_TOKEN: "tok",
      BYNDER_AEM_PATH_PROPERTY: "aemDamPath",
    } as NodeJS.ProcessEnv);
    assert.deepEqual(cfg, CFG);
  });

  it("lists every missing var in one error", () => {
    assert.throws(
      () => resolveBynderConfig({} as NodeJS.ProcessEnv),
      (err: Error) =>
        err.message.includes("BYNDER_BASE_URL") &&
        err.message.includes("BYNDER_TOKEN") &&
        err.message.includes("BYNDER_AEM_PATH_PROPERTY"),
    );
  });

  it("rejects a metaproperty name that can't be a query parameter", () => {
    assert.throws(
      () =>
        resolveBynderConfig({
          BYNDER_BASE_URL: "https://acme.bynder.com",
          BYNDER_TOKEN: "tok",
          BYNDER_AEM_PATH_PROPERTY: "aem path",
        } as NodeJS.ProcessEnv),
      /not a valid Bynder metaproperty name/,
    );
  });

  it("rejects a bare hostname base URL", () => {
    assert.throws(
      () =>
        resolveBynderConfig({
          BYNDER_BASE_URL: "acme.bynder.com",
          BYNDER_TOKEN: "tok",
          BYNDER_AEM_PATH_PROPERTY: "aemDamPath",
        } as NodeJS.ProcessEnv),
      /must be a full origin/,
    );
  });
});

describe("bynderAssetValue", () => {
  it("maps a v4 media object onto the sanity-plugin-bynder-input shape", () => {
    const value = bynderAssetValue(media({ description: "Hero image" }));
    assert.deepEqual(value, {
      _type: "bynder.asset",
      id: "11111111-2222-3333-4444-555555555555",
      databaseId: "11111111-2222-3333-4444-555555555555",
      name: "hero",
      type: "IMAGE",
      description: "Hero image",
      previewUrl: "https://acme.bynder.com/m/abc/webimage-hero.jpg",
      previewImg: "https://acme.bynder.com/m/abc/webimage-hero.jpg",
      width: 1200,
      height: 600,
      aspectRatio: 0.5,
    });
  });

  it("prefers the video preview URL for videos", () => {
    const value = bynderAssetValue(
      media({
        type: "video",
        videoPreviewURLs: ["https://acme.bynder.com/v/preview.mp4"],
      }),
    );
    assert.equal(value.type, "VIDEO");
    assert.equal(value.previewUrl, "https://acme.bynder.com/v/preview.mp4");
    assert.equal(value.videoUrl, "https://acme.bynder.com/v/preview.mp4");
  });

  it("omits absent fields instead of persisting undefined", () => {
    const value = bynderAssetValue({ id: "x" });
    assert.deepEqual(value, { _type: "bynder.asset", id: "x", databaseId: "x" });
  });
});

describe("findBynderMediaByAemPath", () => {
  it("resolves via the property_<name> filter with an exact client-side match", async () => {
    const calls: string[] = [];
    const fetchFn = fetchStub(
      [
        {
          match: (u) => u.includes("property_aemDamPath="),
          // Server-side filter can be fuzzy: include a near-miss.
          body: [media({ id: "b", property_aemDamPath: `${DAM}.renditions` }), media({ id: "a" })],
        },
      ],
      calls,
    );
    const hit = await findBynderMediaByAemPath(CFG, DAM, fetchFn);
    assert.equal(hit?.media.id, "a");
    assert.equal(hit?.matches, 1);
    assert.equal(calls.length, 1);
    assert.match(calls[0]!, /^https:\/\/acme\.bynder\.com\/api\/v4\/media\/\?/);
    assert.ok(calls[0]!.includes(`property_aemDamPath=${encodeURIComponent(DAM)}`));
  });

  it("accepts array-valued metaproperty echoes", async () => {
    const fetchFn = fetchStub([
      {
        match: (u) => u.includes("property_aemDamPath="),
        body: [media({ property_aemDamPath: ["/content/dam/other.jpg", DAM] })],
      },
    ]);
    const hit = await findBynderMediaByAemPath(CFG, DAM, fetchFn);
    assert.ok(hit);
  });

  it("falls back to keyword search when the property filter returns nothing", async () => {
    const calls: string[] = [];
    const fetchFn = fetchStub(
      [
        { match: (u) => u.includes("property_aemDamPath="), body: [] },
        { match: (u) => u.includes("keyword="), body: [media()] },
      ],
      calls,
    );
    const hit = await findBynderMediaByAemPath(CFG, DAM, fetchFn);
    assert.ok(hit);
    assert.equal(calls.length, 2);
  });

  it("returns null when nothing matches exactly", async () => {
    const fetchFn = fetchStub([
      { match: (u) => u.includes("property_aemDamPath="), body: [] },
      { match: (u) => u.includes("keyword="), body: [media({ property_aemDamPath: "/content/dam/other.jpg" })] },
    ]);
    assert.equal(await findBynderMediaByAemPath(CFG, DAM, fetchFn), null);
  });

  it("picks the newest asset deterministically when several match, and reports the count", async () => {
    const fetchFn = fetchStub([
      {
        match: (u) => u.includes("property_aemDamPath="),
        body: [
          media({ id: "old", dateModified: "2024-01-01T00:00:00Z" }),
          media({ id: "new", dateModified: "2025-01-01T00:00:00Z" }),
        ],
      },
    ]);
    const hit = await findBynderMediaByAemPath(CFG, DAM, fetchFn);
    assert.equal(hit?.media.id, "new");
    assert.equal(hit?.matches, 2);
  });

  it("throws with status + body excerpt on an HTTP error", async () => {
    const fetchFn = fetchStub([
      { match: () => true, body: { message: "nope" }, status: 401 },
    ]);
    await assert.rejects(
      findBynderMediaByAemPath(CFG, DAM, fetchFn),
      /Bynder search HTTP 401/,
    );
  });
});
