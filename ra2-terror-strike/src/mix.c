#include "ts.h"

static uint32_t rd32(const uint8_t *p) { return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24); }
static uint16_t rd16(const uint8_t *p) { return (uint16_t)(p[0] | (p[1] << 8)); }

int ts_mix_open(ts_mix *m, const char *path) {
  memset(m, 0, sizeof *m);
  snprintf(m->path, sizeof m->path, "%s", path);
  size_t len = 0;
  uint8_t *data = (uint8_t *)ts_slurp(path, &len);
  if (!data || len < 12) { free(data); ts_logf(TS_LOG_FAIL, "mix: cannot read %s", path); return 0; }
  m->data = data; m->len = len;

  /* TS/RA2 style ("v2"): 4-byte flags, then u16 count, u32 body size.
     TD/RA style ("v1"): u16 count, u32 body size at offset 0.
     Decide by which reading makes the arithmetic close. */
  int try_v[2] = { 2, 1 };
  for (int t = 0; t < 2; t++) {
    int v = try_v[t];
    uint32_t flags = 0, base = 0, count, body;
    if (v == 2) { flags = rd32(data); base = 4; }
    if (base + 6 > len) continue;
    count = rd16(data + base);
    body = rd32(data + base + 2);
    if (count == 0 || count > 20000) continue;
    uint32_t hdr = base + 6;
    uint32_t idx = hdr + count * 12u;
    if (idx > len) continue;
    long expected = (long)idx + (long)body;
    long slack = (long)len - expected;
    if (slack < 0 || slack > 64) continue;               /* 48-byte checksum tailer is normal */
    m->version = v; m->flags = flags; m->body_start = idx; m->body_size = body;
    m->n_files = (int)count;
    m->files = (ts_mix_file *)calloc(count, sizeof(ts_mix_file));
    for (uint32_t i = 0; i < count; i++) {
      const uint8_t *e = data + hdr + i * 12;
      m->files[i].id = rd32(e);
      m->files[i].offset = rd32(e + 4);
      m->files[i].size = rd32(e + 8);
    }
    ts_logf(TS_LOG_OK, "mix: %s -> v%d, %u files, body %u bytes", path, v, count, body);
    return 1;
  }
  ts_logf(TS_LOG_FAIL, "mix: %s has no readable index (encrypted header?)", path);
  free(data); m->data = NULL;
  return 0;
}

void ts_mix_close(ts_mix *m) { free(m->data); free(m->files); memset(m, 0, sizeof *m); }

int ts_mix_open_nested(ts_mix *m, const ts_mix *outer, int index) {
  if (index < 0 || index >= outer->n_files) return 0;
  uint32_t off = outer->body_start + outer->files[index].offset;
  uint32_t sz = outer->files[index].size;
  if (off + sz > outer->len) return 0;
  memset(m, 0, sizeof *m);
  snprintf(m->path, sizeof m->path, "%s!#%d", outer->path, index);
  m->data = (uint8_t *)malloc(sz + 1);
  memcpy(m->data, outer->data + off, sz);
  m->data[sz] = 0;
  m->len = sz;
  /* reuse the header detection by pointing at a temp file-less parse */
  uint8_t *data = m->data; size_t len = m->len;
  int try_v[2] = { 2, 1 };
  for (int t = 0; t < 2; t++) {
    int v = try_v[t];
    uint32_t base = (v == 2) ? 4 : 0;
    if (base + 6 > len) continue;
    uint32_t count = rd16(data + base), body = rd32(data + base + 2);
    if (!count || count > 20000) continue;
    uint32_t idx = base + 6 + count * 12u;
    if (idx > len) continue;
    long slack = (long)len - (long)idx - (long)body;
    if (slack < 0 || slack > 64) continue;
    m->version = v; m->body_start = idx; m->body_size = body; m->n_files = (int)count;
    m->files = (ts_mix_file *)calloc(count, sizeof(ts_mix_file));
    for (uint32_t i = 0; i < count; i++) {
      const uint8_t *e = data + base + 6 + i * 12;
      m->files[i].id = rd32(e); m->files[i].offset = rd32(e + 4); m->files[i].size = rd32(e + 8);
    }
    ts_logf(TS_LOG_OK, "mix: nested %s -> v%d, %u files", m->path, v, count);
    return 1;
  }
  ts_logf(TS_LOG_FAIL, "mix: nested %s has no readable index", m->path);
  free(m->data); memset(m, 0, sizeof *m);
  return 0;
}

int ts_mix_find_by_marker(ts_mix *m, const char *marker, size_t marker_len, uint8_t **out, size_t *out_len, int *out_index) {
  for (int i = 0; i < m->n_files; i++) {
    uint32_t sz = m->files[i].size;
    if (sz < marker_len || sz > 4u * 1024u * 1024u) continue;
    uint32_t off = m->body_start + m->files[i].offset;
    if (off + sz > m->len) continue;
    const uint8_t *p = m->data + off;
    /* quick text sniff: mostly printable */
    uint32_t window = sz < 256 ? sz : 256;
    uint32_t printable = 0;
    for (uint32_t k = 0; k < window; k++) if (p[k] >= 9 || (p[k] >= 32 && p[k] < 127)) printable++;
    if (printable * 100 < window * 80) continue;   /* not a text file */
    for (uint32_t k = 0; k + marker_len <= sz; k++) {
      if (!memcmp(p + k, marker, marker_len)) {
        if (out) { *out = (uint8_t *)malloc(sz + 1); memcpy(*out, p, sz); (*out)[sz] = 0; }
        if (out_len) *out_len = sz;
        if (out_index) *out_index = i;
        return 1;
      }
    }
  }
  return 0;
}
