#!/usr/bin/env bash
# Builds and checks everything: sheets -> generated code, unit tests, an end-to-end run
# against throwaway folders that stand in for the two installed games, then the Windows build.
set -u
cd "$(dirname "$0")/.."
fail=0
say() { printf '%s\n' "$*"; }
check() { if eval "$2"; then say "  ok   $1"; else say "  FAIL $1"; fail=1; fi; }

say "== sheets -> generated code =="
node tools/gen_data.mjs >/dev/null || { say "  FAIL codegen"; exit 1; }
node tools/preflight.mjs || { say "  FAIL preflight"; exit 1; }

say "== unit tests (Linux build of the same sources) =="
gcc -O1 -w -I src tests/test_formats.c src/util.c src/ini.c src/mix.c src/vpk.c src/kv.c \
    src/vtf.c src/shp.c src/audio.c src/gen.c -o /tmp/ts_tests || { say "  FAIL build"; exit 1; }
timeout 60 /tmp/ts_tests | tail -1
[ "${PIPESTATUS[0]}" = 0 ] || fail=1

say "== end to end against stand-in game folders =="
python3 tests/make_fixtures.py /tmp/ts_e2e >/dev/null
gcc -O1 -w -I src src/*.c -o /tmp/ts_native || { say "  FAIL build"; exit 1; }
timeout 60 /tmp/ts_native --test --ra2 /tmp/ts_e2e/ra2 --css /tmp/ts_e2e/css --log /tmp/ts_e2e/melty.log > /tmp/ts_e2e/stdout.txt
rc=$?
check "launcher exits 0" "[ $rc = 0 ]"
R=/tmp/ts_e2e/ra2
check "rulesmd.ini written" "[ -s $R/rulesmd.ini ]"
check "artmd.ini written"   "[ -s $R/artmd.ini ]"
check "weapon list extended"   "grep -q '^3=TSAK47$' $R/rulesmd.ini"
check "operator list extended" "grep -q '^6=TSCTA$' $R/rulesmd.ini"
check "warhead list extended"  "grep -q '^3=TSWHSA$' $R/rulesmd.ini"
check "AK-47 damage converted from the companion's script (36 x 0.55)" "grep -q -A1 '^\[TSAK47\]' $R/rulesmd.ini && grep -A1 '^\[TSAK47\]' $R/rulesmd.ini | grep -q 'Damage=20'"
check "AWP damage converted (115 x 0.9)" "grep -A1 '^\[TSAWP\]' $R/rulesmd.ini | grep -q 'Damage=104'"
check "C4 blast damage"        "grep -A1 '^\[TSC4\]' $R/rulesmd.ini | grep -q 'Damage=1200'"
check "economy rewritten"      "grep -q '^CrateMoney=3000' $R/rulesmd.ini"
check "art cloned from the host game's own section" "grep -A5 '^\[TSCTA\]' $R/artmd.ini | grep -q 'Image=GGI'"
check "cameo points at the generated icon" "grep -A5 '^\[TSCTA\]' $R/artmd.ini | grep -q 'Cameo=tsm4ic'"
check "no duplicate section names" "[ \$(grep -c '^\[WeaponTypes\]' $R/rulesmd.ini) = 1 ]"
check "5 cameos written"  "[ \$(ls $R/*.shp 2>/dev/null | wc -l) = 5 ]"
check "cameos are not empty" "[ -s $R/tsakic.shp ] && [ -s $R/tsc4ic.shp ]"
check "manifest written"    "[ -s $R/terrorstrike-manifest.json ]"
check "manifest lists 7 files" "grep -c '\"path\"' $R/terrorstrike-manifest.json | grep -q '^7$'"
check "no FAIL lines in the log" "! grep -q ' FAIL ' $R/../melty.log"
check "log reports a clean test build" "grep -q 'test build finished: clean' /tmp/ts_e2e/melty.log"
check "shp header is the TS/RA2 sprite form" "[ \$(od -An -t u2 -N 2 $R/tsakic.shp | tr -d ' ') = 0 ]"

say "== Windows build (what players run) =="
ZIG=${ZIG:-/tmp/zt/ziglang/zig}
if [ -x "$ZIG" ]; then
  mkdir -p dist
  "$ZIG" cc -target x86_64-windows -O2 -o dist/TerrorStrike.exe src/*.c 2>/dev/null && say "  ok   dist/TerrorStrike.exe" || { say "  FAIL windows build"; fail=1; }
  [ -f dist/TerrorStrike.exe ] && [ "$(od -An -c -N 2 dist/TerrorStrike.exe | tr -d ' ')" = "MZ" ] && say "  ok   PE header" || { say "  FAIL PE header"; fail=1; }
else
  say "  skip zig not found at $ZIG"
fi

say ""
[ $fail = 0 ] && say "ALL CHECKS PASSED" || say "SOME CHECKS FAILED"
exit $fail
