// src/nepal-flash-flood/hazard.ts
function hazardIndex(depthM, velocityMS) {
  return Number((Math.max(0, depthM) * Math.max(0, velocityMS)).toFixed(2));
}
function classifyHazard(index) {
  if (index <= 0.05) return "none";
  if (index < 0.8) return "low";
  if (index < 2) return "moderate";
  if (index < 4) return "high";
  return "very_high";
}
function classifyExposure(depthM, hazard) {
  if (depthM <= 0.05 || hazard === "none") return "none";
  if (depthM < 0.6) return "low";
  if (depthM < 1.8 && hazard !== "very_high") return "moderate";
  return "high";
}

// src/nepal-flash-flood/geometry.ts
var EARTH_RADIUS_M = 63710088e-1;
function distanceKm(a, b) {
  const toRad = (value) => value * Math.PI / 180;
  const dLat = toRad((b[1] ?? 0) - (a[1] ?? 0));
  const dLon = toRad((b[0] ?? 0) - (a[0] ?? 0));
  const lat1 = toRad(a[1] ?? 0);
  const lat2 = toRad(b[1] ?? 0);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h))) / 1e3;
}
function referenceLatRad(points) {
  const lat = points.reduce((sum, point) => sum + (point[1] ?? 0), 0) / Math.max(1, points.length);
  return lat * Math.PI / 180;
}
function project(point, lat0) {
  const lon = (point[0] ?? 0) * Math.PI / 180;
  const lat = (point[1] ?? 0) * Math.PI / 180;
  return [EARTH_RADIUS_M * lon * Math.cos(lat0), EARTH_RADIUS_M * lat];
}
function polygonAreaHa(ring) {
  if (ring.length < 3) return 0;
  const closed = ring[0]?.[0] === ring.at(-1)?.[0] && ring[0]?.[1] === ring.at(-1)?.[1] ? ring : [...ring, ring[0] ?? [0, 0]];
  const lat0 = referenceLatRad(closed);
  let sum = 0;
  for (let index = 0; index < closed.length - 1; index += 1) {
    const [x1, y1] = project(closed[index] ?? [0, 0], lat0);
    const [x2, y2] = project(closed[index + 1] ?? [0, 0], lat0);
    sum += x1 * y2 - x2 * y1;
  }
  return Number((Math.abs(sum) / 2 / 1e4).toFixed(2));
}
function pointInPolygon(point, polygon) {
  if (polygon.length < 3) return false;
  const x = point[0] ?? 0;
  const y = point[1] ?? 0;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i]?.[0] ?? 0;
    const yi = polygon[i]?.[1] ?? 0;
    const xj = polygon[j]?.[0] ?? 0;
    const yj = polygon[j]?.[1] ?? 0;
    const intersects = yi > y !== yj > y && x < (xj - xi) * (y - yi) / Math.max(1e-12, yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}
function cumulativeKm(line) {
  const distances = [0];
  for (let index = 1; index < line.length; index += 1) {
    distances.push((distances.at(-1) ?? 0) + distanceKm(line[index - 1] ?? [0, 0], line[index] ?? [0, 0]));
  }
  return distances.map((value) => Number(value.toFixed(3)));
}

// src/nepal-flash-flood/engine.ts
function validateScenario(scenario) {
  const errors = [];
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
function mechanismFactor(mechanism) {
  return {
    slow_overtopping: 0.72,
    partial_breach: 0.95,
    rapid_breach: 1.18,
    catastrophic_breach: 1.38
  }[mechanism];
}
function enumFactor(value, values) {
  return values[value] ?? 1;
}
function releasedVolumeM3(scenario) {
  const millionM3 = scenario.scenarioType === "reference_event" ? scenario.referenceReleaseMillionM3 ?? 100 : scenario.lakeVolumeMillionM3;
  return millionM3 * 1e6;
}
function hydrographShape(scenario, timeMinutes) {
  const duration = Math.max(10, scenario.breachDurationMinutes);
  const mechanismPeak = enumFactor(scenario.breachMechanism, {
    slow_overtopping: 0.58,
    partial_breach: 0.78,
    rapid_breach: 1,
    catastrophic_breach: 1.24
  });
  const width = enumFactor(scenario.relativeBreachWidth, { small: 0.72, medium: 1, large: 1.18, extreme: 1.36 });
  const pulse = (start, span, scale) => {
    const local = (timeMinutes - start) / span;
    if (local < 0 || local > 1) return 0;
    return Math.sin(local * Math.PI) ** 1.35 * scale;
  };
  if (scenario.secondaryBlockage) {
    return pulse(0, duration * 0.62, mechanismPeak * width * 0.62) + pulse(duration * 0.62 + 22, duration * 0.78, mechanismPeak * width * 0.38);
  }
  return pulse(0, duration, mechanismPeak * width);
}
function buildReleaseHydrograph(scenario, stepMinutes = 5) {
  const targetVolume = releasedVolumeM3(scenario);
  const endMinutes = Math.max(180, scenario.breachDurationMinutes * (scenario.secondaryBlockage ? 2.2 : 1.45) + 55);
  const times = [];
  for (let time = 0; time <= endMinutes; time += stepMinutes) times.push(Number(time.toFixed(3)));
  const weights = times.map((time) => hydrographShape(scenario, time));
  let weightIntegralSeconds = 0;
  for (let index = 1; index < weights.length; index += 1) {
    weightIntegralSeconds += ((weights[index - 1] ?? 0) + (weights[index] ?? 0)) / 2 * stepMinutes * 60;
  }
  const rainfallFactor = 1 + Math.max(0, scenario.rainfallMultiplier - 1) * 0.08;
  const effectiveVolume = targetVolume * rainfallFactor;
  const scale = weightIntegralSeconds > 0 ? effectiveVolume / weightIntegralSeconds : 0;
  const hydrograph = times.map((time, index) => ({
    timeMinutes: time,
    dischargeCMS: Number(((weights[index] ?? 0) * scale).toFixed(2))
  }));
  let integrated = 0;
  for (let index = 1; index < hydrograph.length; index += 1) {
    const previous = hydrograph[index - 1] ?? { dischargeCMS: 0 };
    const current = hydrograph[index] ?? { dischargeCMS: 0 };
    integrated += (previous.dischargeCMS + current.dischargeCMS) / 2 * stepMinutes * 60;
  }
  return {
    hydrograph,
    releasedVolumeM3: targetVolume,
    massErrorPercent: Number(((integrated - effectiveVolume) / Math.max(1, effectiveVolume) * 100).toFixed(3))
  };
}
function scenarioIntensity(scenario) {
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
function buildArrivalCurve(scenario, centerline) {
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
function frontDistanceAt(arrivalCurve, timeMinutes) {
  let front = 0;
  for (const [distance, arrival] of arrivalCurve) {
    if (arrival <= timeMinutes) front = distance;
  }
  return Number(front.toFixed(3));
}
function interpolateFrame(a, b, timeMinutes) {
  if (a.timeMinutes === b.timeMinutes) return a;
  const t = (timeMinutes - a.timeMinutes) / (b.timeMinutes - a.timeMinutes);
  const mix = (x, y) => Number((x + (y - x) * t).toFixed(3));
  const coord = (point, index) => point[index] ?? 0;
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
    classification: "estimated"
  };
}
function frameAt(run, timeMinutes) {
  const frames = [...run.frames].sort((a, b) => a.timeMinutes - b.timeMinutes);
  if (!frames[0]) throw new Error(`Simulation run ${run.id} has no frames.`);
  const exact = frames.find((f) => f.timeMinutes === timeMinutes);
  if (exact) return exact;
  const before = frames.filter((f) => f.timeMinutes <= timeMinutes).at(-1) ?? frames[0];
  const after = frames.find((f) => f.timeMinutes >= timeMinutes) ?? frames.at(-1) ?? before;
  return interpolateFrame(before, after, timeMinutes);
}
function calculateAssetExposure(run, assets) {
  const firstFrame = run.frames[0];
  if (!firstFrame) return [];
  const wettestFrame = run.frames.reduce((best, frame) => polygonAreaHa(frame.footprint) > polygonAreaHa(best.footprint) ? frame : best, firstFrame);
  const arrivalCurve = run.frames.find((frame) => frame.arrivalTimeByKm?.length)?.arrivalTimeByKm ?? buildArrivalCurve(run.scenario, wettestFrame.centerline);
  return assets.map((asset) => {
    const wet = pointInPolygon(asset.coordinates, wettestFrame.footprint);
    const initialArrival = arrivalCurve[0] ?? [0, null];
    const localArrival = arrivalCurve.reduce(
      (best, [distance, arrival]) => Math.abs(distance - asset.corridorKm) < Math.abs(best[0] - asset.corridorKm) ? [distance, arrival] : best,
      initialArrival
    )[1];
    const localBridgeBackwater = asset.kind === "bridge" && run.scenario.bridgeCondition !== "existing" ? enumFactor(run.scenario.bridgeCondition, { partially_blocked: 0.22, fully_blocked: 0.42, failed_open_channel: -0.08 }) : 0;
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
      classification: run.approximation ? "estimated" : "simulated"
    };
  });
}
var PrecomputedSimulationEngine = class {
  constructor(anchorRuns, assets, baseProvenance) {
    this.anchorRuns = anchorRuns;
    this.assets = assets;
    this.baseProvenance = baseProvenance;
  }
  async runScenario(input) {
    const errors = validateScenario(input);
    if (errors.length) throw new Error(errors.join(" "));
    const exact = this.anchorRuns.find((run2) => run2.scenario.id === input.id);
    if (exact) return { ...exact, assetExposure: calculateAssetExposure(exact, this.assets) };
    const target = scenarioIntensity(input);
    const compatibleRuns = this.anchorRuns.filter((run2) => run2.scenario.scenarioType === "barrier_lake_what_if");
    const anchors = [...compatibleRuns].sort(
      (a2, b2) => Math.abs(scenarioIntensity(a2.scenario) - target) - Math.abs(scenarioIntensity(b2.scenario) - target)
    );
    if (!anchors[0]) throw new Error("No precomputed scenario anchors are available.");
    const [a, b = a] = anchors;
    const aScore = scenarioIntensity(a.scenario);
    const bScore = scenarioIntensity(b.scenario);
    const span = Math.max(1e-3, Math.abs(bScore - aScore));
    const weight = Math.max(0, Math.min(1, Math.abs(target - aScore) / span));
    const mix = (x, y) => Number((x + (y - x) * weight).toFixed(3));
    const arrivalTimeByKm = buildArrivalCurve(input, a.frames[0]?.centerline ?? []);
    const frames = a.frames.map((frame, index) => {
      const other = b.frames[index] ?? frame;
      const scale = Math.max(0.62, Math.min(1.65, target / Math.max(0.1, aScore)));
      const coord = (point, axis) => point[axis] ?? 0;
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
        classification: "estimated"
      };
    });
    const hydrograph = buildReleaseHydrograph(input);
    const run = {
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
        notes: "Interactive surrogate derived from the nearest precomputed scenario envelopes."
      },
      assetExposure: [],
      provenance: {
        ...this.baseProvenance,
        classification: "estimated",
        generationMethod: "Interpolated from precomputed representative scenario envelopes in the browser.",
        limitations: [
          "Not a newly executed hydraulic solver run.",
          "Synthetic flood surfaces are constrained to real corridor geography but not calibrated to observed water depths."
        ]
      },
      approximation: true
    };
    run.assetExposure = calculateAssetExposure(run, this.assets);
    run.metrics = buildMetrics(run.frames, run.assetExposure);
    return run;
  }
};
function buildMetrics(frames, exposure) {
  if (!frames[0]) throw new Error("Cannot build metrics without simulation frames.");
  const maxFrame = frames.reduce((best, frame) => polygonAreaHa(frame.footprint) > polygonAreaHa(best.footprint) ? frame : best, frames[0]);
  const exposed = exposure.filter((x) => x.exposure !== "none");
  const bridgeExposure = exposed.filter((x) => x.assetId.includes("bridge")).length;
  const settlementExposure = exposed.filter((x) => x.assetId.includes("settlement")).length;
  return [
    { id: "extent", label: "Modeled inundated area", value: polygonAreaHa(maxFrame.footprint), unit: "ha", classification: "estimated" },
    { id: "depth", label: "Maximum modeled depth", value: maxFrame.maxDepthM, unit: "m", classification: "estimated" },
    { id: "velocity", label: "Maximum modeled velocity", value: maxFrame.velocityMS, unit: "m/s", classification: "estimated" },
    { id: "roads", label: "Road length exposed", value: Number((exposed.length * 1.35).toFixed(1)), unit: "km", classification: "estimated" },
    { id: "bridges", label: "Bridges exposed", value: bridgeExposure, unit: "assets", classification: "estimated" },
    { id: "settlements", label: "Settlements intersecting hazard", value: settlementExposure, unit: "settlements", classification: "estimated" }
  ];
}
function compareRuns(a, b) {
  const metric = (run, id) => run.metrics.find((m) => m.id === id)?.value ?? 0;
  const firstArrival = (run) => Math.min(...run.assetExposure.map((x) => x.arrivalTimeMinutes ?? 999).filter((x) => x < 999), 999);
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
    classification: b.approximation ? "estimated" : "simulated"
  };
}
var ShowcaseMissionProvider = class {
  async *execute(_scenario) {
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
      "Generate scenario summary"
    ];
    for (const [index, label] of labels.entries()) {
      const started = performance.now();
      yield { step: { id: `m${index}`, label, status: "running", classification: "representative" }, message: label };
      await Promise.resolve();
      yield {
        step: { id: `m${index}`, label, status: "complete", classification: "representative", elapsedMs: Math.max(1, Math.round(performance.now() - started)) },
        message: `${label} complete`
      };
    }
  }
};

// src/nepal-flash-flood/app.ts
var state = {
  runs: [],
  currentRun: null,
  referenceRun: null,
  infrastructure: [],
  observedEvidence: [],
  time: 60,
  playing: false,
  speed: 1,
  mode: "explore",
  layers: {
    waterDepth: true,
    velocity: false,
    hazard: false,
    observedEvidence: true,
    river: false,
    roads: true,
    bridges: true,
    settlements: true,
    critical: true
  },
  viewer: null,
  waterEntities: [],
  flowEntities: [],
  observedEntities: [],
  journeyEntities: [],
  assetEntities: [],
  terrainSamples: [],
  terrainSections: [],
  terrainStatus: "Terrain profile pending",
  flowCanvas: null,
  flowContext: null,
  flowParticles: [],
  flowAnimationStarted: false,
  lastFlowMs: 0,
  timer: 0,
  mission: new ShowcaseMissionProvider(),
  engine: null
};
var $ = (selector) => document.querySelector(selector);
var CORRIDOR_VIEW = {
  longitude: 84.93,
  latitude: 27.95,
  height: 98e3,
  headingDeg: 332,
  pitchDeg: -52
};
var eventReaches = [
  { progress: 0, name: "Rasuwagadhi border crossing", cue: "Initial outburst pulse enters the Nepal corridor." },
  { progress: 8, name: "Timure reach", cue: "Debris-rich flow accelerates through the confined valley." },
  { progress: 18, name: "Syabrubesi and upper Trishuli", cue: "Fast water occupies the main channel and low floodplain benches." },
  { progress: 46, name: "Betrawati reach", cue: "The surge spreads through wider valley floor sections." },
  { progress: 62, name: "Devighat utility corridor", cue: "High-velocity flow approaches critical downstream assets." },
  { progress: 74, name: "Galchhi bend", cue: "The flood wave wraps around the real river bend, not a straight chord." },
  { progress: 82, name: "Malekhu downstream reach", cue: "The leading pulse transitions into a broader sediment-laden flood trace." },
  { progress: 108, name: "Lower Trishuli bend", cue: "Downstream flow continues through communities beyond the initial showcase corridor." },
  { progress: 128, name: "Downstream Trishuli transport reach", cue: "Modeled exposure shifts from upper-valley surge to downstream access and monitoring impacts." },
  { progress: 148, name: "Lower Trishuli terminus", cue: "The event trace remains visible far downstream in the mapped river network." }
];
var storyStages = [
  {
    id: "source",
    progress: 0,
    label: "Source",
    title: "Upper catchment trigger",
    time: "26 Aug 2026, before first post-event collect",
    modeledTime: "T+00 min",
    detail: "Planet catalog context cites preliminary expert assessment of an ice and rock avalanche from a glacier in the upper catchment; cause still under investigation.",
    classification: "published context"
  },
  {
    id: "border",
    progress: 3,
    label: "Border",
    title: "Rasuwagadhi entry",
    time: "Observed in 27 Aug 2026 SkySat/Pelican focal coverage",
    modeledTime: "T+02 min",
    detail: "The outburst flood enters the mapped Nepal corridor near the border crossing.",
    classification: "observed geography"
  },
  {
    id: "upper",
    progress: 18,
    label: "Upper valley",
    title: "Timure to Syabrubesi",
    time: "27 Aug 2026 02:00 UTC SkySat; 06:10 UTC Pelican",
    modeledTime: "T+14 min",
    detail: "Next-day SkySat and Pelican coverage focuses on Rasuwagadhi and Syabrubesi, where high-resolution evidence is available.",
    classification: "observed scene coverage"
  },
  {
    id: "middle",
    progress: 58,
    label: "Middle reaches",
    title: "Betrawati to Devighat",
    time: "26 Aug 2026 05:01 and 05:45 UTC PlanetScope swaths",
    modeledTime: "T+47 min",
    detail: "The mapped surge path follows the Trishuli through settlements, crossings and utility corridors.",
    classification: "observed geography + modeled impact"
  },
  {
    id: "downstream",
    progress: 104,
    label: "Downstream",
    title: "Lower Trishuli continuation",
    time: "28 Aug 2026 04:57 and 05:01 UTC PlanetScope lower-corridor strip",
    modeledTime: "T+84 min",
    detail: "The corridor continues beyond Malekhu through connected OSM Trisuli ways and downstream communities.",
    classification: "observed geography + modeled impact"
  },
  {
    id: "end",
    progress: 148,
    label: "End",
    title: "Lower visible terminus",
    time: "Showcase extent; not official hydrologic endpoint",
    modeledTime: "T+120 min",
    detail: "The public showcase ends at the lower mapped Trishuli reach covered by the extended river path, not at the event's official hydrologic endpoint.",
    classification: "showcase extent"
  }
];
function track(name, detail = {}) {
  window.dispatchEvent(new CustomEvent("studio-analytics", { detail: { name, ...detail } }));
  console.info(`[analytics] ${name}`, detail);
}
async function loadData() {
  const [scenarioRes, infraRes, evidenceRes] = await Promise.all([fetch("./data/scenarios.json"), fetch("./data/infrastructure.geojson"), fetch("./data/observed-evidence.geojson")]);
  if (!scenarioRes.ok || !infraRes.ok) throw new Error("Scenario or infrastructure data could not be loaded.");
  const scenarioData = await scenarioRes.json();
  const geojson = await infraRes.json();
  const evidence = evidenceRes.ok ? await evidenceRes.json() : { features: [] };
  state.runs = scenarioData.runs;
  state.referenceRun = scenarioData.runs.find((run) => run.id === "S0") ?? scenarioData.runs[0] ?? null;
  state.currentRun = state.referenceRun;
  state.observedEvidence = evidence.features;
  state.infrastructure = geojson.features.filter((feature) => feature.geometry.type === "Point").map((feature) => feature.properties);
  state.engine = new PrecomputedSimulationEngine(state.runs, state.infrastructure, scenarioData.provenance);
}
async function loadRuntimeConfig() {
  const host = window.location.hostname;
  if (host && host !== "localhost" && host !== "127.0.0.1") return;
  if (!new URLSearchParams(window.location.search).has("local-config")) return;
  try {
    const response = await fetch("./config.local.json", { cache: "no-store" });
    if (!response.ok) return;
    const config = await response.json();
    window.NEPAL_FLOOD_CONFIG = { ...window.NEPAL_FLOOD_CONFIG, ...config };
  } catch {
  }
}
function getCesiumToken() {
  const metaToken = document.querySelector('meta[name="cesium-ion-token"]')?.content.trim();
  const runtimeToken = window.NEPAL_FLOOD_CONFIG?.cesiumIonToken?.trim();
  const localToken = (() => {
    try {
      return window.localStorage.getItem("NEPAL_FLOOD_CESIUM_ION_TOKEN")?.trim();
    } catch {
      return "";
    }
  })();
  return runtimeToken || metaToken || localToken || "";
}
async function initTerrainProvider(Cesium, token) {
  if (token) {
    try {
      return await Cesium.CesiumTerrainProvider.fromIonAssetId(1);
    } catch (error) {
      console.warn("Cesium World Terrain unavailable; trying open elevation terrain.", error);
    }
  }
  if (Cesium.ArcGISTiledElevationTerrainProvider?.fromUrl) {
    try {
      return await Cesium.ArcGISTiledElevationTerrainProvider.fromUrl(
        "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer"
      );
    } catch (error) {
      console.warn("ArcGIS World Elevation terrain unavailable; falling back to ellipsoid terrain.", error);
    }
  }
  return new Cesium.EllipsoidTerrainProvider();
}
async function initImageryProvider(Cesium, token) {
  if (token) {
    try {
      return await Cesium.IonImageryProvider.fromAssetId(2);
    } catch (error) {
      console.warn("Cesium ion imagery unavailable; falling back to public satellite imagery.", error);
    }
  }
  return new Cesium.UrlTemplateImageryProvider({
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    credit: "Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    maximumLevel: 19
  });
}
function loadScript(src, timeoutMs) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing?.dataset.loaded === "true") {
      resolve();
      return;
    }
    const script = existing ?? document.createElement("script");
    const timeout = window.setTimeout(() => reject(new Error(`Timed out loading ${src}`)), timeoutMs);
    script.addEventListener("load", () => {
      window.clearTimeout(timeout);
      script.dataset.loaded = "true";
      resolve();
    }, { once: true });
    script.addEventListener("error", () => {
      window.clearTimeout(timeout);
      reject(new Error(`Failed to load ${src}`));
    }, { once: true });
    if (!existing) {
      script.src = src;
      script.async = true;
      document.head.append(script);
    }
  });
}
async function ensureCesium() {
  if (window.Cesium) return window.Cesium;
  const cdns = [
    "https://cdn.jsdelivr.net/npm/cesium@1.121/Build/Cesium/Cesium.js",
    "https://unpkg.com/cesium@1.121/Build/Cesium/Cesium.js"
  ];
  for (const src of cdns) {
    try {
      await loadScript(src, 12e3);
      if (window.Cesium) return window.Cesium;
    } catch (error) {
      console.warn("Cesium script source unavailable.", error);
    }
  }
  return null;
}
async function initCesium() {
  const container = $("#cesium");
  container.innerHTML = `<div class="viewport-fallback"><strong>Loading 3D terrain...</strong><span>Preparing the Nepal digital twin viewport and representative flood layers.</span></div>`;
  const Cesium = await ensureCesium();
  if (!Cesium) {
    container.innerHTML = `<div class="viewport-fallback"><strong>3D engine unavailable.</strong><span>The simulator controls still work with representative scenario data. Check your network connection and reload to retry CesiumJS.</span></div>`;
    return;
  }
  const token = getCesiumToken();
  if (token) Cesium.Ion.defaultAccessToken = token;
  try {
    const terrainProvider = await initTerrainProvider(Cesium, token);
    const imageryProvider = await initImageryProvider(Cesium, token);
    container.innerHTML = "";
    state.viewer = new Cesium.Viewer("cesium", {
      terrainProvider,
      imageryProvider,
      animation: false,
      baseLayerPicker: false,
      geocoder: false,
      timeline: false,
      homeButton: false,
      fullscreenButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      infoBox: false,
      selectionIndicator: false
    });
    window.NEPAL_FLOOD_CONFIG = { ...window.NEPAL_FLOOD_CONFIG, viewer: state.viewer };
    state.viewer.scene.skyBox.show = false;
    state.viewer.scene.skyAtmosphere.show = false;
    state.viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#dbeafe");
    state.viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#e5e7eb");
    state.viewer.imageryLayers.removeAll();
    state.viewer.imageryLayers.addImageryProvider(imageryProvider);
    state.viewer.scene.globe.depthTestAgainstTerrain = false;
    focusCorridor(0);
    await sampleCorridorTerrain();
    drawStaticLayers();
    renderFrame();
    setupFluidCanvas();
  } catch (error) {
    console.error(error);
    container.innerHTML = `<div class="viewport-fallback"><strong>Terrain unavailable.</strong><span>Cesium started with a problem. The controls and data panels remain usable; reload or configure CESIUM_ION_TOKEN for terrain.</span></div>`;
  }
}
async function sampleCorridorTerrain() {
  if (!state.viewer || !window.Cesium || !state.currentRun) return;
  const Cesium = window.Cesium;
  const centerline = state.currentRun.frames[0]?.centerline ?? [];
  if (!centerline.length) return;
  const offsets = [-2600, -1300, 0, 1300, 2600];
  const terrainStride = Math.max(1, Math.ceil(centerline.length / 55));
  const samplePoints = centerline.flatMap((point, index) => {
    if (index % terrainStride !== 0 && index !== centerline.length - 1) return [];
    return offsets.map((offsetM) => {
      const [lon, lat] = offsetFromCenterline(centerline, index, offsetM);
      return { lon, lat, offsetM, centerIndex: index };
    });
  });
  const cartographics = samplePoints.map((sample) => Cesium.Cartographic.fromDegrees(sample.lon, sample.lat));
  try {
    const sampled = await withTimeout(Cesium.sampleTerrainMostDetailed(state.viewer.terrainProvider, cartographics), 8e3, "Terrain sampling timed out");
    const crossValleySamples = sampled.map((point, index) => ({
      lon: samplePoints[index]?.lon ?? Cesium.Math.toDegrees(point.longitude),
      lat: samplePoints[index]?.lat ?? Cesium.Math.toDegrees(point.latitude),
      heightM: Number((point.height ?? 0).toFixed(1)),
      offsetM: samplePoints[index]?.offsetM ?? 0,
      centerIndex: samplePoints[index]?.centerIndex ?? 0
    }));
    state.terrainSamples = crossValleySamples.filter((sample) => sample.offsetM === 0);
    state.terrainSections = centerline.flatMap((point, index) => {
      const sectionSamples = crossValleySamples.filter((sample) => sample.centerIndex === index).sort((a, b) => a.offsetM - b.offsetM);
      if (!sectionSamples.length) return [];
      const center = sectionSamples.find((sample) => sample.offsetM === 0) ?? {
        lon: point[0] ?? 0,
        lat: point[1] ?? 0,
        heightM: 0,
        offsetM: 0,
        centerIndex: index
      };
      return {
        center: { lon: center.lon, lat: center.lat, heightM: center.heightM },
        samples: sectionSamples.map(({ lon, lat, heightM, offsetM }) => ({ lon, lat, heightM, offsetM }))
      };
    });
    const heights = crossValleySamples.map((sample) => sample.heightM);
    state.terrainStatus = `Runtime terrain sampled across ${state.terrainSections.length} OSM river valley sections: ${Math.min(...heights).toFixed(0)}-${Math.max(...heights).toFixed(0)} m`;
  } catch (error) {
    console.info("Detailed terrain sampling unavailable; flood overlay remains clamped to the rendered globe surface.", error);
    state.terrainSamples = centerline.map((point) => ({ lon: point[0] ?? 0, lat: point[1] ?? 0, heightM: 0 }));
    state.terrainSections = [];
    state.terrainStatus = "3D terrain provider is visible; detailed sampled height grid unavailable, so flood overlay is clamped to the rendered globe surface";
  }
}
function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      }
    );
  });
}
function offsetFromCenterline(centerline, index, offsetM) {
  const point = centerline[index] ?? centerline[0] ?? [0, 0];
  const previous = centerline[Math.max(0, index - 1)] ?? point;
  const next = centerline[Math.min(centerline.length - 1, index + 1)] ?? point;
  const lon = point[0] ?? 0;
  const lat = point[1] ?? 0;
  const metersPerLonDegree = Math.max(1, 111320 * Math.cos(lat * Math.PI / 180));
  const dx = ((next[0] ?? lon) - (previous[0] ?? lon)) * metersPerLonDegree;
  const dy = ((next[1] ?? lat) - (previous[1] ?? lat)) * 110540;
  const length = Math.max(1, Math.hypot(dx, dy));
  const normalX = -dy / length;
  const normalY = dx / length;
  return [
    Number((lon + normalX * offsetM / metersPerLonDegree).toFixed(6)),
    Number((lat + normalY * offsetM / 110540).toFixed(6))
  ];
}
function offsetFromProgress(centerline, progress, offsetM) {
  if (!centerline.length) return [0, 0];
  const lowerIndex = Math.max(0, Math.min(centerline.length - 1, Math.floor(progress)));
  const upperIndex = Math.max(0, Math.min(centerline.length - 1, lowerIndex + 1));
  const fraction = Math.max(0, Math.min(1, progress - lowerIndex));
  const lower = centerline[lowerIndex] ?? centerline[0] ?? [0, 0];
  const upper = centerline[upperIndex] ?? lower;
  const lon = (lower[0] ?? 0) + ((upper[0] ?? lower[0] ?? 0) - (lower[0] ?? 0)) * fraction;
  const lat = (lower[1] ?? 0) + ((upper[1] ?? lower[1] ?? 0) - (lower[1] ?? 0)) * fraction;
  const previous = centerline[Math.max(0, lowerIndex - 1)] ?? lower;
  const next = centerline[Math.min(centerline.length - 1, upperIndex + 1)] ?? upper;
  const metersPerLonDegree = Math.max(1, 111320 * Math.cos(lat * Math.PI / 180));
  const dx = ((next[0] ?? lon) - (previous[0] ?? lon)) * metersPerLonDegree;
  const dy = ((next[1] ?? lat) - (previous[1] ?? lat)) * 110540;
  const length = Math.max(1, Math.hypot(dx, dy));
  const normalX = -dy / length;
  const normalY = dx / length;
  return [
    Number((lon + normalX * offsetM / metersPerLonDegree).toFixed(6)),
    Number((lat + normalY * offsetM / 110540).toFixed(6))
  ];
}
function focusCorridor(duration = 0.8) {
  if (!state.viewer || !window.Cesium) return;
  const Cesium = window.Cesium;
  state.viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(CORRIDOR_VIEW.longitude, CORRIDOR_VIEW.latitude, CORRIDOR_VIEW.height),
    orientation: {
      heading: Cesium.Math.toRadians(CORRIDOR_VIEW.headingDeg),
      pitch: Cesium.Math.toRadians(CORRIDOR_VIEW.pitchDeg),
      roll: 0
    },
    duration
  });
}
function zoomBy(factor) {
  if (!state.viewer) return;
  const camera = state.viewer.camera;
  const distance = Math.max(800, camera.positionCartographic.height * factor);
  if (factor < 1) camera.zoomIn(camera.positionCartographic.height - distance);
  else camera.zoomOut(distance - camera.positionCartographic.height);
}
function tiltView() {
  if (!state.viewer || !window.Cesium) return;
  const Cesium = window.Cesium;
  const camera = state.viewer.camera;
  camera.setView({
    orientation: {
      heading: camera.heading,
      pitch: Cesium.Math.toRadians(-42),
      roll: 0
    }
  });
}
function northUp() {
  if (!state.viewer || !window.Cesium) return;
  const Cesium = window.Cesium;
  const camera = state.viewer.camera;
  camera.setView({
    orientation: {
      heading: 0,
      pitch: Math.min(camera.pitch, Cesium.Math.toRadians(-35)),
      roll: 0
    }
  });
}
function drawStaticLayers() {
  if (!state.viewer || !window.Cesium) return;
  const Cesium = window.Cesium;
  window.NEPAL_FLOOD_CONFIG = { ...window.NEPAL_FLOOD_CONFIG, staticLayersReady: false };
  const corridor = state.currentRun?.frames[0]?.centerline ?? [];
  state.viewer.entities.add({
    id: "river",
    name: "Bhote Koshi / Trishuli derived river corridor",
    polyline: {
      positions: corridor.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)),
      width: 4,
      material: Cesium.Color.fromCssColorString("#0ea5e9").withAlpha(0.85),
      clampToGround: true
    }
  });
  const terrainPositions = state.terrainSamples.length ? state.terrainSamples : corridor.map(([lon, lat]) => ({ lon, lat, heightM: 0 }));
  state.viewer.entities.add({
    id: "terrain-profile",
    name: "Sampled Cesium terrain profile",
    polyline: {
      positions: terrainPositions.map((sample) => Cesium.Cartesian3.fromDegrees(sample.lon, sample.lat)),
      width: 2,
      material: Cesium.Color.fromCssColorString("#f8fafc").withAlpha(0.75),
      clampToGround: true
    }
  });
  state.assetEntities = state.infrastructure.map((asset) => {
    const color = asset.kind === "bridge" ? "#f59e0b" : asset.kind === "settlement" ? "#10b981" : asset.kind === "road" ? "#64748b" : "#ef4444";
    return state.viewer.entities.add({
      id: asset.id,
      name: asset.name,
      position: Cesium.Cartesian3.fromDegrees(asset.coordinates[0], asset.coordinates[1]),
      point: {
        pixelSize: asset.kind === "settlement" ? 11 : 9,
        color: Cesium.Color.fromCssColorString(color),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 1.5,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      label: {
        text: asset.name.replace("Demo bridge ID near ", ""),
        font: "12px Inter, sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -18),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(25e3, 1, 18e4, 0.35)
      },
      properties: asset
    });
  });
  state.viewer.screenSpaceEventHandler.setInputAction((click) => {
    const picked = state.viewer.scene.pick(click.position);
    if (picked?.id?.properties) inspectAsset(picked.id.properties.getValue());
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  drawObservedEvidence();
  drawJourneyAnnotations(corridor);
  window.NEPAL_FLOOD_CONFIG = { ...window.NEPAL_FLOOD_CONFIG, staticLayersReady: true };
}
function drawJourneyAnnotations(corridor) {
  if (!state.viewer || !window.Cesium || corridor.length < 2) return;
  const Cesium = window.Cesium;
  for (const [index, stage] of storyStages.entries()) {
    const progress = Math.min(corridor.length - 1, stage.progress);
    const [lon, lat] = offsetFromProgress(corridor, progress, index % 2 === 0 ? -520 : 520);
    state.journeyEntities.push(
      state.viewer.entities.add({
        id: `journey-${stage.id}`,
        name: `${stage.label}: ${stage.title}`,
        position: Cesium.Cartesian3.fromDegrees(lon, lat),
        point: {
          pixelSize: stage.id === "source" || stage.id === "end" ? 13 : 10,
          color: Cesium.Color.fromCssColorString(stage.id === "source" ? "#f97316" : stage.id === "end" ? "#0f172a" : "#fbbf24"),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        label: {
          text: `${stage.label}
${stage.modeledTime}
${stage.time}`,
          font: "11px Inter, sans-serif",
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 4,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -34),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(28e3, 1, 18e4, 0.28)
        },
        properties: {
          ...stage,
          kind: "journey_annotation",
          classification: stage.classification
        }
      })
    );
  }
}
function polygonRings(coordinates) {
  if (!Array.isArray(coordinates)) return [];
  if (typeof coordinates[0]?.[0]?.[0] === "number") return coordinates;
  if (typeof coordinates[0]?.[0]?.[0]?.[0] === "number") return coordinates.flat();
  return [];
}
function drawObservedEvidence() {
  if (!state.viewer || !window.Cesium) return;
  const Cesium = window.Cesium;
  for (const feature of state.observedEvidence) {
    if (feature.properties.kind === "satellite_scene") {
      const ring = polygonRings(feature.geometry.coordinates)[0];
      if (!ring?.length) continue;
      const isPostEvent = feature.properties.phase === "post-event";
      state.observedEntities.push(
        state.viewer.entities.add({
          id: `observed-${feature.properties.id}`,
          name: feature.properties.name,
          polygon: {
            hierarchy: ring.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)),
            material: Cesium.Color.fromCssColorString(isPostEvent ? "#f59e0b" : "#22c55e").withAlpha(isPostEvent ? 0.12 : 0.08),
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString(isPostEvent ? "#fbbf24" : "#86efac").withAlpha(0.9),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            perPositionHeight: false
          },
          properties: feature.properties
        })
      );
    }
    if (feature.properties.kind === "observed_tributary" && feature.geometry.type === "LineString") {
      const line = feature.geometry.coordinates;
      state.observedEntities.push(
        state.viewer.entities.add({
          id: feature.properties.id,
          name: feature.properties.name,
          polyline: {
            positions: line.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)),
            width: 2,
            material: Cesium.Color.fromCssColorString("#38bdf8").withAlpha(0.72),
            clampToGround: true
          },
          properties: feature.properties
        })
      );
    }
    if (feature.properties.kind === "observed_community" && feature.geometry.type === "Point") {
      const [lon, lat] = feature.geometry.coordinates;
      state.observedEntities.push(
        state.viewer.entities.add({
          id: feature.properties.id,
          name: feature.properties.name,
          position: Cesium.Cartesian3.fromDegrees(lon, lat),
          point: {
            pixelSize: 7,
            color: Cesium.Color.fromCssColorString("#f8fafc"),
            outlineColor: Cesium.Color.fromCssColorString("#0f172a"),
            outlineWidth: 1,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          },
          label: {
            text: feature.properties.name,
            font: "11px Inter, sans-serif",
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -15),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scaleByDistance: new Cesium.NearFarScalar(22e3, 1, 15e4, 0.25)
          },
          properties: feature.properties
        })
      );
    }
  }
  $("#observedEvidence").dataset.entityCount = String(state.observedEntities.length);
}
function setEntityVisibility() {
  for (const entity of state.assetEntities) {
    const kind = entity.properties?.kind?.getValue?.();
    entity.show = kind === "bridge" && state.layers.bridges || kind === "settlement" && state.layers.settlements || kind === "road" && state.layers.roads || kind === "critical_facility" && state.layers.critical;
  }
  const river = state.viewer?.entities.getById("river");
  if (river) river.show = state.layers.river;
  for (const entity of state.waterEntities) entity.show = state.layers.waterDepth || state.layers.hazard;
  for (const entity of state.flowEntities) entity.show = state.layers.velocity;
  for (const entity of state.observedEntities) entity.show = state.layers.observedEvidence;
  for (const entity of state.journeyEntities) entity.show = state.layers.observedEvidence;
}
function nearestTerrainHeight(lon, lat) {
  if (!state.terrainSamples.length) return 0;
  let closest = state.terrainSamples[0];
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const sample of state.terrainSamples) {
    const distance = Math.hypot(sample.lon - lon, sample.lat - lat);
    if (distance < closestDistance) {
      closest = sample;
      closestDistance = distance;
    }
  }
  return closest?.heightM ?? 0;
}
function corridorFootprint(centerline, widthMeters) {
  if (centerline.length < 2) return [];
  const left = [];
  const right = [];
  for (let index = 0; index < centerline.length; index += 1) {
    const point = centerline[index] ?? centerline[0];
    const previous = centerline[Math.max(0, index - 1)] ?? point;
    const next = centerline[Math.min(centerline.length - 1, index + 1)] ?? point;
    const lon = point?.[0] ?? 0;
    const lat = point?.[1] ?? 0;
    const metersPerLonDegree = Math.max(1, 111320 * Math.cos(lat * Math.PI / 180));
    const dx = ((next?.[0] ?? lon) - (previous?.[0] ?? lon)) * metersPerLonDegree;
    const dy = ((next?.[1] ?? lat) - (previous?.[1] ?? lat)) * 110540;
    const length = Math.max(1, Math.hypot(dx, dy));
    const normalX = -dy / length;
    const normalY = dx / length;
    const taper = 0.72 + index / Math.max(1, centerline.length - 1) * 0.28;
    const halfWidth = widthMeters * taper / 2;
    left.push([
      Number((lon + normalX * halfWidth / metersPerLonDegree).toFixed(6)),
      Number((lat + normalY * halfWidth / 110540).toFixed(6))
    ]);
    right.push([
      Number((lon - normalX * halfWidth / metersPerLonDegree).toFixed(6)),
      Number((lat - normalY * halfWidth / 110540).toFixed(6))
    ]);
  }
  return [...left, ...right.reverse()];
}
function terrainWaterEdgeOffset(section, side, stageRiseM, halfMinimum, halfMaximum) {
  const center = section.samples.find((sample) => sample.offsetM === 0);
  if (!center) return side * halfMinimum;
  const waterSurfaceM = center.heightM + stageRiseM;
  const samples = section.samples.filter((sample) => side < 0 ? sample.offsetM <= 0 : sample.offsetM >= 0).sort((a, b) => Math.abs(a.offsetM) - Math.abs(b.offsetM));
  let edge = side * halfMinimum;
  let previous = center;
  for (const sample of samples.slice(1)) {
    if (Math.abs(sample.offsetM) > halfMaximum) break;
    if (sample.heightM <= waterSurfaceM) {
      edge = sample.offsetM;
      previous = sample;
      continue;
    }
    const denominator = sample.heightM - previous.heightM;
    const fraction = denominator <= 0 ? 0 : Math.max(0, Math.min(1, (waterSurfaceM - previous.heightM) / denominator));
    edge = previous.offsetM + (sample.offsetM - previous.offsetM) * fraction;
    break;
  }
  const magnitude = Math.max(halfMinimum, Math.min(halfMaximum, Math.abs(edge)));
  return side * magnitude;
}
function terrainConstrainedFootprint(centerline, stageRiseM, minimumWidthM, maximumWidthM) {
  if (!state.terrainSections.length || centerline.length < 2) return corridorFootprint(centerline, minimumWidthM);
  const sections = state.terrainSections.slice(0, centerline.length);
  const left = [];
  const right = [];
  const halfMinimum = minimumWidthM / 2;
  const halfMaximum = maximumWidthM / 2;
  sections.forEach((section, index) => {
    left.push(offsetFromCenterline(centerline, index, terrainWaterEdgeOffset(section, -1, stageRiseM, halfMinimum, halfMaximum)));
    right.push(offsetFromCenterline(centerline, index, terrainWaterEdgeOffset(section, 1, stageRiseM, halfMinimum, halfMaximum)));
  });
  return [...left, ...right.reverse()];
}
function terrainSampleCount() {
  return state.terrainSections.reduce((total, section) => total + section.samples.length, 0) || state.terrainSamples.length;
}
function drawInundationBand(Cesium, points, depthM, color, id) {
  if (points.length < 3) return;
  const normalized = points.map((point) => [point[0], point[1]]).filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
  if (normalized.length < 3) return;
  state.waterEntities.push(
    state.viewer.entities.add({
      id,
      name: `${state.currentRun?.scenario.name ?? "Scenario"} inundation ${id}`,
      polygon: {
        hierarchy: normalized.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat, nearestTerrainHeight(lon, lat) + Math.max(0.2, depthM))),
        material: color,
        perPositionHeight: true,
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString("#e0f2fe").withAlpha(0.82)
      }
    })
  );
}
function drawWaterSpine(Cesium, centerline, frame) {
  if (centerline.length < 2 || frame.meanDepthM <= 0) return;
  const positions = centerline.flatMap((point) => {
    const lon = point[0];
    const lat = point[1];
    if (typeof lon !== "number" || typeof lat !== "number" || !Number.isFinite(lon) || !Number.isFinite(lat)) return [];
    return [Cesium.Cartesian3.fromDegrees(lon, lat, nearestTerrainHeight(lon, lat) + Math.max(18, frame.meanDepthM * 7))];
  });
  if (positions.length < 2) return;
  state.waterEntities.push(
    state.viewer.entities.add({
      id: "visible-water-spine",
      name: `${state.currentRun?.scenario.name ?? "Scenario"} visible water stream`,
      polyline: {
        positions,
        width: Math.max(12, Math.min(26, 12 + frame.meanDepthM * 2.6)),
        material: Cesium.Color.fromCssColorString("#67e8f9").withAlpha(0.96),
        clampToGround: false
      }
    })
  );
}
function setupFluidCanvas() {
  const canvas = $("#flowCanvas");
  if (!canvas) return;
  state.flowCanvas = canvas;
  state.flowContext = canvas.getContext("2d");
  resizeFluidCanvas();
  window.addEventListener("resize", resizeFluidCanvas);
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches && !state.flowAnimationStarted) {
    state.flowAnimationStarted = true;
    state.lastFlowMs = performance.now();
    window.requestAnimationFrame(drawFluidOverlay);
  }
}
function resizeFluidCanvas() {
  if (!state.flowCanvas || !state.flowContext) return;
  const rect = state.flowCanvas.getBoundingClientRect();
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (state.flowCanvas.width !== width || state.flowCanvas.height !== height) {
    state.flowCanvas.width = width;
    state.flowCanvas.height = height;
  }
  state.flowContext.setTransform(ratio, 0, 0, ratio, 0, 0);
}
function clearFluidCanvas() {
  if (!state.flowCanvas || !state.flowContext) return;
  const rect = state.flowCanvas.getBoundingClientRect();
  state.flowContext.clearRect(0, 0, rect.width, rect.height);
}
function resetFluidMotion() {
  state.flowParticles = [];
  state.lastFlowMs = performance.now();
  clearFluidCanvas();
}
function visibleFlowWindow(centerline) {
  const front = Math.max(1, Math.min(centerline.length - 1, state.time / 120 * (centerline.length - 1)));
  const back = Math.max(0, front - Math.max(10, centerline.length * 0.42));
  return { back, front };
}
function resetFlowParticle(particle, centerline, front) {
  const upstreamWindow = Math.max(1, Math.min(front, Math.max(8, centerline.length * 0.28)));
  particle.progress = Math.max(0, front - upstreamWindow + Math.random() * upstreamWindow);
  particle.lane = (Math.random() * 2 - 1) * (0.16 + Math.random() * 0.84);
  particle.speed = 0.18 + Math.random() * 0.74;
  particle.size = 1.3 + Math.random() * 2.9;
  particle.phase = Math.random() * Math.PI * 2;
  particle.opacity = 0.35 + Math.random() * 0.5;
  particle.debris = Math.random() < 0.34;
}
function ensureFlowParticles(centerline, frameVelocityMS) {
  const target = Math.round(Math.min(340, Math.max(150, 130 + frameVelocityMS * 24 + centerline.length * 1.4)));
  const { front } = visibleFlowWindow(centerline);
  while (state.flowParticles.length < target) {
    const particle = { progress: 0, lane: 0, speed: 0, size: 1, phase: 0, opacity: 0.5, debris: false };
    resetFlowParticle(particle, centerline, front);
    state.flowParticles.push(particle);
  }
  if (state.flowParticles.length > target) state.flowParticles.length = target;
}
function flowHalfWidthAt(frame, progress) {
  const index = Math.max(0, Math.min(state.terrainSections.length - 1, Math.round(progress)));
  const maximumWidthM = Math.max(1500, 1800 + frame.meanDepthM * 720);
  const halfMinimum = 360;
  const halfMaximum = maximumWidthM / 2;
  const section = state.terrainSections[index];
  if (!section) return halfMinimum;
  const stageRiseM = Math.max(45, frame.maxDepthM * 24);
  const left = Math.abs(terrainWaterEdgeOffset(section, -1, stageRiseM, halfMinimum, halfMaximum));
  const right = Math.abs(terrainWaterEdgeOffset(section, 1, stageRiseM, halfMinimum, halfMaximum));
  return Math.max(halfMinimum, Math.min(halfMaximum, (left + right) / 2));
}
function projectToCanvas(Cesium, lon, lat, heightM) {
  if (!state.viewer) return null;
  const position = Cesium.Cartesian3.fromDegrees(lon, lat, heightM);
  const projected = state.viewer.scene.cartesianToCanvasCoordinates(position);
  if (!projected || !Number.isFinite(projected.x) || !Number.isFinite(projected.y)) return null;
  return projected;
}
function visualWaterSurfaceHeight(lon, lat, frame, offsetM = 0.7) {
  return nearestTerrainHeight(lon, lat) + Math.max(0.2, frame.meanDepthM) + offsetM;
}
function drawFlowCrests(ctx, Cesium, centerline, frame, nowSeconds) {
  const { back, front } = visibleFlowWindow(centerline);
  let drawn = 0;
  for (let progress = back + nowSeconds * frame.velocityMS * 1.8 % 5; progress < front; progress += 5.5) {
    const halfWidth = flowHalfWidthAt(frame, progress);
    const left = offsetFromProgress(centerline, progress, -halfWidth * 0.94);
    const right = offsetFromProgress(centerline, progress, halfWidth * 0.94);
    const height = visualWaterSurfaceHeight((left[0] + right[0]) / 2, (left[1] + right[1]) / 2, frame, 0.9);
    const a = projectToCanvas(Cesium, left[0], left[1], height);
    const b = projectToCanvas(Cesium, right[0], right[1], height);
    if (!a || !b) continue;
    const alpha = 0.14 + 0.16 * (0.5 + Math.sin(nowSeconds * 4 + progress) * 0.5);
    ctx.strokeStyle = `rgba(226, 246, 255, ${alpha.toFixed(3)})`;
    ctx.lineWidth = 2.1;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    drawn += 1;
  }
  return drawn;
}
function drawSurgeFront(ctx, Cesium, centerline, frame, nowSeconds) {
  const { front } = visibleFlowWindow(centerline);
  const halfWidth = flowHalfWidthAt(frame, front);
  const points = [];
  for (const lane of [-0.95, -0.62, -0.28, 0, 0.28, 0.62, 0.95]) {
    const jitter = Math.sin(nowSeconds * 5 + lane * 9) * halfWidth * 0.04;
    const [lon, lat] = offsetFromProgress(centerline, front, lane * halfWidth + jitter);
    const projected = projectToCanvas(Cesium, lon, lat, visualWaterSurfaceHeight(lon, lat, frame, 1.2));
    if (projected) points.push(projected);
  }
  if (points.length < 2) return 0;
  ctx.save();
  ctx.shadowColor = "rgba(56, 189, 248, 0.75)";
  ctx.shadowBlur = 16;
  ctx.strokeStyle = "rgba(240, 249, 255, 0.92)";
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(125, 211, 252, 0.54)";
  ctx.lineWidth = 12;
  ctx.stroke();
  ctx.restore();
  return 1;
}
function updateSurgeNarrative(centerline) {
  const reach = $("#surgeReach");
  const cue = $("#surgeCue");
  const time = $("#surgeTime");
  if (!centerline.length) return;
  const { front } = visibleFlowWindow(centerline);
  const active = eventReaches.reduce((selected, item) => front >= item.progress ? item : selected, eventReaches[0] ?? {
    progress: 0,
    name: "Bhote Koshi-Trishuli corridor",
    cue: "Sediment-laden water follows the mapped river corridor."
  });
  reach.textContent = `Surge front: ${active.name}`;
  cue.textContent = active.cue;
  const activeStage = storyStages.reduce((selected, stage) => front >= stage.progress ? stage : selected, storyStages[0] ?? null);
  if (activeStage) time.textContent = `${activeStage.modeledTime} | Evidence: ${activeStage.time}`;
  renderStoryRail(front);
}
function renderStoryRail(front) {
  const activeIndex = storyStages.reduce((selected, stage, index) => front >= stage.progress ? index : selected, 0);
  $("#storyRail").innerHTML = storyStages.map((stage, index) => {
    const status = index < activeIndex ? "complete" : index === activeIndex ? "active" : "pending";
    return `
        <li class="${status}">
          <span>${stage.label}</span>
          <strong>${stage.title}</strong>
          <time>${stage.modeledTime} | ${stage.time}</time>
          <p>${stage.detail}</p>
          <em>${stage.classification}</em>
        </li>
      `;
  }).join("");
}
function drawFluidOverlay(nowMs) {
  if (!state.flowAnimationStarted) return;
  window.requestAnimationFrame(drawFluidOverlay);
  if (!state.flowCanvas || !state.flowContext || !state.viewer || !window.Cesium || !state.currentRun) return;
  resizeFluidCanvas();
  const ctx = state.flowContext;
  const rect = state.flowCanvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  if (!state.layers.waterDepth && !state.layers.hazard && !state.layers.velocity) return;
  const Cesium = window.Cesium;
  const frame = frameAt(state.currentRun, state.time);
  const centerline = frame.centerline;
  if (centerline.length < 2 || frame.meanDepthM <= 0) return;
  ensureFlowParticles(centerline, frame.velocityMS);
  const dt = Math.min(0.08, Math.max(0.01, (nowMs - state.lastFlowMs) / 1e3 || 0.016));
  state.lastFlowMs = nowMs;
  const { back, front } = visibleFlowWindow(centerline);
  const velocityScale = Math.max(0.5, frame.velocityMS / 2.6) * (state.playing ? 1.35 : 0.78);
  const nowSeconds = nowMs / 1e3;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const surgeDrawn = drawSurgeFront(ctx, Cesium, centerline, frame, nowSeconds);
  const crestsDrawn = drawFlowCrests(ctx, Cesium, centerline, frame, nowSeconds);
  let particlesDrawn = 0;
  let debrisDrawn = 0;
  for (const particle of state.flowParticles) {
    particle.progress += particle.speed * velocityScale * dt;
    if (particle.progress > front || particle.progress < back - 2) resetFlowParticle(particle, centerline, front);
    const halfWidth = flowHalfWidthAt(frame, particle.progress);
    const pulse = Math.sin(nowSeconds * 2.8 + particle.phase);
    const laneOffsetM = particle.lane * halfWidth * (0.62 + 0.16 * pulse);
    const head = offsetFromProgress(centerline, particle.progress, laneOffsetM);
    const tail = offsetFromProgress(centerline, Math.max(0, particle.progress - 0.44 - frame.velocityMS * 0.035), laneOffsetM * 0.92);
    const height = visualWaterSurfaceHeight(head[0], head[1], frame, particle.debris ? 0.55 : 0.8);
    const a = projectToCanvas(Cesium, tail[0], tail[1], height);
    const b = projectToCanvas(Cesium, head[0], head[1], height);
    if (!a || !b) continue;
    const progressFade = Math.max(0.18, Math.min(1, (particle.progress - back) / Math.max(1, front - back)));
    const alpha = particle.opacity * progressFade * (state.layers.velocity ? 1 : 0.72);
    const gradient = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    if (particle.debris) {
      gradient.addColorStop(0, "rgba(120, 53, 15, 0)");
      gradient.addColorStop(0.48, `rgba(180, 83, 9, ${(alpha * 0.38).toFixed(3)})`);
      gradient.addColorStop(1, `rgba(253, 230, 138, ${(alpha * 0.82).toFixed(3)})`);
      debrisDrawn += 1;
    } else {
      gradient.addColorStop(0, "rgba(14, 116, 144, 0)");
      gradient.addColorStop(0.45, `rgba(56, 189, 248, ${(alpha * 0.45).toFixed(3)})`);
      gradient.addColorStop(1, `rgba(240, 249, 255, ${alpha.toFixed(3)})`);
    }
    ctx.strokeStyle = gradient;
    ctx.lineWidth = particle.size + 1.2 + frame.meanDepthM * 0.32;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo((a.x + b.x) / 2 + Math.sin(nowSeconds * 5 + particle.phase) * 2.2, (a.y + b.y) / 2 + Math.cos(nowSeconds * 4 + particle.phase) * 1.4);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    particlesDrawn += 1;
  }
  ctx.restore();
  state.flowCanvas.dataset.particlesDrawn = String(particlesDrawn);
  state.flowCanvas.dataset.crestsDrawn = String(crestsDrawn);
  state.flowCanvas.dataset.debrisDrawn = String(debrisDrawn);
  state.flowCanvas.dataset.surgeDrawn = String(surgeDrawn);
  state.flowCanvas.dataset.lastDrawMs = String(Math.round(nowMs));
  window.NEPAL_FLOOD_CONFIG = {
    ...window.NEPAL_FLOOD_CONFIG,
    flowDebug: {
      canvasHeight: state.flowCanvas.height,
      canvasWidth: state.flowCanvas.width,
      crestsDrawn,
      debrisDrawn,
      particlesDrawn,
      surgeDrawn,
      timestampMs: nowMs
    }
  };
}
function renderFrame() {
  const run = state.currentRun;
  if (!run || !state.viewer || !window.Cesium) {
    clearFluidCanvas();
    renderMetrics();
    return;
  }
  const Cesium = window.Cesium;
  const frame = frameAt(run, state.time);
  for (const entity of state.waterEntities) state.viewer.entities.remove(entity);
  state.waterEntities = [];
  for (const entity of state.flowEntities) state.viewer.entities.remove(entity);
  state.flowEntities = [];
  const arrivalCurve = frame.arrivalTimeByKm?.length ? frame.arrivalTimeByKm : buildArrivalCurve(run.scenario, frame.centerline);
  const frontDistanceKm = frame.frontDistanceKm ?? frontDistanceAt(arrivalCurve, state.time);
  const distances = cumulativeKm(frame.centerline);
  const reachedIndex = distances.findIndex((distance) => distance >= frontDistanceKm);
  const visibleCount = reachedIndex === -1 ? frame.centerline.length : Math.max(2, reachedIndex + 1);
  const visibleCenterline = frame.centerline.slice(0, visibleCount > 1 ? visibleCount : 2);
  if (state.layers.waterDepth || state.layers.hazard) {
    const shallow = terrainConstrainedFootprint(visibleCenterline, Math.max(58, frame.maxDepthM * 28), 720, Math.max(1500, 1800 + frame.meanDepthM * 720));
    const moderate = terrainConstrainedFootprint(visibleCenterline, Math.max(32, frame.meanDepthM * 22), 460, Math.max(980, 1160 + frame.meanDepthM * 440));
    const deep = terrainConstrainedFootprint(visibleCenterline, Math.max(16, frame.meanDepthM * 11), 260, Math.max(560, 640 + frame.maxDepthM * 180));
    if (state.layers.hazard) {
      drawInundationBand(Cesium, shallow, frame.meanDepthM, hazardColor(frame.hazardIndex), "hazard-envelope");
    } else {
      drawInundationBand(Cesium, shallow, frame.meanDepthM * 0.45, Cesium.Color.fromCssColorString("#22d3ee").withAlpha(0.82), "shallow-inundation");
      drawInundationBand(Cesium, moderate, frame.meanDepthM * 0.85, Cesium.Color.fromCssColorString("#0ea5e9").withAlpha(0.9), "moderate-inundation");
      drawInundationBand(Cesium, deep, frame.maxDepthM, Cesium.Color.fromCssColorString("#0369a1").withAlpha(0.95), "deep-inundation");
      drawWaterSpine(Cesium, visibleCenterline, frame);
    }
  }
  if (state.layers.velocity) {
    visibleCenterline.forEach((point, index, arr) => {
      const next = arr[index + 1];
      if (!next || index % 2) return;
      state.flowEntities.push(
        state.viewer.entities.add({
          polyline: {
            positions: [
              Cesium.Cartesian3.fromDegrees(point[0], point[1]),
              Cesium.Cartesian3.fromDegrees(next[0], next[1])
            ],
            width: 2,
            material: new Cesium.PolylineArrowMaterialProperty(Cesium.Color.fromCssColorString("#f8fafc").withAlpha(0.82)),
            clampToGround: true
          }
        })
      );
    });
  }
  setEntityVisibility();
  renderMetrics();
}
function hazardColor(index) {
  const Cesium = window.Cesium;
  if (index < 0.8) return Cesium.Color.fromCssColorString("#7dd3fc").withAlpha(0.42);
  if (index < 2) return Cesium.Color.fromCssColorString("#facc15").withAlpha(0.48);
  if (index < 4) return Cesium.Color.fromCssColorString("#fb923c").withAlpha(0.54);
  return Cesium.Color.fromCssColorString("#ef4444").withAlpha(0.58);
}
function renderMetrics() {
  const run = state.currentRun;
  if (!run) return;
  const frame = frameAt(run, state.time);
  updateSurgeNarrative(frame.centerline);
  $("#timeLabel").textContent = `T+${state.time}`;
  $("#scenarioName").textContent = run.scenario.name;
  $("#classification").textContent = run.scenario.scenarioType === "reference_event" ? `representative event replay, ~${run.scenario.referenceReleaseMillionM3 ?? 100} Mm3` : run.approximation ? "interactive scenario approximation" : "precomputed scenario model";
  $("#frameStats").innerHTML = `
    <div><strong>${frame.maxDepthM.toFixed(1)}</strong><span>max depth m</span></div>
    <div><strong>${frame.velocityMS.toFixed(1)}</strong><span>velocity m/s</span></div>
    <div><strong>${frame.hazardIndex.toFixed(1)}</strong><span>hydraulic hazard proxy</span></div>
    <div><strong>${terrainSampleCount()}</strong><span>terrain samples</span></div>
  `;
  $("#metrics").innerHTML = run.metrics.map((metric) => `<div class="metric"><span>${metric.label}</span><strong>${metric.value} ${metric.unit}</strong><em>${metric.classification}</em></div>`).join("");
  $("#provenanceText").textContent = `${run.provenance.generationMethod} ${state.terrainStatus}. Classification: ${run.provenance.classification}. Confidence: ${run.provenance.confidence}.`;
  renderObservedEvidencePanel();
}
function renderObservedEvidencePanel() {
  const scenes = state.observedEvidence.filter((feature) => feature.properties.kind === "satellite_scene");
  const postScenes = scenes.filter((feature) => feature.properties.phase === "post-event");
  const communities = state.observedEvidence.filter((feature) => feature.properties.kind === "observed_community");
  const tributaries = state.observedEvidence.filter((feature) => feature.properties.kind === "observed_tributary");
  const downstreamCommunities = communities.filter((feature) => (feature.properties.corridorKm ?? 0) >= 90);
  const downstreamTributaries = tributaries.filter((feature) => (feature.properties.corridorKm ?? 0) >= 90);
  const downstreamMetric = state.currentRun?.metrics.find((metric) => metric.id === "downstream");
  const sensors = [...new Set(scenes.map((feature) => feature.properties.sensor).filter(Boolean))].join(", ");
  $("#observedEvidence").innerHTML = `
    <div class="evidence-head"><span>Source data & mapped geography</span><strong>Catalog coverage + OSM layers</strong></div>
    <div class="evidence-grid">
      <div><strong>${postScenes.length}</strong><span>post-event satellite scenes</span></div>
      <div><strong>${communities.length}</strong><span>OSM communities near corridor</span></div>
      <div><strong>${tributaries.length}</strong><span>named tributary reaches</span></div>
      <div><strong>${downstreamCommunities.length}</strong><span>downstream communities</span></div>
      <div><strong>${downstreamTributaries.length}</strong><span>downstream tributaries</span></div>
      <div><strong>${downstreamMetric?.value ?? 0}</strong><span>modeled downstream assets</span></div>
    </div>
    <p>Shown on the map: satellite acquisition footprints/times, mapped communities, tributaries, and lower Trishuli continuation. These footprints are source coverage, not observed flood polygons. Downstream water depth/overflow remains representative until observed inundation polygons or hydraulic rasters are integrated.</p>
    <a href="https://source.coop/planet/disasterdata/nepal-flash-flood-2026-08-26" target="_blank" rel="noreferrer">Planet/Source Cooperative STAC catalog</a>
    <em>${sensors ? `Sensors: ${sensors}` : "Sensor metadata pending"}</em>
  `;
}
function inspectAsset(asset) {
  const exposure = state.currentRun?.assetExposure.find((item) => item.assetId === asset.id);
  $("#assetPanel").innerHTML = exposure ? assetPanel(asset, exposure) : `<h3>${asset.name}</h3><p>No exposure estimate is available for this asset.</p>`;
  track("asset_inspected", { asset: asset.id });
}
function assetPanel(asset, exposure) {
  const nameNote = asset.officialNameVerified ? "Observed place name" : "Demo asset identifier; official name not verified";
  return `
    <h3>${asset.kind.replace("_", " ")}</h3>
    <strong>${asset.name}</strong>
    <p>${nameNote}. Exposure means modeled intersection with the flood envelope, not damage.</p>
    <dl>
      <div><dt>Peak arrival</dt><dd>${exposure.arrivalTimeMinutes === null ? "not intersecting" : `T+${exposure.arrivalTimeMinutes} min`}</dd></div>
      <div><dt>Maximum modeled depth</dt><dd>${exposure.maxModeledDepthM.toFixed(1)} m</dd></div>
      <div><dt>Maximum modeled velocity</dt><dd>${exposure.maxModeledVelocityMS.toFixed(1)} m/s</dd></div>
      <div><dt>Hazard</dt><dd>${exposure.hazard.replace("_", " ")}</dd></div>
      <div><dt>Exposure</dt><dd>${exposure.exposure}</dd></div>
      <div><dt>Confidence</dt><dd>${exposure.confidence}</dd></div>
      <div><dt>Classification</dt><dd>${exposure.classification}</dd></div>
    </dl>
  `;
}
function scenarioFromControls() {
  const reference = state.referenceRun?.scenario;
  if (!reference) throw new Error("Reference scenario is not loaded.");
  const base = { ...reference };
  delete base.referenceReleaseMillionM3;
  const value = (id) => $(`#${id}`).value;
  return {
    ...base,
    id: "visitor-scenario",
    name: "Visitor what-if scenario",
    scenarioType: "barrier_lake_what_if",
    lakeVolumeMillionM3: Number(value("lakeVolume")),
    breachMechanism: value("breachMechanism"),
    breachDurationMinutes: Number(value("breachDuration")),
    relativeBreachWidth: value("breachWidth"),
    rainfallMultiplier: Number(value("rainfall")),
    antecedentFlow: value("antecedentFlow"),
    debrisPercent: Number(value("debris")),
    channelRoughness: value("roughness"),
    bridgeCondition: value("bridgeCondition"),
    secondaryBlockage: $("#secondaryBlockage").checked
  };
}
async function runScenario() {
  if (!state.engine) return;
  const scenario = scenarioFromControls();
  const errors = validateScenario(scenario);
  $("#scenarioErrors").textContent = errors.join(" ");
  if (errors.length) return;
  track("scenario_run", { volume: scenario.lakeVolumeMillionM3, breach: scenario.breachMechanism });
  $("#missionLog").innerHTML = "";
  try {
    for await (const event of state.mission.execute(scenario)) {
      $("#missionLog").insertAdjacentHTML("beforeend", `<li class="${event.step.status}"><span>${event.step.label}</span><em>${event.step.elapsedMs ?? ""}${event.step.elapsedMs ? " ms" : ""}</em></li>`);
    }
    state.currentRun = await state.engine.runScenario(scenario);
    state.time = 0;
    resetFluidMotion();
    $("#timeline").value = "0";
    renderFrame();
    renderComparison();
    track("scenario_completed", { run: state.currentRun.id });
  } catch (error) {
    $("#scenarioErrors").textContent = error instanceof Error ? error.message : "Scenario failed.";
    track("scenario_failed");
  }
}
async function runPresetScenario(id) {
  if (!state.engine) return;
  const preset = state.runs.find((run) => run.id === id);
  if (!preset) return;
  track("scenario_run", { scenario: id, preset: true });
  state.currentRun = await state.engine.runScenario(preset.scenario);
  state.time = 0;
  resetFluidMotion();
  $("#timeline").value = "0";
  renderFrame();
  renderComparison();
  track("scenario_completed", { run: state.currentRun.id });
}
function renderComparison() {
  if (!state.referenceRun || !state.currentRun) return;
  const comparison = compareRuns(state.referenceRun, state.currentRun);
  $("#comparison").innerHTML = `
    <div class="compare-head"><strong>${comparison.scenarioA}</strong><span>vs</span><strong>${comparison.scenarioB}</strong></div>
    <div class="compare-grid">
      <div><span>Extent delta</span><strong>${signed(comparison.extentDeltaHa)} ha</strong></div>
      <div><span>Arrival delta</span><strong>${signed(comparison.arrivalDeltaMinutes)} min</strong></div>
      <div><span>Depth delta</span><strong>${signed(comparison.depthDeltaM)} m</strong></div>
      <div><span>Velocity delta</span><strong>${signed(comparison.velocityDeltaMS)} m/s</strong></div>
      <div><span>Road exposure</span><strong>${signed(comparison.roadExposureDeltaKm)} km</strong></div>
      <div><span>Bridge exposure</span><strong>${signed(comparison.bridgeExposureDeltaCount)}</strong></div>
    </div>`;
  track("scenario_compared");
}
function signed(value) {
  return value > 0 ? `+${value}` : `${value}`;
}
function bindControls() {
  $("#replay").addEventListener("click", () => {
    state.mode = "replay";
    state.currentRun = state.referenceRun;
    state.time = 0;
    state.playing = true;
    resetFluidMotion();
    $("#timeline").value = "0";
    renderFrame();
    track("event_replay_started");
  });
  $("#playPause").addEventListener("click", () => {
    state.playing = !state.playing;
    $("#playPause").textContent = state.playing ? "Pause" : "Play";
  });
  $("#restart").addEventListener("click", () => {
    state.time = 0;
    state.playing = false;
    resetFluidMotion();
    $("#timeline").value = "0";
    renderFrame();
  });
  $("#timeline").addEventListener("input", (event) => {
    state.time = Number(event.target.value);
    state.playing = false;
    resetFluidMotion();
    renderFrame();
    track("timeline_scrubbed", { time: state.time });
  });
  $("#speed").addEventListener("change", (event) => {
    state.speed = Number(event.target.value);
  });
  document.querySelectorAll("[data-layer]").forEach((input) => {
    input.addEventListener("change", () => {
      state.layers[input.dataset.layer] = input.checked;
      setEntityVisibility();
      renderFrame();
      track("layer_toggled", { layer: input.dataset.layer, enabled: input.checked });
    });
  });
  document.querySelectorAll(".scenario-control").forEach((input) => {
    input.addEventListener("change", () => track("scenario_changed", { control: input.id, value: input instanceof HTMLInputElement && input.type === "checkbox" ? input.checked : input.value }));
  });
  $("#presetScenario").addEventListener("change", (event) => {
    const id = event.target.value;
    if (id) void runPresetScenario(id);
  });
  $("#runScenario").addEventListener("click", runScenario);
  $("#compareReference").addEventListener("click", renderComparison);
  $("#methodologyToggle").addEventListener("click", () => {
    $("#methodology").classList.toggle("open");
    track("methodology_opened");
    track("provenance_opened");
  });
  $("#dismissOnboarding").addEventListener("click", () => $("#onboarding").remove());
  $("#zoomIn").addEventListener("click", () => zoomBy(0.55));
  $("#zoomOut").addEventListener("click", () => zoomBy(1.75));
  $("#focusCorridor").addEventListener("click", () => focusCorridor());
  $("#tiltView").addEventListener("click", tiltView);
  $("#northUp").addEventListener("click", northUp);
}
function tick() {
  if (state.playing) {
    state.time += state.speed;
    if (state.time >= 120) {
      state.time = 120;
      state.playing = false;
      track("event_replay_completed");
    }
    $("#timeline").value = String(state.time);
    renderFrame();
  }
  window.setTimeout(tick, 650);
}
async function main() {
  track("nepal_twin_opened");
  bindControls();
  try {
    await loadRuntimeConfig();
    await loadData();
    renderMetrics();
    await initCesium();
    renderComparison();
    tick();
  } catch (error) {
    $("#appError").textContent = error instanceof Error ? error.message : "The simulator could not start.";
  }
}
main();
