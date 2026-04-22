import { EnvSchema, type AuthMode, type Config } from "./schema.ts";

/**
 * Resolve a validated {@link Config} from a plain env-like record. No side
 * effects — callers (CLIs) are responsible for calling `dotenv/config` before
 * invoking this.
 */
export function resolveConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  const data = parsed.data;

  const activeUrl =
    data.AEM_ENV === "author" ? data.AEM_AUTHOR_URL : data.AEM_PUBLISH_URL;
  const activeUser =
    data.AEM_ENV === "author"
      ? data.AEM_AUTHOR_USERNAME
      : data.AEM_PUBLISH_USERNAME;
  const activePass =
    data.AEM_ENV === "author"
      ? data.AEM_AUTHOR_PASSWORD
      : data.AEM_PUBLISH_PASSWORD;

  if (!activeUrl) {
    throw new Error(
      `AEM_${data.AEM_ENV.toUpperCase()}_URL is required when AEM_ENV=${data.AEM_ENV}`,
    );
  }

  let auth: AuthMode;
  if (data.AEM_TOKEN) {
    auth = { kind: "bearer", token: data.AEM_TOKEN };
  } else if (activeUser && activePass) {
    auth = { kind: "basic", username: activeUser, password: activePass };
  } else {
    throw new Error(
      `Missing credentials. Set AEM_TOKEN, or AEM_${data.AEM_ENV.toUpperCase()}_USERNAME and AEM_${data.AEM_ENV.toUpperCase()}_PASSWORD.`,
    );
  }

  return {
    env: data.AEM_ENV,
    baseUrl: activeUrl.replace(/\/$/, ""),
    auth,
    componentPathsFile: data.AEM_COMPONENT_PATHS_FILE,
    contentRootsFile: data.AEM_CONTENT_ROOTS_FILE,
    outputDir: data.OUTPUT_DIR,
    concurrency: data.CONCURRENCY,
  };
}
