# Arenzyra Desktop

## Widget Server LAN Access

The desktop widget server now binds to `0.0.0.0:5510`, which allows OBS to load widgets from another machine on the same local network.

Example startup output:

```text
[widget-server] listening on http://localhost:5510
[widget-server] network access http://192.168.1.25:5510
```

If OBS is running on another computer:

1. Start the Arenzyra desktop app on the machine hosting the widget server.
2. Copy the `network access` URL from the startup logs or from the Widgets screen.
3. Use that LAN URL in the OBS Browser Source on the other machine.

Examples:

```text
http://192.168.1.25:5510/obs/map
http://192.168.1.25:5510/w/:widgetInstanceKey
```

Notes:

- Local previews inside the desktop app still use `http://localhost:5510`.
- Both machines need to be on the same LAN.
- If the remote machine cannot connect, allow the app through the OS firewall for private networks.

## Widget Credential Storage

Permanent OBS widget credentials are shown to the launcher only when first
issued or explicitly rotated. The launcher persists them only through
Electron's OS-backed `safeStorage` encryption in the app-owned launcher
directory. If OS encryption is unavailable or secure file ownership checks
fail, the credential remains in memory for the current session and no
plaintext fallback is written.

An existing active widget created on another workstation is not rotated
automatically, so existing OBS URLs continue to work. Use **Rotate credential**
explicitly when this launcher needs a replacement URL; rotation immediately
invalidates URLs containing the prior credential.

## Visual Capture Retention

Visual Mode keeps review screenshots only in the app-owned `visual-captures`
directory. Pending and failed review items remain available during the running
session; ignored, reviewed, queue-removed, and capacity-evicted items delete
their owned capture immediately.

On startup and periodically before new captures, the launcher scans at most 200
direct directory entries and deletes app-generated capture files older than 24
hours. It never recursively deletes and refuses links, reparse-point entries,
unexpected filenames, or paths outside the physical capture directory.

Set `ARENZYRA_VISUAL_CAPTURE_RETENTION_HOURS` to a positive number of hours when
a longer local recovery window is required. Capture files are limited to 8 MiB
and use restrictive directory/file permissions on platforms that support POSIX
modes.

## Managed PCOB Connector Boundary

Launcher-managed PCOB connector reads and control calls require a random
per-launch capability. The connector accepts only loopback clients, the exact
loopback `Host`, and approved browser origins; it does not expose wildcard
CORS. The launcher executes its verified bundled connector source with pinned
dependency roots and an allowlisted child environment, not the mutable copy in
the PCOB install directory.

ShadowTracker cannot attach a launcher capability to its native telemetry.
For compatibility, the only tokenless requests are loopback requests with the
exact host, no browser `Origin` or `Sec-Fetch-Site`, and a `POST` path matching
`/totalmessage` or the bounded `/set[a-z0-9]{1,64}` namespace. A different
same-user native process could still forge those telemetry-shaped requests;
reads, health details, debug controls, browser-origin traffic, and remote
traffic remain capability-protected.

The launcher never elevates a temporary script or mutable connector source.
If the selected PCOB installation is administrator-only, automatic repair
fails closed. Use an operator-writable installation or have an administrator
deploy the verified connector files through a separate controlled procedure,
then start Arenzyra at normal integrity.

## Representative Packaging Scaffold

`npm run build:electron` is a release-shaped inner command. Do not invoke it as
a production release entrypoint. The reviewed outer Windows launcher in
`infra/PUBLISH.md` attests the parent environment and detached checkout before
it invokes this command.

`npm run build:electron:candidate` is a separate, non-publishable scaffold for
future verifier development. It requires `--publish never`, writes only to
`dist-candidate-not-for-distribution`, gives every artifact a
`CANDIDATE-NOT-FOR-DISTRIBUTION` name, packages the application in ASAR, and
enables the supported ASAR-integrity/loading fuses. It is not a release or
staging input.

The release and candidate commands never run the development-only map importer.
They preserve the existing root `ob.js` connector and package it unchanged as
`connectors/ob.js`. The clean-release-input guard binds the exact tracked source
bytes before the build, and artifact verification compares the packaged bytes
with that same source. The historical commercial-provenance verifier remains
available for audit but is not an active technical release gate.

The current source packages only the project-owned neutral
`map-not-available.svg`; the 13 unproven commercial rasters were recoverably
quarantined and are absent from the runtime source list. The exact zero-raster
provenance state is still verified before packaging.

The fallback keeps local previews stable but does not make a match
production-ready. Production preflight continues to block when the selected
map has no real asset. Any future commercial raster requires the existing
full rights-evidence review for both the exact image bytes and the exact
evidence-document bytes before it can enter the approved runtime path list.
