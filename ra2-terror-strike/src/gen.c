#include "ts.h"
#include <ctype.h>

/* read a key's value out of a parsed ini section */
char *ts_ini_value(ts_ini *ini, const char *section, const char *key, char *out, size_t cap) {
  out[0] = 0;
  ts_ini_sec *s = ts_ini_find(ini, section);
  if (!s) return NULL;
  size_t klen = strlen(key);
  for (size_t i = 0; i < s->body_len;) {
    size_t ls = i;
    while (i < s->body_len && s->body[i] != '\n') i++;
    if (i < s->body_len) i++;                  /* step over the newline */
    char *p = s->body + ls;
    while (*p == ' ' || *p == '\t') p++;
    if (*p != ';' && *p != '#' && !strncmp(p, key, klen)) {
      char *q = p + klen;
      while (*q == ' ' || *q == '\t') q++;
      if (*q == '=') {
        q++;
        while (*q == ' ' || *q == '\t') q++;
        char *e = q;
        while (*e && *e != '\n' && *e != '\r' && *e != ';') e++;
        while (e > q && (e[-1] == ' ' || e[-1] == '\t')) e--;
        size_t n = (size_t)(e - q); if (n >= cap) n = cap - 1;
        memcpy(out, q, n); out[n] = 0;
        return out;
      }
    }
  }
  return NULL;
}

/* append a value to a numbered list section such as [InfantryTypes], keeping the numbering
   contiguous, which is what the host game's parser walks */
int ts_ini_list_add(ts_ini *ini, const char *section, const char *value) {
  ts_ini_sec *s = ts_ini_find(ini, section);
  if (!s) { ts_logf(TS_LOG_WARN, "ini: section [%s] not found, cannot list %s", section, value); return 0; }
  int max = 0;
  for (size_t i = 0; i < s->body_len;) {
    size_t ls = i;
    while (i < s->body_len && s->body[i] != '\n') i++;
    if (i < s->body_len) i++;                  /* step over the newline */
    char *p = s->body + ls;
    while (*p == ' ' || *p == '\t') p++;
    if (*p >= '0' && *p <= '9') {
      int v = (int)strtol(p, NULL, 10);
      if (v > max) max = v;
    }
  }
  /* drop trailing blank lines so the new entry sits with the rest of the list */
  while (s->body_len && (s->body[s->body_len - 1] == '\n' || s->body[s->body_len - 1] == '\r')) s->body[--s->body_len] = 0;
  char line[256];
  int n = snprintf(line, sizeof line, "\n%d=%s\n", max + 1, value);
  if (s->body_len + (size_t)n + 2 > s->body_cap) { s->body_cap = s->body_len + n + 4096; s->body = (char *)realloc(s->body, s->body_cap); }
  memcpy(s->body + s->body_len, line, (size_t)n);
  s->body_len += (size_t)n; s->body[s->body_len] = 0;
  return max + 1;
}

static int clampi(int v, int lo, int hi) { return v < lo ? lo : v > hi ? hi : v; }

/* Resolve the host-game weapon a converted weapon inherits its sound, warhead and projectile
   from. Everything inherited is read out of the player's own rules ini, so it always exists. */
int ts_resolve_donor(ts_ini *rules, const char *donorBody, char *weapon_out, size_t cap,
                     char *report_out, size_t rcap, char *warhead_out, size_t wcap,
                     char *projectile_out, size_t pcap) {
  char tmp[128];
  weapon_out[0] = report_out[0] = warhead_out[0] = projectile_out[0] = 0;
  if (ts_ini_value(rules, donorBody, "Primary", tmp, sizeof tmp)) snprintf(weapon_out, cap, "%s", tmp);
  if (!weapon_out[0]) return 0;
  ts_ini_value(rules, weapon_out, "Report", report_out, rcap);
  ts_ini_value(rules, weapon_out, "Warhead", warhead_out, wcap);
  ts_ini_value(rules, weapon_out, "Projectile", projectile_out, pcap);
  return 1;
}

/* Build every block this mashup adds to the host game's rules ini.
   Numbers come from the companion game's own weapon scripts, converted with the scales and
   clamps in sheets/weapons.json. */
int ts_gen_rules(ts_build *b, ts_ini *rules, char *out, size_t cap) {
  size_t o = 0;
  #define P(...) do { int n = snprintf(out + o, o < cap ? cap - o : 0, __VA_ARGS__); if (n > 0) o += (size_t)n; } while (0)

  P("\n; ===== %s %s - generated from sheets/, do not edit =====\n", TS_TITLE, TS_VERSION);
  P("; Every number below was read out of the player's own Counter-Strike: Source install\n");
  P("; at install time. Nothing from either game is distributed with this mashup.\n");

  /* warheads */
  P("\n[TSWHSA]\nVerses=100%%,90%%,80%%,60%%,40%%,40%%,50%%,40%%,30%%,80%%,100%%\nInfDeath=1\nProneDamage=70%%\nWall=no\nWood=no\nTiberium=no\nAnimList=PIFF\n\n");
  P("[TSWHSP]\nVerses=200%%,150%%,100%%,60%%,40%%,40%%,60%%,40%%,30%%,80%%,100%%\nInfDeath=1\nProneDamage=100%%\nWall=no\nWood=no\nTiberium=no\nAnimList=PIFF\n\n");
  P("[TSWHBL]\nCellSpread=%d\nPercentAtMax=.5\nVerses=150%%,120%%,100%%,90%%,80%%,80%%,100%%,100%%,80%%,100%%,100%%\nInfDeath=4\nWall=yes\nWood=yes\nTiberium=no\nAnimList=TWLT100\n\n", g_objectives[0].cellSpread);
  ts_ini_list_add(rules, "Warheads", "TSWHSA");
  ts_ini_list_add(rules, "Warheads", "TSWHSP");
  ts_ini_list_add(rules, "Warheads", "TSWHBL");

  /* weapons: the [WeaponTypes] list itself is extended in place above */
  for (int i = 0; i < TS_WEAPONS_COUNT; i++) {
    const ts_weapon *w = &g_weapons[i];
    int idx = ts_ini_list_add(rules, "WeaponTypes", w->raName);
    P("; [WeaponTypes] %d=%s\n", idx, w->raName);
  }
  for (int i = 0; i < TS_WEAPONS_COUNT; i++) {
    const ts_weapon *w = &g_weapons[i];
    char donor_w[64], rep[64], wh[64], proj[64];
    if (!ts_resolve_donor(rules, w->donorBody, donor_w, sizeof donor_w, rep, sizeof rep, wh, sizeof wh, proj, sizeof proj)) {
      ts_logf(TS_LOG_WARN, "rules: donor infantry %s not in this game, using the first infantry instead", w->donorBody);
      ts_ini_sec *first = NULL;
      /* fall back: any infantry that has a Primary weapon */
      for (ts_ini_sec *s = rules->head; s && !first; s = s->next) {
        char t[64];
        if (ts_ini_value(rules, s->name, "Primary", t, sizeof t) && strstr(s->name, "E1") == NULL) first = s;
      }
      if (first) ts_resolve_donor(rules, first->name, donor_w, sizeof donor_w, rep, sizeof rep, wh, sizeof wh, proj, sizeof proj);
    }
    int damage = clampi((int)(b->weapon_damage[i] + 0.5), w->minDamage, w->maxDamage);
    int rof = clampi(b->weapon_rof[i], w->minRof, w->maxRof);
    int range = clampi(b->weapon_range[i], w->minRange, w->maxRange);
    const char *warhead = !strcmp(w->id, "c4") ? "TSWHBL" : !strcmp(w->id, "awp") ? "TSWHSP" : "TSWHSA";
    P("[%s]\nDamage=%d\nROF=%d\nRange=%d\nProjectile=%s\nSpeed=100\nReport=%s\nWarhead=%s\nBright=yes\nLaserInnerColor=255,255,255\nLaserOuterColor=0,0,0\n\n",
      w->raName, damage, rof, range,
      proj[0] ? proj : "InvisibleLow",
      rep[0] ? rep : "E1AttackA",
      warhead);
    b->weapon_damage[i] = damage; b->weapon_rof[i] = rof; b->weapon_range[i] = range;
    ts_logf(TS_LOG_OK, "weapon %-8s damage %4d  rof %3d  range %2d  (sound %s, warhead %s from %s)",
            w->raName, damage, rof, range, rep[0] ? rep : "none", warhead, donor_w);
  }

  /* operators: the [InfantryTypes] list itself is extended in place above */
  for (int i = 0; i < TS_OPERATORS_COUNT; i++) {
    int idx = ts_ini_list_add(rules, "InfantryTypes", g_operators[i].raUid);
    P("; [InfantryTypes] %d=%s\n", idx, g_operators[i].raUid);
  }
  for (int i = 0; i < TS_OPERATORS_COUNT; i++) {
    const ts_operator *op = &g_operators[i];
    P("[%s]\nName=%s\nCategory=Soldier\nPrimary=%s\nSecondary=%s\nArmor=%s\nTechLevel=1\nSight=%d\nSpeed=%d\nOwner=%s\nCost=%d\nPoints=10\nPrerequisite=%s\nCrushable=%s\nOccupier=yes\nIsSelectableCombatant=yes\nPhysicalSize=1\nMovementZone=Infantry\nThreatPosed=10\nImmuneToVeins=yes\nBombSeeable=yes\n%s%s\n",
      op->raUid, op->display,
      ts_weapon_ra_name(op->primary), ts_weapon_ra_name(op->secondary),
      op->armor, op->sight, op->speed, op->owner, op->cost, op->prerequisite, op->crushable,
      op->c4Carrier[0] == 'y' ? "C4=yes\nExplodes=yes\nDeathWeapon=TSC4\n" : "",
      "");
    ts_logf(TS_LOG_OK, "operator %-11s %-12s primary %-9s cost %d", op->raUid, op->display, ts_weapon_ra_name(op->primary), op->cost);
  }

  /* economy */
  for (int i = 0; i < TS_ECONOMY_COUNT; i++) {
    if (ts_ini_set(rules, g_economy[i].iniSection, g_economy[i].key, g_economy[i].value))
      ts_logf(TS_LOG_OK, "economy [%s] %s=%s", g_economy[i].iniSection, g_economy[i].key, g_economy[i].value);
    else
      ts_logf(TS_LOG_WARN, "economy: [%s] is not in this game's rules, skipped %s", g_economy[i].iniSection, g_economy[i].key);
  }
  return (int)o;
}

/* artmd.ini blocks: clone the host game's own art section for the body, then point the cameo
   at the one rendered from the companion game's texture when there is one. */
int ts_gen_art(ts_build *b, ts_ini *art, char *out, size_t cap) {
  size_t o = 0;
  #define P(...) do { int n = snprintf(out + o, o < cap ? cap - o : 0, __VA_ARGS__); if (n > 0) o += (size_t)n; } while (0)
  P("\n; ===== %s %s - generated from sheets/ =====\n", TS_TITLE, TS_VERSION);
  for (int i = 0; i < TS_OPERATORS_COUNT; i++) {
    const ts_operator *op = &g_operators[i];
    ts_ini_sec *src = ts_ini_find(art, op->bodyArt);
    if (!src) src = ts_ini_find(art, op->bodyArtFallback);
    if (!src) { ts_logf(TS_LOG_WARN, "art: no [%s] or [%s] in this game's art ini, %s gets no art entry", op->bodyArt, op->bodyArtFallback, op->raUid); continue; }
    P("[%s]\n", op->raUid);
    /* copy every key of the donor art section verbatim */
    for (size_t k = 0; k < src->body_len;) {
      size_t ls = k;
      while (k < src->body_len && src->body[k] != '\n') k++;
      if (k < src->body_len) k++;                  /* step over the newline */
      char *p = src->body + ls;
      while (*p == ' ' || *p == '\t') p++;
      if (*p && *p != '\n' && *p != '\r' && *p != ';' && *p != '#') {
        char *e = src->body + k;
        while (e > p && (e[-1] == '\n' || e[-1] == '\r' || e[-1] == ' ')) e--;
        size_t n = (size_t)(e - p);
        if (o + n + 4 < cap) { memcpy(out + o, p, n); o += n; out[o++] = '\n'; out[o] = 0; }
      }
    }
    P("Image=%s\nCameo=%s\nAltCameo=%s\n\n", src->name, b->operator_cameo[i], b->operator_cameo[i]);
    ts_logf(TS_LOG_OK, "art [%s] cloned from [%s], cameo %s", op->raUid, src->name, b->operator_cameo[i]);
  }
  return (int)o;
}

/* soundmd.ini blocks, only emitted when the optional audio stage ran */
int ts_gen_sound(ts_build *b, char *out, size_t cap) {
  size_t o = 0;
  #define P(...) do { int n = snprintf(out + o, o < cap ? cap - o : 0, __VA_ARGS__); if (n > 0) o += (size_t)n; } while (0)
  (void)b;
  P("\n; ===== %s %s - generated from sheets/ =====\n", TS_TITLE, TS_VERSION);
  for (int i = 0; i < TS_SOUNDS_COUNT; i++) {
    if (!g_sounds[i].enabled) continue;
    P("[%s]\nSound=%s.wav\nVolume=%d\nPriority=%s\nType=players\n\n", g_sounds[i].raName, g_sounds[i].raName, g_sounds[i].volume, g_sounds[i].priority);
  }
  return (int)o;
}

const char *ts_weapon_ra_name(const char *weapon_id) {
  for (int i = 0; i < TS_WEAPONS_COUNT; i++) if (!strcmp(g_weapons[i].id, weapon_id)) return g_weapons[i].raName;
  return "None";
}
