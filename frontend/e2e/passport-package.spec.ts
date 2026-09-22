import { expect, test, type BrowserContext } from "@playwright/test";

import { completeSetup, openGateVisa } from "./helpers";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7xkAAAAASUVORK5CYII=",
  "base64",
);

async function mockLocalOcr(context: BrowserContext): Promise<void> {
  await context.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/assistant/v1/session") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          setup_required: false,
          bootstrap_required: false,
          authenticated: true,
          user: { id: "mock-local", name: "Ada Yılmaz", role: "admin" },
          csrf_token: "mock-csrf-token",
        }),
      });
      return;
    }
    if (path === "/api/passport-ocr/v1/status") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          state: "ready",
          engine: { name: "paddleocr", version: "PP-OCRv6", lang: "en" },
        }),
      });
      return;
    }
    if (path === "/api/passport-ocr/v1/recognize") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          page_id: "mock-page",
          engine: { name: "paddleocr", version: "PP-OCRv6", lang: "en" },
          width: 1200,
          height: 800,
          duration_ms: 12,
          lines: [
            { text: "Surname", box: [[40, 40], [160, 40], [160, 75], [40, 75]], score: 0.99 },
            { text: "YILMAZ", box: [[220, 40], [380, 40], [380, 75], [220, 75]], score: 0.98 },
            { text: "Given", box: [[40, 100], [120, 100], [120, 135], [40, 135]], score: 0.99 },
            { text: "names", box: [[130, 100], [210, 100], [210, 135], [130, 135]], score: 0.99 },
            { text: "ADA", box: [[240, 100], [330, 100], [330, 135], [240, 135]], score: 0.98 },
          ],
        }),
      });
      return;
    }
    await route.fulfill({ status: 404, body: "{}" });
  });
}

test("mock OCR package moves encrypted rows and source image across fresh contexts", async ({
  browser,
}) => {
  const contextA = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
  const contextB = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
  try {
    await mockLocalOcr(contextA);
    const pageA = await contextA.newPage();
    await pageA.goto("/");
    await completeSetup(pageA, "Ada Yılmaz");
    await openGateVisa(pageA);
    await pageA.getByRole("button", { name: /Pasaport → Excel/i }).click();
    await expect(pageA.getByRole("heading", { name: "Yerel OCR hazır" })).toBeVisible();
    await pageA.locator(".xb-photo-drop input[type='file']").setInputFiles({
      name: "synthetic-passport.png",
      mimeType: "image/png",
      buffer: PNG_1X1,
    });
    await expect(pageA.locator(".xb-passport-rows")).toContainText("YILMAZ");

    await pageA.getByText("Şifreli sonuç paketi aktar").click();
    const downloadPromise = pageA.waitForEvent("download");
    await pageA.getByRole("button", { name: "Şifreli paketi indir" }).click();
    const download = await downloadPromise;
    const packagePath = await download.path();
    expect(packagePath).toBeTruthy();
    const code = await pageA.getByLabel("Paket kodu").inputValue();
    expect(code.length).toBeGreaterThanOrEqual(12);

    await mockLocalOcr(contextB);
    const pageB = await contextB.newPage();
    await pageB.goto("/");
    await completeSetup(pageB, "Ada Yılmaz");
    await openGateVisa(pageB);
    await pageB.getByRole("button", { name: /Pasaport → Excel/i }).click();
    await pageB.getByText("Şifreli sonuç paketi aktar").click();
    await pageB.getByLabel("Paket kodu").fill(code);
    await pageB.getByLabel("Şifreli paket dosyası").setInputFiles(packagePath!);
    await pageB.getByRole("button", { name: "Paketi içe aktar" }).click();

    await expect(pageB.locator(".xb-passport-rows")).toContainText("YILMAZ");
    await pageB.getByText("Kaynak sayfayı göster").click();
    await expect(pageB.locator(".xb-passport-viewer img")).toHaveAttribute("src", /^blob:/);
    await expect(pageB.locator(".xb-passport-field-rect")).toBeVisible();
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
