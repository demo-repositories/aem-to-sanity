import type { AuthMode, Config } from "../config/schema.ts";
import type { Logger } from "../logger.ts";
import { DialogNodeSchema, type DialogNode } from "./dialog-types.ts";

export type AemFetchErrorKind =
  | "network"
  | "auth"
  | "parseError"
  | "tooLarge";

export class AemFetchError extends Error {
  constructor(
    public readonly kind: AemFetchErrorKind,
    message: string,
    public readonly details?: { status?: number; bodyExcerpt?: string },
  ) {
    super(message);
    this.name = "AemFetchError";
  }
}

export interface FetchDeps {
  config: Config;
  fetch?: typeof globalThis.fetch;
  logger?: Logger;
}

/**
 * Details of an HTTP 300 resolution. Sling returns 300 when a path can be
 * served at multiple suffixes — typically `.0.json`, `.1.json`, …, `.5.json`.
 * We pick the highest depth because that gives us the most content per call,
 * equivalent to `.infinity.json` up to the AEM depth-5 cap. The caller is
 * expected to log these for careful review — the resolved subtree may still
 * have truncation markers that a deeper suffix would have resolved.
 */
export interface AmbiguousResolution {
  /** The JCR path that returned 300. */
  jcrPath: string;
  /** The original `.infinity.json` URL we asked for. */
  originalUrl: string;
  /** The URL we ultimately fetched. */
  chosenUrl: string;
  /** The depth suffix we picked (e.g. `5` from `.5.json`). */
  chosenDepth: number;
  /** All alternative suffixes AEM offered. */
  alternatives: Array<{ url: string; depth: number }>;
}

export interface FetchInfinityOptions {
  /** Notified when a 300 is resolved via `.N.json` fallback. */
  onAmbiguous?: (resolution: AmbiguousResolution) => void;
  /**
   * Hard cap on response body size, in bytes (decompressed). Pages that
   * exceed this are aborted mid-read with a `tooLarge` error — the walker
   * catches it and skips the root. AEM can produce multi-hundred-MB
   * `.infinity.json` responses on over-authored pages; letting V8 try to
   * `JSON.parse` one is a guaranteed heap OOM. Default: 100 MB.
   */
  maxResponseBytes?: number;
}

const DEFAULT_MAX_RESPONSE_BYTES = 100 * 1024 * 1024;

function authHeader(auth: AuthMode): string {
  if (auth.kind === "bearer") return `Bearer ${auth.token}`;
  const raw = `${auth.username}:${auth.password}`;
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

/**
 * Fetch a JCR path as `.infinity.json`. The generic `parse` parameter lets
 * callers validate/shape the response (e.g. the schema package passes
 * `DialogNodeSchema.parse`); the default is the identity parse.
 *
 * Throws {@link AemFetchError}. `kind: "auth"` signals a non-recoverable
 * credential failure — callers should abort any batch rather than retry.
 *
 * HTTP 300 handling: when Sling can't pick a single representation, it
 * returns a list of `.N.json` alternatives. We auto-retry with the highest
 * N (most content per call) and notify `opts.onAmbiguous` so callers can
 * log these for careful review.
 */
export async function fetchInfinityJson<T = unknown>(
  deps: FetchDeps,
  jcrPath: string,
  parse?: (raw: unknown) => T,
  opts?: FetchInfinityOptions,
): Promise<T> {
  const { config, logger } = deps;
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const originalUrl = `${config.baseUrl}${jcrPath}.infinity.json`;

  logger?.debug(`GET ${originalUrl}`);

  const first = await doFetch(fetchImpl, originalUrl, config.auth);

  if (first.status === 300) {
    // Consume the body once — Sling returns HTML listing the variants.
    const body = await first.res.text();
    const alternatives = parseSlingAlternatives(body, config.baseUrl, jcrPath);
    if (alternatives.length === 0) {
      throw new AemFetchError(
        "network",
        `HTTP 300 fetching ${originalUrl} but no \`.N.json\` alternatives could be parsed from body`,
        { status: 300, bodyExcerpt: body.slice(0, 500) },
      );
    }
    const chosen = alternatives.reduce((a, b) =>
      b.depth > a.depth ? b : a,
    );
    logger?.debug(
      `HTTP 300 at ${originalUrl} — retrying with ${chosen.url} (depth ${chosen.depth})`,
    );
    opts?.onAmbiguous?.({
      jcrPath,
      originalUrl,
      chosenUrl: chosen.url,
      chosenDepth: chosen.depth,
      alternatives,
    });
    const second = await doFetch(fetchImpl, chosen.url, config.auth);
    return parseResponse(second.res, chosen.url, parse, opts?.maxResponseBytes);
  }

  return parseResponse(first.res, originalUrl, parse, opts?.maxResponseBytes);
}

async function doFetch(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  auth: AuthMode,
): Promise<{ res: Response; status: number }> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: {
        Authorization: authHeader(auth),
        Accept: "application/json",
        Cookie: "cq-authoring-mode=TOUCH",
      },
    });
  } catch (err) {
    throw new AemFetchError(
      "network",
      `Network error fetching ${url}: ${(err as Error).message}`,
    );
  }
  return { res, status: res.status };
}

async function parseResponse<T>(
  res: Response,
  url: string,
  parse?: (raw: unknown) => T,
  maxResponseBytes?: number,
): Promise<T> {
  if (res.status === 401 || res.status === 403) {
    throw new AemFetchError(
      "auth",
      `Authentication failed (${res.status}) for ${url}`,
      { status: res.status },
    );
  }

  if (!res.ok) {
    const bodyExcerpt = (await res.text()).slice(0, 500);
    throw new AemFetchError("network", `HTTP ${res.status} fetching ${url}`, {
      status: res.status,
      bodyExcerpt,
    });
  }

  const text = await readTextWithCap(
    res,
    url,
    maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
  );
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new AemFetchError(
      "parseError",
      `Response is not valid JSON: ${(err as Error).message}`,
      { bodyExcerpt: text.slice(0, 500) },
    );
  }

  if (!parse) return raw as T;
  try {
    return parse(raw);
  } catch (err) {
    throw new AemFetchError(
      "parseError",
      `Response shape did not validate: ${(err as Error).message}`,
      { bodyExcerpt: text.slice(0, 500) },
    );
  }
}

/**
 * Stream the response body, aborting with {@link AemFetchError} `tooLarge`
 * once accumulated bytes exceed the cap. Catches the pathological case of a
 * single AEM page returning hundreds of MB of JSON — without this guard the
 * whole response reaches `JSON.parse`, which OOMs the V8 heap before the
 * walker gets a chance to skip.
 */
async function readTextWithCap(
  res: Response,
  url: string,
  maxBytes: number,
): Promise<string> {
  const body = res.body;
  if (!body) return res.text();
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new AemFetchError(
        "tooLarge",
        `Response from ${url} is too large: exceeded ${formatBytes(maxBytes)} cap (aborted after ${formatBytes(total)})`,
      );
    }
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

/**
 * Parse the HTML body of a Sling 300 response to extract `.N.json`
 * alternatives. Sling lists each variant as a link, e.g.
 *   <a href="/content/site/page.5.json">/content/site/page.5.json</a>
 *
 * We match `.<digit>.json` occurrences anchored to the requested jcrPath so
 * we don't pick up unrelated links on the page.
 */
function parseSlingAlternatives(
  body: string,
  baseUrl: string,
  jcrPath: string,
): Array<{ url: string; depth: number }> {
  const seen = new Map<number, string>();
  // Escape regex specials in jcrPath — paths commonly contain `-` etc., safe,
  // but `.` and `/` are not. Anchor on the path so noise elsewhere is ignored.
  const escaped = jcrPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escaped}\\.(\\d+)\\.json`, "g");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    const depth = Number(match[1]);
    if (!Number.isFinite(depth)) continue;
    if (seen.has(depth)) continue;
    seen.set(depth, `${baseUrl}${jcrPath}.${depth}.json`);
  }
  return [...seen.entries()]
    .map(([depth, url]) => ({ depth, url }))
    .sort((a, b) => a.depth - b.depth);
}

/**
 * Convenience helper for the schema package: fetches the `_cq_dialog` of an
 * AEM component and validates it against {@link DialogNodeSchema}.
 */
export function fetchComponentDialog(
  deps: FetchDeps,
  componentPath: string,
): Promise<DialogNode> {
  return fetchInfinityJson(deps, `${componentPath}/_cq_dialog`, (raw) => {
    const parsed = DialogNodeSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      );
    }
    return parsed.data;
  });
}
