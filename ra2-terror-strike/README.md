# Yuri's Revenge: Terror Strike

**Counter-Strike: Source's guns, sounds and bomb-defusal rules, converted into your own
Red Alert 2 / Yuri's Revenge.**

You command in a normal Red Alert 2 / Yuri's Revenge skirmish. Counter-Strike: Source walks
in through your own install of it: at launch the converter reads that game's own weapon
scripts and textures, turns them into Red Alert 2 rules and sidebar icons inside your own
Red Alert 2 folder, and then starts the game.

## What a player gets

- **Four Counter-Strike operators** in the barracks: CT Assault (M4A1), CT Sniper (AWP),
  T Rifleman (AK-47) and T Bomber (C4).
- **Their weapons are the real ones.** Damage, clip size, cycle time and range are read from
  `scripts/weapon_*.txt` inside *your* Counter-Strike: Source and converted with the scales
  in [`sheets/weapons.json`](sheets/weapons.json). The AK-47's 36 damage becomes 20 Red Alert
  damage; the AWP's 115 becomes 104.
- **Their sidebar icons are the real ones too**, rendered from the weapon textures in your
  Counter-Strike: Source into 60x48 Red Alert 2 sprites, quantised to your game's own cameo
  palette.
- **A C4 objective.** The T Bomber carries a charge that detonates for 1200 damage over four
  cells, through a warhead built from the objectives sheet.
- **Combat pays.** Crates come back every two minutes, money crates are worth 3000, free-unit
  crates hand out operators instead of conscripts, and ore stops growing — the closest thing
  to a Counter-Strike round economy the vanilla rules allow.
- Single player skirmish against the AI.

## Both games are really in it

| Role | Game | What it contributes | Where it is read from |
|---|---|---|---|
| primary (host) | Command & Conquer: Red Alert 2 and Yuri's Revenge | the engine, the battlefield, the infantry bodies, the cameo palette, the sounds each weapon reports with | the player's own folder, passed as `{game}` |
| companion | Counter-Strike: Source | weapon statistics, weapon textures for the sidebar, the C4 concept | the player's own folder, passed as `{game:pc-counter-strike-source}` |

**No content from either game is shipped with this project.** The uploaded package contains
one converter executable, this licence and this readme. Everything else is generated on the
player's PC from the player's own copies, and the manifest
(`terrorstrike-manifest.json`, written into the Red Alert 2 folder) lists every file that was
created so it can be removed cleanly.

## How to run

**Through Melty (what players do):** press **Play**. Melty checks both games are installed,
hands the mashup their folders and starts it. One click, no setup.

**By hand on Windows**, without Melty — point the converter at both games and it starts the
game for you:

```bat
TerrorStrike.exe ^
  --ra2 "C:\Program Files (x86)\Steam\steamapps\common\Command and Conquer Red Alert II" ^
  --css "C:\Program Files (x86)\Steam\steamapps\common\Counter-Strike Source"
```

The same two paths can come from the environment instead, which is how Melty passes them:
`RA2_DIR` and `CSS_DIR`.

| Flag | What it does |
|---|---|
| *(none)* | convert, install, then start `gamemd.exe` (`game.exe` for Red Alert 2 without Yuri's Revenge) |
| `--test` | convert and verify only, do not start the game; exit 0 only when the log says `test build finished: clean` |
| `--no-launch` | convert and install, then stop |
| `--audio` | also repack the companion's sounds into `audio.bag`/`audio.idx` (off by default, see above) |
| `--log <file>` | where to write the log; default `melty.log` in the working folder |
| `--help` | the same list |

Every run rewrites the generated files from whatever the two games contain right now, and
`terrorstrike-manifest.json` in the Red Alert 2 folder lists each file it wrote — delete those
to remove the mashup.

**Building it yourself:**

```bash
node tools/gen_data.mjs      # sheets -> generated/ts_data.h
node tools/preflight.mjs     # gate: every cell filled, every reference resolves
bash tests/run_tests.sh      # unit tests + end-to-end + Windows build
node tools/package.mjs       # dist/TerrorStrike-<version>.zip + size + sha256
```

`tests/run_tests.sh` needs a C compiler for the native tests and
[zig](https://pypi.org/project/ziglang/) (`pip install ziglang`) for the Windows build, which
is a cross-compile from Linux: `zig cc -target x86_64-windows -O2 -o dist/TerrorStrike.exe src/*.c`.

## How it is built

```
sheets/*.json          the design, and the source of truth
tools/gen_data.mjs     sheets -> generated/ts_data.h   (one struct per row, one field per column)
tools/preflight.mjs    every row x column cell filled, every cross-sheet reference resolves
src/*.c                the converter and launcher (plain C, no dependencies)
tests/run_tests.sh     codegen, preflight, 58 unit tests, an end-to-end run, the Windows build
dist/TerrorStrike.exe  cross-compiled for Windows, what players run
MODLOG.md              what was scanned, tried and measured, step by step
../melty.json          the install and launch recipe, at the repo root (draft, see below)
```

Change a sheet, then `node tools/gen_data.mjs && bash tests/run_tests.sh`.

## What has been checked, and what has not

`bash tests/run_tests.sh` runs clean: preflight over 412 sheet cells, 58 unit tests over the
format code (INI, MIX, VPK, VTF, SHP, KeyValues, WAV/bag), an end-to-end run of the shipped
converter against stand-in folders that have the same shapes as the two games, and the
Windows build.

What that cannot cover, and is therefore **unverified until the first run on a PC that owns
both games**:

- the host game's own `rulesmd.ini` / `artmd.ini` / `soundmd.ini` live inside
  `ra2md.mix -> genericmd.mix`, and the converter finds them by content rather than by
  filename hash. That is expected to work, but it has only been proven against a stand-in
  archive.
- the SHP sprite container is written in the format's compression-3 scanline form. The
  encoder and decoder round-trip here; the game itself has not been shown the file.
- the cameo palette is taken from the first 768-byte VGA-range palette in the archives, which
  is usually `cameo.pal` but is not proven to be.
- Counter-Strike: Source's real VPK layout: the converter searches the archive tree for paths
  containing `scripts/weapon_ak47`, `weapons/v_models/rif_ak47` and so on, so it does not
  depend on exact paths, but no real archive has been searched yet.

Everything optional is optional: if the palette or a texture is missing the operator keeps
the icon of the host-game infantry it is cloned from, and the mashup still installs and plays.

The **audio stage is deliberately off** in 1.0.0 (`--audio` turns it on). Red Alert 2 / Yuri's
Revenge has a single `audio.bag`/`audio.idx` pair, so replacing it means rewriting the whole
sound bank; doing that unverified could silence the game, so the weapons inherit the report
sound of the host-game weapon they were cloned from instead.

## Still missing before this can be published

1. **Melty is not reachable from the machine this was built on.** `melty.gg` is outside the
   network allowlist here, so `game_info`, `search_mashups`, `create_mod`, `start_upload`,
   `validate_recipe`, `one_click_check`, `test_release` and `publish` have not been called and
   `melty.json`, at the root of the repository, is a draft rather than a validated recipe.
2. **Neither game is installed on this machine** (it is a Linux build box with no Steam), so
   the converter has never been run against real game files and there is **no real gameplay
   screenshot** yet. Until both exist on a Windows PC, this stays a draft.

## Credits and licence

- Command & Conquer: Red Alert 2 and Yuri's Revenge — Westwood Studios / Electronic Arts.
- Counter-Strike: Source — Valve / the Counter-Strike team.
- This mashup's code, sheets and converter — the project author, **MIT**, remixing allowed.

Nothing from either game is included or redistributed.
