import { describe, expect, it } from "vitest";
import { buildMetrics, compareRuns, frameAt, PrecomputedSimulationEngine, scenarioIntensity, validateScenario } from "../../src/nepal-flash-flood/engine";
import { classifyExposure, classifyHazard, hazardIndex } from "../../src/nepal-flash-flood/hazard";
import type { InfrastructureAsset, ModelProvenance, SimulationRun, SimulationScenario } from "../../src/nepal-flash-flood/domain";

const provenance: ModelProvenance = {
  classification: "synthetic",
  source: "test",
  modelVersion: "test",
  generationMethod: "test",
  confidence: "low",
  limitations: ["test"],
  dataSources: [],
};

const scenario: SimulationScenario = {
  id: "S0",
  name: "Reference",
  scenarioType: "reference_event",
  referenceReleaseMillionM3: 100,
  lakeVolumeMillionM3: 3,
  breachMechanism: "partial_breach",
  breachDurationMinutes: 60,
  relativeBreachWidth: "medium",
  rainfallMultiplier: 1,
  antecedentFlow: "normal",
  debrisPercent: 10,
  channelRoughness: "normal",
  bridgeCondition: "existing",
  secondaryBlockage: false,
  provenance,
};

const run: SimulationRun = {
  id: "S0",
  scenario,
  frames: [
    { timeMinutes: 0, footprint: [[85, 28], [85.1, 28], [85.1, 28.1]], centerline: [[85, 28], [85.1, 28.1]], meanDepthM: 0.2, maxDepthM: 0.4, velocityMS: 0.8, hazardIndex: 0.32, classification: "synthetic" },
    { timeMinutes: 10, footprint: [[85, 28], [85.2, 28], [85.2, 28.2]], centerline: [[85, 28], [85.1, 28.1]], meanDepthM: 1, maxDepthM: 2, velocityMS: 3, hazardIndex: 6, classification: "synthetic" },
  ],
  metrics: [],
  rasterMetadata: { scenarioId: "S0", resolutionM: 90, horizontalDatum: "WGS84", verticalDatum: "relative", classification: "synthetic", notes: "test" },
  assetExposure: [],
  provenance,
  approximation: false,
};

const assets: InfrastructureAsset[] = [
  { id: "bridge-test", name: "Bridge", kind: "bridge", coordinates: [85, 28], corridorKm: 5, officialNameVerified: false, classification: "representative" },
  { id: "settlement-test", name: "Settlement", kind: "settlement", coordinates: [85.1, 28.1], corridorKm: 20, officialNameVerified: true, classification: "observed" },
];

describe("Nepal flood simulation core", () => {
  it("validates bounded scenario controls", () => {
    expect(validateScenario(scenario)).toEqual([]);
    expect(validateScenario({ ...scenario, scenarioType: "barrier_lake_what_if", lakeVolumeMillionM3: 9 })).toContain("Barrier lake volume must be between 2.0 and 5.0 million m3.");
    expect(validateScenario({ ...scenario, referenceReleaseMillionM3: 3 })).toContain("Reference event must carry a separate approximately 100 million m3 release estimate with uncertainty.");
  });

  it("classifies hazard and exposure without damage claims", () => {
    expect(hazardIndex(2, 3)).toBe(6);
    expect(classifyHazard(6)).toBe("very_high");
    expect(classifyExposure(0.4, "low")).toBe("low");
  });

  it("interpolates flood frames on scrubbed timeline values", () => {
    const frame = frameAt(run, 5);
    expect(frame.maxDepthM).toBe(1.2);
    expect(frame.classification).toBe("estimated");
  });

  it("calculates metrics and compares scenarios", () => {
    const metrics = buildMetrics(run.frames, [{ assetId: "bridge-test", arrivalTimeMinutes: 8, maxModeledDepthM: 1, maxModeledVelocityMS: 1, hazard: "moderate", exposure: "moderate", confidence: "low", classification: "synthetic" }]);
    expect(metrics.find((metric) => metric.id === "bridges")?.value).toBe(1);
    const richer = { ...run, scenario: { ...scenario, name: "Richer" }, metrics };
    const comparison = compareRuns(run, richer);
    expect(comparison.scenarioB).toBe("Richer");
  });

  it("runs an estimated scenario through the precomputed engine", async () => {
    const engine = new PrecomputedSimulationEngine([{ ...run, metrics: buildMetrics(run.frames, []) }], assets, provenance);
    const baseline = { ...scenario, scenarioType: "barrier_lake_what_if" as const, lakeVolumeMillionM3: 2, breachMechanism: "slow_overtopping" as const, rainfallMultiplier: 0.7, debrisPercent: 5 };
    const output = await engine.runScenario({ ...baseline, id: "visitor", lakeVolumeMillionM3: 5, breachMechanism: "rapid_breach", rainfallMultiplier: 1.5, debrisPercent: 30 });
    expect(output.approximation).toBe(true);
    expect(output.assetExposure.length).toBe(2);
    expect(scenarioIntensity(output.scenario)).toBeGreaterThan(scenarioIntensity(baseline));
  });
});
