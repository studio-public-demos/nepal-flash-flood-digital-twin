import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

const required = [
  "index.html",
  "app.js",
  "styles.css",
  "data/scenarios.json",
  "data/infrastructure.geojson",
  "data/observed-evidence.geojson",
  "data/geography-validation.json",
  "data/physics-validation.json",
];

for (const file of required) {
  await access(join(process.cwd(), file));
}

const html = await readFile(join(process.cwd(), "index.html"), "utf8");
for (const needle of ["Scenario-based research simulation", "Source to Downstream", "Source data & mapped geography", "What-If Lab", "Model & Data", "Powered by Nebula Cloud Studio"]) {
  if (!html.includes(needle)) throw new Error(`Nepal page missing required text: ${needle}`);
}

const scenarios = JSON.parse(await readFile(join(process.cwd(), "data/scenarios.json"), "utf8"));
if (!Array.isArray(scenarios?.runs) || scenarios.runs.length < 8) {
  throw new Error("Expected at least eight published Nepal scenario runs.");
}

for (const run of scenarios.runs) {
  if (!Array.isArray(run.releaseHydrograph) || run.releaseHydrograph.length < 10) {
    throw new Error(`${run.scenario?.id ?? "unknown"} missing release hydrograph.`);
  }
  if (!run.frames?.every((frame) => Array.isArray(frame.arrivalTimeByKm) && frame.arrivalTimeByKm.length > 10)) {
    throw new Error(`${run.scenario?.id ?? "unknown"} missing arrival curve data.`);
  }
}

console.log("Static showcase build validated.");
