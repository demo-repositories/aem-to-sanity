import { defineCliConfig } from "sanity/cli";

// Sanity CLI auto-loads apps/studio/.env with the SANITY_STUDIO_* prefix; we
// also accept the unprefixed names so the same .env can be shared with the
// content-migration CLI when running the whole pipeline from one shell.
const projectId =
  process.env.SANITY_STUDIO_PROJECT_ID ?? process.env.SANITY_PROJECT_ID ?? "";
const dataset =
  process.env.SANITY_STUDIO_DATASET ?? process.env.SANITY_DATASET ?? "production";

export default defineCliConfig({
  api: { projectId, dataset },
  deployment: {
    appId: "y07jj5o21nfuxc1pu93tq2dm",
  },
});
