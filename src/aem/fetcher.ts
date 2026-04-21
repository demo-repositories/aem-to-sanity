import type { AuthMode, Config } from "../config.ts";
import { DialogNodeSchema, type DialogNode } from "./types.ts";

export class AemFetchError extends Error {
  constructor(
    public readonly kind: "network" | "auth" | "parseError",
    message: string,
    public readonly details?: { status?: number; bodyExcerpt?: string },
  ) {
    super(message);
    this.name = "AemFetchError";
  }
}

function authHeader(auth: AuthMode): string {
  if (auth.kind === "bearer") return `Bearer ${auth.token}`;
  const raw = `${auth.username}:${auth.password}`;
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

export function fetchComponentDialog(
  config: Config,
  componentPath: string,
): Promise<DialogNode> {
  return fetchInfinityJson(config, `${componentPath}/_cq_dialog`);
}

/**
 * Fetch an arbitrary JCR path as `.infinity.json`. Used by the mapper to
 * resolve `sling:include` references that point at shared dialog fragments.
 */
export async function fetchInfinityJson(
  config: Config,
  jcrPath: string,
): Promise<DialogNode> {
  const url = `${config.baseUrl}${jcrPath}.infinity.json`;

  let res: Response;
  try {
    res = await fetch(url, {
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
    throw new AemFetchError("auth", `Authentication failed (${res.status}) for ${url}`, {
      status: res.status,
    });
  }

  if (!res.ok) {
    const bodyExcerpt = (await res.text()).slice(0, 500);
    throw new AemFetchError(
      "network",
      `HTTP ${res.status} fetching ${url}`,
      { status: res.status, bodyExcerpt },
    );
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

  const parsed = DialogNodeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AemFetchError(
      "parseError",
      `Response shape does not match expected dialog JSON: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
      { bodyExcerpt: text.slice(0, 500) },
    );
  }
  return parsed.data;
}
