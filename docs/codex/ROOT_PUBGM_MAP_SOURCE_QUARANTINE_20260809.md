# Root PUBG map-source quarantine (2026-08-09)

This record covers a narrow source-boundary rights-risk closure. It is not a
finding about ownership. The repository contained no reviewed evidence that
authorized redistribution of the exact raster bytes below, so they and their
unused single-purpose generator were removed from release source pending
exact-byte approval.

## Inventory before removal

- Workspace: `C:\Arenzyra`
- Root revision: `d3b7ad3d2460d7f4d61a291909b05acb7b1bcab1`
- Raster count: 10
- Raster bytes: 25,142,675
- Generator bytes: 10,120
- Total recoverable bytes per copy set: 25,152,795
- Git status before snapshotting: clean
- Git mode: every item was tracked as a regular `100644` file
- Filesystem status: every item was a regular, single-link file; none was a
  reparse point

| Removed repository path                         |     Bytes | SHA-256                                                            |
| ----------------------------------------------- | --------: | ------------------------------------------------------------------ |
| `scripts/assets/pubgm-maps/erangel.png`         | 6,481,934 | `4fbef9965998b9e80da032eafb165510327437956fd94394546e42e230e46d0f` |
| `scripts/assets/pubgm-maps/karakin.jpg`         |    98,275 | `9df3ae5df740ccedf8ded0ccb8a9411e2ff27ac60cefa9622bf00447642c6aee` |
| `scripts/assets/pubgm-maps/livik.jpg`           |   194,989 | `50f88bea38dcfc43d2fd71ca61eb46a9eea3f6e97ecfdafda7c880a0b695af60` |
| `scripts/assets/pubgm-maps/livik-aftermath.png` |   431,424 | `82daa2c93f69527516e32021c24f6fd3ef1c74e29ecab3b5faedb15e936cc567` |
| `scripts/assets/pubgm-maps/miramar.png`         | 6,992,561 | `326dbde0b514d8789fe25f4f0132d62a0ba23180007d660736cf0f76881e8692` |
| `scripts/assets/pubgm-maps/nusa.png`            |   342,286 | `efc73f3400694fe1b5f572a8159a634edac9c5bb07c847ae264eed7daad216b5` |
| `scripts/assets/pubgm-maps/rondo.jpg`           | 5,851,522 | `5f27c414a94a48954dc06284b5e28c75ea7ce6bf953ae6febb6cb71c40f296f3` |
| `scripts/assets/pubgm-maps/rondo.webp`          | 3,042,466 | `e2bafff7cfce953a576c456611f13f42428aa9bf723bee967862faf855a5d076` |
| `scripts/assets/pubgm-maps/sanhok.jpg`          |   785,287 | `00bb50491e26ee691fb765203f3d55f27363913b03015b060be08d86c9ebd829` |
| `scripts/assets/pubgm-maps/vikendi.jpg`         |   921,931 | `e93e28e2de0718f542e08c7f5f9ea9cd60de867e9b5314f220426acff2173179` |
| `scripts/generate-pubgm-map-assets.mjs`         |    10,120 | `3a24c89a9fe90a681b060bc995571b6f90cfffd0bd38510db5936c3010a79d54` |

## Reference and purpose check

A repository-wide literal reference search, excluding the inventoried files,
found no consumer of `scripts/assets/pubgm-maps` and no caller or package-script
reference to `scripts/generate-pubgm-map-assets.mjs`. The generator read only
these ten source rasters and wrote derived map assets. It had no demonstrated
remaining purpose after the raster quarantine, so it was quarantined with its
inputs. Unrelated release and deployment scripts were preserved.

## Recoverable external snapshot

Before removal, two independent directory copies were created under:

`C:\Arenzyra-safety-snapshots\quarantined-assets\20260809-root-unapproved-pubgm-map-sources`

- `originals/` preserves all eleven paths relative to the repository root.
- `verified-copies/` preserves a second copy of the same eleven paths.
- `MANIFEST.md` is an exact external copy of this record.

Each copy set contains exactly 11 regular, non-reparse files and 25,152,795
bytes. Every source, `originals/` file, and `verified-copies/` file was checked
against the size and SHA-256 table above before source deletion. Restoration is
not release approval: do not restore or distribute any raster unless reviewed
evidence covers those exact bytes and the intended use.

## Release-source enforcement

The production release metadata collector still digests the complete `scripts`
tree. It now fails closed if any file returns beneath
`scripts/assets/pubgm-maps/` or if the removed generator path returns. A static
regression proves both reintroductions are rejected while unrelated reviewed
script assets remain allowed.
