import { readFileSync, writeFileSync } from "node:fs";

const scenarios = JSON.parse(readFileSync("data/scenarios.json", "utf8"));
const results = [];

function add(status, severity, label, details = {}) {
  results.push({ status, severity, label, details });
}

function integratedVolumeM3(hydrograph) {
  if (!hydrograph?.length) return 0;
  let volume = 0;
  for (let index = 1; index < hydrograph.length; index += 1) {
    const a = hydrograph[index - 1];
    const b = hydrograph[index];
    volume += ((a.dischargeCMS + b.dischargeCMS) / 2) * (b.timeMinutes - a.timeMinutes) * 60;
  }
  return volume;
}

const runs = new Map(scenarios.runs.map((run) => [run.id, run]));
for (const run of scenarios.runs) {
  if (!run.releaseHydrograph?.length) add("FAIL", "P0", "Scenario missing explicit release hydrograph", { id: run.id });
  if (!run.frames.every((frame) => frame.arrivalTimeByKm?.length && Number.isFinite(frame.frontDistanceKm))) {
    add("FAIL", "P0", "Scenario missing arrival curve/front distance fields", { id: run.id });
  }
  for (const point of run.releaseHydrograph ?? []) {
    if (point.dischargeCMS < 0 || !Number.isFinite(point.dischargeCMS)) add("FAIL", "P0", "Invalid hydrograph discharge", { id: run.id, point });
  }
  const integrated = integratedVolumeM3(run.releaseHydrograph);
  const target = run.releasedVolumeM3 ?? 0;
  const massErrorPercent = target > 0 ? Math.abs((integrated - target) / target) * 100 : 0;
  if (run.scenario.rainfallMultiplier <= 1.01 && massErrorPercent > 3) {
    add("FAIL", "P0", "Hydrograph mass balance exceeds tolerance", { id: run.id, massErrorPercent: Number(massErrorPercent.toFixed(3)) });
  }
  for (const frame of run.frames) {
    if (frame.meanDepthM < 0 || frame.maxDepthM < 0 || frame.velocityMS < 0) add("FAIL", "P0", "Negative hydraulic value", { id: run.id, timeMinutes: frame.timeMinutes });
    if (!Number.isFinite(frame.hazardIndex)) add("FAIL", "P0", "Invalid hazard index", { id: run.id, timeMinutes: frame.timeMinutes });
    if (frame.maxDepthM < frame.meanDepthM) add("FAIL", "P0", "Max depth below mean depth", { id: run.id, timeMinutes: frame.timeMinutes });
  }
}

const s1 = runs.get("S1");
const s3 = runs.get("S3");
const s4 = runs.get("S4");
const s7 = runs.get("S7");
const peak = (run) => Math.max(...run.releaseHydrograph.map((point) => point.dischargeCMS));
const extent = (run) => run.metrics.find((metric) => metric.id === "extent")?.value ?? 0;
if (s1 && s3 && peak(s3) <= peak(s1)) add("FAIL", "P0", "Rapid 5 Mm3 peak discharge is not greater than slow 2 Mm3 peak", { s1: peak(s1), s3: peak(s3) });
if (s3 && s4 && extent(s4) <= extent(s3)) add("FAIL", "P0", "Elevated rainfall scenario does not increase maximum extent", { s3: extent(s3), s4: extent(s4) });
if (s7) {
  const discharges = s7.releaseHydrograph.map((point) => point.dischargeCMS);
  const localPeaks = discharges.filter((value, index) => value > (discharges[index - 1] ?? 0) && value > (discharges[index + 1] ?? 0));
  if (localPeaks.length < 2) add("FAIL", "P0", "S7 secondary blockage does not contain a delayed second pulse", { localPeaks });
}
if (runs.get("S0")?.scenario.name?.includes("Reference Reconstruction")) {
  add("FAIL", "P0", "S0 still uses over-claiming reference reconstruction label", { name: runs.get("S0").scenario.name });
}

const status = results.some((item) => item.status === "FAIL" && item.severity === "P0") ? "FAIL" : results.some((item) => item.status === "WARN") ? "WARN" : "PASS";
const report = {
  generatedAt: new Date().toISOString(),
  status,
  checkedScenarioCount: scenarios.runs.length,
  results,
};
writeFileSync("data/physics-validation.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(`Physics validation ${status}: ${results.length} findings.`);
if (status === "FAIL") process.exit(1);
