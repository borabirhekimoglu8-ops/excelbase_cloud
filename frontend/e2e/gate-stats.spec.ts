import { test, expect } from "@playwright/test";
import { completeSetup } from "./helpers";

test("kapı vizesi istatistik özeti sade ve yükleme butonlarından arınmış", async ({ page }) => {
  await page.goto("/");
  await completeSetup(page, "Test Operatör");

  await page.getByRole("navigation", { name: "Ana gezinme" })
    .getByRole("button", { name: "KAPI", exact: true })
    .click();
  await page.getByRole("tab", { name: "İSTATİSTİK" }).click();

  await expect(page.getByLabel("Operasyon özeti")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Günlük durum" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "İş kalan günler" })).toBeVisible();
  await expect(page.getByText("Sütun detayları")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Excel ile liste yükle/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Toplu fotoğraf/i })).toHaveCount(0);

  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/gate-stats-clean.png",
    fullPage: true,
  });
});

test("klasör görünümünde yükleme butonları durur", async ({ page }) => {
  await page.goto("/");
  await completeSetup(page, "Test Operatör 2");

  await page.getByRole("navigation", { name: "Ana gezinme" })
    .getByRole("button", { name: "KAPI", exact: true })
    .click();
  await page.getByRole("tab", { name: "KLASÖRLER" }).click();
  await expect(page.getByRole("button", { name: /Excel ile liste yükle/i })).toBeVisible();
});
