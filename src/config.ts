import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  AEM_ENV: z.enum(["author", "publish"]).default("author"),

  AEM_AUTHOR_URL: z.string().url().optional(),
  AEM_AUTHOR_USERNAME: z.string().optional(),
  AEM_AUTHOR_PASSWORD: z.string().optional(),

  AEM_PUBLISH_URL: z.string().url().optional(),
  AEM_PUBLISH_USERNAME: z.string().optional(),
  AEM_PUBLISH_PASSWORD: z.string().optional(),

  AEM_TOKEN: z.string().optional(),

  AEM_COMPONENT_PATHS_FILE: z.string().default("./aem-component-paths"),
  OUTPUT_DIR: z.string().default("./output"),
  CONCURRENCY: z.coerce.number().int().positive().default(4),
});

export type AuthMode =
  | { kind: "bearer"; token: string }
  | { kind: "basic"; username: string; password: string };

export interface Config {
  env: "author" | "publish";
  baseUrl: string;
  auth: AuthMode;
  componentPathsFile: string;
  outputDir: string;
  concurrency: number;
}

export function loadConfig(): Config {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  const env = parsed.data;

  const activeUrl =
    env.AEM_ENV === "author" ? env.AEM_AUTHOR_URL : env.AEM_PUBLISH_URL;
  const activeUser =
    env.AEM_ENV === "author"
      ? env.AEM_AUTHOR_USERNAME
      : env.AEM_PUBLISH_USERNAME;
  const activePass =
    env.AEM_ENV === "author"
      ? env.AEM_AUTHOR_PASSWORD
      : env.AEM_PUBLISH_PASSWORD;

  if (!activeUrl) {
    throw new Error(
      `AEM_${env.AEM_ENV.toUpperCase()}_URL is required when AEM_ENV=${env.AEM_ENV}`,
    );
  }

  let auth: AuthMode;
  if (env.AEM_TOKEN) {
    auth = { kind: "bearer", token: env.AEM_TOKEN };
  } else if (activeUser && activePass) {
    auth = { kind: "basic", username: activeUser, password: activePass };
  } else {
    throw new Error(
      `Missing credentials. Set AEM_TOKEN, or AEM_${env.AEM_ENV.toUpperCase()}_USERNAME and AEM_${env.AEM_ENV.toUpperCase()}_PASSWORD.`,
    );
  }

  return {
    env: env.AEM_ENV,
    baseUrl: activeUrl.replace(/\/$/, ""),
    auth,
    componentPathsFile: env.AEM_COMPONENT_PATHS_FILE,
    outputDir: env.OUTPUT_DIR,
    concurrency: env.CONCURRENCY,
  };
}
