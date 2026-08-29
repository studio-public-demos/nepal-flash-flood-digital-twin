import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const infrastructure = JSON.parse(await readFile(join(root, "data/infrastructure.geojson"), "utf8"));
const scenarios = JSON.parse(await readFile(join(root, "data/scenarios.json"), "utf8"));
const appSource = await readFile(join(root, "src/nepal-flash-flood/app.ts"), "utf8");

const findings = [];

function add(severity, code, message, context = {}) {
  findings.push({ severity, code, message, context });
}

function isLonLat(coordinates) {
  return (
    Array.isArray(coordinates) &&
    coordinates.length >= 2 &&
    Number.isFinite(coordinates[0]) &&
    Number.isFinite(coordinates[1]) &&
    coordinates[0] >= 80 &&
    coordinates[0] <= 90 &&
    coordinates[1] >= 25 &&
    coordinates[1] <= 31
  );
}

for (const feature of infrastructure.features ?? []) {
  const id = feature.properties?.id ?? "unknown";
  if (feature.geometry?.type !== "Point") {
    add("WARN", "non_point_asset", "Spatial 3D QA currently checks point assets only.", { id, type: feature.geometry?.type });
    continue;
  }
  if (!isLonLat(feature.geometry.coordinates)) {
    add("FAIL", "invalid_asset_coordinate", "Point asset coordinate is outside the Nepal corridor bounds or malformed.", {
      id,
      coordinates: feature.geometry?.coordinates,
    });
  }
  if (Number.isFinite(feature.properties?.heightM) && Math.abs(feature.properties.heightM) > 20) {
    add("FAIL", "explicit_asset_height", "Published point assets should be ground-clamped; explicit heights above 20 m require terrain QA evidence.", {
      id,
      heightM: feature.properties.heightM,
    });
  }
}

for (const run of scenarios.runs ?? []) {
  for (const frame of run.frames ?? []) {
    if (!Number.isFinite(frame.meanDepthM) || !Number.isFinite(frame.maxDepthM) || frame.meanDepthM < 0 || frame.maxDepthM < 0) {
      add("FAIL", "invalid_depth", "Flood frame has invalid or negative water depth.", {
        scenarioId: run.scenario?.id,
        timeMinutes: frame.timeMinutes,
        meanDepthM: frame.meanDepthM,
        maxDepthM: frame.maxDepthM,
      });
    }
    if (!Number.isFinite(frame.velocityMS) || frame.velocityMS < 0 || frame.velocityMS > 25) {
      add("FAIL", "invalid_velocity", "Flood frame velocity is outside configured QA bounds.", {
        scenarioId: run.scenario?.id,
        timeMinutes: frame.timeMinutes,
        velocityMS: frame.velocityMS,
      });
    }
    if (!Array.isArray(frame.footprint) || frame.footprint.length < 4 || !frame.footprint.every(isLonLat)) {
      add("FAIL", "invalid_water_polygon", "Flood frame is missing a valid inundation footprint ring.", {
        scenarioId: run.scenario?.id,
        timeMinutes: frame.timeMinutes,
      });
    }
  }
}

const forbiddenFloatingOffsets = [
  /\+\s*150\b/,
  /\+\s*170\b/,
  /\+\s*190\b/,
  /frame\.maxDepthM\s*\*\s*10/,
  /frame\.meanDepthM\s*\*\s*10/,
];

for (const pattern of forbiddenFloatingOffsets) {
  if (pattern.test(appSource)) {
    add("FAIL", "arbitrary_visual_height_offset", "Renderer still contains a large arbitrary visual height offset.", {
      pattern: String(pattern),
    });
  }
}

if (!appSource.includes("visualWaterSurfaceHeight")) {
  add("FAIL", "missing_visual_water_surface_height", "Flow overlay must project near terrain + modeled depth.", {});
}

if (!appSource.includes("perPositionHeight: true")) {
  add("FAIL", "missing_water_surface_mesh_height", "Water polygons must render with explicit per-position heights instead of terrain draping only.", {});
}

const failCount = findings.filter((finding) => finding.severity === "FAIL").length;
const warnCount = findings.filter((finding) => finding.severity === "WARN").length;
const report = {
  status: failCount ? "FAIL" : warnCount ? "WARN" : "PASS",
  generatedAt: new Date().toISOString(),
  qaScope: [
    "published point asset coordinates",
    "explicit point asset height offsets",
    "water depth and velocity sanity bounds",
    "water polygon ring presence",
    "renderer large-offset scan",
    "explicit water-surface rendering configuration",
  ],
  limitations: [
    "This static check does not sample live Cesium terrain elevations.",
    "It verifies renderer configuration and scenario data sanity, not calibrated hydraulic DEM residuals.",
  ],
  findings,
};

await writeFile(join(root, "data/spatial-3d-validation.json"), `${JSON.stringify(report, null, 2)}\n`);

console.log(`Spatial 3D validation ${report.status}: ${findings.length} findings.`);
if (failCount) process.exit(1);
