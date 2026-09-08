import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const viteConfig = readFileSync("vite.config.ts", "utf8");
const manifest = JSON.parse(
  readFileSync("client/public/manifest.json", "utf8")
) as { icons?: Array<{ src?: string }> };
const pwaHook = readFileSync("client/src/hooks/usePWA.ts", "utf8");

describe("PWA build contract", () => {
  it("keeps the checked-in service worker as the single authority", () => {
    expect(viteConfig).not.toContain("VitePWA(");
    expect(viteConfig).not.toContain('from "vite-plugin-pwa"');
    expect(pwaHook).toContain('const SW_PATH = "/sw.js"');
    expect(existsSync("client/public/sw.js")).toBe(true);
  });

  it("references only manifest icon assets that are shipped", () => {
    const iconPaths = (manifest.icons ?? []).map(icon => icon.src);
    expect(iconPaths).toEqual(["/icon-192.png", "/icon-512.png"]);

    for (const src of iconPaths) {
      expect(src).toBeTruthy();
      expect(existsSync(`client/public${src}`)).toBe(true);
    }
  });
});
