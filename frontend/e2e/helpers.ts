import type { Page } from "@playwright/test";

export async function completeSetup(page: Page, name: string, pin = "123456"): Promise<void> {
  await page.locator('input[name="name"]').fill(name);
  await page.locator('input[name="pin"]').fill(pin);
  await page.getByRole("button", { name: "Kurulumu tamamla" }).click();
  await page.getByRole("button", { name: "Kodu yazdım, devam et" }).click();
}

export async function openGateVisa(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "Ana gezinme" })
    .getByRole("button", { name: "Kapı", exact: true })
    .click();
}
