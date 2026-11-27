import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SkipNavigation } from "../SkipNavigation";
import i18n from "@/i18n/config";

afterEach(cleanup);

it("offers only current landmarks and moves keyboard focus when a lazy screen changes", async () => {
  await i18n.changeLanguage("en");
  const page = (search: boolean) => (
    <>
      <SkipNavigation />
      <main id="main-content">{search && <input id="search" />}</main>
    </>
  );
  const view = render(page(true));
  const link = await screen.findByRole("link", { name: "Skip to search" });
  expect(screen.queryByRole("link", { name: "Skip to navigation" })).toBeNull();
  fireEvent.keyDown(link, { key: "Enter" });
  expect(document.getElementById("search")).toHaveFocus();
  view.rerender(page(false));
  await waitFor(() =>
    expect(screen.queryByRole("link", { name: "Skip to search" })).toBeNull()
  );
  fireEvent.click(screen.getByRole("link", { name: "Skip to main content" }));
  expect(document.getElementById("main-content")).toHaveFocus();
});
