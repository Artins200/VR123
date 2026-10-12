#include "ts.h"

static uint32_t rd32(const uint8_t *p) { return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24); }
static uint16_t rd16(const uint8_t *p) { return (uint16_t)(p[0] | (p[1] << 8)); }
static void wr32(uint8_t *p, uint32_t v) { p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); p[2] = (uint8_t)(v >> 16); p[3] = (uint8_t)(v >> 24); }
static void wr16(uint8_t *p, uint16_t v) { p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); }

int ts_wav_parse(const uint8_t *d, size_t len, ts_wav *out) {
  memset(out, 0, sizeof *out);
  if (len < 44 || memcmp(d, "RIFF", 4) || memcmp(d + 8, "WAVE", 4)) return 0;
  size_t i = 12;
  int found_fmt = 0;
  uint16_t fmt_tag = 0, block_align = 0;
  while (i + 8 <= len) {
    uint32_t sz = rd32(d + i + 4);
    const uint8_t *c = d + i;
    if (!memcmp(c, "fmt ", 4)) {
      fmt_tag = rd16(c + 8);
      out->channels = rd16(c + 10);
      out->rate = (int)rd32(c + 12);
      block_align = rd16(c + 20);
      out->bits = rd16(c + 22);
      found_fmt = 1;
    } else if (!memcmp(c, "data", 4)) {
      if (!found_fmt) return 0;
      if (i + 8 + sz > len) sz = (uint32_t)(len - i - 8);
      out->pcm = (uint8_t *)malloc(sz + 1);
      memcpy(out->pcm, c + 8, sz);
      out->pcm_len = sz;
      break;
    }
    i += 8 + sz + (sz & 1);
  }
  if (!out->pcm || !out->pcm_len) return 0;
  if (fmt_tag != 1) { ts_logf(TS_LOG_WARN, "wav: format tag %u is not PCM, skipping", fmt_tag); ts_wav_free(out); return 0; }
  if (!block_align) block_align = (uint16_t)(out->channels * out->bits / 8);
  if (!out->channels || !out->bits || !out->rate) { ts_wav_free(out); return 0; }
  (void)block_align;
  return 1;
}

/* mixdown to mono and resample to want_rate, in place. Linear interpolation is plenty for
   a 44100 -> 22050 conversion of a gunshot. */
int ts_wav_convert(ts_wav *w, int want_rate) {
  if (w->bits != 16) { ts_logf(TS_LOG_WARN, "wav: %d-bit samples are not supported", w->bits); return 0; }
  size_t frames = w->pcm_len / (size_t)(2 * w->channels);
  int16_t *mono = (int16_t *)malloc(frames * sizeof(int16_t));
  for (size_t f = 0; f < frames; f++) {
    int acc = 0;
    for (int c = 0; c < w->channels; c++) {
      size_t at = (f * (size_t)w->channels + (size_t)c) * 2;
      acc += (int16_t)(w->pcm[at] | (w->pcm[at + 1] << 8));
    }
    acc /= w->channels;
    mono[f] = (int16_t)acc;
  }
  size_t out_frames = (size_t)((double)frames * want_rate / w->rate);
  if (!out_frames) out_frames = 1;
  int16_t *res = (int16_t *)malloc(out_frames * sizeof(int16_t));
  for (size_t o = 0; o < out_frames; o++) {
    double src = (double)o * w->rate / want_rate;
    size_t i0 = (size_t)src;
    double frac = src - (double)i0;
    if (i0 + 1 >= frames) i0 = frames ? frames - 1 : 0;
    size_t i1 = i0 + 1 < frames ? i0 + 1 : i0;
    res[o] = (int16_t)(mono[i0] * (1.0 - frac) + mono[i1] * frac);
  }
  free(mono);
  free(w->pcm);
  w->pcm = (uint8_t *)res;
  w->pcm_len = out_frames * 2;
  w->channels = 1;
  w->rate = want_rate;
  return 1;
}

void ts_wav_free(ts_wav *w) { free(w->pcm); memset(w, 0, sizeof *w); }

/* ---------- bag / idx ---------- */
void ts_bag_init(ts_bag *b) { memset(b, 0, sizeof *b); }

static void bag_grow(ts_bag *b, size_t extra) {
  if (b->len + extra > b->cap) {
    b->cap = (b->len + extra + 65536) * 2;
    b->data = (uint8_t *)realloc(b->data, b->cap);
  }
}

int ts_bag_add(ts_bag *b, const char *name, const uint8_t *wav, size_t len, int rate) {
  /* RA2/YR keeps the whole RIFF WAV inside the bag and describes it in the idx */
  if (b->n == b->ent_cap) { b->ent_cap = b->ent_cap ? b->ent_cap * 2 : 32; b->ents = (ts_bag_ent *)realloc(b->ents, (size_t)b->ent_cap * sizeof(ts_bag_ent)); }
  ts_bag_ent *e = &b->ents[b->n++];
  memset(e, 0, sizeof *e);
  snprintf(e->name, sizeof e->name, "%s", name);
  e->offset = (uint32_t)b->len;
  e->size = (uint32_t)len;
  e->rate = (uint32_t)rate;
  e->flags = 0;
  e->chunk = (uint32_t)len;
  bag_grow(b, len);
  memcpy(b->data + b->len, wav, len);
  b->len += len;
  return 1;
}

int ts_bag_write(ts_bag *b, const char *bag_path, const char *idx_path) {
  if (!b->n) return 0;
  if (!ts_write(bag_path, b->data, b->len)) return 0;
  size_t isz = 12 + (size_t)b->n * 36;
  uint8_t *idx = (uint8_t *)calloc(isz, 1);
  wr32(idx, 0x47414241u);          /* "ABAG" */
  wr32(idx + 4, 0);                /* version / unknown */
  wr32(idx + 8, (uint32_t)b->n);
  for (int i = 0; i < b->n; i++) {
    uint8_t *e = idx + 12 + (size_t)i * 36;
    memcpy(e, b->ents[i].name, strlen(b->ents[i].name) < 16 ? strlen(b->ents[i].name) : 15);
    wr32(e + 16, b->ents[i].offset);
    wr32(e + 20, b->ents[i].size);
    wr32(e + 24, b->ents[i].rate);
    wr32(e + 28, b->ents[i].flags);
    wr32(e + 32, b->ents[i].chunk);
  }
  int ok = ts_write(idx_path, idx, isz);
  free(idx);
  return ok;
}

void ts_bag_free(ts_bag *b) { free(b->data); free(b->ents); memset(b, 0, sizeof *b); }
