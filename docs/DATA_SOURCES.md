# Data Sources

## OpenStreetMap

- Provider: OpenStreetMap contributors
- URL: https://www.openstreetmap.org/copyright
- License: Open Database License 1.0
- Use: Corridor context, settlements, roads, bridges, observed communities and named tributary reaches where available
- Processing: Selected Bhote Koshi / Trishuli waterway ways are stitched into the primary corridor, then connected lower Trishuli ways extend the downstream flow path beyond Malekhu; a separate Overpass query adds observed communities and named tributary reaches near the extended corridor.
- Limitations: Completeness and naming vary by local mapping coverage

## Cesium World Terrain

- Provider: Cesium ion / CesiumJS
- URL: https://cesium.com/platform/cesium-ion/content/cesium-world-terrain/
- License: Cesium ion terms when token is configured
- Use: Browser terrain for the public 3D view
- Limitations: The demo first tries Cesium World Terrain when credentials are configured, then ArcGIS World Elevation, and only falls back to ellipsoid terrain if both terrain services are unavailable

## ArcGIS World Elevation

- Provider: Esri ArcGIS
- URL: https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer
- Use: Public runtime terrain fallback for Cesium terrain sampling and 3D relief
- Limitations: Requested at runtime; not bundled or redistributed

## International Charter Space and Major Disasters Activation 1052

- Provider: International Charter Space and Major Disasters
- URL: https://disasterscharter.org/activations/flood-in-nepal-activation-1052-
- Use: Event context only
- Limitations: Not used for calibrated flood depth or velocity

## Geopera Bhote Koshi Flood 2026 Reconstruction

- Provider: Geopera
- URL: https://geopera.com/blog/bhote-koshi-flood-2026-satellite-analysis
- Date: August 28, 2026
- License: Article is public; referenced derived products are described as inheriting CC BY-NC 4.0 from Vantor/Planet imagery
- Use: Scientific reference for the August 26 event scale, timing, source datasets, and the important distinction between the approximately 100 Mm3 reference event and 2-5 Mm3 barrier-lake what-if scenarios
- Redistribution limitations: Geopera derived rasters, measurements, images, and model products are not bundled in this commercial-ready showcase build
- Confidence/limitations: Used as published reference context; direct validation data is not redistributed here

## Planet Crisis Response STAC Catalog on Source Cooperative

- Provider: Planet Labs PBC / Source Cooperative
- URL: https://source.coop/planet/disasterdata/nepal-flash-flood-2026-08-26
- Date: Catalog page lists pre-event and post-event imagery around the 26 August 2026 flood
- Resolution: PlanetScope approximately 3.8 m, SkySat approximately 0.80 m, Pelican approximately 0.55 m, per the catalog README
- License: CC-BY-NC-4.0, attribution required and non-commercial use only
- Use: Real pre-event and post-event STAC scene footprints, acquisition timestamps, sensor metadata and provenance for the observed evidence layer
- Processing: `observed-evidence.geojson` is generated from public STAC item geometries and metadata for the pre-event PlanetScope collection and post-event PlanetScope, SkySat and Pelican collections.
- Redistribution limitations: Imagery pixels are not bundled. No Planet COGs, masks, thumbnails, or GeoParquet indexes are redistributed in this commercial-ready showcase
- Confidence/limitations: Cloud cover and sensor/product differences require expert review; visual assets are reference-only here

## Associated Press Reporting

- Provider: Associated Press
- URL: https://apnews.com/article/d8c11c2215ea0792e3612bf791e4299f
- Use: Context on glacier-collapse flood risk in the Himalayas
- Limitations: News context is not a hydraulic calibration dataset

## Representative Simulation Dataset

- Provider: Nebula Cloud Studio showcase generator
- URL: local `scripts/data/generate-nepal-demo-data.mjs`
- License: Project-owned synthetic data
- Use: Replay, What-If Lab, exposure and comparison
- Processing: OpenStreetMap Bhote Koshi / Trishuli / lower Trishuli waterway geometries are stitched and resampled into a 150-point river centerline; flood envelopes propagate along that centerline and are constrained by runtime terrain cross-sections
- Limitations: Synthetic representative output; not official warning data
