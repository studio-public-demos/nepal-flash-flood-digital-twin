# Scenario Model

Anchor scenarios:

- S0 August 26 Representative Event Replay, stored separately as an approximately 100 Mm3 reference-scale event
- S1 2 Mm3 slow overtopping
- S2 3.5 Mm3 partial breach
- S3 5 Mm3 rapid breach
- S4 5 Mm3 rapid breach + heavy rainfall
- S5 5 Mm3 rapid breach + 30% debris proxy
- S6 5 Mm3 rapid breach + bridge obstruction sensitivity
- S7 Secondary blockage / delayed release

For every scenario, the canonical runtime engine generates an explicit release hydrograph `Q(t)` from:

- lake volume;
- breach mechanism;
- breach duration;
- breach width;
- rainfall;
- antecedent river flow;
- debris;
- secondary blockage.

The hydrograph is mass-balanced against the released water volume within the documented tolerance. Scenario-specific arrival curves are then derived from the hydrograph peak, roughness, debris, and breach mechanism so each scenario has its own flood-front progression. Secondary blockage creates a delayed second pulse rather than a uniform multiplier.

For visitor-defined scenarios, the engine finds nearby S1-S7 what-if anchors and interpolates representative flood frames. Exposure is recalculated geometrically from the resulting inundation envelope. Bridge obstruction is treated as a localized sensitivity around representative bridge assets, not as a global flood multiplier.

S0 is not a 2-5 Mm3 barrier-lake scenario. It is a separate representative replay scale from the published reference context and is used only for comparison and visual replay. S0 is excluded from what-if interpolation.

This public build is a compact browser-ready surrogate. It does not yet bundle ANUGA, HEC-RAS, BASEMENT, calibrated DEM-derived shallow-water rasters, observed flood polygons, or surveyed high-water marks.
