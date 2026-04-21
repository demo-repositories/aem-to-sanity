import type { AuthMode, Config } from "../config/schema.ts";
import type { Logger } from "../logger.ts";
import { DialogNodeSchema, type DialogNode } from "./dialog-types.ts";

export type AemFetchErrorKind = "network" | "auth" | "parseError";

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
 */
export async function fetchInfinityJson<T = unknown>(
  deps: FetchDeps,
  jcrPath: string,
  parse?: (raw: unknown) => T,
): Promise<T> {
  const { config, logger } = deps;
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const url = `${config.baseUrl}${jcrPath}.infinity.json`;

  logger?.debug(`GET ${url}`);

  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: {
        Authorization: authHeader(config.auth),
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

  const text = await res.text();
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
