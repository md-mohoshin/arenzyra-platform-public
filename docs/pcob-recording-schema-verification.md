# PCOB Recording and Observed-Schema Verification

## Purpose

The verification harness streams the two existing multi-gigabyte PCOB
recordings without reading either packets file into memory as a whole. It:

- validates JSONL parsing, packet ordering, recorded SHA-256 hashes, change
  flags, metadata counts/file size, success status, and raw/reduced route-map
  consistency;
- inventories every recursively observed field/type for the observer snapshot
  and all 15 embedded route payloads;
- compares that inventory and the full-recording counts with the checked-in
  versioned manifest at `tools/pcob-observed-schema.v1.json`;
- reconstructs the deterministically recoverable lower bound of incoming route
  events; and
- can attach those reconstructed events to an end-to-end telemetry replay.

The manifest is an **observed schema**, not a claim to be the complete PUBG
PCOB contract.

## Commands

Run the compact fixture/regression suite:

```powershell
node --test tools/pcob-recording-schema.test.cjs
```

Verify the compact 15-route fixture against the real manifest as a compatible
subset:

```powershell
node tools/pcob-recording-verify.cjs `
  --recording tools/test-fixtures/pcob/compact-recording `
  --routes-only --allow-subset --skip-source-counts
```

Verify both full recordings and every checked-in baseline count/path:

```powershell
node tools/pcob-recording-verify.cjs
```

This command reads approximately 3.48 GB and normally takes 60-90 seconds on
the current workstation. It does not make network requests or mutate a
recording.

Regenerate the deterministic manifest only after reviewing an intentional
capture/schema change:

```powershell
node tools/pcob-recording-verify.cjs `
  --write-manifest tools/pcob-observed-schema.v1.json `
  --confirm-write
```

The manifest has no wall-clock generation timestamp, and object/path ordering
is sorted, so the same inputs produce the same file.

## Manifest baseline

Version 1 records:

- Erangel no-recall: 6,104 successful snapshots, 4,357 changed snapshots,
  phases `null` and `0` through `7`, 13 observed routes;
- Rondo recall: 4,720 successful snapshots, 3,294 changed snapshots, phases
  `null` and `0` through `6`, 15 observed routes;
- a combined 602 recursively observed non-route snapshot paths when the `$`
  root is included (601 paths below the root); and
- raw and reduced payload paths, types, observed array bounds, per-match route
  version counts, and unsafe-number observations for every route.

The 15-route union is:

```text
/setairdropboxinfo
/setcircleinfo
/setentertopeightafterrevive
/setgameglobalinfo
/setisingame
/setkillinfo
/setobservingplayer
/setplayerassistinfo
/setplayersaminfo
/setplayerssightusageinfo
/setplayerweapondetailinfo
/setplayerweaponinfo
/setreviveplayer
/setteambackpackinfo
/totalmessage
```

`PickUpData`, `UseData`, and `TotalPlayerWeaponReport` were always empty. The
manifest marks their element schemas unknown rather than inventing fields.

`RoomID` on both `/setplayersaminfo` and `/setplayerweapondetailinfo` was
already an unsafe 19-digit JavaScript number in all 101 observed payload
versions of each route. Its exact original digits cannot be recovered from
these snapshots.

## Synthetic raw-event reconstruction

Use a network-free replay check:

```powershell
node tools/pcob-live-replay.cjs `
  --recording recordings/pcob/rondo-recall-1783635224496 `
  --raw-events --speed 0
```

For an explicitly authorized test match, `--send --confirm-send --match-id`
posts to the existing `/api/observer/telemetry` endpoint. A non-empty
`rawEvents` batch has this contract:

```text
schema: arenzyra.pcobRawEvents.v1
streamId
firstSequence
lastSequence
events[]:
  eventId, sequence, endpoint, requestTarget, method, receivedAt, contentType,
  query, headers, rawBodyEncoding, rawBodyBase64, rawBodyBytes,
  bodySha256, payload
```

The replay extension also sets `syntheticFromSnapshot: true` on the batch and
each event. It uses:

- `method: "POST"`, `contentType: "application/json"`, `query: ""`, and empty
  headers because the originals were not recorded;
- canonical key-sorted UTF-8 JSON for the synthetic body;
- `rawBodyEncoding: "identity"` (synthetic replay never gzips an individual
  reconstructed body);
- base64 of those exact reserialized bytes in `rawBodyBase64`;
- the decoded UTF-8 byte length in `rawBodyBytes`;
- SHA-256 of the same bytes in `bodySha256`;
- event ordering by `receivedAt`, then endpoint and canonical body; and
- deterministic, monotonically increasing sequences and event IDs within the
  recording-derived stream.

Synthetic event IDs use the same identity contract as the live connector:
`streamId`, sequence, canonical receive timestamp, method, exact reconstructed
request target, and body SHA-256. The recording did not retain an original
request target, so replay reconstructs it from the route and its normally empty
synthetic query.

Retries reuse the same batch identifiers. A sending replay validates the
top-level `arenzyra.pcobRawEventsAck.v1`, including stream ID, highest
contiguous sequence, and accepted-plus-duplicate accounting.

When `--from-index` is used, replay still streams earlier packets through the
reconstructor without materializing their bodies. This preserves the same
stream sequence numbers for a deterministic resume.

## Replay through an actual local connector

`pcob-local-connector-replay.cjs` drives the real connector route handlers
instead of sending the reconstructed `rawEvents` envelope directly to the API.
It remains dry-run and performs no network request unless all three send flags
are supplied.

Dry-run either complete recording:

```powershell
node tools/pcob-local-connector-replay.cjs `
  --recording recordings/pcob/rondo-recall-1783635224496
```

Start a separate, isolated connector on a non-production port in another
PowerShell window:

```powershell
$env:PORT = "10087"
$env:FORWARD_ENABLE = "false"
$env:OBSERVER_FORWARD_ENABLE = "false"
node ob.js
```

Then replay at 10x recorded event timing:

```powershell
node tools/pcob-local-connector-replay.cjs `
  --recording recordings/pcob/rondo-recall-1783635224496 `
  --connector-base http://127.0.0.1:10087 `
  --speed 10 --send --confirm-local-send --confirm-isolated-connector
```

Restart the isolated connector to clear its in-memory match state, then repeat
with:

```text
recordings/pcob/normal-no-recall-1783637101011
```

To exercise legacy forwarding into a fake API, set `FORWARD_ENABLE=true` and
`FORWARD_BASE_URL` to that fake API's loopback URL. Keep
`OBSERVER_FORWARD_ENABLE=false`. Before the first POST, the replay tool requires
the connector `/health` endpoint to report either forwarding disabled or a
loopback-only `forwardBaseUrl`. Non-loopback connector and forwarding targets
are rejected.

Use `--max-events N` for a smoke test. Avoid `--speed 0` for a full real-data
connector replay because the connector acknowledges POSTs before draining all
handler work; recorded or moderately accelerated timing is safer.

The local POSTs carry `X-Arenzyra-Synthetic-Replay: true` and deterministic
event ID/sequence headers. Bodies remain reconstructed canonical JSON, not
original PCOB bytes.

## Replay through the actual API with disposable PostgreSQL

The strongest non-production integration gate runs the real connector,
`ObserverController`, `ObserverRawEventsService`, PUBG Mobile PCOB adapter, and
map-state projection against a disposable PostgreSQL 16 database:

```powershell
npm run test:pcob:recordings:api
```

By default it replays every full recording under `recordings/pcob` at 20x
recorded timing. A specific recording can be selected with repeated
`--recording PATH` arguments after `--`.

The validator fails closed unless `postgres:16` is already cached locally. It
never pulls an image, binds PostgreSQL and HTTP only to ephemeral loopback
ports, stores the database on container `tmpfs`, uses a verified OS-temporary
connector spool, and verifies ownership before removing the container. It does
not read the installed launcher's configuration or connect to an existing
organization/database.

This composition exercises the real raw-event persistence, strict ACK,
duplicate idempotency, adapter compatibility state, circle, map, and flight
path. It calls the controller with an isolated authenticated actor; Nest's JWT
guard/global pipes and the canonical player/team telemetry engine remain
covered by their normal API suites rather than this recording harness.

### Recoverable event history

For most routes, only a changed `rawRoutePayloads[path].receivedAt` value can
produce an event. This is one latest payload per route per 250 ms snapshot.

`/setkillinfo` is stronger because the observer snapshot separately retained
the latest 100 `killInfoEntries`. Walking the rolling history recovers 14 kill
events in Erangel and 17 in Rondo that were overwritten in the latest-route
view. No equivalent history exists for other routes.

## What verification cannot prove

- It cannot discover routes or optional fields that never occurred in these
  two matches.
- It cannot recover same-route events overwritten between snapshots, except
  kill events still visible in the rolling kill history.
- It cannot recover original request bytes, whitespace, number lexemes,
  headers, query strings, content types, or exact cross-route arrival order.
- It cannot detect events dropped before the observer state was updated.
- It does not cover every map, mode, recall behavior, PUBG/PCOB version, or
  future schema.
- Parsed and normalized observer fields are derived views; they are not
  independent PCOB endpoints.
- A passing test means “no regression from the checked-in observed corpus,”
  not “complete support for everything PCOB can expose.”

Production deployment and publication are intentionally outside this
workflow.
