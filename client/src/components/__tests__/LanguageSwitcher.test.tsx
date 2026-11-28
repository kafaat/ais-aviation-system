import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, it, expect } from "vitest";
import { LanguageSwitcher } from "../LanguageSwitcher";
import i18n from "@/i18n/config";

afterEach(cleanup);
it.each([
  ["ar-SA", "ar", "تغيير اللغة"],
  ["en-GB", "en", "Change language"],
])(
  "uses the supported UI language for a regional preference %s",
  async (regional, language, accessibleName) => {
    await i18n.changeLanguage(regional);
    render(<LanguageSwitcher />);
    expect(screen.getByRole("button", { name: accessibleName })).toBeVisible();
    expect(i18n.language).toBe(language);
  }
);
