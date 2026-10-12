#include "ts.h"
#include <ctype.h>

static int ci_eq(const char *a, const char *b) {
  for (; *a && *b; ++a, ++b) if (tolower((unsigned char)*a) != tolower((unsigned char)*b)) return 0;
  return *a == 0 && *b == 0;
}

int ts_ini_parse(ts_ini *ini, const char *text, size_t len) {
  memset(ini, 0, sizeof *ini);
  size_t i = 0;
  const char *pre_start = text;
  ts_ini_sec *cur = NULL;
  while (i < len) {
    size_t ls = i;
    while (i < len && text[i] != '\n') i++;
    size_t le = i; if (i < len) i++;
    char line[1024];
    size_t n = le - ls; if (n >= sizeof line) n = sizeof line - 1;
    memcpy(line, text + ls, n); line[n] = 0;
    char *p = line; while (*p == ' ' || *p == '\t' || *p == '\r') p++;
    if (*p == '[') {
      char name[64] = {0};
      char *e = strchr(p, ']');
      if (e) {
        size_t nl = (size_t)(e - p - 1); if (nl >= sizeof name) nl = sizeof name - 1;
        memcpy(name, p + 1, nl);
        ts_ini_sec *s = (ts_ini_sec *)calloc(1, sizeof *s);
        snprintf(s->name, sizeof s->name, "%s", name);
        if (ini->tail) ini->tail->next = s; else ini->head = s;
        ini->tail = s; cur = s;
        /* anything before the first section is preamble */
        if (!ini->preamble) {
          size_t plen = ls - (size_t)(pre_start - text);
          if (plen) { ini->preamble = (char *)malloc(plen + 1); memcpy(ini->preamble, pre_start, plen); ini->preamble[plen] = 0; ini->preamble_len = plen; }
        }
        continue;
      }
    }
    if (!cur) continue;
    if (cur->body_len + (le - ls) + 2 > cur->body_cap) {
      cur->body_cap = (cur->body_cap ? cur->body_cap * 2 : 8192);
      while (cur->body_len + (le - ls) + 2 > cur->body_cap) cur->body_cap *= 2;
      cur->body = (char *)realloc(cur->body, cur->body_cap);
    }
    memcpy(cur->body + cur->body_len, text + ls, le - ls);
    cur->body_len += le - ls;
    if (le == ls || text[le - 1] != '\n') { cur->body[cur->body_len++] = '\n'; }
    cur->body[cur->body_len] = 0;
  }
  return ini->head != NULL;
}

void ts_ini_free(ts_ini *ini) {
  ts_ini_sec *s = ini->head;
  while (s) { ts_ini_sec *n = s->next; free(s->body); free(s); s = n; }
  free(ini->preamble);
  memset(ini, 0, sizeof *ini);
}

ts_ini_sec *ts_ini_find(ts_ini *ini, const char *section) {
  for (ts_ini_sec *s = ini->head; s; s = s->next) if (ci_eq(s->name, section)) return s;
  return NULL;
}
int ts_ini_has(ts_ini *ini, const char *section) { return ts_ini_find(ini, section) != NULL; }

void ts_ini_append_raw(ts_ini *ini, const char *text, size_t len) {
  if (!ini->tail) { ts_ini_parse(ini, "[Generated]\n", 12); }
  ts_ini_sec *s = ini->tail;
  if (s->body_len + len + 2 > s->body_cap) {
    s->body_cap = (s->body_len + len + 8192) * 2;
    s->body = (char *)realloc(s->body, s->body_cap);
  }
  memcpy(s->body + s->body_len, text, len);
  s->body_len += len;
  s->body[s->body_len] = 0;
}

int ts_ini_set(ts_ini *ini, const char *section, const char *key, const char *value) {
  ts_ini_sec *s = ts_ini_find(ini, section);
  if (!s) return 0;
  size_t klen = strlen(key);
  char *body = s->body;
  size_t i = 0, at_line = (size_t)-1;
  while (i < s->body_len) {
    size_t ls = i;
    while (i < s->body_len && body[i] != '\n') i++;
    if (i < s->body_len) i++;                  /* step over the newline */
    char *p = body + ls;
    while (*p == ' ' || *p == '\t') p++;
    if (*p != ';' && *p != '#' && !strncmp(p, key, klen)) {
      char *q = p + klen;
      while (*q == ' ' || *q == '\t') q++;
      if (*q == '=') { at_line = ls; break; }
    }
  }
  if (at_line == (size_t)-1) {
    /* add the key at the end of the section */
    char add[512];
    int n = snprintf(add, sizeof add, "%s=%s\n", key, value);
    ts_ini_sec tmp = *s;
    if (s->body_len + (size_t)n + 2 > s->body_cap) { s->body_cap = s->body_len + n + 4096; s->body = (char *)realloc(s->body, s->body_cap); }
    memcpy(s->body + s->body_len, add, (size_t)n);
    s->body_len += (size_t)n; s->body[s->body_len] = 0;
    (void)tmp;
    return 1;
  }
  /* replace that line */
  size_t le = at_line; while (le < s->body_len && body[le] != '\n') le++;
  char repl[512];
  int n = snprintf(repl, sizeof repl, "%s=%s", key, value);
  size_t newlen = s->body_len - (le - at_line) + (size_t)n;
  char *nb = (char *)malloc(newlen + 1);
  memcpy(nb, body, at_line);
  memcpy(nb + at_line, repl, (size_t)n);
  memcpy(nb + at_line + n, body + le, s->body_len - le);
  nb[newlen] = 0;
  free(s->body);
  s->body = nb; s->body_len = newlen; s->body_cap = newlen + 1;
  return 1;
}

char *ts_ini_render(ts_ini *ini, size_t *out_len) {
  size_t total = (ini->preamble_len ? ini->preamble_len + 2 : 256);
  for (ts_ini_sec *s = ini->head; s; s = s->next) total += s->body_len + strlen(s->name) + 8;
  char *buf = (char *)malloc(total + 1);
  size_t o = 0;
  if (ini->preamble_len) { memcpy(buf, ini->preamble, ini->preamble_len); o = ini->preamble_len; }
  for (ts_ini_sec *s = ini->head; s; s = s->next) {
    o += (size_t)snprintf(buf + o, total - o + 1, "\n[%s]\n", s->name);
    memcpy(buf + o, s->body, s->body_len); o += s->body_len;
  }
  buf[o] = 0;
  if (out_len) *out_len = o;
  return buf;
}
