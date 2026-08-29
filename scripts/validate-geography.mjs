import { readFileSync, writeFileSync } from "node:fs";

const scenarios = JSON.parse(readFileSync("data/scenarios.json", "utf8"));
const infrastructure = JSON.parse(readFileSync("data/infrastructure.geojson", "utf8"));
const observed = JSON.parse(readFileSync("data/observed-evidence.geojson", "utf8"));

const requiredNames = ["Rasuwagadhi", "Timure", "Syabrubesi", "Betrawati", "Devighat", "Galchhi", "Malekhu"];
const features = [...infrastructure.features, ...observed.features];
const results = [];

function add(status, severity, label, details = {}) {
  results.push({ status, severity, label, details });
}

function validLonLat(coords) {
  return Number.isFinite(coords?.[0]) && Number.isFinite(coords?.[1]) && coords[0] > 84 && coords[0] < 86 && coords[1] > 27 && coords[1] < 29;
}

function haversineKm(a, b) {
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function minDistanceToCorridor(point) {
  return Math.min(...scenarios.corridor.map((candidate) => haversineKm(point, candidate)));
}

const ids = new Set();
for (const feature of features) {
  const id = feature.properties?.id;
  if (!id) add("FAIL", "P0", "Feature is missing id", { feature });
  if (ids.has(id)) add("FAIL", "P0", "Duplicate feature id", { id });
  ids.add(id);
  if (feature.geometry?.type === "Point") {
    const coords = feature.geometry.coordinates;
    if (!validLonLat(coords)) add("FAIL", "P0", "Point feature has invalid lon/lat", { id, coords });
    if (coords?.[0] === 0 || coords?.[1] === 0) add("FAIL", "P0", "Point feature has zero coordinate", { id, coords });
    const distanceKm = minDistanceToCorridor(coords);
    if (distanceKm > 8) add("WARN", "P1", "Point feature is far from mapped river corridor", { id, distanceKm: Number(distanceKm.toFixed(2)) });
    const isObservedSettlement = feature.properties?.kind === "settlement" && feature.properties?.classification === "observed";
    if (isObservedSettlement && (!feature.properties?.osmId || !feature.properties?.osmType)) {
      add("FAIL", "P0", "Observed settlement lacks OSM traceability", { id, name: feature.properties?.name });
    }
  }
}

for (const name of requiredNames) {
  const matching = features.filter((feature) => feature.properties?.name === name || feature.properties?.canonicalName === name);
  if (!matching.length) {
    add("WARN", "P1", "Named place is not yet backed by an OSM feature in the production dataset", { name });
  }
}

const status = results.some((item) => item.status === "FAIL" && item.severity === "P0") ? "FAIL" : results.some((item) => item.status === "WARN") ? "WARN" : "PASS";
const report = {
  generatedAt: new Date().toISOString(),
  status,
  checkedFeatureCount: features.length,
  results,
};
writeFileSync("data/geography-validation.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(`Geography validation ${status}: ${results.length} findings.`);
if (status === "FAIL") process.exit(1);
