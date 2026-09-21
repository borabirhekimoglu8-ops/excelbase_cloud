import { test, expect } from "@playwright/test";
import path from "node:path";

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

test("pasaport JPG MRZ okur", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await completeSetup(page, "Pasaport OCR");
  await page.getByRole("navigation", { name: "Ana gezinme" })
    .getByRole("button", { name: "KAPI", exact: true })
    .click();
  await page.getByRole("button", { name: /Pasaport JPG/i }).click();
  await expect(page.getByRole("heading", { name: /Pasaport JPG → Excel/i })).toBeVisible();

  const sample = path.resolve("/tmp/mrz-sample.jpg");
  await page.locator(".xb-photo-drop input[type='file']").setInputFiles(sample);

  // Wait until OCR finishes and a result row appears with passport fields.
  const lastName = page.locator(".xb-passport-rows input").nth(1);
  await expect(lastName).toHaveValue(/ERIKSSON/i, { timeout: 120_000 });
  const passportNo = page.locator(".xb-passport-rows input").nth(2);
  await expect(passportNo).toHaveValue(/L898902C3/i, { timeout: 30_000 });

  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/passport-ocr-result.png",
    fullPage: true,
  });
});
