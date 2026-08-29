import { classifyExposure, classifyHazard, hazardIndex } from "./hazard";
import type {
  AssetExposure,
  FloodSimulationEngine,
  InfrastructureAsset,
  MissionEvent,
  MissionExecutionProvider,
  ModelProvenance,
  ScenarioComparison,
  SimulationFrame,
  SimulationRun,
  SimulationScenario,
} from "./domain";

export const TIMELINE = [0, 10, 20, 30, 45, 60, 90, 120];

export function validateScenario(scenario: SimulationScenario): string[] {
  const errors: string[] = [];
  if (scenario.scenarioType === "reference_event") {
    if (!scenario.referenceReleaseMillionM3 || scenario.referenceReleaseMillionM3 < 60 || scenario.referenceReleaseMillionM3 > 140) {
      errors.push("Reference event must carry a separate approximately 100 million m3 release estimate with uncertainty.");
    }
    return errors;
  }
  if (scenario.lakeVolumeMillionM3 < 2 || scenario.lakeVolumeMillionM3 > 5) {
    errors.push("Barrier lake volume must be between 2.0 and 5.0 million m3.");
  }
  if (scenario.breachDurationMinutes < 10 || scenario.breachDurationMinutes > 120) {
    errors.push("Breach duration must be between 10 and 120 minutes.");
  }
  if (scenario.rainfallMultiplier < 0.5 || scenario.rainfallMultiplier > 2) {
    errors.push("Rainfall multiplier must be between 0.5x and 2.0x.");
  }
  if (scenario.debrisPercent < 0 || scenario.debrisPercent > 50) {
    errors.push("Debris content must be between 0 and 50 percent.");
  }
  return errors;
}

function mechanismFactor(mechanism: SimulationScenario["breachMechanism"]): number {
  return {
    slow_overtopping: 0.72,
    partial_breach: 0.95,
    rapid_breach: 1.18,
    catastrophic_breach: 1.38,
  }[mechanism];
}

function enumFactor(value: string, values: Record<string, number>): number {
  return values[value] ?? 1;
}

export function scenarioIntensity(scenario: SimulationScenario): number {
  if (scenario.scenarioType === "reference_event") {
    const referenceVolume = scenario.referenceReleaseMillionM3 ?? 100;
    return Number((3.85 * (referenceVolume / 100)).toFixed(3));
  }
  const volume = 0.75 + (scenario.lakeVolumeMillionM3 - 2) / 3;
  const rainfall = 0.85 + scenario.rainfallMultiplier * 0.16;
  const flow = enumFactor(scenario.antecedentFlow, { low: 0.86, normal: 1, high: 1.16, extreme: 1.34 });
  const debris = 1 + scenario.debrisPercent / 140;
  const width = enumFactor(scenario.relativeBreachWidth, { small: 0.88, medium: 1, large: 1.14, extreme: 1.28 });
  const roughness = enumFactor(scenario.channelRoughness, { low: 1.08, normal: 1, high: 0.9 });
  const obstruction = enumFactor(scenario.bridgeCondition, {
    existing: 1,
    partially_blocked: 1.09,
    fully_blocked: 1.18,
    failed_open_channel: 0.96,
  });
  return Number((volume * mechanismFactor(scenario.breachMechanism) * rainfall * flow * debris * width * roughness * obstruction * (scenario.secondaryBlockage ? 1.08 : 1)).toFixed(3));
}

export function interpolateFrame(a: SimulationFrame, b: SimulationFrame, timeMinutes: number): SimulationFrame {
  if (a.timeMinutes === b.timeMinutes) return a;
  const t = (timeMinutes - a.timeMinutes) / (b.timeMinutes - a.timeMinutes);
  const mix = (x: number, y: number) => Number((x + (y - x) * t).toFixed(3));
  const coord = (point: number[], index: 0 | 1) => point[index] ?? 0;
  const footprint = a.footprint.map((p, i) => {
    const q = b.footprint[i] ?? p;
    return [mix(coord(p, 0), coord(q, 0)), mix(coord(p, 1), coord(q, 1))];
  });
  return {
    timeMinutes,
    footprint,
    centerline: a.centerline,
    meanDepthM: mix(a.meanDepthM, b.meanDepthM),
    maxDepthM: mix(a.maxDepthM, b.maxDepthM),
    velocityMS: mix(a.velocityMS, b.velocityMS),
    hazardIndex: hazardIndex(mix(a.maxDepthM, b.maxDepthM), mix(a.velocityMS, b.velocityMS)),
    classification: "estimated",
  };
}

export function frameAt(run: SimulationRun, timeMinutes: number): SimulationFrame {
  const frames = [...run.frames].sort((a, b) => a.timeMinutes - b.timeMinutes);
  if (!frames[0]) throw new Error(`Simulation run ${run.id} has no frames.`);
  const exact = frames.find((f) => f.timeMinutes === timeMinutes);
  if (exact) return exact;
  const before = frames.filter((f) => f.timeMinutes <= timeMinutes).at(-1) ?? frames[0];
  const after = frames.find((f) => f.timeMinutes >= timeMinutes) ?? frames.at(-1) ?? before;
  return interpolateFrame(before, after, timeMinutes);
}

export function calculateAssetExposure(run: SimulationRun, assets: InfrastructureAsset[]): AssetExposure[] {
  const intensity = scenarioIntensity(run.scenario);
  return assets.map((asset) => {
    const arrival = Math.max(8, Math.round(asset.corridorKm * (1.6 - Math.min(0.7, intensity / 5))));
    const reachFactor = Math.max(0, Math.min(1.5, intensity - asset.corridorKm / 165 + (asset.kind === "bridge" ? 0.12 : 0)));
    const depth = Number(Math.max(0, reachFactor * 2.15 + (asset.kind === "settlement" ? -0.28 : 0.15)).toFixed(1));
    const velocity = Number(Math.max(0, run.frames.reduce((m, f) => Math.max(m, f.velocityMS), 0) * (0.72 + reachFactor / 4)).toFixed(1));
    const hazard = classifyHazard(hazardIndex(depth, velocity));
    return {
      assetId: asset.id,
      arrivalTimeMinutes: depth > 0.05 ? arrival : null,
      maxModeledDepthM: depth,
      maxModeledVelocityMS: velocity,
      hazard,
      exposure: classifyExposure(depth, hazard),
      confidence: asset.classification === "observed" ? "medium" : "low",
      classification: run.approximation ? "estimated" : "simulated",
    };
  });
}

export class PrecomputedSimulationEngine implements FloodSimulationEngine {
  constructor(
    private readonly anchorRuns: SimulationRun[],
    private readonly assets: InfrastructureAsset[],
    private readonly baseProvenance: ModelProvenance,
  ) {}

  async runScenario(input: SimulationScenario): Promise<SimulationRun> {
    const errors = validateScenario(input);
    if (errors.length) throw new Error(errors.join(" "));
    const exact = this.anchorRuns.find((run) => run.scenario.id === input.id);
    if (exact) return { ...exact, assetExposure: calculateAssetExposure(exact, this.assets) };

    const target = scenarioIntensity(input);
    const anchors = [...this.anchorRuns].sort(
      (a, b) => Math.abs(scenarioIntensity(a.scenario) - target) - Math.abs(scenarioIntensity(b.scenario) - target),
    );
    if (!anchors[0]) throw new Error("No precomputed scenario anchors are available.");
    const [a, b = a] = anchors;
    const aScore = scenarioIntensity(a.scenario);
    const bScore = scenarioIntensity(b.scenario);
    const span = Math.max(0.001, Math.abs(bScore - aScore));
    const weight = Math.max(0, Math.min(1, Math.abs(target - aScore) / span));
    const mix = (x: number, y: number) => Number((x + (y - x) * weight).toFixed(3));
    const frames = a.frames.map((frame, index) => {
      const other = b.frames[index] ?? frame;
      const scale = Math.max(0.62, Math.min(1.65, target / Math.max(0.1, aScore)));
      const coord = (point: number[], axis: 0 | 1) => point[axis] ?? 0;
      return {
        ...frame,
        footprint: frame.footprint.map((p, i) => {
          const center = frame.centerline[Math.min(i, Math.max(0, frame.centerline.length - 1))] ?? p;
          const q = other.footprint[i] ?? p;
          const lon = mix(coord(p, 0), coord(q, 0));
          const lat = mix(coord(p, 1), coord(q, 1));
          const centerLon = coord(center, 0);
          const centerLat = coord(center, 1);
          return [Number((centerLon + (lon - centerLon) * scale).toFixed(6)), Number((centerLat + (lat - centerLat) * scale).toFixed(6))];
        }),
        meanDepthM: Number((mix(frame.meanDepthM, other.meanDepthM) * scale).toFixed(2)),
        maxDepthM: Number((mix(frame.maxDepthM, other.maxDepthM) * scale).toFixed(2)),
        velocityMS: Number((mix(frame.velocityMS, other.velocityMS) * Math.sqrt(scale)).toFixed(2)),
        hazardIndex: hazardIndex(mix(frame.maxDepthM, other.maxDepthM) * scale, mix(frame.velocityMS, other.velocityMS) * Math.sqrt(scale)),
        classification: "estimated" as const,
      };
    });
    const run: SimulationRun = {
      id: `approx-${Date.now()}`,
      scenario: input,
      frames,
      metrics: buildMetrics(frames, []),
      rasterMetadata: {
        scenarioId: input.id,
        resolutionM: 90,
        horizontalDatum: "WGS84",
        verticalDatum: "representative relative depth",
        classification: "estimated",
        notes: "Interactive surrogate derived from the nearest precomputed scenario envelopes.",
      },
      assetExposure: [],
      provenance: {
        ...this.baseProvenance,
        classification: "estimated",
        generationMethod: "Interpolated from precomputed representative scenario envelopes in the browser.",
        limitations: [
          "Not a newly executed hydraulic solver run.",
          "Synthetic flood surfaces are constrained to real corridor geography but not calibrated to observed water depths.",
        ],
      },
      approximation: true,
    };
    run.assetExposure = calculateAssetExposure(run, this.assets);
    run.metrics = buildMetrics(run.frames, run.assetExposure);
    return run;
  }
}

export function buildMetrics(frames: SimulationFrame[], exposure: AssetExposure[]) {
  if (!frames[0]) throw new Error("Cannot build metrics without simulation frames.");
  const maxFrame = frames.reduce((best, frame) => (frame.maxDepthM > best.maxDepthM ? frame : best), frames[0]);
  const exposed = exposure.filter((x) => x.exposure !== "none");
  const bridgeExposure = exposed.filter((x) => x.assetId.includes("bridge")).length;
  const settlementExposure = exposed.filter((x) => x.assetId.includes("settlement")).length;
  return [
    { id: "extent", label: "Modeled inundated area", value: Number((maxFrame.footprint.length * maxFrame.meanDepthM * 0.42).toFixed(1)), unit: "ha", classification: "estimated" as const },
    { id: "depth", label: "Maximum modeled depth", value: maxFrame.maxDepthM, unit: "m", classification: "estimated" as const },
    { id: "velocity", label: "Maximum modeled velocity", value: maxFrame.velocityMS, unit: "m/s", classification: "estimated" as const },
    { id: "roads", label: "Road length exposed", value: Number((exposed.length * 1.35).toFixed(1)), unit: "km", classification: "estimated" as const },
    { id: "bridges", label: "Bridges exposed", value: bridgeExposure, unit: "assets", classification: "estimated" as const },
    { id: "settlements", label: "Settlements intersecting hazard", value: settlementExposure, unit: "settlements", classification: "estimated" as const },
  ];
}

export function compareRuns(a: SimulationRun, b: SimulationRun): ScenarioComparison {
  const metric = (run: SimulationRun, id: string) => run.metrics.find((m) => m.id === id)?.value ?? 0;
  const firstArrival = (run: SimulationRun) =>
    Math.min(...run.assetExposure.map((x) => x.arrivalTimeMinutes ?? 999).filter((x) => x < 999), 999);
  return {
    scenarioA: a.scenario.name,
    scenarioB: b.scenario.name,
    extentDeltaHa: Number((metric(b, "extent") - metric(a, "extent")).toFixed(1)),
    arrivalDeltaMinutes: firstArrival(b) - firstArrival(a),
    depthDeltaM: Number((metric(b, "depth") - metric(a, "depth")).toFixed(1)),
    velocityDeltaMS: Number((metric(b, "velocity") - metric(a, "velocity")).toFixed(1)),
    roadExposureDeltaKm: Number((metric(b, "roads") - metric(a, "roads")).toFixed(1)),
    bridgeExposureDeltaCount: metric(b, "bridges") - metric(a, "bridges"),
    settlementExposureDeltaCount: metric(b, "settlements") - metric(a, "settlements"),
    classification: b.approximation ? "estimated" : "simulated",
  };
}

export class ShowcaseMissionProvider implements MissionExecutionProvider {
  async *execute(_scenario: SimulationScenario): AsyncIterable<MissionEvent> {
    const labels = [
      "Validate scenario",
      "Load scenario envelope",
      "Resolve terrain context",
      "Generate release hydrograph",
      "Select anchor models",
      "Compute scenario approximation",
      "Validate numerical bounds",
      "Compute infrastructure exposure",
      "Generate timeline frames",
      "Update 3D digital twin",
      "Generate scenario summary",
    ];
    for (const [index, label] of labels.entries()) {
      const started = performance.now();
      yield { step: { id: `m${index}`, label, status: "running", classification: "representative" }, message: label };
      await Promise.resolve();
      yield {
        step: { id: `m${index}`, label, status: "complete", classification: "representative", elapsedMs: Math.max(1, Math.round(performance.now() - started)) },
        message: `${label} complete`,
      };
    }
  }
}
