# PCOB Live Recording

Use this when a real PCOB match is available and you want reusable test data.

The files produced here are polled observer snapshots. They are not byte-level
captures of the incoming PCOB POST requests. See
[`../docs/pcob-recording-schema-verification.md`](../docs/pcob-recording-schema-verification.md)
for the deterministic schema verifier, observed route manifest, synthetic
`rawEvents` reconstruction, and the limits of what these recordings prove.

## Record

Start this after PCOB starts sending live data:

```powershell
node tools\pcob-live-recorder.cjs --label match-test
```

It saves raw local snapshots here:

```text
recordings\pcob\<timestamp>-match-test\packets.jsonl
recordings\pcob\<timestamp>-match-test\metadata.json
```

Stop with `Ctrl+C`, or let it stop after PCOB goes idle. The recorder does not post anything to Arenzyra.

## Replay Dry-Run

This checks a recording without sending telemetry:

```powershell
node tools\pcob-live-replay.cjs --recording recordings\pcob\<folder>
```

To reconstruct the recoverable lower bound of the new raw-event contract in a
dry run:

```powershell
node tools\pcob-live-replay.cjs --recording recordings\pcob\<folder> --raw-events --speed 0
```

Every reconstructed batch and event is marked `syntheticFromSnapshot: true`.
Its `rawBodyBase64` is canonical JSON reserialized from the parsed snapshot
payload, not the original PCOB request bytes.

## Replay Into A Test Match

Only use this with a test match unless you intentionally want to affect production data:

```powershell
node tools\pcob-live-replay.cjs --recording recordings\pcob\<folder> --match-id <TEST_MATCH_ID> --send --confirm-send --speed 10
```

Add `--raw-events` to exercise the raw-event persistence/acknowledgement path.
In that mode replay requires a valid `arenzyra.pcobRawEventsAck.v1` response for
each non-empty batch. Use a test match; the send flags still affect live API
state.

To route reconstructed events through an isolated local `ob.js` first, use
`tools/pcob-local-connector-replay.cjs`. Its exact safety setup and commands for
both recordings are documented in the verification guide linked above.

`--speed 1` replays with original timing. `--speed 10` is ten times faster. `--speed 0` sends as fast as the API accepts packets.
