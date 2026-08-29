# Scenario Model

Anchor scenarios:

- S0 August 26 Reference Reconstruction, stored separately as an approximately 100 Mm3 reference event
- S1 2 Mm3 slow overtopping
- S2 3.5 Mm3 partial breach
- S3 5 Mm3 rapid breach
- S4 5 Mm3 rapid breach + heavy rainfall
- S5 5 Mm3 rapid breach + 30% debris proxy
- S6 5 Mm3 rapid breach + bridge obstruction sensitivity
- S7 Secondary blockage / delayed release

For S1-S7 and custom visitor scenarios, the scenario model computes a dimensionless intensity from:

- lake volume;
- breach mechanism;
- breach duration;
- breach width;
- rainfall;
- antecedent river flow;
- debris;
- channel roughness;
- bridge condition;
- secondary blockage.

For visitor-defined scenarios, the engine finds nearby anchors and interpolates representative flood frames. Exposure is recalculated from the resulting run.

S0 is not a 2-5 Mm3 barrier-lake scenario. It is the separate reference reconstruction scale from the published Geopera analysis and is used for comparison only.
