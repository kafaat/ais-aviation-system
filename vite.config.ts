import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "module";
import path from "path";
import { defineConfig, type PluginOption, type UserConfig } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";
import { VitePWA } from "vite-plugin-pwa";

// Create require for dynamic imports in ESM
const require = createRequire(import.meta.url);

// Type definitions for Rollup callbacks
interface ChunkInfo {
  name: string;
}

interface AssetInfo {
  name?: string;
}

// Manual chunks configuration for optimal code splitting
// Strategy: Simplified grouping to avoid circular dependencies while maintaining good caching
function manualChunks(id: string): string | undefined {
  // Only split node_modules - let application code be handled by Vite's defaults
  if (!id.includes("node_modules")) {
    return undefined;
  }

  // Charts library - large, often lazy loaded
  // Keep d3 and recharts together (they have internal dependencies)
  if (id.includes("recharts") || id.includes("d3-")) {
    return "vendor-charts";
  }

  // Animation library - significant size, often conditionally used
  if (id.includes("framer-motion") || id.includes("motion")) {
    return "vendor-animations";
  }

  // Icons - tree-shakeable but can be large
  if (id.includes("lucide-react")) {
    return "vendor-icons";
  }

  // Date utilities - commonly used, stable version
  if (id.includes("date-fns")) {
    return "vendor-date";
  }

  // Sentry - error tracking, only needed in production
  if (id.includes("@sentry")) {
    return "vendor-monitoring";
  }

  // API layer - tRPC and React Query
  if (id.includes("@trpc") || id.includes("@tanstack")) {
    return "vendor-api";
  }

  // Everything else (React, Radix UI, utilities, etc.) - single vendor chunk
  // This avoids circular dependencies between React and React-based libraries
  return "vendor";
}

// Build the plugins array
function buildPlugins(mode: string): PluginOption[] {
  const pluginList: PluginOption[] = [
    react(),
    tailwindcss(),
    jsxLocPlugin(),
    vitePluginManusRuntime(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico"],
      manifest: {
        name: "نظام الطيران المتكامل - AIS",
        short_name: "AIS",
        description: "نظام شامل لحجز تذاكر الطيران وإدارة الرحلات",
        theme_color: "#3b82f6",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any maskable",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        runtimeCaching: [
          {
            urlPattern: /^\/api\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24,
              },
            },
          },
        ],
      },
    }),
  ];

  // Add compression plugins for production builds
  if (mode === "production") {
    try {
      const compression = require("vite-plugin-compression");
      const compressionPlugin = compression.default || compression;
      // Gzip compression
      pluginList.push(
        compressionPlugin({
          algorithm: "gzip",
          ext: ".gz",
          threshold: 1024, // Only compress files > 1KB
          deleteOriginFile: false,
        })
      );
      // Brotli compression (better compression ratio)
      pluginList.push(
        compressionPlugin({
          algorithm: "brotliCompress",
          ext: ".br",
          threshold: 1024,
          deleteOriginFile: false,
        })
      );
    } catch (e) {
      console.info("vite-plugin-compression not available:", e);
    }
  }

  // Add visualizer plugin if ANALYZE=true
  if (process.env.ANALYZE === "true") {
    try {
      const visualizerModule = require("rollup-plugin-visualizer");
      const visualizer =
        visualizerModule.visualizer || visualizerModule.default;
      pluginList.push(
        visualizer({
          filename: path.resolve(import.meta.dirname, "dist/public/stats.html"),
          open: false,
          gzipSize: true,
          brotliSize: true,
          template: "treemap", // Options: sunburst, treemap, network
        })
      );
      console.info("Bundle analysis enabled - stats.html will be generated");
    } catch (e) {
      console.info("rollup-plugin-visualizer not available:", e);
    }
  }

  return pluginList;
}

export default defineConfig(({ mode }): UserConfig => {
  const isProduction = mode === "production";

  return {
    plugins: buildPlugins(mode),
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "client", "src"),
        "@shared": path.resolve(import.meta.dirname, "shared"),
        "@assets": path.resolve(import.meta.dirname, "attached_assets"),
      },
    },
    envDir: path.resolve(import.meta.dirname),
    root: path.resolve(import.meta.dirname, "client"),
    publicDir: path.resolve(import.meta.dirname, "client", "public"),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
      // Target modern browsers for smaller bundles
      target: "es2022",
      // Minification settings
      minify: "esbuild",
      // CSS code splitting
      cssCodeSplit: true,
      // Source maps for production debugging (can disable for smaller builds)
      sourcemap: false,
      // Chunk size warning limit (in KB)
      chunkSizeWarningLimit: 500,
      // Rollup options for advanced optimization
      rollupOptions: {
        output: {
          // Manual chunks for code splitting
          manualChunks,
          // Optimize chunk file names
          chunkFileNames: (chunkInfo: ChunkInfo): string => {
            const name = chunkInfo.name || "chunk";
            return `assets/${name}-[hash].js`;
          },
          entryFileNames: "assets/[name]-[hash].js",
          assetFileNames: (assetInfo: AssetInfo): string => {
            const name = assetInfo.name || "";
            // Organize assets by type
            if (/\.(woff2?|ttf|eot)$/.test(name)) {
              return "assets/fonts/[name]-[hash][extname]";
            }
            if (/\.(png|jpe?g|gif|svg|webp|ico)$/.test(name)) {
              return "assets/images/[name]-[hash][extname]";
            }
            return "assets/[name]-[hash][extname]";
          },
        },
        // Tree shaking configuration
        treeshake: {
          // More aggressive tree shaking
          moduleSideEffects: (id: string): boolean => {
            // Keep side effects for CSS and certain libraries
            if (id.endsWith(".css")) return true;
            if (id.includes("@radix-ui")) return true;
            return false;
          },
          // Remove unused properties
          propertyReadSideEffects: false,
        },
      },
    },
    // Optimization for dependencies
    optimizeDeps: {
      // Pre-bundle these dependencies for faster dev startup
      include: [
        "react",
        "react-dom",
        "@tanstack/react-query",
        "@trpc/client",
        "@trpc/react-query",
        "wouter",
        "clsx",
        "tailwind-merge",
        "class-variance-authority",
        "lucide-react",
        "date-fns",
        "zod",
        "react-hook-form",
        "sonner",
        "framer-motion",
      ],
      // Exclude packages that should not be pre-bundled
      exclude: ["@vite/client"],
    },
    // Esbuild configuration for faster builds
    esbuild: {
      // Remove console.log in production
      drop: isProduction ? ["console", "debugger"] : [],
      // Legal comments handling
      legalComments: "none",
    },
    server: {
      host: true,
      allowedHosts: [
        ".manuspre.computer",
        ".manus.computer",
        ".manus-asia.computer",
        ".manuscomputer.ai",
        ".manusvm.computer",
        "localhost",
        "127.0.0.1",
      ],
      fs: {
        strict: true,
        deny: ["**/.*"],
      },
    },
  };
});
