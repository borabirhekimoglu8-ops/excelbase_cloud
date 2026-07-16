import { expect, test } from "@playwright/test";
import * as XLSX from "@e965/xlsx";

function passengerWorkbook(name: string, passport: string, index = 1): Buffer {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["NO", "NAME", "SURNAME", "PASSPORT NUMBER", "VOUCHER", "DEPARTURE", "ARRIVAL", "ADULT", "CHILD"],
    [String(index), name, "YOLCU", passport, `V-${index}`, "2026-07-16", "2026-07-20", "25", "0"],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "PAX LIST");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

test("PWA manifesti ve çevrimdışı uygulama kabuğu hazır", async ({ context, page, request }) => {
  const manifestResponse = await request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json();
  expect(manifest.short_name).toBe("Excelbase");
  expect(manifest.display).toBe("standalone");

  const workerResponse = await request.get("/sw.js");
  expect(workerResponse.ok()).toBeTruthy();
  expect(await workerResponse.text()).toContain("excelbase-shell-");

  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

  const shellCaches = await page.evaluate(async () => {
    const names = await caches.keys();
    return names.filter((name) => name.startsWith("excelbase-shell-"));
  });
  expect(shellCaches).toHaveLength(1);

  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveTitle(/Excelbase/);
  await context.setOffline(false);
});

test("uçak modunda yerel kasa açılır ve içe aktarılan yolcu kalır", async ({ context, page }) => {
  await page.goto("/");
  await page.locator('input[name="name"]').fill("Yerel Yönetici");
  await page.locator('input[name="pin"]').fill("123456");
  await page.getByRole("button", { name: "Kurulumu tamamla" }).click();

  await page.getByRole("button", { name: "YÜKLE" }).click();
  await page.getByLabel("ZIP veya Excel listelerini seç").setInputFiles({
    name: "yolcular.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: passengerWorkbook("AYŞE", "TR123456"),
  });
  await expect(page.getByText("HAZIR", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "YOLCULAR" }).click();
  await expect(page.getByText("AYŞE YOLCU")).toBeVisible();

  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('input[name="pin"]').fill("123456");
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.getByRole("button", { name: "YOLCULAR" }).click();
  await expect(page.getByText("AYŞE YOLCU")).toBeVisible();
  await context.setOffline(false);
});

test("49 Excel dosyası sırayla işlenir ve çevrimdışı soğuk açılışta 49 yolcu kalır", async ({ context, page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await page.locator('input[name="name"]').fill("Toplu Test");
  await page.locator('input[name="pin"]').fill("123456");
  await page.getByRole("button", { name: "Kurulumu tamamla" }).click();
  await page.getByRole("button", { name: "YÜKLE" }).click();

  const files = Array.from({ length: 49 }, (_, offset) => {
    const index = offset + 1;
    return {
      name: `liste-${String(index).padStart(2, "0")}.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: passengerWorkbook(`YOLCU${index}`, `TR${String(index).padStart(7, "0")}`, index),
    };
  });
  await page.getByLabel("ZIP veya Excel listelerini seç").setInputFiles(files);
  await expect(page.getByText("HAZIR", { exact: true })).toHaveCount(49, { timeout: 120_000 });

  await page.getByRole("button", { name: "YOLCULAR" }).click();
  await expect(page.getByText("TOPLAM 49 KAYIT", { exact: true })).toBeVisible();

  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.close();
  await context.setOffline(true);
  const offlinePage = await context.newPage();
  await offlinePage.goto("/", { waitUntil: "domcontentloaded" });
  await offlinePage.locator('input[name="pin"]').fill("123456");
  await offlinePage.getByRole("button", { name: "Giriş yap" }).click();
  await offlinePage.getByRole("button", { name: "YOLCULAR" }).click();
  await expect(offlinePage.getByText("TOPLAM 49 KAYIT", { exact: true })).toBeVisible();
  await context.setOffline(false);
});
