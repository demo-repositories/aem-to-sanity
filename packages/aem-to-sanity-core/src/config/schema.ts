import { z } from "zod";

export const EnvSchema = z.object({
  AEM_ENV: z.enum(["author", "publish"]).default("author"),

  AEM_AUTHOR_URL: z.url().optional(),
  AEM_AUTHOR_USERNAME: z.string().optional(),
  AEM_AUTHOR_PASSWORD: z.string().optional(),

  AEM_PUBLISH_URL: z.url().optional(),
  AEM_PUBLISH_USERNAME: z.string().optional(),
  AEM_PUBLISH_PASSWORD: z.string().optional(),

  AEM_TOKEN: z.string().optional(),

  // AEM as a Cloud Service: paste either the path to the Service Credentials
  // JSON downloaded from Adobe Developer Console, or the JSON itself (for CI).
  // When set, the resolver exchanges with Adobe IMS for a short-lived access
  // token and uses it as a bearer for AEM requests. See `aem/ims.ts`.
  AEM_SERVICE_CREDENTIALS_FILE: z.string().optional(),
  AEM_SERVICE_CREDENTIALS: z.string().optional(),

  AEM_COMPONENT_PATHS_FILE: z.string().default("./aem-component-paths"),
  AEM_CONTENT_ROOTS_FILE: z.string().default("./aem-content-roots"),
  OUTPUT_DIR: z.string().default("./output"),
  CONCURRENCY: z.coerce.number().int().positive().default(4),
});

export type Env = z.infer<typeof EnvSchema>;

export type AuthMode =
  | {
      kind: "bearer";
      token: string;
      /**
       * Where the bearer token came from. `"ims"` = exchanged from Service
       * Credentials and will expire (see `expiresAt`); `"token"` = pasted in
       * via `AEM_TOKEN`. Lets the startup banner explain "AEMaaCS via IMS"
       * vs "developer token" without leaking the token itself.
       */
      source?: "ims" | "token";
      /** ms since epoch when an IMS-exchanged token expires. */
      expiresAt?: number;
    }
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
