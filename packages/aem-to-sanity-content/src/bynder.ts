/**
 * Bynder asset resolution for `aem-assets` (`MIGRATION_ASSET_BACKEND=bynder`).
 *
 * Assumes assets were already migrated into the Bynder portal out-of-band,
 * each stamped with a metaproperty holding its legacy AEM DAM path
 * (`/content/dam/...`). This module resolves DAM paths to Bynder media via
 * `GET /api/v4/media/?property_<name>=<path>` and maps each hit onto the
 * value shape `sanity-plugin-bynder-input` persists (`_type: 'bynder.asset'`),
 * so rewritten fields render in the plugin's Studio input.
 *
 * API surface used (https://api.bynder.com/):
 *   - `GET /api/v4/media/` — asset search; `property_<NAME>` filters by
 *     metaproperty value, `keyword` free-text search. Auth: `Authorization:
 *     Bearer <permanent or OAuth2 token>` against the per-account portal
 *     domain.
 *   - `GET /api/1/taxonomy/metaproperties` — metaproperty definitions, used
 *     only for a best-effort startup warning when the configured property
 *     name doesn't exist.
 */
import { BYNDER_ASSET_TYPE_NAME } from "aem-to-sanity-core";

export interface BynderConfig {
  /** Portal origin, e.g. `https://acme.bynder.com` (no trailing slash). */
  baseUrl: string;
  /** Permanent token or OAuth2 access token, sent as `Authorization: Bearer`. */
  token: string;
  /** Metaproperty name that stores each asset's legacy AEM DAM path. */
  aemPathProperty: string;
}

/** Metaproperty names land in a query-parameter name (`property_<NAME>`). */
const METAPROPERTY_NAME_RE = /^[A-Za-z0-9_]+$/;

/**
 * Read + validate the Bynder env surface. Throws with an actionable message
 * (all missing vars at once) — the assets CLI turns that into `exit 2`.
 */
export function resolveBynderConfig(
  env: NodeJS.ProcessEnv = process.env,
): BynderConfig {
  const baseUrl = env.BYNDER_BASE_URL?.trim();
  const token = env.BYNDER_TOKEN?.trim();
  const aemPathProperty = env.BYNDER_AEM_PATH_PROPERTY?.trim();
  const missing = [
    !baseUrl && "BYNDER_BASE_URL (portal origin, e.g. https://acme.bynder.com)",
    !token && "BYNDER_TOKEN (permanent token or OAuth2 access token)",
    !aemPathProperty &&
      "BYNDER_AEM_PATH_PROPERTY (metaproperty name holding the legacy AEM DAM path)",
  ].filter((m): m is string => Boolean(m));
  if (missing.length > 0) {
    throw new Error(
      `MIGRATION_ASSET_BACKEND=bynder needs:\n${missing.map((m) => `  - ${m}`).join("\n")}`,
    );
  }
  if (!/^https?:\/\//.test(baseUrl!)) {
    throw new Error(
      `BYNDER_BASE_URL="${baseUrl}" must be a full origin (https://<portal>.bynder.com).`,
    );
  }
  if (!METAPROPERTY_NAME_RE.test(aemPathProperty!)) {
    throw new Error(
      `BYNDER_AEM_PATH_PROPERTY="${aemPathProperty}" is not a valid Bynder metaproperty name — letters, digits, and underscores only (it becomes the property_<NAME> search parameter).`,
    );
  }
  return {
    baseUrl: baseUrl!.replace(/\/+$/, ""),
    token: token!,
    aemPathProperty: aemPathProperty!,
  };
}

/**
 * Media object from `GET /api/v4/media/`. Only the fields we read are
 * declared; custom metaproperty values surface as `property_<name>` keys.
 */
export interface BynderMedia {
  id: string;
  name?: string;
  type?: string;
  description?: string;
  width?: number;
  height?: number;
  /** Derivative URLs keyed by name — `webimage`, `thul`, `mini`, ... */
  thumbnails?: Record<string, string>;
  /** Dynamic Asset Transformation base URL (only when DAT is enabled). */
  transformBaseUrl?: string;
  videoPreviewURLs?: string[];
  /** Original binary URL (public assets only). */
  original?: string;
  dateModified?: string;
  [key: string]: unknown;
}

/**
 * Map a v4 media object onto the persisted value shape of
 * `sanity-plugin-bynder-input`'s `bynder.asset` type, so the Studio input
 * renders migrated fields exactly like picker-selected ones.
 *
 * Two deliberate deviations from a Compact-View selection (both documented
 * in the mapping doc): `id` is the v4 media UUID rather than the Compact
 * View GraphQL id (the API doesn't expose the latter; `databaseId` — the
 * field frontends should key on — is the same UUID either way), and
 * `width`/`height`/`aspectRatio` come from the original binary rather than
 * the `webimage` derivative.
 */
export function bynderAssetValue(media: BynderMedia): Record<string, unknown> {
  const webImage = media.thumbnails?.webimage;
  const isVideo = media.type?.toLowerCase() === "video";
  const videoUrl = isVideo
    ? (media.videoPreviewURLs?.[0] ?? media.original)
    : undefined;
  const width = typeof media.width === "number" ? media.width : undefined;
  const height = typeof media.height === "number" ? media.height : undefined;
  const value: Record<string, unknown> = {
    _type: BYNDER_ASSET_TYPE_NAME,
    id: media.id,
    databaseId: media.id,
    name: media.name,
    // The plugin persists the Compact View's uppercase type discriminator
    // ('IMAGE' | 'VIDEO' | 'DOCUMENT' | 'AUDIO') and renders previews off it.
    type: media.type?.toUpperCase(),
    description: media.description || undefined,
    previewUrl: isVideo ? (media.videoPreviewURLs?.[0] ?? webImage) : webImage,
    previewImg: webImage,
    datUrl: media.transformBaseUrl,
    videoUrl,
    width,
    height,
    // Plugin convention: height / width (see BynderInput's getAspectRatio).
    aspectRatio: width && height ? height / width : undefined,
  };
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

export interface BynderMatch {
  media: BynderMedia;
  /** How many assets carried the exact metaproperty value (1 = unambiguous). */
  matches: number;
}

const SEARCH_LIMIT = 100;

async function searchMedia(
  cfg: BynderConfig,
  params: Record<string, string>,
  fetchFn: typeof fetch,
): Promise<BynderMedia[]> {
  const qs = new URLSearchParams({ limit: String(SEARCH_LIMIT), ...params });
  const res = await fetchFn(`${cfg.baseUrl}/api/v4/media/?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${cfg.token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Bynder search HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const body = (await res.json()) as unknown;
  return Array.isArray(body) ? (body as BynderMedia[]) : [];
}

function propertyMatches(
  media: BynderMedia,
  propertyName: string,
  damPath: string,
): boolean {
  const v = media[`property_${propertyName}`];
  if (typeof v === "string") return v.trim() === damPath;
  if (Array.isArray(v)) {
    return v.some((x) => typeof x === "string" && x.trim() === damPath);
  }
  return false;
}

/**
 * Resolve one DAM path to its Bynder asset.
 *
 * Primary lookup filters server-side via `property_<name>=<damPath>`; because
 * that filter can behave fuzzily (and on some portals doesn't apply to
 * free-text metaproperties at all), every candidate is re-checked client-side
 * against the media object's echoed `property_<name>` value — only exact
 * (trimmed) matches count. When the filter returns nothing, a `keyword`
 * search runs as fallback with the same exact-match check.
 *
 * Ambiguity (several assets stamped with the same path) resolves to the most
 * recently modified asset, id as tiebreaker — deterministic across runs; the
 * caller surfaces `matches > 1` as a warning.
 */
export async function findBynderMediaByAemPath(
  cfg: BynderConfig,
  damPath: string,
  fetchFn: typeof fetch = fetch,
): Promise<BynderMatch | null> {
  const filtered = await searchMedia(
    cfg,
    { [`property_${cfg.aemPathProperty}`]: damPath },
    fetchFn,
  );
  let exact = filtered.filter((m) =>
    propertyMatches(m, cfg.aemPathProperty, damPath),
  );
  if (exact.length === 0) {
    const byKeyword = await searchMedia(cfg, { keyword: damPath }, fetchFn);
    exact = byKeyword.filter((m) =>
      propertyMatches(m, cfg.aemPathProperty, damPath),
    );
  }
  if (exact.length === 0) return null;
  exact.sort(
    (a, b) =>
      (b.dateModified ?? "").localeCompare(a.dateModified ?? "") ||
      a.id.localeCompare(b.id),
  );
  return { media: exact[0]!, matches: exact.length };
}

/**
 * Fail-fast auth/URL probe: one `limit=1` search. Throws with an actionable
 * message so the assets CLI can abort before looping over every DAM path.
 */
export async function checkBynderConnection(
  cfg: BynderConfig,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetchFn(`${cfg.baseUrl}/api/v4/media/?limit=1`, {
      headers: { Authorization: `Bearer ${cfg.token}` },
    });
  } catch (err) {
    throw new Error(
      `Cannot reach Bynder at ${cfg.baseUrl}: ${(err as Error).message} — check BYNDER_BASE_URL.`,
    );
  }
  if (!res.ok) {
    throw new Error(
      `Bynder rejected the connection check (HTTP ${res.status} on GET /api/v4/media/?limit=1) — check BYNDER_TOKEN (permanent token or OAuth2 access token with asset read scope) and BYNDER_BASE_URL.`,
    );
  }
}

/**
 * Best-effort startup check that the configured metaproperty exists —
 * a typo'd BYNDER_AEM_PATH_PROPERTY would otherwise just produce a 100%-miss
 * run. Returns a warning string (never throws): the taxonomy endpoint may be
 * unavailable to restricted tokens, and that must not block resolution.
 */
export async function metapropertyWarning(
  cfg: BynderConfig,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const res = await fetchFn(
      `${cfg.baseUrl}/api/1/taxonomy/metaproperties?limit=1000`,
      { headers: { Authorization: `Bearer ${cfg.token}` } },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      metaproperties?: Array<{ name?: string; metapropertyType?: string }>;
    };
    const props = body?.metaproperties;
    if (!Array.isArray(props) || props.length === 0) return null;
    const hit = props.find((p) => p.name === cfg.aemPathProperty);
    if (!hit) {
      return `Bynder metaproperty "${cfg.aemPathProperty}" not found among ${props.length} metaproperties — check BYNDER_AEM_PATH_PROPERTY (every lookup will miss).`;
    }
    return null;
  } catch {
    return null;
  }
}
