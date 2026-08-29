import { expect, test } from "@playwright/test";

test("page opens centered on the Nepal flood corridor", async ({ page }) => {
  test.setTimeout(60000);
  const satelliteTileRequests: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/World_Imagery/MapServer/tile/")) satelliteTileRequests.push(url);
  });
  await page.goto("/");
  await expect(page.getByText("Scenario-based research simulation")).toBeVisible();
  await expect(page.getByText("Source to Downstream")).toBeVisible();
  await expect(page.getByText("Upper catchment trigger")).toBeVisible();
  await expect(page.getByText("T+00 min | 26 Aug 2026, before first post-event collect")).toBeVisible();
  await expect(page.getByText("27 Aug 2026 02:00 UTC SkySat; 06:10 UTC Pelican")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Map legend" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Legend/ })).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: /Legend/ }).click();
  await expect(page.getByRole("button", { name: /Legend/ })).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#legendBody")).toBeVisible();
  await expect(page.locator("#legendBody")).toContainText("Modeled shallow inundation");
  await expect(page.locator("#legendBody")).toContainText("Journey annotation with modeled T+ and real collect time");
  await expect(page.locator("#legendBody")).toContainText("Observed Planet scene footprint");
  await expect(page.getByText("Real catalog + OSM layers")).toBeVisible();
  await expect(page.getByRole("button", { name: "Replay August 26, 2026 Reference Reconstruction" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Zoom out" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Center on Nepal flood corridor" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run Scenario" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Compare with Reference" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Model & Data: how was this calculated?" })).toBeVisible();
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const Cesium = window.Cesium;
          const viewer = window.NEPAL_FLOOD_CONFIG?.viewer;
          if (!Cesium || !viewer) return false;
          const position = viewer.camera.positionCartographic;
          const lon = Cesium.Math.toDegrees(position.longitude);
          const lat = Cesium.Math.toDegrees(position.latitude);
          return lon > 84 && lon < 86 && lat > 27 && lat < 29;
        }),
      { timeout: 15000 },
    )
    .toBe(true);
  await expect.poll(() => satelliteTileRequests.length, { timeout: 15000 }).toBeGreaterThan(0);
  await expect(page.locator("#flowCanvas")).toBeVisible();
  await expect.poll(async () => page.locator("#flowCanvas").evaluate((canvas: HTMLCanvasElement) => canvas.width > 0 && canvas.height > 0), { timeout: 15000 }).toBe(true);
  await expect.poll(async () => page.locator(".viewport-shell").evaluate((element: HTMLElement) => Math.round(element.getBoundingClientRect().height))).toBeLessThanOrEqual(1000);
  await expect.poll(async () => page.locator(".viewport-shell").evaluate((element: HTMLElement) => Math.round(element.getBoundingClientRect().width))).toBeGreaterThan(600);
});
