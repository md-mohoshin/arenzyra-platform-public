# Desktop Map Assets

This directory is the desktop launcher's runtime source of truth for PUBG map images.

Default location:

- `apps/desktop/electron/assets/maps`

Runtime rules:

- Electron and the local widget server read map assets only from this desktop-owned folder.
- Missing required maps do not crash widgets. The launcher serves `map-not-available.svg` as a safe fallback and reports missing keys through asset health status.
- You can override the folder with `ARENZYRA_WIDGET_MAPS_DIR` when launching Electron.

Optional import workflow:

- `node scripts/sync-desktop-maps.cjs`
- `npm run sync:maps` from `apps/desktop`

The sync script may still import files from `apps/arenzyra-web/public/...`, but that is only a content-ingest convenience. Runtime does not depend on the web app asset tree.
