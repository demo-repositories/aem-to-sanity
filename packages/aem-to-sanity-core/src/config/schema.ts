import { z } from "zod";

export const EnvSchema = z.object({
  AEM_ENV: z.enum(["author", "publish"]).default("author"),

  AEM_AUTHOR_URL: z.string().url().optional(),
  AEM_AUTHOR_USERNAME: z.string().optional(),
  AEM_AUTHOR_PASSWORD: z.string().optional(),

  AEM_PUBLISH_URL: z.string().url().optional(),
  AEM_PUBLISH_USERNAME: z.string().optional(),
  AEM_PUBLISH_PASSWORD: z.string().optional(),

  AEM_TOKEN: z.string().optional(),

  AEM_COMPONENT_PATHS_FILE: z.string().default("./aem-component-paths"),
  AEM_CONTENT_ROOTS_FILE: z.string().default("./aem-content-roots"),
  OUTPUT_DIR: z.string().default("./output"),
  CONCURRENCY: z.coerce.number().int().positive().default(4),
});

export type Env = z.infer<typeof EnvSchema>;

export type AuthMode =
  | { kind: "bearer"; token: string }
  | { kind: "basic"; username: string; password: string };

export interface Config {
  env: "author" | "publish";
  baseUrl: string;
  auth: AuthMode;
  componentPathsFile: string;
  contentRootsFile: string;
  outputDir: string;
  concurrency: number;
}
