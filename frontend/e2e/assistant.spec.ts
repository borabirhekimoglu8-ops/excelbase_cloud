import { expect, test } from "@playwright/test";

test("Claude Sonnet bağımsız çalışma alanı güvenli bağlamla gerçek sohbet akışını çalıştırır", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.route("**/api/assistant/v1/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        available: true,
        online_required: true,
        privacy_mode: "aggregate_context_only",
        model_family: "sonnet",
        model_label: "Claude Sonnet",
        capabilities: ["dashboard_summary"],
      }),
    });
  });
  await page.route("**/api/assistant/v1/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        setup_required: false,
        bootstrap_required: false,
        authenticated: true,
        user: { id: "operator-1", name: "Operasyon", role: "admin" },
        csrf_token: "e2e-derived-csrf",
      }),
    });
  });

  let postedBody: Record<string, unknown> | null = null;
  await page.route("**/api/assistant/v1/chat", async (route) => {
    postedBody = route.request().postDataJSON();
    expect(route.request().headers()["x-csrf-token"]).toBe("e2e-derived-csrf");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: "Operasyon hazır. <script>window.hacked=true</script>",
        usage: { input_tokens: 90, output_tokens: 12 },
        request_id: "e2e-request",
      }),
    });
  });

  await page.goto("/");
  await page.locator('input[name="name"]').fill("Sonnet Test");
  await page.locator('input[name="pin"]').fill("123456");
  await page.getByRole("button", { name: "Kurulumu tamamla" }).click();

  await page.getByRole("button", { name: /Claude Sonnet Asistan/ }).click();
  await expect(page.getByText("Claude Sonnet", { exact: true })).toBeVisible();
  await expect(page.getByText("Claude Sonnet hazır", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Operasyonu birlikte netleştirelim." })).toBeVisible();
  const composerShell = page.locator(".assistant-composer-shell");
  const composerBox = await composerShell.boundingBox();
  expect(composerBox).not.toBeNull();
  expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(844);

  const composer = page.getByLabel("Sonnet mesajı");
  await expect(composer).toBeDisabled();
  await page.getByText(/Yazdığım metnin Anthropic’e gönderileceğini biliyorum/).click();
  await expect(composer).toBeEnabled();
  await composer.fill("Bugünkü durumu özetle.");
  await page.getByRole("button", { name: "Sonnet mesajını gönder" }).click();

  await expect(page.getByText("Operasyon hazır. <script>window.hacked=true</script>", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as typeof window & { hacked?: boolean }).hacked)).toBeUndefined();
  expect(postedBody).toMatchObject({
    message: "Bugünkü durumu özetle.",
    privacy_acknowledged: true,
  });
  expect(JSON.stringify(postedBody)).not.toMatch(/passport_no|api.?key|anthropic_api|model/i);

  await page.getByRole("button", { name: "Geri" }).click();
  await expect(page.getByRole("heading", { name: /Günaydın/ })).toBeVisible();
  await page.getByRole("button", { name: /Claude Sonnet Asistan/ }).click();
  await expect(page.getByText("Operasyon hazır. <script>window.hacked=true</script>", { exact: true })).toBeVisible();
});

test("hızlı çift gönderim tek ücretli istek açar ve yeni konuşmaya eski yanıt sızmaz", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const capabilities = ["dashboard_summary"];

  await page.route("**/api/assistant/v1/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        available: true,
        online_required: true,
        privacy_mode: "aggregate_context_only",
        model_family: "sonnet",
        model_label: "Claude Sonnet",
        capabilities,
      }),
    });
  });
  await page.route("**/api/assistant/v1/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        setup_required: false,
        bootstrap_required: false,
        authenticated: true,
        user: { id: "operator-1", name: "Operasyon", role: "admin" },
        csrf_token: "race-csrf",
      }),
    });
  });

  let releaseResponse: () => void = () => undefined;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let requestCount = 0;
  await page.route("**/api/assistant/v1/chat", async (route) => {
    requestCount += 1;
    await responseGate;
    try {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message: "Bu yanıt eski konuşmaya aittir.",
          usage: { input_tokens: 30, output_tokens: 8 },
          request_id: "race-request",
        }),
      });
    } catch {
      // Yeni konuşma isteği etkin fetch'i iptal eder; iptal edilen route artık fulfill edilemez.
    }
  });

  await page.goto("/");
  await page.locator('input[name="name"]').fill("Sonnet Race Test");
  await page.locator('input[name="pin"]').fill("123456");
  await page.getByRole("button", { name: "Kurulumu tamamla" }).click();
  await page.getByRole("button", { name: /Claude Sonnet Asistan/ }).click();
  await page.getByText(/Yazdığım metnin Anthropic’e gönderileceğini biliyorum/).click();

  const composer = page.getByLabel("Sonnet mesajı");
  await composer.fill("Tek kez gönder.");
  const send = page.getByRole("button", { name: "Sonnet mesajını gönder" });
  await send.evaluate((element) => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });

  await expect.poll(() => requestCount).toBe(1);
  await expect(page.getByText("Tek kez gönder.", { exact: true })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Yeni konuşma başlat" }).click();
  releaseResponse();

  await expect(page.getByRole("heading", { name: "Operasyonu birlikte netleştirelim." })).toBeVisible();
  await expect(page.getByText("Bu yanıt eski konuşmaya aittir.", { exact: true })).toHaveCount(0);
  expect(requestCount).toBe(1);
});
