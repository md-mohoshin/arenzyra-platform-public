# Desktop Map Assets

This directory is the desktop launcher's map-asset boundary.

Release contents:

- `map-not-available.svg` is the only bundled map image in the current release source.
- No commercial PUBG map raster (`.png`, `.jpg`, `.jpeg`, or `.webp`) is bundled by default.
- Missing map artwork resolves to the neutral SVG for preview stability, but `assetAvailable` remains false.
- Production match preflight still blocks when the selected map has no real approved asset. The fallback is not production-ready map artwork.

Development-only import:

- `npm run sync:maps:development` from `apps/desktop`
- The command requires an explicit `--development-only` boundary internally and may copy local raster assets from the web workspace for visual testing.
- Release and candidate build commands never run this import.
- Imported rasters are local inputs only. The release-input gate rejects untracked or modified files, the commercial provenance gate requires an exact inventory and reviewed evidence, and the runtime package policy excludes rasters unless it receives an evidence-approved path list.

The 13 previously tracked rasters with unproven redistribution rights were
recoverably quarantined outside the repository. Their original paths, sizes,
and SHA-256 hashes are recorded in
`apps/desktop/release/quarantined-pubg-map-assets-20260809.txt`.

Future commercial map artwork must not be added to a distributable package
until the existing full rights-evidence workflow verifies the exact asset
bytes and exact reviewed evidence-document bytes. Package-size,
telemetry-calibration, and label-layer reviews are still required separately.
