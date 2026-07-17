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
  expect(manifest.name).toBe("Gate Visa Checklist");
  expect(manifest.short_name).toBe("Gate Visa Checklist");
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ src: "/icon-192.png", sizes: "192x192", type: "image/png" }),
    expect.objectContaining({ src: "/icon-512.png", sizes: "512x512", type: "image/png" }),
  ]));

  const workerResponse = await request.get("/sw.js");
  expect(workerResponse.ok()).toBeTruthy();
  expect(await workerResponse.text()).toContain("excelbase-shell-");

  await page.goto("/");
  await expect(page).toHaveTitle(/Gate Visa Checklist/);
  await expect(page.locator('meta[name="application-name"]')).toHaveAttribute("content", "Gate Visa Checklist");
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "Gate Visa Checklist");
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
  await expect(page).toHaveTitle(/Gate Visa Checklist/);
  await context.setOffline(false);
});

test("uçak modunda yerel kasa açılır ve içe aktarılan yolcu kalır", async ({ context, page }) => {
  await page.goto("/");
  await page.locator('input[name="name"]').fill("Yerel Yönetici");
  await page.locator('input[name="pin"]').fill("123456");
  await page.getByRole("button", { name: "Kurulumu tamamla" }).click();

  await page.getByRole("navigation", { name: "Ana gezinme" }).getByRole("button", { name: "YÜKLE", exact: true }).click();
  await page.getByLabel("ZIP veya Excel listelerini seç").setInputFiles({
    name: "yolcular.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: passengerWorkbook("AYŞE", "TR123456"),
  });
  await expect(page.getByText("HAZIR", { exact: true })).toBeVisible();

  await page.getByRole("navigation", { name: "Ana gezinme" }).getByRole("button", { name: "YOLCULAR", exact: true }).click();
  await expect(page.getByText("AYŞE YOLCU")).toBeVisible();

  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('input[name="pin"]').fill("123456");
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.getByRole("navigation", { name: "Ana gezinme" }).getByRole("button", { name: "YOLCULAR", exact: true }).click();
  await expect(page.getByText("AYŞE YOLCU")).toBeVisible();
  await context.setOffline(false);
});

test("yolcuya JPG biyometrik fotoğraf ve PDF evrak çevrimdışı eklenir", async ({ context, page }) => {
  await page.goto("/");
  await page.locator('input[name="name"]').fill("Evrak Operatörü");
  await page.locator('input[name="pin"]').fill("123456");
  await page.getByRole("button", { name: "Kurulumu tamamla" }).click();

  await page.getByRole("navigation", { name: "Ana gezinme" }).getByRole("button", { name: "YÜKLE", exact: true }).click();
  await page.getByLabel("ZIP veya Excel listelerini seç").setInputFiles({
    name: "evrak-yolcusu.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: passengerWorkbook("AYŞE", "TR123456"),
  });
  await expect(page.getByText("HAZIR", { exact: true })).toBeVisible();

  await page.getByRole("navigation", { name: "Ana gezinme" }).getByRole("button", { name: "YOLCULAR", exact: true }).click();
  await page.getByText("AYŞE YOLCU", { exact: true }).click();
  await expect(page.getByText("Yolcu Detayı", { exact: true })).toBeVisible();

  await page.getByLabel("JPG biyometrik fotoğraf seç").setInputFiles({
    name: "TR123456-biyometrik.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]),
  });
  await expect(page.getByText("JPG DEĞİŞTİR", { exact: true })).toBeVisible();
  await expect(page.locator('.ido-sheet img[alt="AYŞE YOLCU"]')).toHaveAttribute("src", /^blob:/);

  await page.getByLabel("Yolcu PDF evraklarını seç").setInputFiles([
    {
      name: "TR123456-pasaport.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\nGate Visa Checklist test pasaportu\n%%EOF"),
    },
    {
      name: "TR123456-vize-formu.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\nGate Visa Checklist test vize formu\n%%EOF"),
    },
  ]);
  await expect(page.getByText("TR123456-pasaport.pdf", { exact: true })).toBeVisible();
  await expect(page.getByText("TR123456-vize-formu.pdf", { exact: true })).toBeVisible();
  await expect(page.getByText("2 EVRAK", { exact: true })).toBeVisible();

  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('input[name="pin"]').fill("123456");
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.getByRole("navigation", { name: "Ana gezinme" }).getByRole("button", { name: "YOLCULAR", exact: true }).click();
  await page.getByText("AYŞE YOLCU", { exact: true }).click();
  await expect(page.locator('.ido-sheet img[alt="AYŞE YOLCU"]')).toHaveAttribute("src", /^blob:/);
  await expect(page.getByText("TR123456-pasaport.pdf", { exact: true })).toBeVisible();
  await expect(page.getByText("TR123456-vize-formu.pdf", { exact: true })).toBeVisible();
  await context.setOffline(false);
});

test("49 Excel dosyası sırayla işlenir ve çevrimdışı soğuk açılışta 49 yolcu kalır", async ({ context, page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await page.locator('input[name="name"]').fill("Toplu Test");
  await page.locator('input[name="pin"]').fill("123456");
  await page.getByRole("button", { name: "Kurulumu tamamla" }).click();
  await page.getByRole("navigation", { name: "Ana gezinme" }).getByRole("button", { name: "YÜKLE", exact: true }).click();

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

  await page.getByRole("navigation", { name: "Ana gezinme" }).getByRole("button", { name: "YOLCULAR", exact: true }).click();
  await expect(page.getByText("TOPLAM 49 KAYIT", { exact: true })).toBeVisible();

  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.close();
  await context.setOffline(true);
  const offlinePage = await context.newPage();
  await offlinePage.goto("/", { waitUntil: "domcontentloaded" });
  await offlinePage.locator('input[name="pin"]').fill("123456");
  await offlinePage.getByRole("button", { name: "Giriş yap" }).click();
  await offlinePage.getByRole("navigation", { name: "Ana gezinme" }).getByRole("button", { name: "YOLCULAR", exact: true }).click();
  await expect(offlinePage.getByText("TOPLAM 49 KAYIT", { exact: true })).toBeVisible();
  await context.setOffline(false);
});
