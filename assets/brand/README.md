# Arenzyra brand assets

`arenzyra-mark.png` is the canonical transparent Arenzyra product mark used by
the desktop renderer. `scripts/sync-brand-icons.cjs` keeps the packaged desktop
copy aligned with this source.

The desktop and launcher icons and the default-team image are checked-in
package inputs. When the optional web repository is present, the same sync
script refreshes them from its favicon and application icon; otherwise it
retains the checked-in inputs.

Game-publisher artwork and player photographs are not brand assets. Do not add
them here or use them as generic fallbacks without a documented redistribution
right and provenance review. The desktop's generic player fallback is the
project-authored passive vector at `apps/desktop/build/default-player.svg`.
