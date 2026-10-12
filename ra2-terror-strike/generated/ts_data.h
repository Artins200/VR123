/* GENERATED from sheets/ by tools/gen_data.mjs - do not edit by hand.
   One struct per sheet row, one field per sheet column. Change the sheet, then re-run:
       node tools/gen_data.mjs && node tools/preflight.mjs                              */
#ifndef TS_DATA_H
#define TS_DATA_H

/* ---- sheets/weapons.json : 5 rows x 20 columns ---- */
/* One row per Counter-Strike: Source weapon brought into the host game. Numbers are NOT hardcoded: at install the converter reads the companion game's own scripts/weapon_*.txt and converts them with the scales in this row. */
typedef struct ts_weapon {
  const char* id;
  const char* raName;
  const char* display;
  const char* scriptMatch;
  const char* damageKey;
  double damageScale;
  const char* rofKey;
  int rofScale;
  const char* clipKey;
  const char* rangeKey;
  double rangeScale;
  const char* donorBody;
  const char* sound;
  const char* cameo;
  int minDamage;
  int maxDamage;
  int minRof;
  int maxRof;
  int minRange;
  int maxRange;
} ts_weapon;

static const ts_weapon g_weapons[5] = {
  { "ak47", "TSAK47", "AK-47", "scripts/weapon_ak47", "Damage", 0.55, "CycleTime", 15, "ClipSize", "Range", 0.0007, "E2", "ak47", "ak47", 5, 200, 4, 60, 3, 14 },
  { "m4a1", "TSM4A1", "M4A1", "scripts/weapon_m4a1", "Damage", 0.55, "CycleTime", 15, "ClipSize", "Range", 0.0007, "GGI", "m4a1", "m4a1", 5, 200, 4, 60, 3, 14 },
  { "awp", "TSAWP", "AWP", "scripts/weapon_awp", "Damage", 0.9, "CycleTime", 15, "ClipSize", "Range", 0.0007, "SNIPE", "awp", "awp", 5, 200, 4, 60, 3, 14 },
  { "deagle", "TSDEAGLE", "Desert Eagle", "scripts/weapon_deagle", "Damage", 0.55, "CycleTime", 15, "ClipSize", "Range", 0.0007, "GGI", "deagle", "deagle", 5, 200, 4, 60, 3, 14 },
  { "c4", "TSC4", "C4 Charge", "scripts/weapon_c4", "Damage", 12, "CycleTime", 15, "ClipSize", "Range", 0.0007, "TERROR", "c4boom", "c4", 5, 2000, 4, 60, 3, 6 }
};
#define TS_WEAPONS_COUNT 5

/* ---- sheets/sounds.json : 8 rows x 9 columns ---- */
/* One row per Counter-Strike: Source sound read out of the companion game's own archives. 'match' is a substring searched across every .wav path in the VPK tree. enabled=false for 1.0.0: repacking audio.bag/audio.idx replaces the host game's whole sound bank, which cannot be verified without a real install, so the launcher keeps the host game's own sounds (cloned from each donor weapon) and this stage is opt-in with --audio. */
typedef struct ts_sound {
  const char* id;
  const char* raName;
  const char* match;
  const char* kind;
  int volume;
  const char* priority;
  const char* loop;
  int required;
  int enabled;
} ts_sound;

static const ts_sound g_sounds[8] = {
  { "ak47", "tsak47", "weapons/ak47/ak47-1", "weapon", 90, "critical", "no", 1, 0 },
  { "m4a1", "tsm4a1", "weapons/m4a1/m4a1_unsil-1", "weapon", 90, "critical", "no", 1, 0 },
  { "awp", "tsawp", "weapons/awp/awp1", "weapon", 95, "critical", "no", 1, 0 },
  { "deagle", "tsdeagle", "weapons/deagle/deagle-1", "weapon", 90, "critical", "no", 1, 0 },
  { "c4beep", "tsc4beep", "weapons/c4/c4_beep", "ui", 70, "normal", "no", 1, 0 },
  { "c4plant", "tsc4plant", "weapons/c4/c4_plant", "ui", 80, "normal", "no", 0, 0 },
  { "c4boom", "tsc4boom", "weapons/c4/c4_exp_deb", "explosion", 100, "critical", "no", 1, 0 },
  { "c4defuse", "tsc4defuse", "weapons/c4/c4_disarm", "ui", 80, "normal", "no", 0, 0 }
};
#define TS_SOUNDS_COUNT 8

/* ---- sheets/art.json : 5 rows x 8 columns ---- */
/* One row per sidebar cameo rendered from a Counter-Strike: Source texture in the companion game's own archives. fallback="donor" means: when the texture or the host game's cameo palette cannot be found, the operator keeps the cameo of the host-game infantry its body is cloned from, so the sidebar always shows a real icon. */
typedef struct ts_art {
  const char* id;
  const char* raName;
  const char* match;
  int width;
  int height;
  const char* palette;
  const char* fallback;
  int required;
} ts_art;

static const ts_art g_art[5] = {
  { "ak47", "tsakic", "weapons/v_models/rif_ak47", 60, 48, "cameo.pal", "donor", 1 },
  { "m4a1", "tsm4ic", "weapons/v_models/rif_m4a1", 60, 48, "cameo.pal", "donor", 1 },
  { "awp", "tsawic", "weapons/v_models/snip_awp", 60, 48, "cameo.pal", "donor", 1 },
  { "deagle", "tsdgic", "weapons/v_models/pist_deagle", 60, 48, "cameo.pal", "donor", 1 },
  { "c4", "tsc4ic", "weapons/v_models/c4", 60, 48, "cameo.pal", "donor", 1 }
};
#define TS_ART_COUNT 5

/* ---- sheets/operators.json : 4 rows x 16 columns ---- */
/* One row per operator infantry added to the host game. bodyArt names an infantry image that already exists in the HOST game, so no art leaves either game. */
typedef struct ts_operator {
  const char* id;
  const char* raUid;
  const char* display;
  const char* bodyArt;
  const char* bodyArtFallback;
  const char* cameo;
  const char* primary;
  const char* secondary;
  int cost;
  int speed;
  int sight;
  const char* armor;
  const char* owner;
  const char* prerequisite;
  const char* crushable;
  const char* c4Carrier;
} ts_operator;

static const ts_operator g_operators[4] = {
  { "ct_assault", "TSCTA", "CT Assault", "GGI", "E1", "m4a1", "m4a1", "deagle", 400, 5, 6, "none", "Americans", "GABARR", "yes", "no" },
  { "ct_sniper", "TSCTS", "CT Sniper", "SNIPE", "E1", "awp", "awp", "deagle", 600, 4, 8, "none", "Americans", "GABARR", "yes", "no" },
  { "t_rifleman", "TSTRA", "T Rifleman", "E2", "E1", "ak47", "ak47", "deagle", 400, 5, 6, "none", "Russians", "NABARR", "yes", "no" },
  { "t_bomber", "TSTBM", "T Bomber", "TERROR", "E2", "c4", "c4", "deagle", 800, 6, 5, "flak", "Russians", "NABARR", "no", "yes" }
};
#define TS_OPERATORS_COUNT 4

/* ---- sheets/objectives.json : 1 rows x 12 columns ---- */
/* The Counter-Strike: Source objective brought into the host game. */
typedef struct ts_objective {
  const char* id;
  const char* display;
  const char* carrier;
  const char* weapon;
  const char* plantSound;
  const char* beepSound;
  const char* boomSound;
  const char* defuseSound;
  int damage;
  int cellSpread;
  int fuseSeconds;
  const char* notes;
} ts_objective;

static const ts_objective g_objectives[1] = {
  { "c4", "C4 plant and defuse", "t_bomber", "c4", "c4plant", "c4beep", "c4boom", "c4defuse", 1200, 4, 40, "The bomber's weapon is a delayed-blast warhead: it beeps on plant and detonates with the companion game's own explosion sound" }
};
#define TS_OBJECTIVES_COUNT 1

/* ---- sheets/economy.json : 4 rows x 5 columns ---- */
/* Combat economy: the vanilla rules.md.ini keys the mashup rewrites so fighting pays. */
typedef struct ts_economy {
  const char* id;
  const char* iniSection;
  const char* key;
  const char* value;
  const char* why;
} ts_economy;

static const ts_economy g_economy[4] = {
  { "crate_regen", "General", "CrateRegen", "0:02", "Crates come back fast enough that pressing an attack is worth it" },
  { "crate_money", "General", "CrateMoney", "3000", "Money crates pay like a Counter-Strike round win" },
  { "unit_crate", "General", "UnitCrateType", "TSCTA", "Free-unit crates hand out operators instead of host-game infantry" },
  { "ore_growth", "General", "OreGrows", "no", "Income comes from fighting, not from turtling on ore" }
};
#define TS_ECONOMY_COUNT 4

/* ---- sheets/systems.json : 11 rows x 8 columns ---- */
/* Every game system the mashup touches. Each row generates one entry of g_systems[] in generated/ts_data.h. */
typedef struct ts_system {
  const char* id;
  const char* name;
  const char* whatItDoes;
  const char* implementedBy;
  const char* stage;
  int required;
  const char* status;
  const char* notes;
} ts_system;

static const ts_system g_systems[11] = {
  { "probe", "Game probe", "Finds and validates the RA2/YR host folder and the Counter-Strike: Source companion folder, and reports what each contains", "src/main.c probe_games()", "prebuild", 1, "implemented", "Reads RA2_DIR and CSS_DIR from the environment, set by Melty file mappings" },
  { "ini_merge", "INI merge", "Extracts the host game's own rulesmd.ini, artmd.ini and soundmd.ini from its archives and appends the mashup's generated sections", "src/ini.c + src/gen.c", "build", 1, "implemented", "The originals are never shipped; they are read from the player's copy and rewritten in place each run" },
  { "weapon_stats", "Weapon statistics", "Reads Counter-Strike: Source's own weapon scripts and converts Damage, ClipSize, CycleTime, Range and Recoil into RA2/YR WeaponType numbers", "src/kv.c + src/gen.c", "build", 1, "implemented", "scripts/weapon_*.txt inside the companion's VPK archives" },
  { "weapon_sounds", "Weapon sounds", "Extracts Counter-Strike: Source's real firing, reload and C4 sounds and repacks them into an RA2/YR audio.bag / audio.idx pair", "src/audio.c", "build", 0, "implemented", "Optional stage: if it cannot be done the mashup still runs on the host game's own sounds" },
  { "cameos", "Sidebar cameo icons", "Decodes Counter-Strike: Source weapon textures and renders 60x48 SHP cameos quantised to the host game's own cameo palette", "src/vtf.c + src/shp.c", "build", 0, "implemented", "Optional stage; falls back to a cameo already in the host game" },
  { "operators", "Operator infantry", "Adds four Counter-Strike operator infantry to the host game, armed with the converted weapons", "src/gen.c", "build", 1, "implemented", "Bodies reference the host game's own infantry art by name, so nothing is copied out of it" },
  { "c4_objective", "C4 plant and defuse", "A bomb carrier infantry plants a C4 charge that detonates with Counter-Strike: Source's own bomb sounds and a warhead scaled to its blast", "src/gen.c", "build", 1, "implemented", "Built from the objectives sheet" },
  { "economy", "Combat economy", "Tunes the host game's crate economy so fighting pays, the closest thing to Counter-Strike's round economy the vanilla rules allow", "src/gen.c", "build", 1, "implemented", "Per-kill bounties need a code extender; see DESIGN.md, open question OQ-1" },
  { "briefing", "EVA briefing", "Adds a short EVA brief line for the terror strike objective using the host game's own EVA voices", "src/gen.c", "build", 0, "implemented", "Uses [DialogList]/[Events] text entries only" },
  { "manifest", "Install manifest and uninstall", "Records every file written into the host folder so it can be removed or refreshed cleanly", "src/util.c write_manifest()", "postbuild", 1, "implemented", "terrorstrike-manifest.json in the host folder" },
  { "launch", "Launch host", "Starts the host game's own executable and waits for it to exit", "src/main.c launch_game()", "launch", 1, "implemented", "gamemd.exe for Yuri's Revenge, game.exe for Red Alert 2" }
};
#define TS_SYSTEMS_COUNT 11

/* ---- sheets/hooks.json : 2 rows x 8 columns ---- */
/* How the mashup attaches to each game. One row per game. */
typedef struct ts_hook {
  const char* id;
  const char* game;
  const char* slug;
  const char* role;
  const char* folderEnv;
  const char* markers;
  const char* reads;
  const char* neverCopies;
} ts_hook;

static const ts_hook g_hooks[2] = {
  { "ra2", "Command & Conquer: Red Alert 2 and Yuri's Revenge", "pc-command-conquer-red-alert-2-and-yuri-s-revenge", "primary", "RA2_DIR", "gamemd.exe,game.exe,ra2md.mix,ra2.mix", "ra2md.mix/genericmd.mix/rulesmd.ini,ra2md.mix/genericmd.mix/artmd.ini,ra2md.mix/genericmd.mix/soundmd.ini,cameo.pal", "Nothing is copied out of it into the upload; generated files are written into it on the player's PC" },
  { "css", "Counter-Strike: Source", "pc-counter-strike-source", "companion", "CSS_DIR", "cstrike/cstrike_dir.vpk,hl2/hl2_textures_dir.vpk,hl2.exe", "cstrike_dir.vpk: scripts/weapon_*.txt,cstrike_dir.vpk: sound/weapons/**/*.wav,cstrike_dir.vpk: materials/models/weapons/**/*.vtf", "Nothing is copied out of it into the upload; its files are read at install time and converted in memory" }
};
#define TS_HOOKS_COUNT 2

/* ---- sheets/meta.json ---- */
#define TS_TITLE "Yuri's Revenge: Terror Strike"
#define TS_TAGLINE "Counter-Strike: Source's guns, sounds and bomb-defusal rules, converted into your own Red Alert 2 / Yuri's Revenge."
#define TS_VERSION "1.0.0"
#define TS_HOST_SLUG "pc-command-conquer-red-alert-2-and-yuri-s-revenge"
#define TS_CSS_SLUG "pc-counter-strike-source"
#define TS_MANIFEST_NAME "terrorstrike-manifest.json"
#define TS_MARK "TerrorStrike"

#endif /* TS_DATA_H */
