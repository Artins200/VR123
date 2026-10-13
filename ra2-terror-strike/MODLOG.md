# MODLOG — Yuri's Revenge: Terror Strike

Build log in the [universal-modder](https://github.com/rehan-remade/universal-modder) shape:
intake → scan → route → backup → vertical slice → verify → publish check.

## Intake

- Primary (host) game: Command & Conquer: Red Alert 2 / Yuri's Revenge.
- Companion game: Counter-Strike: Source. Its content is **read** from the player's install at
  launch, never copied into the upload.
- Solo skirmish against the AI. No multiplayer, no invented server or player capacity.

## Scan

The build machine is a Linux container with no Steam and no games:

- `um scan --list` → no game installs found.

So every format decision came from the knowledge base and public format documentation, and every
test runs against stand-in folders that `tests/make_fixtures.py` builds with the same shapes as
the two games. Nothing was ever read out of a real install here, and that is stated in the README
as the thing that still has to happen on a PC that owns both games.

## Knowledge base

`um kb search` needs pyyaml, which the container did not have: `pip3 install --target /tmp/umdeps pyyaml`,
then `PYTHONPATH=/tmp/umdeps`.

- `knowledge/games/portal-2/.../viewmodel-converted-for-another-engine-v.md` (status **working**) —
  Source content sits in `<game>/pak01_dir.vpk` (VPK v2) plus numbered `pak01_NNN.vpk`; **search
  game-specific folders before the base game**; weapon textures under
  `materials/models/weapons/v_models/…`. Adopted directly: `src/vpk.c` sorts `cstrike*_dir.vpk`
  ahead of `hl2*_dir.vpk` and logs `vpk: search order N: …`.
- `knowledge/techniques/reading-source-engine-models-and-animations.md` — VPK index layout:
  zero-terminated ext/dir/name strings, entry = CRC, preload, archive index, offset, length,
  archive index `0x7fff` meaning the bytes are in the dir file itself. Implemented in `src/vpk.c`.

Host side, from public format documentation: the MIX container (4-byte flags, `UINT16LE` file
count, `UINT32LE` data size, 12-byte index entries with offsets relative to the body), the SHP
(TS) sprite container (8-byte header, 32-byte frame info, compression 3 = RLE-Zero scanlines),
the loose override set the game reads on its own (`rulesmd.ini`, `artmd.ini`, `soundmd.ini`,
`ecache(md)NN.mix`, `expand(md)NN.mix`, `elocal(md)NN.mix`, `ra2.csf`), and `audio.bag` /
`audio.idx` (IDXHeader magic `ABAG`, 16-byte names that are not reliably NUL-terminated, BAG as
concatenated raw samples, IMA ADPCM 22050 Hz mono).

## Route

Cheapest route that still works, and the one `um publish check` explicitly prefers ("ship a
patch/converter that runs on the user's own install"):

- **No loader, no DLL, no game patching.** One self-contained `TerrorStrike.exe` that reads both
  games, writes generated files into the host folder and starts `gamemd.exe`. Vanilla RA2/YR
  reads loose `rulesmd.ini` / `artmd.ini` and `*.shp` on its own, so the upload is 3 files and
  players install nothing on top of their games.
- Rejected: a loader/injector (would need a third-party runtime bundled into the upload);
  MDL → sprite weapon models (needs an MDL v49 / VVD / VTX reader — open question OQ-2);
  repacking `audio.bag`/`audio.idx` (replaces the host's whole sound bank, unverifiable failure
  mode) → kept as an opt-in stage, off by default, all sound rows `enabled=false`.
- Windows build without a cross-compiler and without root (`apt-get install` → `Permission denied`):
  `pip install ziglang`, then `zig cc -target x86_64-windows -O2 -o dist/TerrorStrike.exe src/*.c`.

## Backup

`um backup create` was not run — there is no game install on this machine to back up. The
converter does not edit host files in place: it writes new files, records every one in
`terrorstrike-manifest.json`, and removal is deleting those files (documented in the README).

## Vertical slice

```
sheets/*.json          the design and the source of truth
tools/gen_data.mjs     sheets -> generated/ts_data.h
tools/preflight.mjs    gate: every row x column cell filled, every cross-sheet reference resolves
src/*.c                converter + launcher, plain C, no dependencies
tests/make_fixtures.py the only stand-in data in the project
tests/run_tests.sh     codegen, preflight, unit tests, end-to-end run, Windows build
```

## Verify — numbers from the last run

- preflight: 9 sheets, 412 row × column cells, 11 cross-sheet reference kinds → clean
- unit tests: 58 passed, 0 failed
- end to end: 21/21 assertions, `installed: 5 weapons, 4 operators, 5 cameos, 1 objective`,
  `test build finished: clean`
- `dist/TerrorStrike.exe`: PE header ok, 272384 bytes
- package: `dist/TerrorStrike-1.0.0.zip`, 145194 bytes,
  sha256 `eab73a4f5d8218f682dc288be9e12d27a917093f505dcc56024e226baf21c814`, 3 entries
- `um publish check dist/stage` → `PASS: 3 files, 0 failures, 0 warnings`
- `um publish check <repo root>` → `PASS: 41 files, 0 failures, 0 warnings`

## Bugs this loop caught and fixed

- **VPK search order** — base-game archives were searched first, so an `hl2` texture could win
  over the `cstrike` one the mashup is about. Fixed to cstrike-first, with the order logged.
- **Cameo fallback** — when no icon could be generated and the donor art section had no `Cameo=`,
  the generator wrote the literal string `Cameo=donor` over the value cloned from the host game,
  leaving the operator with a broken icon. Now `Cameo=`/`AltCameo=` are emitted only when a real
  icon exists; otherwise the cloned section keeps its own.

## Known gaps, deliberately

- `--audio` is a no-op by construction: the WAV and bag writers exist and are unit-tested, but
  nothing in `src/main.c` calls them and every row in `sheets/sounds.json` is `enabled=false`.
- The SHP compression-3 encoder round-trips against its own decoder only. The game has never been
  shown one of these files.
- Names use `Name=`, not `UIName=`: there is no CSF writer.
- C4 is a high-damage warhead on the bomber, not a planted objective: there is no map with
  plant/defuse triggers, and vanilla RA2/YR INI has no per-kill bounty (that is Phobos/Ares).
- `melty.json` is unvalidated. `melty.gg` is outside this machine's network allowlist (the TLS
  handshake is terminated), so no Melty tool has ever been called from here.
- No real gameplay screenshot: neither game is installed here, so the converter has never run
  against real game files.

## Open questions

- **OQ-2** — real Counter-Strike: Source weapon models: MDL v49 / VVD / VTX → SHP frames.
- Which archive actually holds `cameo.pal` on a retail install. The converter takes the first
  768-byte VGA-range palette it finds, which is usually right and has not been proven.
