# Limitations

- Not an official flood warning, evacuation, damage, or engineering design tool.
- No calibrated hydraulic model output is integrated.
- No ANUGA, HEC-RAS, BASEMENT, or equivalent 2D shallow-water solver output is bundled yet.
- No observed flood polygon IoU is reported.
- No OSM/HOT road LineString extract is bundled yet, so road exposure length remains a surrogate metric.
- No official casualty, damage, warning, or evacuation claims are made.
- Exposure does not imply damage or confirmed impassability.
- Terrain-aware rendering samples Cesium terrain when configured, but hydraulic values remain representative until solver outputs are integrated.
- Some bridge and infrastructure names are representative demo identifiers where official names are not verified.
- Simplified isolation analysis is represented through exposure and bridge-condition sensitivity, not a full routable transport network.
