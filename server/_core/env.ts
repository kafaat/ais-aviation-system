import { z } from "zod";

/**
 * Environment variables schema with Zod validation
 * This ensures all required environment variables are present and valid at startup
 */
const envSchema = z.object({
  // App Configuration
  VITE_APP_ID: z.string().min(1).default("ais-aviation-system"),

  // Database
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid URL"),

  // Authentication
  SELF_SERVICE_CAPABILITY_SECRET: z.string().optional(),
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  OAUTH_SERVER_URL: z
    .string()
    .url("OAUTH_SERVER_URL must be a valid URL")
    .optional()
    .default("http://localhost:3000"),
  AUTH_SERVICE_URL: z
    .string()
    .url("AUTH_SERVICE_URL must be a valid URL")
    .optional()
    .default("http://localhost:8000"),
  OWNER_OPEN_ID: z.string().default(""),

  // Built-in Forge API
  BUILT_IN_FORGE_API_URL: z
    .union([z.string().url(), z.literal("")])
    .default(""),
  BUILT_IN_FORGE_API_KEY: z.string().default(""),

  // Node Environment
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

/**
 * Validate and parse environment variables
 * Throws an error with detailed messages if validation fails
 */
function validateEnv() {
  try {
    const env = envSchema.parse(process.env);
    if (
      env.NODE_ENV === "production" &&
      (env.SELF_SERVICE_CAPABILITY_SECRET?.length ?? 0) < 32
    )
      throw new Error(
        "SELF_SERVICE_CAPABILITY_SECRET must contain at least 32 characters in production"
      );
    return env;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("❌ Environment validation failed:");
      error.issues.forEach((err: z.ZodIssue) => {
        console.error(`  - ${err.path.join(".")}:  ${err.message}`);
      });
      throw new Error(
        "Invalid environment configuration. Please check your .env file."
      );
    }
    throw error;
  }
}

/**
 * Validated environment variables
 */
const validatedEnv = validateEnv();

/**
 * Exported environment configuration with backward compatibility
 */
export const ENV = {
  appId: validatedEnv.VITE_APP_ID,
  cookieSecret: validatedEnv.JWT_SECRET,
  databaseUrl: validatedEnv.DATABASE_URL,
  oAuthServerUrl: validatedEnv.OAUTH_SERVER_URL,
  authServiceUrl: validatedEnv.AUTH_SERVICE_URL,
  ownerOpenId: validatedEnv.OWNER_OPEN_ID,
  isProduction: validatedEnv.NODE_ENV === "production",
  forgeApiUrl: validatedEnv.BUILT_IN_FORGE_API_URL,
  forgeApiKey: validatedEnv.BUILT_IN_FORGE_API_KEY,
};

/**
 * Type-safe environment variables
 */
export type Env = z.infer<typeof envSchema>;
