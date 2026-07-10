import { expect, test } from "@playwright/test";

const orgId = process.env.V8_E2E_ORG_ID ?? "";
const userId = process.env.V8_E2E_USER_ID ?? "";

test("V8 pilot: operasyon, yolcu, maskeli pasaport ve reveal akışı", async ({ page }) => {
  test.skip(!orgId || !userId, "V8_E2E_ORG_ID / V8_E2E_USER_ID ortam değişkenleri tanımlı değil.");

  await page.goto("/v8");
  await page.getByLabel("Organization ID").fill(orgId);
  await page.getByLabel("User ID").fill(userId);
  await page.getByRole("button", { name: "Kimliği kaydet" }).click();

  const code = `E2E-${Date.now()}`;
  await page.getByPlaceholder("KUS-SAM-20260710").fill(code);
  await page.getByPlaceholder("Kuşadası", { exact: true }).fill("Kuşadası");
  await page.getByPlaceholder("Samos Vathy").fill("Samos Vathy");
  await page.locator('input[name="departure"]').fill("2026-08-01");
  await page.getByRole("button", { name: "Operasyon oluştur" }).click();

  const operationButton = page.getByRole("button", { name: new RegExp(code) });
  await expect(operationButton).toBeVisible();
  await operationButton.click();

  await page.getByPlaceholder("Ad", { exact: true }).fill("Ada");
  await page.getByPlaceholder("Soyad", { exact: true }).fill("Lovelace");
  await page.getByPlaceholder("Pasaport", { exact: true }).fill("E2E12345678");
  await page.getByRole("button", { name: "Yolcu ekle" }).click();

  await expect(page.getByText("Ada Lovelace")).toBeVisible();
  // API yalnızca maskeli pasaport döndürür.
  await expect(page.getByText(/\*+5678/)).toBeVisible();

  await page.getByRole("button", { name: "Pasaportu göster" }).click();
  await expect(page.getByText(/E2E12345678/)).toBeVisible();
});
