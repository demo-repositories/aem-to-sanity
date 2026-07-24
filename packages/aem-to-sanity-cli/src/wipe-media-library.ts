/**
 * Wipe EVERY asset from the configured Sanity Media Library. Intended for
 * test environments only — destructive, org-scoped, and NOT reversible.
 *
 * - Lists every `sanity.asset` parent and the `sanity.imageAsset`/
 *   `sanity.fileAsset` instances each one references.
 * - Deletes parents + instances via the ML mutate endpoint in batches.
 * - Dry-run by default. Pass `--confirm-delete` to actually delete.
 *
 * Env (loaded from the caller's cwd .env):
 *   SANITY_TOKEN              — user-scoped token with ML write access.
 *   SANITY_MEDIA_LIBRARY_ID   — the org-level ML id (e.g. `mlTnBiUKRzfi`).
 *   SANITY_API_VERSION        — optional. Defaults to 2025-02-19.
 *
 * Side effects not handled here:
 *   - Dataset-level "linked asset" docs created by `/assets/media-library-link`
 *     are NOT cleaned up. Run `aem-import` to re-hydrate, or delete them
 *     separately via `@sanity/client` if you want a full reset.
 *   - `output/cache/assets/manifest.json` will be stale after a wipe. Delete
 *     it (or `output/cache/`) before the next `aem-assets` run.
 */
import { config as loadDotenv } from "dotenv";

interface AssetRow {
  _id: string;
  instances?: string[];
}

export async function wipeMediaLibrary(args: string[]): Promise<void> {
  loadDotenv({ quiet: true });

  const mlId = process.env.SANITY_MEDIA_LIBRARY_ID;
  const token = process.env.SANITY_TOKEN;
  const apiVersion = process.env.SANITY_API_VERSION ?? "2025-02-19";
  const confirm = args.includes("--confirm-delete");
  const BATCH = 50;

  if (!mlId || !token) {
    console.error("Missing SANITY_MEDIA_LIBRARY_ID or SANITY_TOKEN in env");
    process.exit(2);
  }

  async function listAssets(): Promise<AssetRow[]> {
    const url = `https://api.sanity.io/v${apiVersion}/media-libraries/${mlId}/query`;
    // `sanity.asset` is the parent; instances (`sanity.imageAsset` / `sanity.fileAsset`)
    // are what the parent references — same direction `lookupExistingAsset` uses
    // in the aem-assets pipeline.
    const query = `*[_type == 'sanity.asset']{
      _id,
      "instances": *[_type in ['sanity.imageAsset', 'sanity.fileAsset'] && references(^._id)]._id
    }`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`query failed: HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
    const body = (await res.json()) as { result?: AssetRow[] };
    return body.result ?? [];
  }

  async function deleteBatch(ids: string[]): Promise<void> {
    const url = `https://api.sanity.io/v${apiVersion}/media-libraries/${mlId}/mutate`;
    const mutations = ids.map((id) => ({ delete: { id } }));
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ mutations }),
    });
    if (!res.ok) throw new Error(`delete failed: HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }

  console.error(`Target Media Library: ${mlId}`);
  console.error(`API version:          ${apiVersion}`);
  console.error(`Mode:                 ${confirm ? "DELETE" : "DRY RUN"}`);
  console.error("────────────────────────────────────────");

  const assets = await listAssets();
  const parentIds = assets.map((a) => a._id);
  const instanceIds = assets.flatMap((a) => a.instances ?? []);
  const allIds = [...parentIds, ...instanceIds];

  console.error(
    `Parents:   ${parentIds.length}\nInstances: ${instanceIds.length}\nTotal:     ${allIds.length}`,
  );

  if (allIds.length === 0) {
    console.error("\nNothing to delete.");
    return;
  }

  if (!confirm) {
    console.error("\nDRY RUN — first 10 ids that would be deleted:");
    for (const id of allIds.slice(0, 10)) console.error(`  - ${id}`);
    console.error(
      `\nRe-run with --confirm-delete to wipe ${allIds.length} doc(s) from Media Library ${mlId}.`,
    );
    return;
  }

  let done = 0;
  for (let i = 0; i < allIds.length; i += BATCH) {
    const batch = allIds.slice(i, i + BATCH);
    await deleteBatch(batch);
    done += batch.length;
    console.error(`  deleted ${done}/${allIds.length}`);
  }

  console.error(
    "\nDone. Remember: dataset-linked asset docs and the local assets manifest are NOT cleaned up (see --help).",
  );
}
