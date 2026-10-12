#include "ts.h"
#include <ctype.h>
#ifdef _WIN32
#  include <windows.h>
#else
#  include <unistd.h>
#endif

static int g_test_mode, g_no_launch, g_want_audio, g_verbose;

static void usage(void) {
  printf("%s %s\n", TS_TITLE, TS_VERSION);
  printf("Converts the player's own Counter-Strike: Source content into their own Red Alert 2 / Yuri's Revenge.\n");
  printf("  --ra2 <dir>    host game folder      (default: $RA2_DIR)\n");
  printf("  --css <dir>    companion game folder (default: $CSS_DIR)\n");
  printf("  --test         build and verify only, do not start the game\n");
  printf("  --no-launch    build, then stop\n");
  printf("  --audio        also repack the companion's sounds into audio.bag/audio.idx (off by default)\n");
  printf("  --log <file>   where to write the log (default: melty.log next to this program)\n");
}

static const char *env_or(const char *k, const char *fallback) {
  const char *v = getenv(k);
  return (v && *v) ? v : fallback;
}

/* ---------- host game probe ---------- */
static int probe_host(ts_build *b, const char *dir) {
  snprintf(b->ra2_dir, sizeof b->ra2_dir, "%s", dir);
  int found = 0;
  for (int i = 0; i < TS_HOOKS_COUNT; i++) {
    if (strcmp(g_hooks[i].role, "primary")) continue;
    for (const char **m = (const char *[]){ NULL }; m && *m; m++) {}
    (void)g_hooks[i];
  }
  char p[TS_PATH_MAX];
  ts_join(p, sizeof p, dir, "gamemd.exe");
  if (ts_file_exists(p)) { b->is_yr = 1; found = 1; ts_logf(TS_LOG_OK, "host: Yuri's Revenge (gamemd.exe) in %s", dir); }
  else {
    ts_join(p, sizeof p, dir, "game.exe");
    if (ts_file_exists(p)) { b->is_yr = 0; found = 1; ts_logf(TS_LOG_OK, "host: Red Alert 2 (game.exe) in %s", dir); }
  }
  if (!found) {
    ts_join(p, sizeof p, dir, "ra2md.mix");
    if (ts_file_exists(p)) { b->is_yr = 1; found = 1; ts_logf(TS_LOG_OK, "host: ra2md.mix found in %s (no executable seen)", dir); }
  }
  if (!found) {
    ts_join(p, sizeof p, dir, "ra2.mix");
    if (ts_file_exists(p)) { b->is_yr = 0; found = 1; ts_logf(TS_LOG_OK, "host: ra2.mix found in %s (no executable seen)", dir); }
  }
  if (!found) ts_logf(TS_LOG_FAIL, "host: %s does not look like a Red Alert 2 / Yuri's Revenge folder", dir);
  return found;
}

static int probe_companion(ts_build *b, const char *dir) {
  snprintf(b->css_dir, sizeof b->css_dir, "%s", dir);
  char p[TS_PATH_MAX];
  ts_join(p, sizeof p, dir, "cstrike");
  if (!ts_file_exists(p)) {
    ts_join(p, sizeof p, dir, "hl2.exe");
    if (!ts_file_exists(p)) { ts_logf(TS_LOG_FAIL, "companion: %s does not look like a Source game folder", dir); return 0; }
  }
  ts_logf(TS_LOG_OK, "companion: Counter-Strike: Source in %s", dir);
  return 1;
}

/* ---------- pull an ini out of the host game's own archives ---------- */
static int mix_find_ini(ts_mix *outer, const char *marker, char **out_text, size_t *out_len, const char *what) {
  uint8_t *data = NULL; size_t len = 0; int idx = -1;
  /* Look inside the nested archives first. An outer mix also contains the bytes of the inner
     ones, so searching it first would hand back the container instead of the ini. */
  for (int i = 0; i < outer->n_files; i++) {
    ts_mix inner;
    if (!ts_mix_open_nested(&inner, outer, i)) continue;
    if (ts_mix_find_by_marker(&inner, marker, strlen(marker), &data, &len, &idx)) {
      *out_text = (char *)data; *out_len = len;
      ts_logf(TS_LOG_OK, "host: %s found in %s", what, inner.path);
      ts_mix_close(&inner);
      return 1;
    }
    ts_mix_close(&inner);
  }
  if (ts_mix_find_by_marker(outer, marker, strlen(marker), &data, &len, &idx)) {
    *out_text = (char *)data; *out_len = len;
    ts_logf(TS_LOG_OK, "host: %s found directly in %s", what, outer->path);
    return 1;
  }
  return 0;
}

static char *load_host_ini(ts_build *b, const char *md_name, const char *ra2_name, const char *marker, const char *what) {
  char p[TS_PATH_MAX];
  const char *name = b->is_yr ? md_name : ra2_name;
  ts_join(p, sizeof p, b->ra2_dir, name);
  size_t len = 0;
  char *t = ts_slurp(p, &len);
  if (t && strstr(t, marker)) { ts_logf(TS_LOG_OK, "host: %s is already a loose file, using %s", what, name); return t; }
  free(t);
  /* find the outer mix */
  char outer_name[64];
  snprintf(outer_name, sizeof outer_name, "%s", b->is_yr ? "ra2md.mix" : "ra2.mix");
  char op[TS_PATH_MAX];
  ts_join(op, sizeof op, b->ra2_dir, outer_name);
  ts_mix outer;
  if (!ts_mix_open(&outer, op)) {
    /* maybe the generic mix is loose */
    ts_join(op, sizeof op, b->ra2_dir, b->is_yr ? "genericmd.mix" : "generic.mix");
    if (!ts_mix_open(&outer, op)) { ts_logf(TS_LOG_FAIL, "host: no readable mix in %s", b->ra2_dir); return NULL; }
  }
  char *text = NULL; size_t tlen = 0;
  if (!mix_find_ini(&outer, marker, &text, &tlen, what)) {
    ts_logf(TS_LOG_FAIL, "host: %s not found inside %s", what, outer.path);
    ts_mix_close(&outer);
    return NULL;
  }
  ts_mix_close(&outer);
  return text;
}

/* ---------- cameo palette ---------- */
static int is_vga_palette(const uint8_t *d) {
  int ok = 0;
  for (int i = 0; i < 768; i++) { if (d[i] > 63) return 0; if (d[i]) ok = 1; }
  return ok;
}

static int find_palette(ts_build *b) {
  char p[TS_PATH_MAX];
  ts_join(p, sizeof p, b->ra2_dir, "cameo.pal");
  size_t len = 0;
  char *d = ts_slurp(p, &len);
  if (d && len >= 768 && is_vga_palette((uint8_t *)d)) {
    ts_pal_load(&b->cameo_pal, (uint8_t *)d, len);
    b->have_cameo_pal = 1;
    ts_logf(TS_LOG_OK, "host: cameo palette from loose cameo.pal");
    free(d);
    return 1;
  }
  free(d);
  char op[TS_PATH_MAX];
  ts_join(op, sizeof op, b->ra2_dir, b->is_yr ? "ra2md.mix" : "ra2.mix");
  ts_mix outer;
  if (!ts_mix_open(&outer, op)) return 0;
  for (int pass = 0; pass < 2 && !b->have_cameo_pal; pass++) {
    ts_mix *m = &outer, inner;
    int opened = 0;
    if (pass == 1) {
      opened = 0;
      for (int i = 0; i < outer.n_files && !opened; i++) {
        if (ts_mix_open_nested(&inner, &outer, i)) {
          for (int k = 0; k < inner.n_files; k++) {
            if (inner.files[k].size != 768) continue;
            uint32_t off = inner.body_start + inner.files[k].offset;
            if (off + 768 > inner.len) continue;
            if (is_vga_palette(inner.data + off)) {
              ts_pal_load(&b->cameo_pal, inner.data + off, 768);
              b->have_cameo_pal = 1;
              ts_logf(TS_LOG_OK, "host: cameo palette from %s entry #%d (768 bytes, VGA range)", inner.path, k);
              break;
            }
          }
          ts_mix_close(&inner);
          opened = 1;
        }
      }
      continue;
    }
    for (int k = 0; k < m->n_files; k++) {
      if (m->files[k].size != 768) continue;
      uint32_t off = m->body_start + m->files[k].offset;
      if (off + 768 > m->len) continue;
      if (is_vga_palette(m->data + off)) {
        ts_pal_load(&b->cameo_pal, m->data + off, 768);
        b->have_cameo_pal = 1;
        ts_logf(TS_LOG_OK, "host: cameo palette from %s entry #%d (768 bytes, VGA range)", m->path, k);
        break;
      }
    }
  }
  ts_mix_close(&outer);
  if (!b->have_cameo_pal) ts_logf(TS_LOG_WARN, "host: no 768-byte VGA palette found; cameos will fall back to the host game's own icons");
  return b->have_cameo_pal;
}

/* ---------- companion content ---------- */
static int convert_weapons(ts_build *b, ts_vpk *vpks, int nvpk) {
  for (int i = 0; i < TS_WEAPONS_COUNT; i++) {
    const ts_weapon *w = &g_weapons[i];
    b->weapon_damage[i] = 20; b->weapon_rof[i] = 10; b->weapon_range[i] = 6;
    const ts_vpk_entry *e = NULL;
    for (int k = 0; k < nvpk && !e; k++) e = ts_vpk_find(&vpks[k], w->scriptMatch);
    if (!e) { ts_logf(TS_LOG_WARN, "companion: no weapon script matching \"%s\"; %s keeps safe defaults", w->scriptMatch, w->raName); continue; }
    uint8_t *data = NULL; size_t len = 0;
    char path[512]; ts_vpk_path(e, path, sizeof path);
    if (!ts_vpk_read(&vpks[0], e, &data, &len)) {
      /* entry may live in another archive of the set */
      for (int k = 1; k < nvpk && !data; k++) if (ts_vpk_find(&vpks[k], w->scriptMatch) && ts_vpk_read(&vpks[k], ts_vpk_find(&vpks[k], w->scriptMatch), &data, &len)) break;
    }
    if (!data) continue;
    ts_kvlist kv;
    int n = ts_kv_parse(&kv, (const char *)data, len);
    double dmg = ts_kv_num(&kv, w->damageKey, 0);
    double cyc = ts_kv_num(&kv, w->rofKey, 0);
    double rng = ts_kv_num(&kv, w->rangeKey, 0);
    int clip = (int)ts_kv_num(&kv, w->clipKey, 30);
    b->weapon_damage[i] = dmg * w->damageScale;
    b->weapon_rof[i] = (int)(cyc * w->rofScale + 0.5);
    b->weapon_range[i] = (int)(rng * w->rangeScale + 0.5);
    ts_logf(TS_LOG_OK, "companion: %s -> %s  (%d keys read) Damage=%g ClipSize=%d CycleTime=%g Range=%g",
            path, w->raName, n, dmg, clip, cyc, rng);
    ts_kv_free(&kv);
    free(data);
  }
  return 1;
}

static int convert_cameos(ts_build *b, ts_vpk *vpks, int nvpk) {
  if (!b->have_cameo_pal) return 0;
  int made = 0;
  for (int i = 0; i < TS_ART_COUNT; i++) {
    const ts_art *a = &g_art[i];
    const ts_vpk_entry *e = NULL;
    int which = 0;
    for (int k = 0; k < nvpk && !e; k++) { e = ts_vpk_find(&vpks[k], a->match); which = k; }
    if (!e) { ts_logf(TS_LOG_WARN, "companion: no texture matching \"%s\" for cameo %s", a->match, a->raName); continue; }
    uint8_t *data = NULL; size_t len = 0;
    char path[512]; ts_vpk_path(e, path, sizeof path);
    if (!ts_vpk_read(&vpks[which], e, &data, &len)) { ts_logf(TS_LOG_WARN, "companion: cannot read %s", path); continue; }
    ts_rgba img;
    if (!ts_vtf_decode(data, len, &img)) { ts_logf(TS_LOG_WARN, "companion: %s is not a VTF this build can decode", path); free(data); continue; }
    free(data);
    ts_rgba small;
    ts_rgba_resize(&img, &small, a->width, a->height);
    ts_rgba_free(&img);
    uint8_t *idx = (uint8_t *)calloc((size_t)a->width * a->height, 1);
    long sr = 0, sg = 0, sb = 0; int npx = 0;
    for (int y = 0; y < a->height; y++) {
      for (int x = 0; x < a->width; x++) {
        uint8_t *p = small.px + ((size_t)y * a->width + x) * 4;
        int r = p[0], g = p[1], bl = p[2], al = p[3];
        /* near-black or transparent pixels become the transparent index */
        if (al < 96 || (r < 24 && g < 24 && bl < 24)) continue;
        idx[(size_t)y * a->width + x] = (uint8_t)ts_pal_nearest(&b->cameo_pal, r, g, bl);
        sr += r; sg += g; sb += bl; npx++;
      }
    }
    uint8_t preview[3] = { 128, 128, 128 };
    if (npx) { preview[0] = (uint8_t)(sr / npx); preview[1] = (uint8_t)(sg / npx); preview[2] = (uint8_t)(sb / npx); }
    char out[TS_PATH_MAX], fname[64];
    snprintf(fname, sizeof fname, "%s.shp", a->raName);
    ts_join(out, sizeof out, b->ra2_dir, fname);
    if (ts_shp_write_cameo(out, idx, a->width, a->height, preview)) {
      ts_manifest_add(fname, ts_file_size(out));
      made++;
      ts_logf(TS_LOG_OK, "cameo %s.shp <- %s (%dx%d, %d painted pixels)", a->raName, path, a->width, a->height, npx);
    }
    free(idx);
    ts_rgba_free(&small);
  }
  b->cameos_ok = made;
  return made;
}

/* map each operator to a cameo: ours when we made it, otherwise the host game's own */
static void resolve_cameos(ts_build *b, ts_ini *art) {
  for (int i = 0; i < TS_OPERATORS_COUNT; i++) {
    const ts_operator *op = &g_operators[i];
    const char *ours = NULL;
    for (int k = 0; k < TS_ART_COUNT; k++) if (!strcmp(g_art[k].id, op->cameo)) ours = g_art[k].raName;
    if (b->cameos_ok && ours) snprintf(b->operator_cameo[i], sizeof b->operator_cameo[i], "%s", ours);
    else {
      char v[64] = "";
      ts_ini_sec *s = ts_ini_find(art, op->bodyArt);
      if (!s) s = ts_ini_find(art, op->bodyArtFallback);
      if (s && ts_ini_value(art, s->name, "Cameo", v, sizeof v)) snprintf(b->operator_cameo[i], sizeof b->operator_cameo[i], "%s", v);
      else snprintf(b->operator_cameo[i], sizeof b->operator_cameo[i], "%s", g_art[0].fallback);
    }
  }
}

/* ---------- merge one ini and write it back ----------
   The ini is passed in already parsed, because ts_gen_rules/ts_gen_art also edit it in place
   (they extend the host game's [WeaponTypes] / [InfantryTypes] / [Warheads] lists). Writing a
   second parse of the original text would throw those edits away. */
static int write_ini_obj(ts_build *b, const char *name, ts_ini *ini, const char *append_blocks) {
  if (!ini->head) { ts_logf(TS_LOG_FAIL, "%s: no sections parsed", name); return 0; }
  if (append_blocks && *append_blocks) ts_ini_append_raw(ini, append_blocks, strlen(append_blocks));
  size_t len = 0;
  char *out = ts_ini_render(ini, &len);
  char p[TS_PATH_MAX];
  ts_join(p, sizeof p, b->ra2_dir, name);
  int ok = ts_write(p, out, len);
  if (ok) ts_manifest_add(name, (long)len);
  free(out);
  ts_ini_free(ini);
  return ok;
}

/* ---------- launch ---------- */
static int launch_game(ts_build *b) {
  char exe[TS_PATH_MAX];
  ts_join(exe, sizeof exe, b->ra2_dir, b->is_yr ? "gamemd.exe" : "game.exe");
  if (!ts_file_exists(exe)) { ts_logf(TS_LOG_FAIL, "launch: %s is not there", exe); return 0; }
#ifdef _WIN32
  STARTUPINFOA si; PROCESS_INFORMATION pi;
  memset(&si, 0, sizeof si); si.cb = sizeof si;
  memset(&pi, 0, sizeof pi);
  char cmd[TS_PATH_MAX * 2];
  snprintf(cmd, sizeof cmd, "\"%s\"", exe);
  ts_logf(TS_LOG_OK, "launch: starting %s", exe);
  if (!CreateProcessA(exe, cmd, NULL, NULL, FALSE, 0, NULL, b->ra2_dir, &si, &pi)) {
    ts_logf(TS_LOG_FAIL, "launch: CreateProcess failed (%lu)", (unsigned long)GetLastError());
    return 0;
  }
  WaitForSingleObject(pi.hProcess, INFINITE);
  DWORD code = 0;
  GetExitCodeProcess(pi.hProcess, &code);
  CloseHandle(pi.hThread);
  CloseHandle(pi.hProcess);
  ts_logf(TS_LOG_OK, "launch: game exited with code %lu", (unsigned long)code);
  return code == 0;
#else
  ts_logf(TS_LOG_WARN, "launch: not Windows, would start %s", exe);
  return 1;
#endif
}

int main(int argc, char **argv) {
  const char *ra2 = env_or("RA2_DIR", "");
  const char *css = env_or("CSS_DIR", "");
  const char *logfile = NULL;
  for (int i = 1; i < argc; i++) {
    if (!strcmp(argv[i], "--test")) g_test_mode = 1;
    else if (!strcmp(argv[i], "--no-launch")) g_no_launch = 1;
    else if (!strcmp(argv[i], "--audio")) g_want_audio = 1;
    else if (!strcmp(argv[i], "--verbose")) g_verbose = 1;
    else if (!strcmp(argv[i], "--ra2") && i + 1 < argc) ra2 = argv[++i];
    else if (!strcmp(argv[i], "--css") && i + 1 < argc) css = argv[++i];
    else if (!strcmp(argv[i], "--log") && i + 1 < argc) logfile = argv[++i];
    else if (!strcmp(argv[i], "--help")) { usage(); return 0; }
  }
  char deflog[TS_PATH_MAX];
  if (!logfile) { snprintf(deflog, sizeof deflog, "melty.log"); logfile = deflog; }
  ts_log_open(logfile);
  ts_logf(TS_LOG_INFO, "%s %s", TS_TITLE, TS_VERSION);
  ts_logf(TS_LOG_INFO, "host slug %s, companion slug %s", TS_HOST_SLUG, TS_CSS_SLUG);
  if (!*ra2) { ts_logf(TS_LOG_FAIL, "no host folder: pass --ra2 or set RA2_DIR"); usage(); ts_log_close(); return 2; }
  if (!*css) { ts_logf(TS_LOG_FAIL, "no companion folder: pass --css or set CSS_DIR"); usage(); ts_log_close(); return 2; }

  ts_build b;
  memset(&b, 0, sizeof b);
  if (!probe_host(&b, ra2)) { ts_log_close(); return 2; }
  if (!probe_companion(&b, css)) { ts_log_close(); return 2; }

  /* the host game's own rule books */
  char *rules_text = load_host_ini(&b, "rulesmd.ini", "rules.ini", "[InfantryTypes]", "rules ini");
  char *art_text = load_host_ini(&b, "artmd.ini", "art.ini", "Sequence=", "art ini");
  char *sound_text = load_host_ini(&b, "soundmd.ini", "sound.ini", "Sound=", "sound ini");
  if (!rules_text || !art_text) {
    ts_logf(TS_LOG_FAIL, "cannot read the host game's own rules and art, refusing to write anything");
    free(rules_text); free(art_text); free(sound_text);
    ts_log_close();
    return 3;
  }
  ts_ini art_ini;
  ts_ini_parse(&art_ini, art_text, strlen(art_text));

  find_palette(&b);

  /* companion content */
  ts_vpk vpks[8];
  int nvpk = ts_vpk_scan(vpks, 8, b.css_dir);
  if (!nvpk) ts_logf(TS_LOG_WARN, "companion: no VPK archives found, weapons will keep safe defaults");
  convert_weapons(&b, vpks, nvpk);

  char mani[TS_PATH_MAX];
  ts_join(mani, sizeof mani, b.ra2_dir, TS_MANIFEST_NAME);
  ts_manifest_begin(mani);
  if (nvpk) convert_cameos(&b, vpks, nvpk);
  resolve_cameos(&b, &art_ini);

  /* generate and merge, all on the same parsed copies that get written back */
  static char rules_blocks[1 << 17], art_blocks[1 << 16], sound_blocks[1 << 14];
  ts_ini rules_ini;
  if (!ts_ini_parse(&rules_ini, rules_text, strlen(rules_text))) {
    ts_logf(TS_LOG_FAIL, "the host game's rules book did not parse");
    ts_log_close();
    return 4;
  }
  ts_gen_rules(&b, &rules_ini, rules_blocks, sizeof rules_blocks);
  ts_gen_art(&b, &art_ini, art_blocks, sizeof art_blocks);

  if (!write_ini_obj(&b, b.is_yr ? "rulesmd.ini" : "rules.ini", &rules_ini, rules_blocks)) { ts_log_close(); return 4; }
  if (!write_ini_obj(&b, b.is_yr ? "artmd.ini" : "art.ini", &art_ini, art_blocks)) { ts_log_close(); return 4; }
  if (g_want_audio && sound_text) {
    ts_ini snd_ini;
    if (ts_ini_parse(&snd_ini, sound_text, strlen(sound_text))) {
      ts_gen_sound(&b, sound_blocks, sizeof sound_blocks);
      write_ini_obj(&b, b.is_yr ? "soundmd.ini" : "sound.ini", &snd_ini, sound_blocks);
    }
  }
  if (!g_want_audio) ts_logf(TS_LOG_INFO, "audio stage skipped (pass --audio to repack the companion's sounds)");
  if (sound_text) free(sound_text);

  ts_manifest_end();
  for (int i = 0; i < nvpk; i++) ts_vpk_close(&vpks[i]);
  free(rules_text);
  free(art_text);

  ts_logf(TS_LOG_OK, "installed: %d weapons, %d operators, %d cameos, 1 objective", TS_WEAPONS_COUNT, TS_OPERATORS_COUNT, b.cameos_ok);
  if (ts_fail_count()) ts_logf(TS_LOG_WARN, "%d problems were logged; the mashup still runs", ts_fail_count());

  if (g_test_mode || g_no_launch) {
    ts_logf(TS_LOG_OK, "Terror Strike test build finished: %s", ts_fail_count() ? "with warnings" : "clean");
    ts_log_close();
    return g_test_mode ? (ts_fail_count() ? 1 : 0) : 0;
  }
  int ok = launch_game(&b);
  ts_log_close();
  return ok ? 0 : 1;
}
