# Nepal 2026 Flash Flood Digital Twin

This is a standalone Nebula Cloud Studio public showcase experience for the Bhote Koshi / Trishuli corridor in Nepal.

The public demo runs entirely in the browser. It does not require Studio Desktop, StudioOS Runtime, HEC-RAS, BASEMENT, PostGIS, or any local engineering software.

Route: `/`

## What Works

- CesiumJS 3D globe with real Nepal corridor coordinates.
- OpenStreetMap-derived Bhote Koshi / Trishuli river centerline, not straight settlement chords.
- Downstream Trishuli continuation beyond Malekhu using connected OSM river ways, with downstream impact metrics.
- Observed Planet/Source Cooperative STAC scene footprints and acquisition metadata for pre-event and post-event imagery.
- Observed OpenStreetMap communities and named tributary reaches near the corridor.
- Source-to-downstream journey annotations with modeled replay offsets and real PlanetScope, SkySat, and Pelican acquisition times from the public STAC catalog.
- Runtime terrain sampling from Cesium World Terrain when configured, ArcGIS World Elevation otherwise, with ellipsoid fallback only when terrain services are unavailable.
- Event replay with play, pause, restart, speed, and timeline scrubber.
- Fluidic event-reconstruction overlay with a visible surge front, sediment/debris streaks, wave crests and advected particles projected over the real terrain corridor.
- Explicit separation between S0, the approximately 100 Mm3 August 26 reference reconstruction, and S1-S7 2-5 Mm3 barrier-lake what-if scenarios.
- Terrain-constrained representative flood footprint, depth, velocity, and hazard rendering.

## What Is Not Claimed

- The water levels are not measured gauge or surveyed high-water-mark levels.
- The inundation envelope is not an observed flood polygon from Planet imagery.
- Overflow into tributaries and communities is not validated until observed inundation polygons or hydraulic raster outputs are integrated.
- Layer controls for water, velocity, hazard, river, roads, bridges, settlements, and critical infrastructure.
- Asset inspection with modeled exposure, arrival time, depth, velocity, hazard, confidence, and classification.
- What-If Lab for breach volume, breach type, duration, width, rainfall, antecedent flow, debris, roughness, bridge condition, and secondary blockage.
- Precomputed scenario selector for S1 through S7 plus custom visitor scenarios.
- Scenario comparison against the reference run.
- Showcase Mission visualization for the conceptual Studio workflow.
- Provenance and Model & Data disclosure.

## Safety Language

This experience is a scenario-based research simulation. It is not an official flood warning or evacuation system. Exposure means modeled intersection with a representative flood envelope, not damage.
