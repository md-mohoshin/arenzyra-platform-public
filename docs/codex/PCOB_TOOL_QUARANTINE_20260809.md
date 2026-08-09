# PCOB mutating diagnostic quarantine — 2026-08-09

This record contains provenance only. It intentionally contains no launcher
credentials, session contents, telemetry, or other user data.

- Original workspace path: `tools/pcob-live-bridge-diagnostic.cjs`
- Recoverable quarantine path:
  `C:\Arenzyra-safety-snapshots\quarantined-tools\20260809-pcob-mutating-diagnostic\pcob-live-bridge-diagnostic.cjs`
- Size: `14,876` bytes
- SHA-256:
  `748ad33824ee125ba7d1b33b0ed6b1eb28df9dd19fb9536697c382f3ad1c36ac`
- Workspace state: absent and unreferenced

The file was excluded from the release candidate because it reads and decrypts
the current launcher session, obtains an observer-feed token, and can submit
telemetry to an API. It also embedded operator-specific paths and a fixed match
identifier. Those behaviors are not appropriate for a distributable diagnostic.

Do not restore it into the release tree. A future replacement must be read-only
by default, require explicit target selection and mutation confirmation, avoid
credential decryption, contain no operator-specific values, and have isolated
mock tests before review.
