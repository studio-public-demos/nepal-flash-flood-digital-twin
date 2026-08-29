# License Review

This production showcase does not bundle Geopera, Vantor, Planet imagery pixels, WorldView imagery, PlanetScope imagery pixels, SkySat imagery pixels, Pelican imagery pixels, HEC-RAS, BASEMENT, NASA HMA DEM, Copernicus DEM, or HOT tasking-manager exports.

## Geopera / Vantor / Planet

Geopera's public reconstruction is used as scientific reference and citation context. The article states that the source imagery programmes and derived products are CC BY-NC 4.0. Because the Studio Demo Showcase may be used commercially, those rasters, derived measurements, and model outputs are not redistributed in this build.

Use in this showcase: cited context only, especially the separation between the approximately 100 Mm3 August 26 reference event and smaller 2-5 Mm3 barrier-lake what-if scenarios.

## Planet Source Cooperative Disaster Data

The Source Cooperative catalog at `https://source.coop/planet/disasterdata/nepal-flash-flood-2026-08-26` is public and documents PlanetScope, SkySat, and Pelican imagery as a STAC catalog, but it is licensed CC-BY-NC-4.0. Because that license is non-commercial, the showcase does not bundle or display imagery pixels, COGs, masks, thumbnails, or GeoParquet indexes.

The public build does include a small hand-curated acquisition-coverage GeoJSON derived from catalog metadata so users can see where cited scenes were collected. These footprints are classified as satellite acquisition coverage, not observed flood evidence, not derived flood masks, and not validation products.

## Cesium

The page can use CesiumJS from a CDN and Cesium World Terrain when a valid ion token is configured. Terrain is requested from the viewer at runtime and is not redistributed in the repository. Without a token, the app falls back to an ellipsoid terrain provider and remains functional.

## OpenStreetMap / HOT

Corridor place names are based on real geography and OpenStreetMap/HOT context where available. The current demo ships a small bounded GeoJSON with representative bridge/facility identifiers and lowered confidence for named settlements that are not yet backed by stored OSM feature IDs. Any future bundled OSM extract must preserve ODbL attribution and share-alike requirements.

## NASA / Copernicus / Nepal Sources

NASA HMA terrain, Copernicus DEM, Nepal BIPAD, DHM Nepal, ICIMOD, and Copernicus Emergency Management products are documented as future integration sources. They are not bundled in this public static build.

## Release Gate

Before publishing a new version with third-party data, confirm license, attribution, commercial-use permission, redistribution permission, source URL, processing steps, and checksums in `DATA_SOURCES.md`.
