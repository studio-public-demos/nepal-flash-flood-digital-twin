# Adding New Scenarios

Add scenario anchors by updating `scripts/data/generate-nepal-demo-data.mjs` or replacing generated records with solver-derived runs that match the same schema.

Each scenario must include:

- scenario parameters;
- frames at public timeline steps;
- flood raster metadata;
- asset exposure;
- provenance;
- data classification;
- limitations.

After adding scenarios, run:

```bash
npm run build
npm test
```
