# Architecture

The showcase is a static web experience integrated into the existing Studio public demo catalogue.

```text
showcase/nepal-flash-flood/
  index.html
  styles.css
  app.js
  data/
    scenarios.json
    infrastructure.geojson
src/nepal-flash-flood/
  domain.ts
  hazard.ts
  engine.ts
  app.ts
scripts/data/
  generate-nepal-demo-data.mjs
```

## Runtime

The visitor-facing app uses CesiumJS from a CDN and static data assets generated during build. The simulation engine is a browser-side TypeScript module bundled with esbuild.

## Adapter Boundaries

`FloodSimulationEngine` supports replacement of the current `PrecomputedSimulationEngine` with future solver-backed adapters:

- `HecRasSimulationEngine`
- `BasementSimulationEngine`
- `RemoteStudioSimulationEngine`

`MissionExecutionProvider` supports replacement of `ShowcaseMissionProvider` with a future `StudioMissionRuntimeProvider`.

`GeospatialAnalysisProvider` is reserved for future Atlas-backed exposure and network analysis.
