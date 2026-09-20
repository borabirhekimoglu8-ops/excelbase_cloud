import { test, expect } from "@playwright/test";
import { completeSetup } from "./helpers";

test("ana ekran liman masası görseli", async ({ page }) => {
  await page.goto("/");
  await completeSetup(page, "Ayşe Operatör");
  await expect(page.getByText("Excelbase · İDO")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ayşe" })).toBeVisible();
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/home-craft-ui.png",
    fullPage: true,
  });
  await page.getByRole("navigation", { name: "Ana gezinme" })
    .getByRole("button", { name: "KAPI", exact: true })
    .click();
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/gate-craft-ui.png",
    fullPage: true,
  });
});
