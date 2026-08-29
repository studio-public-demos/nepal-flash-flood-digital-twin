# Deployment

This showcase is static and can be deployed using the existing Studio public demos static hosting mechanism.

## Build

```bash
npm install
npm run build
```

The build regenerates representative data and bundles `src/nepal-flash-flood/app.ts` to `showcase/nepal-flash-flood/app.js`.

## Terrain Token

`CESIUM_ION_TOKEN` is optional. Do not commit the token to the repository.

Supported deployment options:

- inject the token into the `cesium-ion-token` meta tag during deployment;
- set `window.NEPAL_FLOOD_CONFIG.cesiumIonToken` from a private runtime config script;
- create an uncommitted `showcase/nepal-flash-flood/config.local.json` for local testing;
- for local browser testing only, set `localStorage.NEPAL_FLOOD_CESIUM_ION_TOKEN`.

When no token is configured, the page uses OpenStreetMap imagery and ellipsoid terrain fallback.

No OpenAI API key, Studio runtime credential, HEC-RAS license, database, or server process is required.
