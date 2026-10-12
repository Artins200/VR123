#include "ts.h"
#include <stdarg.h>
#include <sys/stat.h>

static FILE *g_log;
static int g_fails;

void ts_log_open(const char *path) { g_log = fopen(path, "w"); }
void ts_log_close(void) { if (g_log) { fclose(g_log); g_log = NULL; } }
int  ts_fail_count(void) { return g_fails; }

void ts_logf(ts_level lvl, const char *fmt, ...) {
  const char *tag = lvl == TS_LOG_OK ? "  ok  " : lvl == TS_LOG_WARN ? " warn " : lvl == TS_LOG_FAIL ? " FAIL " : "  --  ";
  va_list ap;
  char buf[2048];
  va_start(ap, fmt);
  vsnprintf(buf, sizeof buf, fmt, ap);
  va_end(ap);
  if (lvl == TS_LOG_FAIL) g_fails++;
  printf("[%s] %s\n", tag, buf);
  if (g_log) { fprintf(g_log, "[%s] %s\n", tag, buf); fflush(g_log); }
}

char *ts_slurp(const char *path, size_t *out_len) {
  FILE *f = fopen(path, "rb");
  if (!f) return NULL;
  fseek(f, 0, SEEK_END);
  long n = ftell(f);
  fseek(f, 0, SEEK_SET);
  if (n < 0) { fclose(f); return NULL; }
  char *buf = (char *)malloc((size_t)n + 1);
  if (!buf) { fclose(f); return NULL; }
  size_t got = fread(buf, 1, (size_t)n, f);
  fclose(f);
  buf[got] = 0;
  if (out_len) *out_len = got;
  return buf;
}

int ts_write(const char *path, const void *data, size_t len) {
  FILE *f = fopen(path, "wb");
  if (!f) { ts_logf(TS_LOG_FAIL, "cannot write %s", path); return 0; }
  size_t w = fwrite(data, 1, len, f);
  fclose(f);
  if (w != len) { ts_logf(TS_LOG_FAIL, "short write on %s (%zu of %zu)", path, w, len); return 0; }
  return 1;
}

int ts_file_exists(const char *path) {
  FILE *f = fopen(path, "rb");
  if (f) { fclose(f); return 1; }
  return 0;
}

long ts_file_size(const char *path) {
  FILE *f = fopen(path, "rb");
  if (!f) return -1;
  fseek(f, 0, SEEK_END);
  long n = ftell(f);
  fclose(f);
  return n;
}

void ts_join(char *out, size_t cap, const char *a, const char *b) {
  if (!a || !*a) { snprintf(out, cap, "%s", b); return; }
  size_t la = strlen(a);
  char sep = (la && (a[la - 1] == '/' || a[la - 1] == '\\')) ? 0 : TS_SEP;
  if (sep) snprintf(out, cap, "%s%c%s", a, sep, b);
  else snprintf(out, cap, "%s%s", a, b);
}

void ts_lower_inplace(char *s) { for (; *s; ++s) if (*s >= 'A' && *s <= 'Z') *s += 32; }

const char *ts_basename_ext(const char *path) {
  const char *p = strrchr(path, '.');
  return p ? p : "";
}

/* ---------- manifest ---------- */
static FILE *g_mani;
static int g_mani_n;

void ts_manifest_begin(const char *path) {
  g_mani = fopen(path, "w");
  if (!g_mani) { ts_logf(TS_LOG_WARN, "cannot write manifest %s", path); return; }
  fprintf(g_mani, "{\n  \"mod\": \"%s\",\n  \"version\": \"%s\",\n  \"files\": [\n", TS_MARK, TS_VERSION);
  g_mani_n = 0;
}

void ts_manifest_add(const char *path, long bytes) {
  if (!g_mani) return;
  fprintf(g_mani, "%s    { \"path\": \"%s\", \"bytes\": %ld }", g_mani_n++ ? ",\n" : "", path, bytes);
}

void ts_manifest_end(void) {
  if (!g_mani) return;
  fprintf(g_mani, "\n  ]\n}\n");
  fclose(g_mani);
  g_mani = NULL;
  ts_logf(TS_LOG_OK, "manifest: %d files recorded", g_mani_n);
}

/* ---------- directory listing ---------- */
#ifdef _WIN32
#  include <windows.h>
int ts_dir_list(ts_dirlist *out, const char *dir) {
  out->names = NULL; out->n = 0;
  char pat[TS_PATH_MAX];
  ts_join(pat, sizeof pat, dir, "*");
  WIN32_FIND_DATAA fd;
  HANDLE h = FindFirstFileA(pat, &fd);
  if (h == INVALID_HANDLE_VALUE) return 0;
  int cap = 0;
  do {
    if (!strcmp(fd.cFileName, ".") || !strcmp(fd.cFileName, "..")) continue;
    if (out->n == cap) { cap = cap ? cap * 2 : 64; out->names = (char **)realloc(out->names, (size_t)cap * sizeof(char *)); }
    out->names[out->n++] = strdup(fd.cFileName);
  } while (FindNextFileA(h, &fd));
  FindClose(h);
  return 1;
}
#else
#  include <dirent.h>
int ts_dir_list(ts_dirlist *out, const char *dir) {
  out->names = NULL; out->n = 0;
  DIR *d = opendir(dir);
  if (!d) return 0;
  int cap = 0;
  struct dirent *e;
  while ((e = readdir(d))) {
    if (!strcmp(e->d_name, ".") || !strcmp(e->d_name, "..")) continue;
    if (out->n == cap) { cap = cap ? cap * 2 : 64; out->names = (char **)realloc(out->names, (size_t)cap * sizeof(char *)); }
    out->names[out->n++] = strdup(e->d_name);
  }
  closedir(d);
  return 1;
}
#endif

void ts_dir_list_free(ts_dirlist *d) {
  for (int i = 0; i < d->n; i++) free(d->names[i]);
  free(d->names);
  d->names = NULL; d->n = 0;
}
