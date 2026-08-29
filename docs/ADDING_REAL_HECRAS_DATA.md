# Adding Real HEC-RAS Data

Future calibrated results can replace the representative scenario envelopes through the `FloodSimulationEngine` boundary.

Recommended import path:

1. Export HEC-RAS depth and velocity rasters or polygons per timestep.
2. Reproject outputs to WGS84 web coordinates.
3. Normalize frames to `SimulationFrame`.
4. Attach model provenance, calibration status, terrain source and validation metrics.
5. Generate optimized web assets under `showcase/nepal-flash-flood/data/`.
6. Replace or augment anchor runs S0-S6.

Do not label future outputs as calibrated unless calibration and validation metadata are available.
