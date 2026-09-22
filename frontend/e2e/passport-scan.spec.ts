import { test, expect } from "@playwright/test";

import { completeSetup, openGateVisa } from "./helpers";

const LINE1 = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<";
const LINE2 = "L898902C36UTO7408122F1204159ZE184226B<<<<<10";

test("pasaport MRZ metin ekranı açılır", async ({ page }) => {
  await page.goto("/");
  await completeSetup(page, "Ada Yılmaz");
  await openGateVisa(page);
  await page.getByRole("button", { name: /Pasaport MRZ/i }).click();
  await expect(page.getByRole("heading", { name: /Pasaport MRZ → Excel/i })).toBeVisible();
  await expect(page.getByLabel("MRZ satırlarını yapıştır")).toBeVisible();
  await expect(page.getByText("Metin katmanlı PDF veya TXT")).toBeVisible();
  await expect(page.locator(".xb-photo-drop input[type='file']")).toHaveAttribute(
    "accept",
    ".pdf,application/pdf,.txt,text/plain",
  );
});

test("yapıştırılan MRZ alanlarını doğrular ve Excel indirir", async ({ page }) => {
  await page.goto("/");
  await completeSetup(page, "Ada Yılmaz");
  await openGateVisa(page);
  await page.getByRole("button", { name: /Pasaport MRZ/i }).click();
  await page.getByLabel("MRZ satırlarını yapıştır").fill(`${LINE1}\n${LINE2}`);
  await page.getByRole("button", { name: "Satırları işle" }).click();

  const lastName = page.locator(".xb-passport-rows input").nth(1);
  await expect(lastName).toHaveValue(/ERIKSSON/i);
  const passportNo = page.locator(".xb-passport-rows input").nth(2);
  await expect(passportNo).toHaveValue(/L898902C3/i);
  const country = page.locator(".xb-passport-rows input").nth(3);
  // UTO is the fictional ICAO sample state. Unknown codes must stay blank.
  await expect(country).toHaveValue("");
  await country.fill("TR");
  await expect(page.getByLabel("TC.No")).toBeVisible();
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
