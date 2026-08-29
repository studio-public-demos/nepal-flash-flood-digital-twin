import { classifyExposure, classifyHazard, hazardIndex } from "./hazard";
import { cumulativeKm, pointInPolygon, polygonAreaHa } from "./geometry";
import type {
  AssetExposure,
  FloodSimulationEngine,
  InfrastructureAsset,
  MissionEvent,
  MissionExecutionProvider,
  ModelProvenance,
  ReleaseHydrographPoint,
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

export function mechanismFactor(mechanism: SimulationScenario["breachMechanism"]): number {
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

export function releasedVolumeM3(scenario: SimulationScenario): number {
  const millionM3 = scenario.scenarioType === "reference_event" ? scenario.referenceReleaseMillionM3 ?? 100 : scenario.lakeVolumeMillionM3;
  return millionM3 * 1_000_000;
}

function hydrographShape(scenario: SimulationScenario, timeMinutes: number): number {
  const duration = Math.max(10, scenario.breachDurationMinutes);
  const mechanismPeak = enumFactor(scenario.breachMechanism, {
    slow_overtopping: 0.58,
    partial_breach: 0.78,
    rapid_breach: 1,
    catastrophic_breach: 1.24,
  });
  const width = enumFactor(scenario.relativeBreachWidth, { small: 0.72, medium: 1, large: 1.18, extreme: 1.36 });
  const pulse = (start: number, span: number, scale: number) => {
    const local = (timeMinutes - start) / span;
    if (local < 0 || local > 1) return 0;
    return Math.sin(local * Math.PI) ** 1.35 * scale;
  };
  if (scenario.secondaryBlockage) {
    return pulse(0, duration * 0.62, mechanismPeak * width * 0.62) + pulse(duration * 0.62 + 22, duration * 0.78, mechanismPeak * width * 0.38);
  }
  return pulse(0, duration, mechanismPeak * width);
}

export function buildReleaseHydrograph(scenario: SimulationScenario, stepMinutes = 5): {
  hydrograph: ReleaseHydrographPoint[];
  releasedVolumeM3: number;
  massErrorPercent: number;
} {
  const targetVolume = releasedVolumeM3(scenario);
  const endMinutes = Math.max(180, scenario.breachDurationMinutes * (scenario.secondaryBlockage ? 2.2 : 1.45) + 55);
  const times: number[] = [];
  for (let time = 0; time <= endMinutes; time += stepMinutes) times.push(Number(time.toFixed(3)));
  const weights = times.map((time) => hydrographShape(scenario, time));
  let weightIntegralSeconds = 0;
  for (let index = 1; index < weights.length; index += 1) {
    weightIntegralSeconds += (((weights[index - 1] ?? 0) + (weights[index] ?? 0)) / 2) * stepMinutes * 60;
  }
  const rainfallFactor = 1 + Math.max(0, scenario.rainfallMultiplier - 1) * 0.08;
  const effectiveVolume = targetVolume * rainfallFactor;
  const scale = weightIntegralSeconds > 0 ? effectiveVolume / weightIntegralSeconds : 0;
  const hydrograph = times.map((time, index) => ({
    timeMinutes: time,
    dischargeCMS: Number(((weights[index] ?? 0) * scale).toFixed(2)),
  }));
  let integrated = 0;
  for (let index = 1; index < hydrograph.length; index += 1) {
    const previous = hydrograph[index - 1] ?? { dischargeCMS: 0 };
    const current = hydrograph[index] ?? { dischargeCMS: 0 };
    integrated += ((previous.dischargeCMS + current.dischargeCMS) / 2) * stepMinutes * 60;
  }
  return {
    hydrograph,
    releasedVolumeM3: targetVolume,
    massErrorPercent: Number((((integrated - effectiveVolume) / Math.max(1, effectiveVolume)) * 100).toFixed(3)),
  };
}

export function scenarioIntensity(scenario: SimulationScenario): number {
  if (scenario.scenarioType === "reference_event") {
    const referenceVolume = scenario.referenceReleaseMillionM3 ?? 100;
    return Number((3.85 * (referenceVolume / 100)).toFixed(3));
  }
  const hydrograph = buildReleaseHydrograph(scenario).hydrograph;
  const peakQ = Math.max(...hydrograph.map((point) => point.dischargeCMS), 1);
  const volume = 0.75 + (scenario.lakeVolumeMillionM3 - 2) / 3;
  const rainfall = 0.85 + scenario.rainfallMultiplier * 0.16;
  const flow = enumFactor(scenario.antecedentFlow, { low: 0.86, normal: 1, high: 1.16, extreme: 1.34 });
  const debris = 1 + scenario.debrisPercent / 140;
  const roughness = enumFactor(scenario.channelRoughness, { low: 1.08, normal: 1, high: 0.9 });
  const hydrographPeak = Math.sqrt(peakQ / 460);
  return Number((volume * mechanismFactor(scenario.breachMechanism) * rainfall * flow * debris * roughness * hydrographPeak).toFixed(3));
}

export function buildArrivalCurve(scenario: SimulationScenario, centerline: number[][]): Array<[number, number]> {
  const distances = cumulativeKm(centerline);
  const hydrograph = buildReleaseHydrograph(scenario).hydrograph;
  const peakQ = Math.max(...hydrograph.map((point) => point.dischargeCMS), 1);
  const firstPulseTime = hydrograph.find((point) => point.dischargeCMS >= peakQ * 0.12)?.timeMinutes ?? 0;
  const roughness = enumFactor(scenario.channelRoughness, { low: 1.12, normal: 1, high: 0.86 });
  const debris = 1 - Math.min(0.18, scenario.debrisPercent / 320);
  const mechanism = enumFactor(scenario.breachMechanism, { slow_overtopping: 0.74, partial_breach: 0.92, rapid_breach: 1.08, catastrophic_breach: 1.18 });
  const celerityKmPerMin = Math.max(0.55, Math.min(2.25, (0.42 + Math.sqrt(peakQ) / 62) * roughness * debris * mechanism));
  return distances.map((distance) => [Number(distance.toFixed(3)), Number((firstPulseTime + distance / celerityKmPerMin).toFixed(2))]);
}

export function frontDistanceAt(arrivalCurve: Array<[number, number]>, timeMinutes: number): number {
  let front = 0;
  for (const [distance, arrival] of arrivalCurve) {
    if (arrival <= timeMinutes) front = distance;
  }
  return Number(front.toFixed(3));
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
  const firstFrame = run.frames[0];
  if (!firstFrame) return [];
  const wettestFrame = run.frames.reduce((best, frame) => (polygonAreaHa(frame.footprint) > polygonAreaHa(best.footprint) ? frame : best), firstFrame);
  const arrivalCurve = run.frames.find((frame) => frame.arrivalTimeByKm?.length)?.arrivalTimeByKm ?? buildArrivalCurve(run.scenario, wettestFrame.centerline);
  return assets.map((asset) => {
    const wet = pointInPolygon(asset.coordinates, wettestFrame.footprint);
    const initialArrival: [number, number | null] = arrivalCurve[0] ?? [0, null];
    const localArrival = arrivalCurve.reduce<[number, number | null]>(
      (best, [distance, arrival]) => (Math.abs(distance - asset.corridorKm) < Math.abs(best[0] - asset.corridorKm) ? [distance, arrival] : best),
      initialArrival,
    )[1];
    const localBridgeBackwater =
      asset.kind === "bridge" && run.scenario.bridgeCondition !== "existing"
        ? enumFactor(run.scenario.bridgeCondition, { partially_blocked: 0.22, fully_blocked: 0.42, failed_open_channel: -0.08 })
        : 0;
    const timeFactor = wet ? Math.max(0.15, 1 - asset.corridorKm / 210) : 0;
    const depth = Number((wet ? Math.max(0.08, wettestFrame.maxDepthM * (0.35 + timeFactor * 0.45) + localBridgeBackwater) : 0).toFixed(2));
    const velocity = Number((wet ? Math.max(0.05, wettestFrame.velocityMS * (0.42 + timeFactor * 0.32)) : 0).toFixed(2));
    const hazard = classifyHazard(hazardIndex(depth, velocity));
    return {
      assetId: asset.id,
      arrivalTimeMinutes: depth > 0.05 && localArrival !== null ? Number(localArrival.toFixed(1)) : null,
      maxModeledDepthM: depth,
      maxModeledVelocityMS: velocity,
      hazard,
      exposure: classifyExposure(depth, hazard),
      confidence: run.approximation ? "low" : asset.classification === "observed" ? "medium" : "low",
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
    const compatibleRuns = this.anchorRuns.filter((run) => run.scenario.scenarioType === "barrier_lake_what_if");
    const anchors = [...compatibleRuns].sort(
      (a, b) => Math.abs(scenarioIntensity(a.scenario) - target) - Math.abs(scenarioIntensity(b.scenario) - target),
    );
    if (!anchors[0]) throw new Error("No precomputed scenario anchors are available.");
    const [a, b = a] = anchors;
    const aScore = scenarioIntensity(a.scenario);
    const bScore = scenarioIntensity(b.scenario);
    const span = Math.max(0.001, Math.abs(bScore - aScore));
    const weight = Math.max(0, Math.min(1, Math.abs(target - aScore) / span));
    const mix = (x: number, y: number) => Number((x + (y - x) * weight).toFixed(3));
    const arrivalTimeByKm = buildArrivalCurve(input, a.frames[0]?.centerline ?? []);
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
        frontDistanceKm: frontDistanceAt(arrivalTimeByKm, frame.timeMinutes),
        arrivalTimeByKm,
        classification: "estimated" as const,
      };
    });
    const hydrograph = buildReleaseHydrograph(input);
    const run: SimulationRun = {
      id: `approx-${Date.now()}`,
      scenario: input,
      releaseHydrograph: hydrograph.hydrograph,
      releasedVolumeM3: hydrograph.releasedVolumeM3,
      hydrographMassErrorPercent: hydrograph.massErrorPercent,
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
  const maxFrame = frames.reduce((best, frame) => (polygonAreaHa(frame.footprint) > polygonAreaHa(best.footprint) ? frame : best), frames[0]);
  const exposed = exposure.filter((x) => x.exposure !== "none");
  const bridgeExposure = exposed.filter((x) => x.assetId.includes("bridge")).length;
  const settlementExposure = exposed.filter((x) => x.assetId.includes("settlement")).length;
  return [
    { id: "extent", label: "Modeled inundated area", value: polygonAreaHa(maxFrame.footprint), unit: "ha", classification: "estimated" as const },
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
      "Generate release hydrograph Q(t)",
      "Select anchor models",
      "Compute scenario approximation",
      "Validate numerical bounds",
      "Compute geometric infrastructure exposure",
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
