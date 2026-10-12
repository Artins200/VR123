/* Yuri's Revenge: Terror Strike - common header.
   Reads Counter-Strike: Source's own files and the host game's own files at run time and
   writes generated files into the host game's folder. Nothing from either game is shipped. */
#ifndef TS_H
#define TS_H

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

#ifdef _WIN32
#  define TS_SEP '\\'
#else
#  define TS_SEP '/'
#endif

#define TS_PATH_MAX 1024
#define TS_MAX_FILES 4096

/* ---------- logging ---------- */
typedef enum { TS_LOG_INFO, TS_LOG_OK, TS_LOG_WARN, TS_LOG_FAIL } ts_level;
void ts_log_open(const char *path);
void ts_log_close(void);
void ts_logf(ts_level lvl, const char *fmt, ...);
int  ts_fail_count(void);

/* ---------- util ---------- */
char *ts_slurp(const char *path, size_t *out_len);
int   ts_write(const char *path, const void *data, size_t len);
int   ts_file_exists(const char *path);
long  ts_file_size(const char *path);
void  ts_join(char *out, size_t cap, const char *a, const char *b);
void  ts_lower_inplace(char *s);
const char *ts_basename_ext(const char *path);
/* append to the install manifest so the mod can be refreshed or removed cleanly */
void  ts_manifest_begin(const char *path);
void  ts_manifest_add(const char *path, long bytes);
void  ts_manifest_end(void);

/* ---------- directory listing ---------- */
typedef struct ts_dirlist { char **names; int n; } ts_dirlist;
int  ts_dir_list(ts_dirlist *out, const char *dir);   /* 0 on failure */
void ts_dir_list_free(ts_dirlist *d);

/* ---------- ini ---------- */
typedef struct ts_ini_sec { char name[64]; char *body; size_t body_len, body_cap; struct ts_ini_sec *next; } ts_ini_sec;
typedef struct ts_ini { ts_ini_sec *head, *tail; char *preamble; size_t preamble_len; } ts_ini;
int  ts_ini_parse(ts_ini *ini, const char *text, size_t len);
void ts_ini_free(ts_ini *ini);
ts_ini_sec *ts_ini_find(ts_ini *ini, const char *section);       /* case-insensitive */
int  ts_ini_has(ts_ini *ini, const char *section);
/* append a whole block of text (our generated sections) to the end of the ini */
void ts_ini_append_raw(ts_ini *ini, const char *text, size_t len);
/* rewrite one key inside a section; if the section is absent the key is ignored */
int  ts_ini_set(ts_ini *ini, const char *section, const char *key, const char *value);
char *ts_ini_render(ts_ini *ini, size_t *out_len);

/* ---------- mix (host game archives) ---------- */
typedef struct ts_mix_file { uint32_t id; uint32_t offset; uint32_t size; } ts_mix_file;
typedef struct ts_mix {
  uint8_t *data; size_t len;       /* whole file, owned */
  char path[TS_PATH_MAX];
  int version;                     /* 1 = TD/RA style header, 2 = TS/RA2 style header */
  uint32_t flags, body_start, body_size;
  ts_mix_file *files; int n_files;
} ts_mix;
int  ts_mix_open(ts_mix *m, const char *path);
void ts_mix_close(ts_mix *m);
/* find an entry by content because RA2 mix ids are filename hashes we do not reimplement */
int  ts_mix_find_by_marker(ts_mix *m, const char *marker, size_t marker_len, uint8_t **out, size_t *out_len, int *out_index);
/* open a nested mix held inside another mix */
int  ts_mix_open_nested(ts_mix *m, const ts_mix *outer, int index);

/* ---------- vpk (companion game archives) ---------- */
typedef struct ts_vpk_entry { char *ext, *dir, *name; uint32_t crc, preload, archive, offset, length; uint8_t *preload_data; } ts_vpk_entry;
typedef struct ts_vpk {
  char dir_path[TS_PATH_MAX];      /* path of the *_dir.vpk */
  char folder[TS_PATH_MAX];        /* folder holding the dir + numbered archives */
  ts_vpk_entry *entries; int n_entries, cap_entries;
  int version; uint32_t tree_size, tree_end;
} ts_vpk;
int  ts_vpk_open(ts_vpk *v, const char *dir_vpk_path);
void ts_vpk_close(ts_vpk *v);
int  ts_vpk_read(ts_vpk *v, const ts_vpk_entry *e, uint8_t **out, size_t *out_len);
/* find the first entry whose full path contains 'needle' (case-insensitive) */
const ts_vpk_entry *ts_vpk_find(const ts_vpk *v, const char *needle);
void ts_vpk_path(const ts_vpk_entry *e, char *out, size_t cap);
/* open every *_dir.vpk under a Source game root */
int  ts_vpk_scan(ts_vpk *list, int max, const char *game_root);

/* ---------- kv (Source KeyValues, used by the companion's weapon scripts) ---------- */
typedef struct ts_kv { char key[64]; char val[256]; } ts_kv;
typedef struct ts_kvlist { ts_kv *items; int n, cap; } ts_kvlist;
int   ts_kv_parse(ts_kvlist *out, const char *text, size_t len);   /* flattened, last value wins */
const char *ts_kv_get(const ts_kvlist *l, const char *key);        /* NULL when absent */
double ts_kv_num(const ts_kvlist *l, const char *key, double fallback);
void  ts_kv_free(ts_kvlist *l);

/* ---------- image ---------- */
typedef struct ts_rgba { uint8_t *px; int w, h; } ts_rgba;
int  ts_vtf_decode(const uint8_t *data, size_t len, ts_rgba *out);   /* 1 on success */
void ts_rgba_free(ts_rgba *im);
void ts_rgba_resize(const ts_rgba *src, ts_rgba *dst, int w, int h);
/* 6-bit VGA palette, 256 entries */
typedef struct ts_pal { uint8_t rgb[256][3]; int n; } ts_pal;
int  ts_pal_load(ts_pal *p, const uint8_t *data, size_t len);
int  ts_pal_nearest(const ts_pal *p, int r, int g, int b);

/* ---------- shp (host game sprite format) ---------- */
int  ts_shp_write_cameo(const char *path, const uint8_t *indexed, int w, int h, const uint8_t *rgb_preview);

/* ---------- audio ---------- */
typedef struct ts_wav { int rate, channels, bits; uint8_t *pcm; size_t pcm_len; } ts_wav;
int  ts_wav_parse(const uint8_t *data, size_t len, ts_wav *out);
int  ts_wav_convert(ts_wav *w, int want_rate);                       /* mixdown to mono + resample, in place */
void ts_wav_free(ts_wav *w);
typedef struct ts_bag_ent { char name[16]; uint32_t offset, size, rate, flags, chunk; } ts_bag_ent;
typedef struct ts_bag { uint8_t *data; size_t len, cap; ts_bag_ent *ents; int n, ent_cap; } ts_bag;
void ts_bag_init(ts_bag *b);
int  ts_bag_add(ts_bag *b, const char *name, const uint8_t *wav, size_t len, int rate);
int  ts_bag_write(ts_bag *b, const char *bag_path, const char *idx_path);
void ts_bag_free(ts_bag *b);

/* ---------- generated data ---------- */
#include "../generated/ts_data.h"

/* ---------- gen ---------- */
typedef struct ts_build {
  char ra2_dir[TS_PATH_MAX];
  char css_dir[TS_PATH_MAX];
  int  is_yr;                       /* Yuri's Revenge when gamemd.exe is present */
  int  sounds_ok, cameos_ok;        /* optional stages that actually succeeded */
  ts_pal cameo_pal;
  int   have_cameo_pal;
  /* per-row results, one entry per sheet row */
  char  weapon_cameo[TS_WEAPONS_COUNT][16];
  char  weapon_sound[TS_WEAPONS_COUNT][16];
  char  operator_cameo[TS_OPERATORS_COUNT][32];
  double weapon_damage[TS_WEAPONS_COUNT];
  int    weapon_rof[TS_WEAPONS_COUNT];
  int    weapon_clip[TS_WEAPONS_COUNT];
  int    weapon_range[TS_WEAPONS_COUNT];
} ts_build;

char *ts_ini_value(ts_ini *ini, const char *section, const char *key, char *out, size_t cap);
int   ts_ini_list_add(ts_ini *ini, const char *section, const char *value);
int   ts_resolve_donor(ts_ini *rules, const char *donor_body, char *weapon_out, size_t cap,
                       char *report_out, size_t rcap, char *warhead_out, size_t wcap,
                       char *projectile_out, size_t pcap);
const char *ts_weapon_ra_name(const char *weapon_id);
int   ts_gen_rules(ts_build *b, ts_ini *rules, char *out, size_t cap);
int   ts_gen_art(ts_build *b, ts_ini *art, char *out, size_t cap);
int   ts_gen_sound(ts_build *b, char *out, size_t cap);
int   ts_shp_read_frame0(const uint8_t *data, size_t len, uint8_t *out, int w, int h);

#endif /* TS_H */
