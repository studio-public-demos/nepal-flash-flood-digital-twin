# Future Studio Integration

The current build is web-only and does not depend on Studio Desktop, StudioOS Runtime, Supervisor, Atlas, HEC-RAS, or BASEMENT.

Provider boundaries are already present in TypeScript:

- `FloodSimulationEngine`
- `MissionExecutionProvider`
- `GeospatialAnalysisProvider`

Current implementations:

- `PrecomputedSimulationEngine`
- `SurrogateSimulationEngine` concept via browser interpolation in `PrecomputedSimulationEngine`
- `ShowcaseMissionProvider`
- local exposure calculations

Future adapters:

- `RemoteStudioSimulationEngine` can submit scenarios to Studio Runtime and return a `SimulationRun`.
- `AtlasProvider` can replace local exposure/accessibility calculations.
- `HecRasSimulationEngine` can normalize HEC-RAS outputs into frames, rasters, and exposure products.
- `BasementSimulationEngine` can do the same for BASEMENT results.

Any future adapter must preserve provenance, data classification, license metadata, and visible uncertainty labels.
