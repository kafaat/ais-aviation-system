#!/usr/bin/env tsx
/**
 * OpenAPI Specification Generator
 *
 * This script generates the OpenAPI specification file (openapi.json)
 * from the tRPC router definitions.
 *
 * Usage:
 *   pnpm docs:generate
 *   # or
 *   tsx scripts/generate-openapi.ts
 *
 * Output:
 *   - docs/openapi.json: The complete OpenAPI 3.0 specification
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// Get the directory of this script
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");

// Import the OpenAPI document generator
import { getOpenApiSpec } from "../server/openapi";

/**
 * Main function to generate OpenAPI documentation
 */
async function generateOpenApiDocs(): Promise<void> {
  console.info("Generating OpenAPI documentation...\n");

  try {
    // Generate the OpenAPI specification
    const openApiSpec = await getOpenApiSpec();

    // Parse to validate and get metadata
    const specObject = JSON.parse(openApiSpec);

    // Ensure docs directory exists
    const docsDir = join(projectRoot, "docs");
    if (!existsSync(docsDir)) {
      mkdirSync(docsDir, { recursive: true });
      console.info("Created docs directory");
    }

    // Write the OpenAPI specification to file
    const outputPath = join(docsDir, "openapi.json");
    writeFileSync(outputPath, openApiSpec, "utf-8");

    // Also write to public directory for static serving
    const publicDir = join(projectRoot, "client", "public");
    if (existsSync(publicDir)) {
      const publicOutputPath = join(publicDir, "openapi.json");
      writeFileSync(publicOutputPath, openApiSpec, "utf-8");
      console.info(`OpenAPI spec written to: ${publicOutputPath}`);
    }

    // Print summary
    console.info(`
OpenAPI Documentation Generated Successfully!
=============================================

File: ${outputPath}

API Information:
  Title: ${specObject.info?.title || "N/A"}
  Version: ${specObject.info?.version || "N/A"}
  Description: ${specObject.info?.description?.split("\n")[0] || "N/A"}

Endpoints: ${Object.keys(specObject.paths || {}).length} paths defined
Tags: ${specObject.tags?.length || 0} categories

To view the documentation:
  1. Start the development server: pnpm dev
  2. Open http://localhost:3000/api/docs in your browser

To use the OpenAPI spec with other tools:
  - Import ${outputPath} into Postman, Insomnia, or other API clients
  - Use with code generators (OpenAPI Generator, swagger-codegen)
  - Integrate with API gateways for validation
`);
  } catch (error) {
    console.error("Error generating OpenAPI documentation:");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run the generator
generateOpenApiDocs();
