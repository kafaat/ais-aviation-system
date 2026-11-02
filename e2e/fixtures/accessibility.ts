import axe from "axe-core";
import { expect, type Page } from "@playwright/test";

/** Scan the actual rendered controls without sending passenger data to any service. */
export async function expectAccessibleControls(
  page: Page,
  selectors: string[]
) {
  for (const selector of selectors) {
    await expect(page.locator(selector).first()).toBeVisible();
  }
  await page.evaluate(axe.source);
  const failures = await page.evaluate(async include => {
    const engine = (window as Window & { axe: typeof axe }).axe;
    const result = await engine.run(
      { include },
      {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
        },
      }
    );
    return result.violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map(node => node.target),
    }));
  }, selectors);
  expect(failures).toEqual([]);
}
