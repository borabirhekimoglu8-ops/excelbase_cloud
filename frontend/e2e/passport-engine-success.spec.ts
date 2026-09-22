import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";
import * as XLSX from "@e965/xlsx";

import { completeSetup, openGateVisa } from "./helpers";

const PIN = "123456";
const SOURCE_PDF = resolve(
  process.cwd(),
  "src/lib/passport/__fixtures__/engine-runs/sources/tur-image-pdf-250dpi.pdf",
);
const PROOF_PATH = resolve(
  process.cwd(),
  "src/lib/passport/__fixtures__/engine-runs/flow-proof.json",
);

test.use({ baseURL: "http://127.0.0.1:8000" });
test.skip(
  process.env.PASSPORT_OCR_E2E !== "1",
  "Real PP-OCR browser flow requires PASSPORT_OCR_E2E=1 and FastAPI on :8000.",
);

test("real TUR image-PDF reaches user-approved Excel", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await page.goto("/");
  await completeSetup(page, "Ada Yılmaz", PIN);
  await openGateVisa(page);
  await page.getByRole("button", { name: /Pasaport → Excel/i }).click();

  const localLogin = page.getByLabel("Yerel servis kodu");
  if (await localLogin.isVisible().catch(() => false)) {
    await localLogin.fill(PIN);
    await page.getByRole("button", { name: "Yerel servise giriş" }).click();
  }
  const readyHeading = page.getByRole("heading", { name: "Yerel OCR hazır" });
  await expect.poll(async () => {
    if (await readyHeading.isVisible()) return true;
    const refresh = page.getByRole("button", { name: "Durumu yenile" });
    if (await refresh.isVisible()) await refresh.click();
    return readyHeading.isVisible();
  }, {
    message: "PP-OCRv6 did not become ready",
    timeout: 180_000,
    intervals: [2_000, 3_000, 5_000],
  }).toBe(true);

  await page.locator(".xb-photo-drop input[type='file']").setInputFiles(SOURCE_PDF);
  const row = page.locator(".xb-passport-rows > li").first();
  await expect(row).toBeVisible({ timeout: 180_000 });

  const initialReviewStatus = await row.getAttribute("data-review-status");
  expect(["verified", "needs_review"]).toContain(initialReviewStatus);
  const editedFields: string[] = [];

  async function ensureField(label: string, expected: string, field: string): Promise<void> {
    const input = row.getByLabel(label, { exact: true });
    if (await input.inputValue() !== expected) {
      await input.fill(expected);
      editedFields.push(field);
    }
    await expect(input).toHaveValue(expected);
  }

  await ensureField("Yolcu Adı", "ADA", "firstName");
  await ensureField("Yolcu Soyadı", "YILMAZ", "lastName");
  await ensureField("Pasaport No", "U1000001", "passportNo");
  await ensureField("Doğum Tarihi", "1990-01-01", "birthDate");
  await ensureField("Pasaport Bitiş Tar.", "2030-12-31", "expiryDate");

  const nationality = row.getByRole("combobox", { name: "Uyruk" });
  if (await nationality.inputValue() !== "TUR") {
    await nationality.fill("TUR");
    await nationality.press("Enter");
    editedFields.push("nationality");
  }
  await expect(nationality).toHaveValue("TUR");
  await expect(row.getByLabel("Uyruktan türetilen ülke kodu 2")).toHaveValue("TR");

  const reviewed = row.getByLabel("Kontrol ettim");
  if (initialReviewStatus === "verified") {
    expect(editedFields).toEqual([]);
    await expect(reviewed).toBeChecked();
    await expect(reviewed).toBeDisabled();
    await expect(row.getByLabel("Doğrulama durumu")).toHaveText(
      "MRZ doğrulandı · otomatik kayıt",
    );
  } else {
    await reviewed.check();
    await expect(row).toHaveAttribute("data-review-status", "reviewed");
    await expect(row.getByLabel("Doğrulama durumu")).toHaveText(
      "Görsel taslak · kullanıcı kontrol etti",
    );
  }

  testInfo.annotations.push({
    type: initialReviewStatus === "verified" ? "AUTOMATIC" : "USER-FIXED",
    description: editedFields.length ? editedFields.join(",") : "none",
  });

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Excel indir" }).click();
  const download = await downloadPromise;
  const downloadedPath = await download.path();
  expect(downloadedPath).toBeTruthy();

  const workbook = XLSX.read(readFileSync(downloadedPath!), { type: "buffer" });
  const sheet = workbook.Sheets.Yolcular;
  expect(sheet.A2.v).toBe("ADA");
  expect(sheet.B2.v).toBe("YILMAZ");
  expect(sheet.D2.v).toBe("TR");
  expect(sheet.H2.v).toBe("U1000001");

  writeFileSync(
    PROOF_PATH,
    `${JSON.stringify({
      evidence: "real_fastapi_ppocrv6_browser_flow",
      synthetic_only: true,
      source_pdf: "sources/tur-image-pdf-250dpi.pdf",
      base_url: "http://127.0.0.1:8000",
      api_mocked: false,
      initial_review_status: initialReviewStatus,
      outcome: initialReviewStatus === "verified" ? "automatically_correct" : "user_corrected",
      edited_fields: editedFields,
      excel_downloaded: true,
      excel_assertions: {
        first_name: "ADA",
        last_name: "YILMAZ",
        country_code_2: "TR",
        passport_no: "U1000001",
      },
    }, null, 2)}\n`,
    "utf8",
  );
});
