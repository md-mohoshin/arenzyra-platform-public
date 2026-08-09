# Root exclusions quarantine — 2026-08-09

The 24 previously excluded Root paths were removed from release input without
destroying their contents.

- Quarantine root:
  `C:\Arenzyra-safety-snapshots\quarantined-exclusions\20260809-root-unapproved`
- `originals/` contains all 24 reviewed files at the hashes below.
- `verified-copies/` contains a second byte-identical copy of all 24 files.
- The 21 untracked publishing, rendering, YouTube, JSON, and Markdown files were
  moved to `originals/` after both copies were hash-verified.
- The three modified tracked brand assets were copied to both quarantine trees
  and then restored to their committed Root revision.
- No file was published, uploaded, executed, or sent to an external service.
- Each copy set contains 24 regular files totaling 839,097 bytes.
- The canonical sorted `path<TAB>bytes<TAB>sha256<LF>` inventory digest is
  `0e37e297a6e771ac044451926db314d6ff2470e9955889b1d2ffc413a5c9b4d9`.

Do not restore these paths as a group. Review the exact file, its provenance,
credentials/local paths, external side effects, asset rights, and intended
release scope first. Restore only an individually approved file from
`originals/<repository-relative-path>` and verify its SHA-256 again.

| Repository-relative path                                   |   Bytes | SHA-256                                                            |
| ---------------------------------------------------------- | ------: | ------------------------------------------------------------------ |
| `apps/discord-bot/assets/arenzyra-discord-icon-blue-a.png` | 175,861 | `b1a9d8e8bf777150122b93a9c3d555352fb7591b6be0129236868acc6a348c8e` |
| `apps/discord-bot/assets/arenzyra-discord-icon.png`        | 175,861 | `b1a9d8e8bf777150122b93a9c3d555352fb7591b6be0129236868acc6a348c8e` |
| `arenzyra-broadcast-v1/widgets/assets/channel-logo.svg`    | 234,992 | `aec83fc1fd99868a27689829982e4afc4a462175128fd9bba85c652ea744c78a` |
| `docs/YOUTUBE_TOKEN_KEY_ROTATION.md`                       |   5,933 | `f00cab3c6f9d9b82232f0e549c84bcb81f4056750f8b521d5573be3b51e5d655` |
| `scripts/matrix-champions-league-s4-overlays.json`         |   5,225 | `8095a5c5b3192cd0068078440917fb07618d3ce816be011e940923084f2f558d` |
| `scripts/meta-bootstrap-publisher.cjs`                     |   6,969 | `4479c66a40340bba491b8863374522db697786edff4b6bf539aafdbe87acd9a2` |
| `scripts/publish-meta-launch.cjs`                          |   7,669 | `0255a53a9e05019b672ce628bb009b75950cd42c001b4daab0ae7e91173c4355` |
| `scripts/publish-meta-platform-reel.cjs`                   |  14,785 | `3de1f0addd67e239a8c92f6a4bcc4b6b302b89d22fa64a39a789a5bced2c80a6` |
| `scripts/render-arenzyra-platform-short.ps1`               |   7,520 | `965536fecfefa11a2b9c6db3d978016a00f411c33b70c06fd3d9446c07877ccc` |
| `scripts/render-fix-training-thumbnail.ps1`                |  17,073 | `62423b1659429123484ab41dbe3b1f77d0649248cfdd76a405cfba2097d497dc` |
| `scripts/render-map-live-match-overlay.ps1`                |  11,207 | `606ceb59e0328d93bcab8d4a25511f577e3fa5b39484c3296e6fb71b892418cc` |
| `scripts/render-matrixz-mtm-diamond-s2-obs-overlays.cjs`   |  33,671 | `4ed9e8064b2c0a6f7134beb6b2e375c82ac74900b47fe94f3b648e9fcf29b296` |
| `scripts/render-pmnc-sa-practice-final-overlays-v2.cjs`    |  24,694 | `a96b393d0f2eb7a134c45c7ca15bd5ed0521b43efcd6b5a8b753c68921303ef5` |
| `scripts/render-pmnc-sa-practice-final-overlays.cjs`       |  21,580 | `c7b7f8179fe6ebba1512470b5b9bf618ae5e86ba5adf052a0208456f6da60149` |
| `scripts/render-pubg-animated-overlays.ps1`                |  23,855 | `b30f471fa46851adc53fd4adbacb367f1ab634efb4935b887b7146a0bbc9368f` |
| `scripts/render-thumbnail-countdown-video.ps1`             |   2,603 | `bef710a111755cd034f4f11d6e45338486135f2638c33db5ded29903b6621648` |
| `scripts/render-totemxthp-league-event-final-overlays.cjs` |   8,170 | `00a77eb12c5733b103864612c7a1c1060ce621f702e2925a38f7c87f1af4d08e` |
| `scripts/youtube-channel-audit.cjs`                        |   4,356 | `b4918e771ee9b856880c205097d24c28b4621fd138779457001617f035b6c891` |
| `scripts/youtube-channel-seo.cjs`                          |   7,116 | `6a3281a404885425a91d1a428378122a01f74be14f73822f43493c27f6689ee3` |
| `scripts/youtube-oauth-local.cjs`                          |   6,132 | `94c9f27a8b1e395a4c77be408afcd3b299abbc195f54ed957ea0b8ffe0f6648f` |
| `scripts/youtube-optimize-tutorial.cjs`                    |  14,454 | `d04b0b91c6cd0af5c59bb5d380a1db84869242d0d39e71916077d96bd60599bd` |
| `scripts/youtube-update-walkthrough-thumbnail.cjs`         |   5,586 | `91d049880b99d51d164fbba4b0811b15d5ea9a3b79618efc30f8e5a6768e7017` |
| `scripts/youtube-upload-arenzyra-short.cjs`                |  10,252 | `eb25506cfd16c4e4693e9c6e8e83a831ec6004c95267df07e0ccdf5329cbaa15` |
| `scripts/youtube-upload-arenzyra-walkthrough.cjs`          |  13,533 | `f62349e376ecc348d5fc978ebed08189baeb34d0129ae07dcbbcb938017b2357` |
