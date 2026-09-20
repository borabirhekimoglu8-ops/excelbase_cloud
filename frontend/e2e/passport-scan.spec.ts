import { test, expect } from "@playwright/test";
import { completeSetup } from "./helpers";

test("pasaport tarama ekranı açılır", async ({ page }) => {
  await page.goto("/");
  await completeSetup(page, "Pasaport Operatör");
  await page.getByRole("navigation", { name: "Ana gezinme" })
    .getByRole("button", { name: "KAPI", exact: true })
    .click();
  await page.getByRole("button", { name: /Pasaport JPG/i }).click();
  await expect(page.getByRole("heading", { name: /Pasaport JPG → Excel/i })).toBeVisible();
  await expect(page.getByText(/Pasaport JPG veya ZIP bırakın/i)).toBeVisible();
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/passport-scan-screen.png",
    fullPage: true,
  });
});
