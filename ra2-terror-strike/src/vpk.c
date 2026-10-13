#include "ts.h"

static uint32_t rd32(const uint8_t *p) { return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24); }
static uint16_t rd16(const uint8_t *p) { return (uint16_t)(p[0] | (p[1] << 8)); }

static int has_suffix_ci(const char *s, const char *suf) {
  size_t ls = strlen(s), lf = strlen(suf);
  if (lf > ls) return 0;
  for (size_t i = 0; i < lf; i++) {
    char a = s[ls - lf + i], b = suf[i];
    if (a >= 'A' && a <= 'Z') a += 32;
    if (b >= 'A' && b <= 'Z') b += 32;
    if (a != b) return 0;
  }
  return 1;
}

static void add_entry(ts_vpk *v, const char *ext, const char *dir, const char *name,
                      uint32_t crc, uint16_t preload, uint16_t archive, uint32_t off, uint32_t length,
                      const uint8_t *preload_data) {
  if (v->n_entries == v->cap_entries) {
    v->cap_entries = v->cap_entries ? v->cap_entries * 2 : 256;
    v->entries = (ts_vpk_entry *)realloc(v->entries, (size_t)v->cap_entries * sizeof(ts_vpk_entry));
  }
  ts_vpk_entry *e = &v->entries[v->n_entries++];
  memset(e, 0, sizeof *e);
  e->ext = strdup(ext); e->dir = strdup(dir); e->name = strdup(name);
  e->crc = crc; e->preload = preload; e->archive = archive; e->offset = off; e->length = length;
  if (preload && preload > 0) { e->preload_data = (uint8_t *)malloc(preload); memcpy(e->preload_data, preload_data, preload); }
}

int ts_vpk_open(ts_vpk *v, const char *dir_vpk_path) {
  memset(v, 0, sizeof *v);
  snprintf(v->dir_path, sizeof v->dir_path, "%s", dir_vpk_path);
  /* folder = everything before the last separator */
  snprintf(v->folder, sizeof v->folder, "%s", dir_vpk_path);
  char *sep = strrchr(v->folder, TS_SEP);
  char *sep2 = strrchr(v->folder, '/');
  char *cut = sep > sep2 ? sep : sep2;
  if (cut) *cut = 0; else snprintf(v->folder, sizeof v->folder, ".");

  size_t len = 0;
  uint8_t *d = (uint8_t *)ts_slurp(dir_vpk_path, &len);
  if (!d || len < 16) { free(d); ts_logf(TS_LOG_FAIL, "vpk: cannot read %s", dir_vpk_path); return 0; }
  uint32_t sig = rd32(d);
  uint32_t version = rd32(d + 4);
  if (sig != 0x55AA1234u) { ts_logf(TS_LOG_FAIL, "vpk: %s is not a VPK (signature %08X)", dir_vpk_path, sig); free(d); return 0; }
  uint32_t tree_size;
  size_t tree_at;
  if (version == 1) { tree_size = rd32(d + 8); tree_at = 12; }
  else if (version == 2) { tree_size = rd32(d + 8); tree_at = 28; }
  else { ts_logf(TS_LOG_FAIL, "vpk: %s unsupported version %u", dir_vpk_path, version); free(d); return 0; }
  v->version = (int)version; v->tree_size = tree_size; v->tree_end = (uint32_t)(tree_at + tree_size);
  if (tree_at + tree_size > len) { ts_logf(TS_LOG_FAIL, "vpk: %s tree runs past end of file", dir_vpk_path); free(d); return 0; }

  const uint8_t *p = d + tree_at, *end = p + tree_size;
  char ext[256], dir[256], name[256];
  while (p < end) {
    size_t n = strnlen((const char *)p, (size_t)(end - p));
    if (!n) break;
    if (n >= sizeof ext) n = sizeof ext - 1;
    memcpy(ext, p, n); ext[n] = 0; p += n + 1;
    while (p < end) {
      n = strnlen((const char *)p, (size_t)(end - p));
      if (!n) { p++; break; }
      if (n >= sizeof dir) n = sizeof dir - 1;
      memcpy(dir, p, n); dir[n] = 0; p += n + 1;
      while (p < end) {
        n = strnlen((const char *)p, (size_t)(end - p));
        if (!n) { p++; break; }
        if (n >= sizeof name) n = sizeof name - 1;
        memcpy(name, p, n); name[n] = 0; p += n + 1;
        if (p + 18 > end) goto done;
        uint32_t crc = rd32(p);
        uint16_t preload = rd16(p + 4);
        uint16_t archive = rd16(p + 6);
        uint32_t off = rd32(p + 8);
        uint32_t length = rd32(p + 12);
        p += 16;
        p += 2;                       /* 0xFFFF terminator */
        const uint8_t *pd = NULL;
        if (preload) {
          if (p + preload > end) goto done;
          pd = p; p += preload;
        }
        add_entry(v, ext, dir, name, crc, preload, archive, off, length, pd);
      }
    }
  }
done:
  free(d);
  ts_logf(TS_LOG_OK, "vpk: %s -> v%d, %d entries", dir_vpk_path, version, v->n_entries);
  return v->n_entries > 0;
}

void ts_vpk_close(ts_vpk *v) {
  for (int i = 0; i < v->n_entries; i++) { free(v->entries[i].ext); free(v->entries[i].dir); free(v->entries[i].name); free(v->entries[i].preload_data); }
  free(v->entries);
  memset(v, 0, sizeof *v);
}

void ts_vpk_path(const ts_vpk_entry *e, char *out, size_t cap) {
  if (e->dir && *e->dir && strcmp(e->dir, " ")) snprintf(out, cap, "%s/%s.%s", e->dir, e->name, e->ext);
  else snprintf(out, cap, "%s.%s", e->name, e->ext);
}

const ts_vpk_entry *ts_vpk_find(const ts_vpk *v, const char *needle) {
  char low[512]; snprintf(low, sizeof low, "%s", needle); ts_lower_inplace(low);
  const ts_vpk_entry *best = NULL;
  size_t best_len = (size_t)-1;
  char path[512], lowp[512];
  for (int i = 0; i < v->n_entries; i++) {
    ts_vpk_path(&v->entries[i], path, sizeof path);
    snprintf(lowp, sizeof lowp, "%s", path); ts_lower_inplace(lowp);
    if (strstr(lowp, low)) {
      size_t l = v->entries[i].length + v->entries[i].preload;
      if (best_len == (size_t)-1 || l > best_len) { best = &v->entries[i]; best_len = l; }
    }
  }
  return best;
}

int ts_vpk_read(ts_vpk *v, const ts_vpk_entry *e, uint8_t **out, size_t *out_len) {
  size_t total = (size_t)e->preload + (size_t)e->length;
  uint8_t *buf = (uint8_t *)malloc(total + 1);
  size_t o = 0;
  if (e->preload && e->preload_data) { memcpy(buf, e->preload_data, e->preload); o = e->preload; }
  if (e->length) {
    char ap[TS_PATH_MAX];
    uint32_t extra = 0;
    if (e->archive == 0x7FFF) {
      /* stored in the dir file itself, right after the tree */
      snprintf(ap, sizeof ap, "%s", v->dir_path);
      extra = v->tree_end;
    } else {
      /* <folder>/<stem>_<archive padded to 3 digits>.vpk */
      char stem[TS_PATH_MAX];
      snprintf(stem, sizeof stem, "%s", v->dir_path);
      char *us = strrchr(stem, '_');
      if (us) *us = 0;
      char aname[TS_PATH_MAX];
      snprintf(aname, sizeof aname, "%s_%03d.vpk", stem, e->archive);
      snprintf(ap, sizeof ap, "%s", aname);
    }
    size_t flen = 0;
    char *fdata = ts_slurp(ap, &flen);
    if (!fdata) { ts_logf(TS_LOG_FAIL, "vpk: missing archive %s", ap); free(buf); return 0; }
    if ((size_t)e->offset + extra + e->length > flen) { ts_logf(TS_LOG_FAIL, "vpk: %s entry runs past %s", v->dir_path, ap); free(fdata); free(buf); return 0; }
    memcpy(buf + o, fdata + e->offset + extra, e->length);
    o += e->length;
    free(fdata);
  }
  buf[o] = 0;
  *out = buf; *out_len = o;
  return 1;
}

int ts_vpk_scan(ts_vpk *list, int max, const char *game_root) {
  int found = 0;
  ts_dirlist top;
  if (!ts_dir_list(&top, game_root)) { ts_logf(TS_LOG_WARN, "cannot list %s", game_root); return 0; }
  /* look in the root and one level down (hl2/, cstrike/) */
  for (int pass = 0; pass < 2 && found < max; pass++) {
    if (pass == 0) {
      for (int i = 0; i < top.n && found < max; i++) {
        if (!has_suffix_ci(top.names[i], "_dir.vpk")) continue;
        char p[TS_PATH_MAX]; ts_join(p, sizeof p, game_root, top.names[i]);
        if (ts_vpk_open(&list[found], p)) found++;
      }
    } else {
      for (int i = 0; i < top.n && found < max; i++) {
        char sub[TS_PATH_MAX]; ts_join(sub, sizeof sub, game_root, top.names[i]);
        ts_dirlist sd;
        if (!ts_dir_list(&sd, sub)) continue;
        for (int j = 0; j < sd.n && found < max; j++) {
          if (!has_suffix_ci(sd.names[j], "_dir.vpk")) continue;
          char p[TS_PATH_MAX]; ts_join(p, sizeof p, sub, sd.names[j]);
          if (ts_vpk_open(&list[found], p)) found++;
        }
        ts_dir_list_free(&sd);
      }
    }
  }
  ts_dir_list_free(&top);
  /* The companion game keeps its own content in cstrike/ and only shared content in hl2/.
     Search the game-specific archives first, the way the Portal 2 field note in
     universal-modder's knowledge base does (dlc folders first, then the base game). */
  for (int i = 0; i < found; i++) {
    for (int j = i + 1; j < found; j++) {
      int a = strstr(list[i].dir_path, "cstrike") != NULL;
      int b = strstr(list[j].dir_path, "cstrike") != NULL;
      if (!a && b) { ts_vpk t = list[i]; list[i] = list[j]; list[j] = t; }
    }
  }
  for (int i = 0; i < found; i++) ts_logf(TS_LOG_INFO, "vpk: search order %d: %s", i + 1, list[i].dir_path);
  ts_logf(TS_LOG_OK, "vpk: %d archives found under %s", found, game_root);
  return found;
}
