# Methodology

The current public showcase uses precomputed representative scenario envelopes over real corridor geography. It is a browser-ready surrogate hardened for transparent scenario exploration, not a calibrated engineering flood model.

## Inputs

- OpenStreetMap Bhote Koshi / Trishuli waterway geometries stitched from named OSM ways and resampled into the simulation centerline, including the lower Trishuli continuation downstream of Malekhu.
- Published Planet/Source Cooperative event context describing a preliminary upper-catchment ice and rock avalanche trigger assessment; the cause remains under investigation.
- Public Cesium terrain, ArcGIS World Elevation terrain, or final ellipsoid fallback for visualization and terrain sampling.
- OpenStreetMap-derived infrastructure concepts and representative demo asset IDs where official names are not verified.
- Published Geopera reference context for the August 26, 2026 reconstruction scale.

S0 represents the August 26 event as an approximately 100 Mm3-scale representative replay. S1-S7 and custom scenarios represent smaller 2-5 Mm3 future barrier-lake what-if cases. S0 is excluded from custom what-if interpolation.

## Hydrographs And Flood Frames

Each scenario stores an explicit release hydrograph `Q(t)`. The hydrograph responds to lake volume, breach mechanism, breach duration, breach width, rainfall contribution, antecedent flow context, debris sensitivity, and secondary blockage. The integrated release volume is checked against the scenario volume in `data/physics-validation.json`.

Scenario-specific arrival curves are stored along the river centerline. A 2 Mm3 slow overtopping case therefore does not advance downstream on the same timeline as a 5 Mm3 rapid breach, and S7 includes a delayed multi-pulse release.

Each scenario contains frames at:

`T+00, T+10, T+20, T+30, T+45, T+60, T+90, T+120`

Each frame contains:

- inundation footprint polygon;
- centerline;
- mean depth;
- maximum depth;
- velocity magnitude;
- relative hydraulic hazard proxy `H = h * |V|`;
- data classification.

## Terrain-Aware Rendering

At runtime, the browser samples terrain along and across the Bhote Koshi / Trishuli / lower Trishuli OSM river centerline. It first uses Cesium World Terrain when configured, then ArcGIS World Elevation, then falls back to an ellipsoid only if terrain services are unavailable. The viewer builds cross-valley terrain sections, computes a representative water-surface stage for each timestep, and renders water as an explicit surface positioned from sampled terrain height plus modeled depth.

The hydraulic values are still representative surrogate values unless replaced by solver output. Terrain sampling constrains the footprint visualization; it does not by itself make the scenario a calibrated ANUGA, HEC-RAS, or BASEMENT model.

## Source-to-Downstream Story

The public route includes a source-to-downstream story rail. The source stage is published event context, not a mapped trigger polygon. The downstream endpoint is the showcase's lower mapped Trishuli extent, not an official hydrologic termination of the flood.

## What-If Approximation

When visitor controls do not match an anchor scenario exactly, the browser computes an interactive approximation from nearby scenario envelopes. This is not a newly executed hydraulic model.

Inputs influence release hydrograph shape, arrival timing, relative depth, relative velocity, hazard proxy, and geometric exposure metrics.

## Exposure

Point assets are exposed only when their coordinates fall inside the inundation envelope. Inundated area is calculated from polygon area. Road exposure remains a documented limitation until an OSM/HOT road LineString extract and line-polygon intersection pipeline are bundled.
