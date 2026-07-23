import { defineCliConfig } from "sanity/cli";

// Sanity CLI auto-loads apps/studio/.env with the SANITY_STUDIO_* prefix; we
// also accept the unprefixed names so the same .env can be shared with the
// content-migration CLI when running the whole pipeline from one shell.
const projectId =
  process.env.SANITY_STUDIO_PROJECT_ID ?? process.env.SANITY_PROJECT_ID ?? "";
const dataset =
  process.env.SANITY_STUDIO_DATASET ?? process.env.SANITY_DATASET ?? "production";
const appId =
  process.env.SANITY_STUDIO_APP_ID ?? process.env.SANITY_APP_ID ?? "";

export default defineCliConfig({
  api: { projectId, dataset },
  deployment: appId ? { appId } : undefined,
  mediaLibrary: { aspectsPath: "./aspects" },
});
