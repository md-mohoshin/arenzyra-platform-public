# Local ignored uploads cleanup incident — 2026-08-09

This record concerns only the isolated canonical API worktree at
`.worktrees/api-release-lineage`. It did not affect tracked files, the separate
legacy `apps/api/uploads` directory, Docker, or production.

## What happened

Two failed-test WebP outputs had been individually observed under the ignored
worktree path `uploads/sponsors`:

- `4e8f9afb-fe81-4db1-9a4b-0dd2ffcc975f.webp` — 130 bytes
- `85594dad-ab86-4bbf-83b8-add8349e76ba.webp` — 130 bytes

The following command was intended to remove only those two paths:

```text
git clean -f -X -- uploads/sponsors/4e8f9afb-fe81-4db1-9a4b-0dd2ffcc975f.webp uploads/sponsors/85594dad-ab86-4bbf-83b8-add8349e76ba.webp
```

Git exited successfully but reported `Removing uploads/`. The complete ignored
worktree `uploads` directory was therefore removed rather than just the two
named descendants.

## Evidence boundary

Before deletion, only the two exact file paths and their 130-byte sizes had
been recorded. No directory-wide inventory, hashes, timestamps, ownership,
ACLs, or byte copies were captured. Test logs identify both files as Sharp WebP
outputs from the media-upload test suite, and earlier passing tests are known to
create upload subdirectories, but that does not prove the directory contained
nothing else. Any additional deleted ignored contents are unknown and must not
be inferred away.

Git cannot restore ignored, untracked data. The command bypassed the Recycle
Bin, no byte-identical recovery copy is known, and an attempted read of the NTFS
USN journal was unavailable without administrator access. No claim of complete
recovery is made.

## Containment and correction

Writes stopped while the incident scope was audited. The canonical API source
changes were preserved, and subsequent media tests were changed to write only
inside unique operating-system temporary directories. The isolated worktree
`uploads` path remained absent before and after the final verified test run.

`AGENTS.md` now prohibits `git clean` for individual descendants of ignored
directories. Future cleanup must either leave harmless output in place or move
exact inspected files to a recoverable quarantine after verifying the parent
inventory.
