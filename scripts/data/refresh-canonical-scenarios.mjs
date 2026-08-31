import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cacheDir = resolve(root, ".cache");
mkdirSync(cacheDir, { recursive: true });

const engineBundle = resolve(cacheDir, "canonical-engine.mjs");
const command = process.platform === "win32" ? "cmd" : "npx";
const args = process.platform === "win32"
  ? ["/c", "npx", "esbuild", "src/nepal-flash-flood/engine.ts", "--bundle", "--platform=node", "--format=esm", `--outfile=${engineBundle}`]
  : ["esbuild", "src/nepal-flash-flood/engine.ts", "--bundle", "--platform=node", "--format=esm", `--outfile=${engineBundle}`];
execFileSync(command, args, {
  cwd: root,
  stdio: "inherit",
});

const {
  buildArrivalCurve,
  buildMetrics,
  buildReleaseHydrograph,
  calculateAssetExposure,
  frontDistanceAt,
  scenarioIntensity,
  TIMELINE,
} = await import(pathToFileURL(engineBundle).href);

const scenarioDataPath = resolve(root, "data", "scenarios.json");
const infrastructurePath = resolve(root, "data", "infrastructure.geojson");
const scenarioData = JSON.parse(readFileSync(scenarioDataPath, "utf8"));
const infrastructure = JSON.parse(readFileSync(infrastructurePath, "utf8"));
const assets = infrastructure.features.filter((feature) => feature.geometry?.type === "Point").map((feature) => feature.properties);

function offsetFromCenterline(corridor, index, offsetMeters) {
  const point = corridor[index] ?? corridor[0];
  const previous = corridor[Math.max(0, index - 1)] ?? point;
  const next = corridor[Math.min(corridor.length - 1, index + 1)] ?? point;
  const lon = point?.[0] ?? 0;
  const lat = point?.[1] ?? 0;
  const metersPerLonDegree = Math.max(1, 111320 * Math.cos((lat * Math.PI) / 180));
  const dx = ((next?.[0] ?? lon) - (previous?.[0] ?? lon)) * metersPerLonDegree;
  const dy = ((next?.[1] ?? lat) - (previous?.[1] ?? lat)) * 110540;
  const length = Math.max(1, Math.hypot(dx, dy));
  const normalX = -dy / length;
  const normalY = dx / length;
  return [
    Number((lon + (normalX * offsetMeters) / metersPerLonDegree).toFixed(6)),
    Number((lat + (normalY * offsetMeters) / 110540).toFixed(6)),
  ];
}

function footprintFor(corridor, frontDistanceKm, widthMeters) {
  const distances = [0];
  for (let index = 1; index < corridor.length; index += 1) {
    const a = corridor[index - 1];
    const b = corridor[index];
    const dLat = ((b[1] - a[1]) * Math.PI) / 180;
    const dLon = ((b[0] - a[0]) * Math.PI) / 180;
    const lat1 = (a[1] * Math.PI) / 180;
    const lat2 = (b[1] * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    distances.push(distances.at(-1) + 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h))));
  }
  const reachedIndex = distances.findIndex((distance) => distance >= frontDistanceKm);
  const reached = reachedIndex === -1 ? corridor.length : Math.max(2, reachedIndex + 1);
  const slice = corridor.slice(0, reached > 1 ? reached : Math.min(2, corridor.length));
  const left = slice.map((_, index) => {
    const taper = 0.72 + index / Math.max(1, corridor.length - 1) * 0.28;
    return offsetFromCenterline(corridor, index, -widthMeters * taper * 0.5);
  });
  const right = slice.toReversed().map((_, reverseIndex) => {
    const index = slice.length - 1 - reverseIndex;
    const taper = 0.72 + index / Math.max(1, corridor.length - 1) * 0.28;
    return offsetFromCenterline(corridor, index, widthMeters * taper * 0.5);
  });
  return [...left, ...right];
}

function frameValues(scenario, timeMinutes, peakDischarge, intensity) {
  const duration = Math.max(10, scenario.breachDurationMinutes);
  const local = scenario.secondaryBlockage
    ? Math.max(
        Math.sin(Math.max(0, Math.min(1, timeMinutes / (duration * 0.62))) * Math.PI) * 0.62,
        Math.sin(Math.max(0, Math.min(1, (timeMinutes - duration * 0.62 - 22) / (duration * 0.78))) * Math.PI) * 0.92,
      )
    : Math.sin(Math.max(0, Math.min(1, timeMinutes / duration)) * Math.PI);
  const dischargeRatio = Math.max(0.05, Math.min(1.15, local || peakDischarge / Math.max(peakDischarge, 1) * 0.05));
  const meanDepthM = Number((0.12 + dischargeRatio * intensity * 0.78).toFixed(2));
  const maxDepthM = Number((meanDepthM * (1.72 + intensity * 0.12)).toFixed(2));
  const debrisVelocityFactor = 1 + Math.min(0.18, scenario.debrisPercent / 300);
  const velocityMS = Number(((0.35 + dischargeRatio * Math.sqrt(Math.max(peakDischarge, 1)) / 33) * debrisVelocityFactor).toFixed(2));
  return { meanDepthM, maxDepthM, velocityMS, hazardIndex: Number((maxDepthM * velocityMS).toFixed(2)) };
}

scenarioData.generatedAt = new Date().toISOString();
scenarioData.provenance = {
  ...scenarioData.provenance,
  modelVersion: "nepal-flash-flood-surrogate-v0.2.0",
  generationMethod: "Canonical runtime engine generated release hydrographs, scenario-specific arrival curves, geometric exposure, and polygon-area metrics for a browser-ready surrogate. No full shallow-water solver output is bundled.",
};

scenarioData.runs = scenarioData.runs.map((run) => {
  const scenario = {
    ...run.scenario,
    name: run.id === "S0" ? "August 26 Representative Event Replay" : run.scenario.name,
    provenance: {
      ...run.scenario.provenance,
      modelVersion: "nepal-flash-flood-surrogate-v0.2.0",
    },
  };
  const hydrograph = buildReleaseHydrograph(scenario);
  const arrivalTimeByKm = buildArrivalCurve(scenario, scenarioData.corridor);
  const peakDischarge = Math.max(...hydrograph.hydrograph.map((point) => point.dischargeCMS), 1);
  const intensity = scenarioIntensity(scenario);
  const frames = TIMELINE.map((timeMinutes) => {
    const frontDistanceKm = frontDistanceAt(arrivalTimeByKm, timeMinutes);
    const values = frameValues(scenario, timeMinutes, peakDischarge, intensity);
    return {
      timeMinutes,
      footprint: footprintFor(
        scenarioData.corridor,
        frontDistanceKm,
        (620 + Math.min(4.2, intensity) * 210 + Math.sqrt(values.meanDepthM) * 170) * (1 + Math.max(0, scenario.rainfallMultiplier - 1) * 0.24),
      ),
      centerline: scenarioData.corridor,
      frontDistanceKm,
      arrivalTimeByKm,
      ...values,
      classification: run.id === "S0" ? "representative" : "simulated",
    };
  });
  const provisional = {
    ...run,
    scenario,
    releaseHydrograph: hydrograph.hydrograph,
    releasedVolumeM3: hydrograph.releasedVolumeM3,
    hydrographMassErrorPercent: hydrograph.massErrorPercent,
    frames,
    approximation: false,
    provenance: {
      ...run.provenance,
      modelVersion: "nepal-flash-flood-surrogate-v0.2.0",
    },
  };
  provisional.assetExposure = calculateAssetExposure(provisional, assets);
  provisional.metrics = buildMetrics(provisional.frames, provisional.assetExposure);
  provisional.rasterMetadata = {
    ...provisional.rasterMetadata,
    notes: "Compact browser-ready surrogate output with explicit Q(t), arrival curve, footprints, depth, velocity, and hazard proxy. Replace with solver rasters for engineering release.",
  };
  return provisional;
});

writeFileSync(scenarioDataPath, `${JSON.stringify(scenarioData, null, 2)}\n`);
console.log(`Refreshed ${scenarioData.runs.length} scenario runs with canonical hydrographs and arrival curves.`);
