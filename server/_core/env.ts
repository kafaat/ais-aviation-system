import { z } from "zod";

/**
 * Environment variables schema with Zod validation
 * This ensures all required environment variables are present and valid at startup
 */
const envSchema = z.object({
  // App Configuration
  VITE_APP_ID: z.string().min(1, "VITE_APP_ID is required"),
  
  // Database
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid URL"),
  
  // Authentication
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  OAUTH_SERVER_URL: z.string().url("OAUTH_SERVER_URL must be a valid URL"),
  OWNER_OPEN_ID: z.string().min(1, "OWNER_OPEN_ID is required"),
  
  // Built-in Forge API
  BUILT_IN_FORGE_API_URL: z.string().url("BUILT_IN_FORGE_API_URL must be a valid URL"),
  BUILT_IN_FORGE_API_KEY: z.string().min(1, "BUILT_IN_FORGE_API_KEY is required"),
  
  // Node Environment
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

/**
 * Validate and parse environment variables
 * Throws an error with detailed messages if validation fails
 */
function validateEnv() {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("❌ Environment validation failed:");
      error.issues.forEach((err: z.ZodIssue) => {
        console.error(`  - ${err.path.join(".")}:  ${err.message}`);
      });
      throw new Error("Invalid environment configuration. Please check your .env file.");
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
  ownerOpenId: validatedEnv.OWNER_OPEN_ID,
  isProduction: validatedEnv.NODE_ENV === "production",
  forgeApiUrl: validatedEnv.BUILT_IN_FORGE_API_URL,
  forgeApiKey: validatedEnv.BUILT_IN_FORGE_API_KEY,
};

/**
 * Type-safe environment variables
 */
export type Env = z.infer<typeof envSchema>;
