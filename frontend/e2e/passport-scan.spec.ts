import { test, expect } from "@playwright/test";

import { completeSetup, openGateVisa } from "./helpers";

const LINE1 = "P<TURYILMAZ<<ADA<<<<<<<<<<<<<<<<<<<<<<<<<<<<";
const LINE2 = "U1000001<6UTO9001011F301231610000000146<<<44";

test("pasaport WhatsApp PDF ve görüntü ekranı açılır", async ({ page }) => {
  await page.goto("/");
  await completeSetup(page, "Ada Yılmaz");
  await openGateVisa(page);
  await page.getByRole("button", { name: /Pasaport → Excel/i }).click();
  await expect(page.getByRole("heading", { name: /Pasaport → Excel/i })).toBeVisible();
  await expect(page.getByText("Metin katmanlı PDF bırakın")).toBeVisible();
  await expect(page.getByText("Alternatif: Live Text ile MRZ yapıştır")).toBeVisible();
  await expect(page.getByLabel("MRZ satırlarını yapıştır")).toBeHidden();
  await expect(page.locator(".xb-photo-drop input[type='file']")).toHaveAttribute(
    "accept",
    /^\.pdf,application\/pdf$/,
  );
});

test("UTO gerçek durumunu korur ve ülke kodu olmayan Excel satırını engeller", async ({ page }) => {
  await page.goto("/");
  await completeSetup(page, "Ada Yılmaz");
  await openGateVisa(page);
  await page.getByRole("button", { name: /Pasaport → Excel/i }).click();
  await page.getByText("Alternatif: Live Text ile MRZ yapıştır").click();
  await page.getByLabel("MRZ satırlarını yapıştır").fill(`${LINE1}\n${LINE2}`);
  await page.getByRole("button", { name: "Satırları işle" }).click();

  const lastName = page.locator(".xb-passport-rows input").nth(1);
  await expect(lastName).toHaveValue(/YILMAZ/i);
  const passportNo = page.locator(".xb-passport-rows input").nth(2);
  await expect(passportNo).toHaveValue(/U1000001/i);
  // UTO is the fictional ICAO sample state. Unknown codes must stay blank.
  await expect(page.getByRole("combobox", { name: "Uyruk" })).toHaveValue("UTO");
  await expect(page.getByLabel("Uyruktan türetilen ülke kodu 2")).toHaveValue("");
  await expect(page.getByText(/Uyruk UTO \(Ütopya \(ICAO örnek belge\)\).*Ülke Kodu 2 yok/)).toBeVisible();
  await expect(page.getByLabel("TC.No")).toBeVisible();
  await expect(page.locator(".xb-passport-rows select")).toHaveValue("Passport");
  // Visa date inputs were removed from the scan UI (template columns stay in Excel).
  await expect(page.getByLabel(/Vize Başlangıç/i)).toHaveCount(0);
  await expect(page.getByLabel(/Vize Bitiş/i)).toHaveCount(0);

  const excelButton = page.getByRole("button", { name: "Excel indir" });
  await expect(excelButton).toBeDisabled();
  await expect(page.getByLabel("Kontrol ettim")).toBeChecked();
});
