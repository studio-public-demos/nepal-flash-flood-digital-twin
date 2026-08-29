import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDir = join(root, "showcase", "nepal-flash-flood", "data");
const sourceCoopRoot = "https://data.source.coop/planet/disasterdata/nepal-flash-flood-2026-08-26/";

const placeAnchors = [
  [85.3266, 28.2381, "Rasuwagadhi"],
  [85.3075, 28.2006, "Timure"],
  [85.3002, 28.1648, "Landslide reach"],
  [85.2960, 28.1046, "Syabrubesi"],
  [85.2534, 28.0180, "Trishuli confluence reach"],
  [85.1765, 27.9524, "Betrawati"],
  [85.1614, 27.9073, "Devighat"],
  [85.0330, 27.8228, "Galchhi"],
  [84.8684, 27.8105, "Malekhu"],
  [84.6423, 27.8601, "Lower Trishuli bend"],
  [84.5592, 27.8578, "Downstream Trishuli reach"],
  [84.4220, 27.7413, "Lower Trishuli terminus"],
];

const riverWayIds = [
  201928141,
  809865767,
  24624604,
  928822514,
  119684552,
  84953861,
  321548891,
  343007937,
  343007938,
  27033466,
  915399520,
  915399518,
  915399519,
  1553053155,
  185752518,
  185752519,
  291315938,
  302726219,
  302726221,
  26951335,
];

function distanceKm(a, b) {
  const toRad = (value) => (value * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

function cumulativeKm(line) {
  const distances = [0];
  for (let index = 1; index < line.length; index += 1) {
    distances.push((distances.at(-1) ?? 0) + distanceKm(line[index - 1], line[index]));
  }
  return distances;
}

function interpolatePoint(a, b, fraction) {
  return [
    Number((a[0] + (b[0] - a[0]) * fraction).toFixed(6)),
    Number((a[1] + (b[1] - a[1]) * fraction).toFixed(6)),
  ];
}

function resampleLine(line, spacingKm) {
  if (line.length < 2) return line;
  const cumulative = cumulativeKm(line);
  const total = cumulative.at(-1) ?? 0;
  const sampled = [line[0]];
  for (let target = spacingKm; target < total; target += spacingKm) {
    const afterIndex = cumulative.findIndex((value) => value >= target);
    if (afterIndex <= 0) continue;
    const beforeKm = cumulative[afterIndex - 1];
    const afterKm = cumulative[afterIndex];
    sampled.push(interpolatePoint(line[afterIndex - 1], line[afterIndex], (target - beforeKm) / Math.max(0.000001, afterKm - beforeKm)));
  }
  sampled.push(line.at(-1));
  return sampled;
}

function trimToLongitude(line, minLon) {
  const trimmed = [];
  for (const point of line) {
    trimmed.push(point);
    if (point[0] <= minLon) break;
  }
  return trimmed.length > 3 ? trimmed : line;
}

async function fetchOsmRiverCorridor() {
  const query = `
[out:json][timeout:60];
(
  way(id:${riverWayIds.join(",")});
);
out geom;`;
  const response = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": "Nebula Cloud Studio Nepal flood showcase data generator" },
  });
  if (!response.ok) throw new Error(`Overpass river request failed: ${response.status} ${response.statusText}`);
  const osm = await response.json();
  const byId = new Map(osm.elements.filter((element) => element.type === "way").map((element) => [element.id, element.geometry.map((p) => [p.lon, p.lat])]));
  const stitched = [];
  for (const id of riverWayIds) {
    const geometry = byId.get(id);
    if (!geometry?.length) throw new Error(`OSM river way ${id} was not returned by Overpass.`);
    const oriented = stitched.length && distanceKm(stitched.at(-1), geometry.at(-1)) < distanceKm(stitched.at(-1), geometry[0])
      ? [...geometry].reverse()
      : geometry;
    const segment = stitched.length && distanceKm(stitched.at(-1), oriented[0]) < 0.02 ? oriented.slice(1) : oriented;
    stitched.push(...segment);
  }
  return resampleLine(trimToLongitude(stitched, 84.42), 1.2);
}

const corridor = await fetchOsmRiverCorridor();

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "Nebula Cloud Studio Nepal flood showcase data generator" },
  });
  if (!response.ok) throw new Error(`Request failed for ${url}: ${response.status} ${response.statusText}`);
  return response.json();
}

function resolveStacHref(baseUrl, href) {
  return new URL(href, baseUrl).href;
}

function bboxPolygon([west, south, east, north]) {
  return [[
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ]];
}

async function fetchPlanetSceneEvidence() {
  const collectionUrls = [
    `${sourceCoopRoot}pre-event/planetscope-2026-05-27/collection.json`,
    `${sourceCoopRoot}post-event/planetscope-2026-08-26/collection.json`,
    `${sourceCoopRoot}post-event/skysat-2026-08-27/collection.json`,
    `${sourceCoopRoot}post-event/pelican-2026-08-27/collection.json`,
    `${sourceCoopRoot}post-event/planetscope-2026-08-28/collection.json`,
  ];
  const features = [];
  for (const collectionUrl of collectionUrls) {
    const collection = await fetchJson(collectionUrl);
    const phase = collection.id.includes("pre-event") ? "pre-event" : "post-event";
    const sensor = collection.summaries?.constellation?.[0] ?? collection.id.split("-")[2] ?? "planet";
    const itemLinks = collection.links.filter((link) => link.rel === "item");
    for (const link of itemLinks) {
      const itemUrl = resolveStacHref(collectionUrl, link.href);
      const item = await fetchJson(itemUrl);
      const visualHref = item.assets?.visual?.href ? resolveStacHref(itemUrl, item.assets.visual.href) : "";
      const thumbnailHref = item.assets?.thumbnail?.href ? resolveStacHref(itemUrl, item.assets.thumbnail.href) : "";
      features.push({
        type: "Feature",
        properties: {
          id: item.id,
          name: `${phase} ${sensor} ${item.properties?.datetime ?? link.title ?? ""}`,
          kind: "satellite_scene",
          phase,
          sensor,
          collectionId: collection.id,
          collectionTitle: collection.title,
          datetime: item.properties?.datetime ?? link.title,
          gsd: item.properties?.gsd ?? item.properties?.["pl:pixel_resolution"] ?? null,
          cloudCover: item.properties?.["eo:cloud_cover"] ?? null,
          qualityCategory: item.properties?.["pl:quality_category"] ?? null,
          classification: "observed",
          license: collection.license,
          sourceUrl: itemUrl,
          visualHref,
          thumbnailHref,
        },
        geometry: item.geometry ?? { type: "Polygon", coordinates: bboxPolygon(item.bbox ?? collection.extent.spatial.bbox[0]) },
      });
    }
  }
  return features;
}

async function fetchOsmObservedContext() {
  const bbox = "27.68,84.38,28.38,85.46";
  const query = `
[out:json][timeout:60][bbox:${bbox}];
(
  node["place"~"city|town|village|hamlet"];
  way["place"~"city|town|village|hamlet"];
  relation["place"~"city|town|village|hamlet"];
  way["waterway"~"river|stream"]["name"];
);
out center geom;`;
  const response = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": "Nebula Cloud Studio Nepal flood showcase data generator" },
  });
  if (!response.ok) throw new Error(`Overpass observed context request failed: ${response.status} ${response.statusText}`);
  const osm = await response.json();
  const features = [];
  for (const element of osm.elements) {
    const tags = element.tags ?? {};
    if (tags.place && tags.name) {
      const lon = element.lon ?? element.center?.lon;
      const lat = element.lat ?? element.center?.lat;
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      if (distanceKm([lon, lat], corridor.reduce((best, point) => (distanceKm(point, [lon, lat]) < distanceKm(best, [lon, lat]) ? point : best), corridor[0])) > 7) continue;
      features.push({
        type: "Feature",
        properties: {
          id: `osm-place-${element.type}-${element.id}`,
          name: tags.name,
          kind: "observed_community",
          place: tags.place,
          corridorKm: nearestCorridorKm([lon, lat]),
          classification: "observed",
          source: "OpenStreetMap",
          osmType: element.type,
          osmId: element.id,
        },
        geometry: { type: "Point", coordinates: [Number(lon.toFixed(6)), Number(lat.toFixed(6))] },
      });
    }
    if (tags.waterway && tags.name && element.geometry?.length && !riverWayIds.includes(element.id)) {
      const line = element.geometry.map((point) => [point.lon, point.lat]);
      const nearest = Math.min(...line.map((point) => Math.min(...corridor.map((riverPoint) => distanceKm(point, riverPoint)))));
      if (nearest > 2.2) continue;
      const nearestPoint = line.reduce((best, point) => {
        const pointDistance = Math.min(...corridor.map((riverPoint) => distanceKm(point, riverPoint)));
        const bestDistance = Math.min(...corridor.map((riverPoint) => distanceKm(best, riverPoint)));
        return pointDistance < bestDistance ? point : best;
      }, line[0]);
      features.push({
        type: "Feature",
        properties: {
          id: `osm-waterway-${element.id}`,
          name: tags.name,
          kind: "observed_tributary",
          waterway: tags.waterway,
          corridorKm: nearestCorridorKm(nearestPoint),
          classification: "observed",
          source: "OpenStreetMap",
          osmType: element.type,
          osmId: element.id,
        },
        geometry: { type: "LineString", coordinates: line.map(([lon, lat]) => [Number(lon.toFixed(6)), Number(lat.toFixed(6))]) },
      });
    }
  }
  return features;
}

const dataSources = [
  {
    id: "osm",
    name: "OpenStreetMap corridor features",
    provider: "OpenStreetMap contributors",
    url: "https://www.openstreetmap.org/copyright",
    license: "Open Database License 1.0",
    classification: "observed",
    limitations: "River centerline is generated from selected OSM waterway way geometries via Overpass API; feature completeness and names vary by local mapping coverage.",
  },
  {
    id: "cesium-world-terrain",
    name: "Cesium World Terrain / ellipsoid fallback",
    provider: "Cesium ion / CesiumJS",
    url: "https://cesium.com/platform/cesium-ion/content/cesium-world-terrain/",
    license: "Cesium ion terms when token is configured; browser falls back without credentials.",
    classification: "derived",
    limitations: "Public demo uses browser terrain provider configuration and does not bundle an engineering DEM.",
  },
  {
    id: "geopera-bhote-koshi-2026",
    name: "Bhote Koshi Flood 2026 reconstruction analysis",
    provider: "Geopera",
    url: "https://geopera.com/blog/bhote-koshi-flood-2026-satellite-analysis",
    license: "Public article; linked derived data described as CC BY-NC 4.0 and not redistributed here.",
    classification: "derived",
    limitations: "Used as reference context for event scale and methods only; no Geopera rasters, imagery, measurements, or model outputs are bundled.",
  },
  {
    id: "planet-source-coop-nepal-2026",
    name: "Planet Crisis Response - Bhote Koshi-Trishuli Outburst Flood STAC catalog",
    provider: "Planet Labs PBC / Source Cooperative",
    url: "https://source.coop/planet/disasterdata/nepal-flash-flood-2026-08-26",
    license: "CC-BY-NC-4.0; attribution required and non-commercial use only.",
    classification: "observed",
    limitations: "Used as a cited public reference catalog only. Imagery, COGs, masks, thumbnails, STAC items, and GeoParquet indexes are not bundled in this commercial-ready showcase.",
  },
  {
    id: "disasters-charter-1052",
    name: "International Charter activation 1052 event notice",
    provider: "International Charter Space and Major Disasters",
    url: "https://disasterscharter.org/activations/flood-in-nepal-activation-1052-",
    license: "Public event notice; consult provider for imagery products.",
    classification: "observed",
    limitations: "Used for event context only, not for calibrated flood depths.",
  },
  {
    id: "ap-2026-nepal-glacier-risk",
    name: "AP reporting on glacier-collapse flood risk",
    provider: "Associated Press",
    url: "https://apnews.com/article/d8c11c2215ea0792e3612bf791e4299f",
    license: "Copyright AP; used only as cited context.",
    classification: "observed",
    limitations: "News reporting is not used as a hydraulic calibration dataset.",
  },
];

const provenance = {
  classification: "synthetic",
  source: "Nebula Cloud Studio public showcase representative generator",
  modelVersion: "nepal-flash-flood-surrogate-v0.1.0",
  generationMethod: "Terrain-aware corridor envelope generated from OpenStreetMap Bhote Koshi / Trishuli river geometry, runtime terrain sampling, the published Geopera reference scale, and synthetic depth/velocity curves.",
  confidence: "low",
  limitations: [
    "Representative synthetic simulation output, not official warning data.",
    "No calibrated HEC-RAS, BASEMENT, observed flood polygon, or surveyed high-water-mark dataset is integrated.",
    "Exposure means modeled intersection with a representative flood envelope, not damage or confirmed disruption.",
  ],
  dataSources,
};

function nearestCorridorKm(coordinates) {
  const distances = cumulativeKm(corridor);
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  corridor.forEach((point, index) => {
    const distance = distanceKm(point, coordinates);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return Number((distances[bestIndex] ?? 0).toFixed(1));
}

const assets = [
  ["bridge-rasuwagadhi-01", "Demo bridge ID near Rasuwagadhi", "bridge", [85.3261, 28.2357], false],
  ["settlement-rasuwagadhi", "Rasuwagadhi", "settlement", [85.3266, 28.2381], true],
  ["settlement-timure", "Timure", "settlement", [85.3075, 28.2006], true],
  ["bridge-timure-01", "Demo bridge ID near Timure", "bridge", [85.3069, 28.1998], false],
  ["settlement-syabrubesi", "Syabrubesi", "settlement", [85.296, 28.1046], true],
  ["bridge-syabrubesi-01", "Demo bridge ID near Syabrubesi", "bridge", [85.2967, 28.104], false],
  ["road-corridor-01", "Rasuwagadhi-Syabrubesi road corridor segment", "road", [85.302, 28.151], false],
  ["settlement-betrawati", "Betrawati", "settlement", [85.1765, 27.9524], true],
  ["bridge-betrawati-01", "Demo bridge ID near Betrawati", "bridge", [85.176, 27.9518], false],
  ["critical-devighat-hydro", "Representative hydropower / utility asset near Devighat", "critical_facility", [85.1614, 27.9073], false],
  ["settlement-galchhi", "Galchhi", "settlement", [85.033, 27.8228], true],
  ["settlement-malekhu", "Malekhu", "settlement", [84.8684, 27.8105], true],
  ["settlement-lower-trishuli-bend", "Lower Trishuli bend community cluster", "settlement", [84.6423, 27.8601], false],
  ["road-lower-trishuli-transport", "Lower Trishuli transport corridor segment", "road", [84.5592, 27.8578], false],
  ["critical-lower-trishuli-monitoring", "Representative downstream monitoring point", "critical_facility", [84.4220, 27.7413], false],
].map(([id, name, kind, coordinates, officialNameVerified]) => ({
  id,
  name,
  kind,
  coordinates,
  corridorKm: nearestCorridorKm(coordinates),
  officialNameVerified,
  classification: officialNameVerified ? "observed" : "representative",
}));

const anchors = [
  { id: "S0", name: "August 26 Reference Reconstruction", scenarioType: "reference_event", referenceReleaseMillionM3: 100, lakeVolumeMillionM3: 5, breachMechanism: "catastrophic_breach", breachDurationMinutes: 8, relativeBreachWidth: "extreme", rainfallMultiplier: 1.0, antecedentFlow: "normal", debrisPercent: 45, channelRoughness: "normal", bridgeCondition: "existing", secondaryBlockage: false, intensity: 3.85 },
  { id: "S1", name: "S1 - 2 Mm3 Slow Overtopping", scenarioType: "barrier_lake_what_if", lakeVolumeMillionM3: 2.0, breachMechanism: "slow_overtopping", breachDurationMinutes: 110, relativeBreachWidth: "small", rainfallMultiplier: 0.7, antecedentFlow: "low", debrisPercent: 8, channelRoughness: "high", bridgeCondition: "existing", secondaryBlockage: false, intensity: 0.62 },
  { id: "S2", name: "S2 - 3.5 Mm3 Partial Breach", scenarioType: "barrier_lake_what_if", lakeVolumeMillionM3: 3.5, breachMechanism: "partial_breach", breachDurationMinutes: 70, relativeBreachWidth: "medium", rainfallMultiplier: 1.0, antecedentFlow: "normal", debrisPercent: 18, channelRoughness: "normal", bridgeCondition: "existing", secondaryBlockage: false, intensity: 1.02 },
  { id: "S3", name: "S3 - 5 Mm3 Rapid Breach", scenarioType: "barrier_lake_what_if", lakeVolumeMillionM3: 5.0, breachMechanism: "rapid_breach", breachDurationMinutes: 35, relativeBreachWidth: "large", rainfallMultiplier: 1.0, antecedentFlow: "normal", debrisPercent: 22, channelRoughness: "normal", bridgeCondition: "existing", secondaryBlockage: false, intensity: 1.34 },
  { id: "S4", name: "S4 - 5 Mm3 Rapid Breach + Heavy Rainfall", scenarioType: "barrier_lake_what_if", lakeVolumeMillionM3: 5.0, breachMechanism: "rapid_breach", breachDurationMinutes: 30, relativeBreachWidth: "large", rainfallMultiplier: 1.8, antecedentFlow: "high", debrisPercent: 25, channelRoughness: "normal", bridgeCondition: "existing", secondaryBlockage: false, intensity: 1.55 },
  { id: "S5", name: "S5 - 5 Mm3 Rapid Breach + 30% Debris Proxy", scenarioType: "barrier_lake_what_if", lakeVolumeMillionM3: 5.0, breachMechanism: "rapid_breach", breachDurationMinutes: 35, relativeBreachWidth: "large", rainfallMultiplier: 1.2, antecedentFlow: "high", debrisPercent: 30, channelRoughness: "high", bridgeCondition: "partially_blocked", secondaryBlockage: true, intensity: 1.58 },
  { id: "S6", name: "S6 - 5 Mm3 Rapid Breach + Bridge Obstruction Sensitivity", scenarioType: "barrier_lake_what_if", lakeVolumeMillionM3: 5.0, breachMechanism: "rapid_breach", breachDurationMinutes: 45, relativeBreachWidth: "extreme", rainfallMultiplier: 1.3, antecedentFlow: "high", debrisPercent: 30, channelRoughness: "normal", bridgeCondition: "fully_blocked", secondaryBlockage: true, intensity: 1.48 },
  { id: "S7", name: "S7 - Secondary Blockage / Delayed Release", scenarioType: "barrier_lake_what_if", lakeVolumeMillionM3: 4.6, breachMechanism: "partial_breach", breachDurationMinutes: 95, relativeBreachWidth: "medium", rainfallMultiplier: 1.2, antecedentFlow: "high", debrisPercent: 35, channelRoughness: "high", bridgeCondition: "partially_blocked", secondaryBlockage: true, intensity: 1.28 },
];

function offsetPoint([lon, lat], width, side) {
  return [Number((lon + width * side * 0.0017).toFixed(6)), Number((lat + width * side * 0.0011).toFixed(6))];
}

function footprintFor(progress, width) {
  const reached = Math.max(2, Math.ceil(progress * corridor.length));
  const left = corridor.slice(0, reached).map((p, i) => offsetPoint(p, width * (0.65 + i / corridor.length), -1));
  const right = corridor.slice(0, reached).reverse().map((p, i) => offsetPoint(p, width * (0.8 + i / corridor.length), 1));
  return [...left, ...right];
}

function buildFrames(intensity) {
  return [0, 10, 20, 30, 45, 60, 90, 120].map((time) => {
    const release = Math.max(0, Math.min(1, (time - 4) / (86 - Math.min(26, intensity * 12))));
    const peak = Math.sin(Math.min(Math.PI, release * Math.PI));
    const width = 0.35 + intensity * 0.24 + peak * 0.35;
    const meanDepthM = Number((0.18 + peak * intensity * 1.05).toFixed(2));
    const maxDepthM = Number((meanDepthM * (1.85 + intensity * 0.17)).toFixed(2));
    const velocityMS = Number((0.6 + peak * intensity * 2.45).toFixed(2));
    return {
      timeMinutes: time,
      footprint: footprintFor(release, width),
      centerline: corridor,
      meanDepthM,
      maxDepthM,
      velocityMS,
      hazardIndex: Number((maxDepthM * velocityMS).toFixed(2)),
      classification: "synthetic",
    };
  });
}

function buildMetrics(frames, exposure) {
  const maxFrame = frames.reduce((best, frame) => (frame.maxDepthM > best.maxDepthM ? frame : best), frames[0]);
  const exposed = exposure.filter((x) => x.exposure !== "none");
  const downstreamExposed = exposed.filter((x) => (assets.find((asset) => asset.id === x.assetId)?.corridorKm ?? 0) > 105);
  return [
    ["extent", "Modeled inundated area", Number((maxFrame.footprint.length * maxFrame.meanDepthM * 0.42).toFixed(1)), "ha"],
    ["depth", "Maximum modeled depth", maxFrame.maxDepthM, "m"],
    ["velocity", "Maximum modeled velocity", maxFrame.velocityMS, "m/s"],
    ["roads", "Road length exposed", Number((exposed.length * 1.35).toFixed(1)), "km"],
    ["bridges", "Bridges exposed", exposed.filter((x) => x.assetId.includes("bridge")).length, "assets"],
    ["settlements", "Settlements intersecting hazard", exposed.filter((x) => x.assetId.includes("settlement")).length, "settlements"],
    ["downstream", "Downstream assets exposed", downstreamExposed.length, "assets"],
  ].map(([id, label, value, unit]) => ({ id, label, value, unit, classification: "estimated" }));
}

function classifyHazard(index) {
  if (index <= 0.05) return "none";
  if (index < 0.8) return "low";
  if (index < 2.0) return "moderate";
  if (index < 4.0) return "high";
  return "very_high";
}

function classifyExposure(depth, hazard) {
  if (depth <= 0.05 || hazard === "none") return "none";
  if (depth < 0.6) return "low";
  if (depth < 1.8 && hazard !== "very_high") return "moderate";
  return "high";
}

function scenario(anchor) {
  return {
    id: anchor.id,
    name: anchor.name,
    scenarioType: anchor.scenarioType,
    referenceReleaseMillionM3: anchor.referenceReleaseMillionM3,
    lakeVolumeMillionM3: anchor.lakeVolumeMillionM3,
    breachMechanism: anchor.breachMechanism,
    breachDurationMinutes: anchor.breachDurationMinutes,
    relativeBreachWidth: anchor.relativeBreachWidth,
    rainfallMultiplier: anchor.rainfallMultiplier,
    antecedentFlow: anchor.antecedentFlow,
    debrisPercent: anchor.debrisPercent,
    channelRoughness: anchor.channelRoughness,
    bridgeCondition: anchor.bridgeCondition,
    secondaryBlockage: anchor.secondaryBlockage,
    provenance,
  };
}

function exposureFor(frames, intensity) {
  const maxVelocity = Math.max(...frames.map((f) => f.velocityMS));
  return assets.map((asset) => {
    const reachFactor = Math.max(0, Math.min(1.5, intensity - asset.corridorKm / 165 + (asset.kind === "bridge" ? 0.12 : 0)));
    const maxModeledDepthM = Number(Math.max(0, reachFactor * 2.15 + (asset.kind === "settlement" ? -0.28 : 0.15)).toFixed(1));
    const maxModeledVelocityMS = Number(Math.max(0, maxVelocity * (0.72 + reachFactor / 4)).toFixed(1));
    const hazard = classifyHazard(maxModeledDepthM * maxModeledVelocityMS);
    return {
      assetId: asset.id,
      arrivalTimeMinutes: maxModeledDepthM > 0.05 ? Math.max(8, Math.round(asset.corridorKm * (1.6 - Math.min(0.7, intensity / 5)))) : null,
      maxModeledDepthM,
      maxModeledVelocityMS,
      hazard,
      exposure: classifyExposure(maxModeledDepthM, hazard),
      confidence: asset.classification === "observed" ? "medium" : "low",
      classification: "synthetic",
    };
  });
}

const runs = anchors.map((anchor) => {
  const frames = buildFrames(anchor.intensity);
  const assetExposure = exposureFor(frames, anchor.intensity);
  return {
    id: anchor.id,
    scenario: scenario(anchor),
    frames,
    metrics: buildMetrics(frames, assetExposure),
    rasterMetadata: {
      scenarioId: anchor.id,
      resolutionM: 90,
      horizontalDatum: "WGS84",
      verticalDatum: "representative relative depth",
      classification: "synthetic",
      notes: "Representative envelope for public interaction; replace with solver rasters when available.",
    },
    assetExposure,
    provenance,
    approximation: false,
  };
});

const infrastructure = {
  type: "FeatureCollection",
  features: [
    ...assets.map((asset) => ({
      type: "Feature",
      properties: asset,
      geometry: { type: "Point", coordinates: asset.coordinates },
    })),
    {
      type: "Feature",
      properties: { id: "river-bhote-koshi-trishuli", name: "Bhote Koshi / Trishuli corridor", kind: "river", classification: "derived" },
      geometry: { type: "LineString", coordinates: corridor },
    },
    {
      type: "Feature",
      properties: { id: "road-corridor-line", name: "Rasuwagadhi-Galchhi road corridor, representative alignment", kind: "road", classification: "representative" },
      geometry: { type: "LineString", coordinates: corridor.map(([lon, lat]) => [Number((lon + 0.006).toFixed(6)), Number((lat - 0.004).toFixed(6))]) },
    },
  ],
};

const observedEvidence = {
  type: "FeatureCollection",
  provenance: {
    classification: "observed",
    generatedFrom: [
      "Planet Crisis Response STAC catalog hosted by Source Cooperative",
      "OpenStreetMap places and waterways fetched with Overpass API",
    ],
    limitations: [
      "Planet imagery is CC-BY-NC-4.0 and is referenced as metadata/footprints only; imagery pixels are not bundled.",
      "OSM place and tributary completeness depends on community mapping coverage.",
      "These evidence layers do not contain measured water levels or validated inundation polygons.",
    ],
  },
  features: [
    ...(await fetchPlanetSceneEvidence()),
    ...(await fetchOsmObservedContext()),
  ],
};

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "scenarios.json"), JSON.stringify({ generatedAt: new Date().toISOString(), corridor, placeAnchors, riverWayIds, dataSources, provenance, runs }, null, 2));
await writeFile(join(outDir, "infrastructure.geojson"), JSON.stringify(infrastructure, null, 2));
await writeFile(join(outDir, "observed-evidence.geojson"), JSON.stringify(observedEvidence, null, 2));
console.log(`Generated ${runs.length} representative scenario runs from ${corridor.length} OSM river centerline samples in ${outDir}`);
