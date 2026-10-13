# VR123

One Melty mashup lives in this repository:

## Yuri's Revenge: Terror Strike

Four Counter-Strike: Source operators join a normal Red Alert 2 / Yuri's Revenge skirmish.
Their weapons use the damage, clip, cycle time and range read out of the player's own
Counter-Strike: Source weapon scripts, their sidebar icons are rendered from the player's own
weapon textures, a T Bomber carries a C4 charge worth 1200 damage across four cells, and the
economy pays for kills: crates respawn every two minutes, money crates are worth 3000,
free-unit crates hand out operators, and ore no longer grows. Single player skirmish against
the AI.

Both games are **required** and owned by the player:

| Game | Role | What happens to it |
|---|---|---|
| Command & Conquer: Red Alert 2 / Yuri's Revenge | primary (host) | the converter writes generated `rulesmd.ini` / `artmd.ini` / `*.shp` entries into its folder, then starts `gamemd.exe` |
| Counter-Strike: Source | companion | its VPKs are **read** at launch for weapon scripts and textures; nothing is copied out of it |

Nothing from either game is stored in this repository or in the published package. The
converter reads the player's own copies when it runs, so every player brings their own content.

## Where things are

| Path | What it is |
|---|---|
| [`melty.json`](melty.json) | the install and launch recipe Melty reads from this repo root when the mashup is published from a GitHub link. **Still a draft**: `validate_recipe` / `one_click_check` have not run (see below) |
| [`ra2-terror-strike/README.md`](ra2-terror-strike/README.md) | player-facing text: what you get, how to run it, how to remove it, what is verified |
| [`ra2-terror-strike/DESIGN.md`](ra2-terror-strike/DESIGN.md) | why the mashup is shaped the way it is, and every balance number |
| [`ra2-terror-strike/sheets/`](ra2-terror-strike/sheets) | the design as data — the source of truth the C code is generated from |
| [`ra2-terror-strike/src/`](ra2-terror-strike/src) | the converter and launcher, plain C, no dependencies |
| [`ra2-terror-strike/MODLOG.md`](ra2-terror-strike/MODLOG.md) | build log: what was scanned, what was tried, what was measured |
| [`ra2-terror-strike/PUBLISH.md`](ra2-terror-strike/PUBLISH.md) | step-by-step publishing runbook (in Russian) |
| [`ra2-terror-strike/LICENSE`](ra2-terror-strike/LICENSE) | MIT, remixing allowed |

## Build and test

```
cd ra2-terror-strike
node tools/gen_data.mjs        # sheets -> generated/ts_data.h
node tools/preflight.mjs       # every row x column cell filled, every reference resolves
bash tests/run_tests.sh        # codegen, preflight, 58 unit tests, an end-to-end run, Windows build
node tools/package.mjs         # -> dist/TerrorStrike-1.0.0.zip with its size and sha256
```

`tests/run_tests.sh` needs a C compiler for the native tests and
[zig](https://pypi.org/project/ziglang/) (`pip install ziglang`) for the Windows build, which is
a cross-compile from Linux: `zig cc -target x86_64-windows -O2 -o dist/TerrorStrike.exe src/*.c`.

## Status

Green on the build machine: preflight over 412 sheet cells, 58 unit tests, an end-to-end run
against stand-in game folders, a Windows PE build, `um publish check` clean (0 failures,
0 warnings).

Still a **draft**, because two things can only happen on a Windows PC that owns both games:
a real run of the converter against real game files, and a real gameplay screenshot. Melty
requires a finished screenshot before a mashup can go live.

## What was removed

This repository used to contain a standalone WebXR sandbox (`index.html`, `build.js`,
`test.js`, `src/`, and a `Build APK` workflow). It was removed: it needs no existing game to
run, so it is not a Melty mashup and would have had to be rejected. It is still in the history —
`git show 94081aa81f17be17dc33358ef00411ad785bd9cc:index.html > index.html` brings any of it back.
