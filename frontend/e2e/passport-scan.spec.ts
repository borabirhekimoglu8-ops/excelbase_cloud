import { test, expect } from "@playwright/test";
import path from "node:path";

import { completeSetup, openGateVisa } from "./helpers";

test("pasaport tarama ekranı açılır", async ({ page }) => {
  await page.goto("/");
  await completeSetup(page, "Pasaport Operatör");
  await openGateVisa(page);
  await page.getByRole("button", { name: /Pasaport JPG/i }).click();
  await expect(page.getByRole("heading", { name: /Pasaport JPG → Excel/i })).toBeVisible();
  await expect(page.getByText("Pasaport JPG, PDF veya ZIP")).toBeVisible();
  await expect(page.locator(".xb-photo-drop input[type='file']")).toHaveAttribute(
    "accept",
    /(?:^|,)\.pdf,application\/pdf(?:,|$)/,
  );
});

test("pasaport JPG MRZ okur", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await completeSetup(page, "Pasaport OCR");
  await openGateVisa(page);
  await page.getByRole("button", { name: /Pasaport JPG/i }).click();
  await expect(page.getByRole("heading", { name: /Pasaport JPG → Excel/i })).toBeVisible();

  // Repo fixture — CI has no /tmp sample image.
  const sample = path.join(process.cwd(), "e2e", "fixtures", "mrz-sample.jpg");
  await page.locator(".xb-photo-drop input[type='file']").setInputFiles(sample);

  const lastName = page.locator(".xb-passport-rows input").nth(1);
  await expect(lastName).toHaveValue(/ERIKSSON/i, { timeout: 120_000 });
  const passportNo = page.locator(".xb-passport-rows input").nth(2);
  await expect(passportNo).toHaveValue(/L898902C3/i, { timeout: 30_000 });
  const country = page.locator(".xb-passport-rows input").nth(3);
  await expect(country).toHaveValue(/^[A-Z]{2}$/);
  await expect(page.locator(".xb-passport-rows select")).toHaveValue("Passport");
  // Visa date inputs were removed from the scan UI (template columns stay in Excel).
  await expect(page.getByLabel(/Vize Başlangıç/i)).toHaveCount(0);
  await expect(page.getByLabel(/Vize Bitiş/i)).toHaveCount(0);

  const excelButton = page.getByRole("button", { name: "Excel indir" });
  await expect(excelButton).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await excelButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^pasaport-yolcu-listesi-\d{4}-\d{2}-\d{2}\.xlsx$/);
});
