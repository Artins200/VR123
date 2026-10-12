#include "ts.h"
#include <ctype.h>

static void put(ts_kvlist *l, const char *k, const char *v) {
  for (int i = 0; i < l->n; i++) if (!strcmp(l->items[i].key, k)) { snprintf(l->items[i].val, sizeof l->items[i].val, "%s", v); return; }
  if (l->n == l->cap) { l->cap = l->cap ? l->cap * 2 : 64; l->items = (ts_kv *)realloc(l->items, (size_t)l->cap * sizeof(ts_kv)); }
  snprintf(l->items[l->n].key, sizeof l->items[l->n].key, "%s", k);
  snprintf(l->items[l->n].val, sizeof l->items[l->n].val, "%s", v);
  l->n++;
}

/* Source KeyValues, flattened. Line and block comments are stripped, nesting is ignored,
   the last value for a key wins. That is all a weapon_*.txt script needs. */
int ts_kv_parse(ts_kvlist *out, const char *text, size_t len) {
  memset(out, 0, sizeof *out);
  size_t i = 0;
  char key[256], val[256];
  while (i < len) {
    while (i < len && isspace((unsigned char)text[i])) i++;
    if (i >= len) break;
    if (text[i] == '/' && i + 1 < len && text[i + 1] == '/') { while (i < len && text[i] != '\n') i++; continue; }
    if (text[i] == '/' && i + 1 < len && text[i + 1] == '*') { i += 2; while (i + 1 < len && !(text[i] == '*' && text[i + 1] == '/')) i++; i += 2; continue; }
    if (text[i] == '{' || text[i] == '}') { i++; continue; }
    /* read a token */
    size_t t = 0;
    if (text[i] == '"') {
      i++;
      while (i < len && text[i] != '"' && t < sizeof key - 1) key[t++] = text[i++];
      if (i < len) i++;
    } else {
      while (i < len && !isspace((unsigned char)text[i]) && text[i] != '{' && text[i] != '}' && text[i] != '"' && t < sizeof key - 1) key[t++] = text[i++];
    }
    key[t] = 0;
    if (!t) continue;
    size_t j = i;
    while (j < len && (isspace((unsigned char)text[j]))) j++;
    if (j >= len || text[j] == '{' || text[j] == '}' || (text[j] == '/' && j + 1 < len && (text[j + 1] == '/' || text[j + 1] == '*'))) { i = j; continue; }
    /* value token */
    i = j; t = 0;
    if (text[i] == '"') {
      i++;
      while (i < len && text[i] != '"' && t < sizeof val - 1) val[t++] = text[i++];
      if (i < len) i++;
    } else {
      while (i < len && !isspace((unsigned char)text[i]) && text[i] != '{' && text[i] != '}' && t < sizeof val - 1) val[t++] = text[i++];
    }
    val[t] = 0;
    put(out, key, val);
  }
  return out->n;
}

const char *ts_kv_get(const ts_kvlist *l, const char *key) {
  for (int i = 0; i < l->n; i++) if (!strcmp(l->items[i].key, key)) return l->items[i].val;
  return NULL;
}

double ts_kv_num(const ts_kvlist *l, const char *key, double fallback) {
  const char *v = ts_kv_get(l, key);
  if (!v || !*v) return fallback;
  char *end = NULL;
  double d = strtod(v, &end);
  if (end == v) return fallback;
  return d;
}

void ts_kv_free(ts_kvlist *l) { free(l->items); memset(l, 0, sizeof *l); }
