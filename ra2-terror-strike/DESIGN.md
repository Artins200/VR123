# Design notes

## The mashup in one sentence

You command a Red Alert 2 / Yuri's Revenge skirmish in which Counter-Strike: Source's
operators, weapons, numbers and icons are generated into the game at launch from the
player's own Counter-Strike: Source install.

## Routes considered, and the one taken

Red Alert 2 / Yuri's Revenge is not in Melty's catalog, so no loader is installed for it. The
route chosen is the community-established **loose-INI data mod**: the game reads
`rulesmd.ini` / `artmd.ini` / `soundmd.ini` and loose art from its own folder in preference to
its archives, and `gamemd.exe` needs no patching, no DLL and no loader. The alternative —
bundling a code extender such as Phobos with Syringe — would give access to more engine
features but adds a native hook to a one-click install for no gain in 1.0.0.

Counter-Strike: Source has no scripting surface the host game could talk to, so it is read
**as data**: its VPK archives are parsed directly (no Source SDK, no decompiler).

## Open questions

- **OQ-1, per-kill bounties.** Counter-Strike pays per kill. Red Alert 2 / Yuri's Revenge has
  no INI key for that; it needs a code extender. 1.0.0 approximates it with the crate economy
  in `sheets/economy.json`. Adding a real bounty means either shipping Phobos or reading the
  game's memory while it runs, and both need a decision before they are built.
- **OQ-2, visible weapons.** Red Alert 2 infantry carry their weapon baked into their sprite
  frames, so the operators wear the host game's infantry bodies and Counter-Strike: Source
  supplies their numbers, their sidebar icons and (when the audio stage is on) their sounds.
  Baking the actual Counter-Strike: Source weapon models into sprites or voxels is a separate
  piece of work.
- **OQ-3, real planting.** A true plant-and-defuse round needs map triggers, which means
  shipping a map. 1.0.0 makes the C4 a weapon on a carrier instead.

## Sheet coverage

Every system the mashup touches has a row in `sheets/systems.json`, and `tools/preflight.mjs`
fails the build when any row x column cell is empty, when a cross-sheet reference does not
resolve, when a donor body is not a known host-game infantry name, when a conversion clamp is
not usable, or when a companion game has no hook row.
