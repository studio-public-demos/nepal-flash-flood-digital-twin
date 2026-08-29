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
      { timeout: 45000 },
    )
    .toBe(true);
  await expect.poll(() => satelliteTileRequests.length, { timeout: 15000 }).toBeGreaterThan(0);
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const Cesium = window.Cesium;
          const viewer = window.NEPAL_FLOOD_CONFIG?.viewer;
          if (!Cesium || !viewer || !window.NEPAL_FLOOD_CONFIG?.staticLayersReady) return false;
          const clamped = Cesium.HeightReference.CLAMP_TO_GROUND;
          const byKind = (kind: string) => Array.from(viewer.entities.values).find((entity: any) => entity.properties?.kind?.getValue?.() === kind);
          const trackedEntities = [
            viewer.entities.getById("river"),
            viewer.entities.getById("terrain-profile"),
            viewer.entities.getById("journey-source"),
            viewer.entities.getById("journey-downstream"),
            byKind("observed_community"),
            byKind("satellite_scene"),
          ];
          return trackedEntities.every((entity: any) => {
            if (!entity) return false;
            if (entity.polyline) return entity.polyline.clampToGround?.getValue?.() === true;
            if (entity.polygon) return entity.polygon.heightReference?.getValue?.() === clamped && entity.polygon.perPositionHeight?.getValue?.() === false;
            return entity.point?.heightReference?.getValue?.() === clamped && entity.label?.heightReference?.getValue?.() === clamped;
          });
        }),
      { timeout: 45000 },
    )
    .toBe(true);
  await expect(page.locator("#flowCanvas")).toBeAttached();
});
