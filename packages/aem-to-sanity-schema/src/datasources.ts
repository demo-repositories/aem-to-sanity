import type { DialogNode } from "aem-to-sanity-core";

/**
 * Option resolution for datasource-driven Granite selection widgets.
 *
 * AEM populates many selects / buttongroups / radiogroups from a
 * `datasource` child node instead of literal `items` — a server-side
 * servlet runs when the dialog renders. Over `.infinity.json` that
 * resolution never happens, so the widget node carries only the datasource
 * reference and the mapper would fall back to a plain field (value still
 * migrates; the dropdown affordance is lost).
 *
 * Two datasource families ARE resolvable offline, and this module handles
 * them:
 *
 * 1. **ACS Commons generic lists** — the datasource node carries the list
 *    page's JCR path; the options are plain content at
 *    `{path}/jcr:content/list` (children with `jcr:title` + `value`),
 *    fetchable with the same transport as every other dialog fetch.
 * 2. **Core Components policy datasources** (`allowedheadingelements`,
 *    the title component's `allowedtypes`) — the real option set comes
 *    from the template's content policy, which is per-instance (template +
 *    position) while the migration emits one schema per component type.
 *    Rather than reimplement policy lookup, we emit the servlet's
 *    no-policy default (h1–h6) — the same list AEM shows when no policy
 *    restricts the component. The policy may allow fewer values than we
 *    offer; the authored value always round-trips either way.
 *
 * Everything else (project-custom datasource servlets, Scene7 image
 * presets, language lists) stays a plain field — resolving those would
 * mean rendering the dialog HTML server-side, which is fragile and
 * needs per-instance content context. Operators can see each fallback in
 * `migration-report.json` under `unmapped` with reason
 * `datasource-unresolved`.
 */

export interface SelectOption {
  title: string;
  value: string;
}

export const ACS_GENERIC_LIST_DATASOURCE_RT =
  "acs-commons/components/utilities/genericlist/datasource";

const HEADING_OPTIONS: SelectOption[] = [
  { title: "H1", value: "h1" },
  { title: "H2", value: "h2" },
  { title: "H3", value: "h3" },
  { title: "H4", value: "h4" },
  { title: "H5", value: "h5" },
  { title: "H6", value: "h6" },
];

/**
 * Policy-driven core datasources → the servlet's no-policy default list.
 * Keyed by the datasource node's `sling:resourceType`.
 */
const STATIC_DATASOURCE_OPTIONS: Record<string, SelectOption[]> = {
  "core/wcm/components/commons/datasources/allowedheadingelements/v1":
    HEADING_OPTIONS,
  "core/wcm/components/title/v1/datasource/allowedtypes": HEADING_OPTIONS,
  "core/wcm/components/title/v2/datasource/allowedtypes": HEADING_OPTIONS,
};

/** Fetches `{jcrPath}.infinity.json` — same shape the mapper's fetcher has. */
type Fetcher = (jcrPath: string) => Promise<DialogNode>;

/**
 * Cache of resolved ACS generic lists, keyed by list path. One dialog
 * commonly references the same list from several fields (the wrapper
 * component reads `flex-align` from four breakpoint variants), so the
 * cache belongs to the mapping run — create one per `mapDialog` call.
 * Failed lookups cache as `undefined` so a missing list is fetched once,
 * not once per field.
 */
export type DatasourceCache = Map<string, SelectOption[] | undefined>;

export interface DatasourceResolution {
  options?: SelectOption[];
  /** Set when the node IS datasource-driven but couldn't be resolved. */
  unresolved?: {
    datasourceResourceType: string;
    detail: string;
  };
}

/**
 * Resolve options for a selection widget whose `items` are absent but which
 * carries a `datasource` child. Returns `{}` when the node isn't
 * datasource-driven at all.
 */
export async function resolveDatasourceOptions(
  node: DialogNode,
  fetcher: Fetcher,
  cache: DatasourceCache,
): Promise<DatasourceResolution> {
  const ds = node["datasource"];
  if (!ds || typeof ds !== "object" || Array.isArray(ds)) return {};
  const dsNode = ds as DialogNode;
  const rt = dsNode["sling:resourceType"];
  if (typeof rt !== "string" || rt.length === 0) return {};

  const staticOptions = STATIC_DATASOURCE_OPTIONS[rt];
  if (staticOptions) return { options: [...staticOptions] };

  if (rt === ACS_GENERIC_LIST_DATASOURCE_RT) {
    const path = dsNode["path"];
    if (typeof path !== "string" || !path.startsWith("/")) {
      return {
        unresolved: {
          datasourceResourceType: rt,
          detail: "generic-list datasource has no absolute `path`",
        },
      };
    }
    if (cache.has(path)) {
      const cached = cache.get(path);
      return cached
        ? { options: [...cached] }
        : {
            unresolved: {
              datasourceResourceType: rt,
              detail: `generic list ${path} unresolved (see earlier field)`,
            },
          };
    }
    try {
      const page = await fetcher(path);
      const options = extractGenericListOptions(page);
      if (options.length > 0) {
        cache.set(path, options);
        return { options: [...options] };
      }
      cache.set(path, undefined);
      return {
        unresolved: {
          datasourceResourceType: rt,
          detail: `generic list ${path} has no title/value items under jcr:content/list`,
        },
      };
    } catch (err) {
      cache.set(path, undefined);
      return {
        unresolved: {
          datasourceResourceType: rt,
          detail: `generic list ${path} fetch failed: ${(err as Error).message}`,
        },
      };
    }
  }

  return {
    unresolved: {
      datasourceResourceType: rt,
      detail:
        "datasource resolves server-side at dialog render time — options unavailable over .infinity.json",
    },
  };
}

/**
 * ACS generic list page → options. Canonical shape is a `cq:Page` whose
 * `jcr:content/list` children each carry `jcr:title` + `value`. Tolerant of
 * a `path` that already points at `jcr:content` (no nested `jcr:content`
 * child), and of item nodes using `text` instead of `jcr:title`.
 */
function extractGenericListOptions(page: DialogNode): SelectOption[] {
  const content = (page["jcr:content"] ?? page) as DialogNode;
  if (!content || typeof content !== "object") return [];
  const list = content["list"];
  if (!list || typeof list !== "object" || Array.isArray(list)) return [];
  const out: SelectOption[] = [];
  for (const child of Object.values(list as Record<string, unknown>)) {
    if (!child || typeof child !== "object" || Array.isArray(child)) continue;
    const c = child as DialogNode;
    const value = c["value"];
    if (typeof value !== "string") continue;
    const title = c["jcr:title"] ?? (c as Record<string, unknown>)["text"];
    out.push({ title: typeof title === "string" && title ? title : value, value });
  }
  return out;
}
