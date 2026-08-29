import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildReleaseHydrograph, buildMetrics, calculateAssetExposure, compareRuns, frameAt, scenarioIntensity, TIMELINE, validateScenario } from "../../src/nepal-flash-flood/engine";
import { hazardIndex } from "../../src/nepal-flash-flood/hazard";
import type { InfrastructureAsset, SimulationRun } from "../../src/nepal-flash-flood/domain";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const scenarioData = JSON.parse(readFileSync(resolve(root, "data", "scenarios.json"), "utf8")) as {
  runs: SimulationRun[];
};
const infrastructure = JSON.parse(readFileSync(resolve(root, "data", "infrastructure.geojson"), "utf8")) as {
  features: Array<{ properties: InfrastructureAsset; geometry: { type: string } }>;
};
const assets = infrastructure.features
  .filter((feature) => feature.geometry.type === "Point")
  .map((feature) => feature.properties);

const metric = (run: SimulationRun, id: string) => run.metrics.find((item) => item.id === id)?.value;
const run = (id: string) => scenarioData.runs.find((item) => item.id === id);

describe("bundled Nepal flood scenario data", () => {
  it("ships the reference reconstruction and seven named what-if scenarios", () => {
    expect(scenarioData.runs.map((item) => item.id)).toEqual(["S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7"]);
    expect(run("S0")?.scenario.scenarioType).toBe("reference_event");
    expect(run("S0")?.scenario.referenceReleaseMillionM3).toBe(100);
    for (const item of scenarioData.runs.slice(1)) {
      expect(item.scenario.scenarioType).toBe("barrier_lake_what_if");
      expect(item.scenario.referenceReleaseMillionM3).toBeUndefined();
    }
  });

  it("keeps every published scenario inside documented control bounds", () => {
    for (const item of scenarioData.runs) {
      expect(validateScenario(item.scenario), item.id).toEqual([]);
      expect(item.scenario.lakeVolumeMillionM3, item.id).toBeGreaterThanOrEqual(2);
      expect(item.scenario.lakeVolumeMillionM3, item.id).toBeLessThanOrEqual(5);
      if (item.scenario.scenarioType === "barrier_lake_what_if") {
        expect(item.scenario.breachDurationMinutes, item.id).toBeGreaterThanOrEqual(10);
        expect(item.scenario.breachDurationMinutes, item.id).toBeLessThanOrEqual(120);
        expect(item.scenario.rainfallMultiplier, item.id).toBeGreaterThanOrEqual(0.5);
        expect(item.scenario.rainfallMultiplier, item.id).toBeLessThanOrEqual(2);
        expect(item.scenario.debrisPercent, item.id).toBeGreaterThanOrEqual(0);
        expect(item.scenario.debrisPercent, item.id).toBeLessThanOrEqual(50);
      }
    }
  });

  it("stores mass-balanced hydrographs and scenario-specific arrival curves", () => {
    const curves = new Map<string, string>();
    for (const item of scenarioData.runs) {
      expect(item.releaseHydrograph?.length, item.id).toBeGreaterThan(10);
      expect(item.releasedVolumeM3, item.id).toBeGreaterThan(0);
      expect(Math.abs(item.hydrographMassErrorPercent ?? 999), item.id).toBeLessThan(0.01);
      expect(item.releaseHydrograph?.every((point) => point.dischargeCMS >= 0), item.id).toBe(true);
      const regenerated = buildReleaseHydrograph(item.scenario);
      expect(Math.max(...(item.releaseHydrograph ?? []).map((point) => point.dischargeCMS)), item.id).toBeCloseTo(
        Math.max(...regenerated.hydrograph.map((point) => point.dischargeCMS)),
        1,
      );
      const firstFrame = item.frames[0];
      expect(firstFrame?.arrivalTimeByKm?.length, item.id).toBeGreaterThan(20);
      curves.set(item.id, JSON.stringify(item.frames.map((frame) => frame.frontDistanceKm)));
    }
    expect(curves.get("S1")).not.toEqual(curves.get("S3"));
    expect(curves.get("S3")).not.toEqual(curves.get("S4"));
    expect(curves.get("S3")).not.toEqual(curves.get("S7"));
  });

  it("uses a complete monotonic replay timeline with physically bounded frame values", () => {
    for (const item of scenarioData.runs) {
      expect(item.frames.map((frame) => frame.timeMinutes), item.id).toEqual(TIMELINE);
      for (const frame of item.frames) {
        expect(frame.centerline.length, `${item.id} centerline`).toBeGreaterThan(20);
        expect(frame.footprint.length, `${item.id} footprint`).toBeGreaterThanOrEqual(3);
        for (const point of [...frame.centerline, ...frame.footprint]) {
          expect(Number.isFinite(point[0]), `${item.id} longitude`).toBe(true);
          expect(Number.isFinite(point[1]), `${item.id} latitude`).toBe(true);
          expect(point[0], `${item.id} longitude`).toBeGreaterThan(84);
          expect(point[0], `${item.id} longitude`).toBeLessThan(86);
          expect(point[1], `${item.id} latitude`).toBeGreaterThan(27);
          expect(point[1], `${item.id} latitude`).toBeLessThan(29);
        }
        expect(frame.meanDepthM, `${item.id} mean depth`).toBeGreaterThanOrEqual(0);
        expect(frame.maxDepthM, `${item.id} max depth`).toBeGreaterThanOrEqual(frame.meanDepthM);
        expect(frame.velocityMS, `${item.id} velocity`).toBeGreaterThanOrEqual(0);
        expect(frame.hazardIndex, `${item.id} hazard index`).toBeCloseTo(hazardIndex(frame.maxDepthM, frame.velocityMS), 2);
      }
      expect(frameAt(item, 75).timeMinutes).toBe(75);
      expect(frameAt(item, 75).classification).toBe("estimated");
    }
  });

  it("keeps stored exposure and metrics consistent with the simulation engine", () => {
    for (const item of scenarioData.runs) {
      const recalculatedExposure = calculateAssetExposure(item, assets);
      expect(item.assetExposure.length, item.id).toBe(recalculatedExposure.length);
      for (const exposure of item.assetExposure) {
        expect(assets.some((asset) => asset.id === exposure.assetId), exposure.assetId).toBe(true);
        expect(exposure.maxModeledDepthM).toBeGreaterThanOrEqual(0);
        expect(exposure.maxModeledVelocityMS).toBeGreaterThanOrEqual(0);
        expect(exposure.arrivalTimeMinutes === null || exposure.arrivalTimeMinutes >= 0).toBe(true);
      }

      const recalculatedMetrics = buildMetrics(item.frames, item.assetExposure);
      for (const expected of recalculatedMetrics) {
        expect(metric(item, expected.id), `${item.id} ${expected.id}`).toBe(expected.value);
      }
    }
  });

  it("preserves expected scenario sensitivity for the escalation presets", () => {
    const s1 = run("S1");
    const s2 = run("S2");
    const s3 = run("S3");
    const s4 = run("S4");
    const s5 = run("S5");
    const s6 = run("S6");
    const s7 = run("S7");
    expect(s1 && s2 && s3 && s4 && s5 && s6 && s7).toBeTruthy();
    if (!s1 || !s2 || !s3 || !s4 || !s5 || !s6 || !s7) return;

    expect(scenarioIntensity(s2.scenario)).toBeGreaterThan(scenarioIntensity(s1.scenario));
    expect(scenarioIntensity(s3.scenario)).toBeGreaterThan(scenarioIntensity(s2.scenario));
    expect(scenarioIntensity(s4.scenario)).toBeGreaterThan(scenarioIntensity(s3.scenario));
    expect(metric(s2, "extent")).toBeGreaterThan(metric(s1, "extent") ?? 0);
    expect(metric(s3, "extent")).toBeGreaterThan(metric(s2, "extent") ?? 0);
    expect(metric(s4, "extent")).toBeGreaterThan(metric(s3, "extent") ?? 0);
    expect(metric(s5, "velocity")).toBeGreaterThan(metric(s3, "velocity") ?? 0);
    expect(metric(s6, "bridges")).toBeGreaterThanOrEqual(metric(s3, "bridges") ?? 0);
    expect(compareRuns(s1, s4).extentDeltaHa).toBeGreaterThan(0);
    expect(compareRuns(s3, s7).classification).toBe("simulated");
    const s7Discharges = s7.releaseHydrograph?.map((point) => point.dischargeCMS) ?? [];
    const localPeaks = s7Discharges.filter((value, index) => value > (s7Discharges[index - 1] ?? 0) && value > (s7Discharges[index + 1] ?? 0));
    expect(localPeaks.length).toBeGreaterThanOrEqual(2);
  });
});
