import { describe, expect, it, vi, afterEach } from "vitest";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Express } from "express";
import type { Server } from "node:http";

const root = path.resolve(import.meta.dirname, "../..");

afterEach(() => {
  vi.doUnmock("vite");
  vi.resetModules();
});

describe("production build boundary", () => {
  it("does not eagerly import development-only packages in either entry point", async () => {
    const pkg = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf8")
    );
    const devOnly = new Set(
      Object.keys(pkg.devDependencies).filter(
        name => !(name in pkg.dependencies)
      )
    );
    const result = await build({
      absWorkingDir: root,
      entryPoints: ["server/_core/index.ts", "server/worker.ts"],
      bundle: true,
      platform: "node",
      packages: "external",
      format: "esm",
      outdir: "dist",
      write: false,
      metafile: true,
      logLevel: "silent",
    });
    expect(Object.keys(result.metafile.inputs)).not.toContain("vite.config.ts");
    const eagerDevImports = Object.values(result.metafile.outputs).flatMap(
      output =>
        output.imports.filter(item => {
          if (!item.external || item.kind === "dynamic-import") return false;
          const name = item.path.startsWith("@")
            ? item.path.split("/").slice(0, 2).join("/")
            : item.path.split("/")[0];
          return devOnly.has(name);
        })
    );
    expect(eagerDevImports).toEqual([]);
  }, 20000);

  it("can load static serving code without evaluating Vite", async () => {
    const evaluated = vi.fn();
    vi.doMock("vite", () => {
      evaluated();
      throw new Error("Development-only dependency must not load");
    });
    const { serveStatic } = await import("./vite");
    expect(typeof serveStatic).toBe("function");
    expect(evaluated).not.toHaveBeenCalled();
  });

  it("loads Vite and the repository config only when development is requested", async () => {
    const createServer = vi.fn().mockResolvedValue({ middlewares: vi.fn() });
    vi.doMock("vite", () => ({ createServer }));
    const { setupVite } = await import("./vite");
    expect(createServer).not.toHaveBeenCalled();
    const app = { use: vi.fn() };
    const server = {};
    await setupVite(app as unknown as Express, server as Server);
    expect(createServer).toHaveBeenCalledWith({
      configFile: path.join(root, "vite.config.ts"),
      mode: "development",
      server: {
        middlewareMode: true,
        hmr: { server },
        allowedHosts: true,
      },
      appType: "custom",
    });
    expect(app.use).toHaveBeenCalledTimes(2);
  });
});
