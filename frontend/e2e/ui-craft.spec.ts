import { test, expect } from "@playwright/test";
import { completeSetup, openGateVisa } from "./helpers";

test("ana ekran liman masası görseli", async ({ page }) => {
  await page.goto("/");
  await completeSetup(page, "Ayşe Operatör");
  await expect(page.getByText("İDO · Operasyon", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Excelbase", exact: true })).toBeVisible();
  await expect(page.getByText("Ayşe · uzamsal köprü", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/home-craft-ui.png",
    fullPage: true,
  });
  await openGateVisa(page);
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/gate-craft-ui.png",
    fullPage: true,
  });
});
