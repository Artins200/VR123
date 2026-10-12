#include "ts.h"

/* SHP (TS/RA2/YR sprite container), written as a single frame in the game's own
   "compression 3" scanline RLE-Zero form:
     per scanline: uint16 encoded length, then a byte stream where
       0x00            ends the line (the rest is transparent)
       0x80 | n        n transparent pixels
       n (1..0x7f)     n literal palette indices follow
   Index 0 is transparent in the host game's palettes, so cameos come out with a hole
   behind the gun. */
static void put16(uint8_t *p, uint16_t v) { p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); }

static size_t encode_line(const uint8_t *row, int w, uint8_t *out) {
  size_t o = 2;
  int x = 0;
  while (x < w) {
    if (row[x] == 0) {
      int n = 0;
      while (x + n < w && row[x + n] == 0 && n < 0x7f) n++;
      out[o++] = (uint8_t)(0x80 | n);
      x += n;
    } else {
      int n = 0;
      while (x + n < w && row[x + n] != 0 && n < 0x7f) n++;
      out[o++] = (uint8_t)n;
      memcpy(out + o, row + x, (size_t)n);
      o += (size_t)n;
      x += n;
    }
  }
  out[o++] = 0;
  put16(out, (uint16_t)o);
  return o;
}

int ts_shp_write_cameo(const char *path, const uint8_t *indexed, int w, int h, const uint8_t *rgb_preview) {
  size_t cap = (size_t)w * h * 2 + 256;
  uint8_t *data = (uint8_t *)calloc(cap, 1);
  size_t o = 8 + 32;                       /* file header + one frame header */
  for (int y = 0; y < h; y++) {
    if (o + (size_t)w * 2 + 8 > cap) { cap *= 2; data = (uint8_t *)realloc(data, cap); }
    o += encode_line(indexed + (size_t)y * w, w, data + o);
  }
  put16(data + 0, 0);
  put16(data + 2, (uint16_t)w);
  put16(data + 4, (uint16_t)h);
  put16(data + 6, 1);
  put16(data + 8 + 0, 0);                    /* frame x */
  put16(data + 8 + 2, 0);                    /* frame y */
  put16(data + 8 + 4, (uint16_t)w);
  put16(data + 8 + 6, (uint16_t)h);
  data[8 + 8] = 3;                           /* compression 3 */
  data[8 + 9] = 0; data[8 + 10] = 0; data[8 + 11] = 0;
  if (rgb_preview) { data[8 + 12] = rgb_preview[0]; data[8 + 13] = rgb_preview[1]; data[8 + 14] = rgb_preview[2]; }
  data[8 + 16] = 0; data[8 + 17] = 0; data[8 + 18] = 0; data[8 + 19] = 0;
  uint32_t off = 8 + 32;
  data[8 + 20] = (uint8_t)off; data[8 + 21] = (uint8_t)(off >> 8);
  data[8 + 22] = (uint8_t)(off >> 16); data[8 + 23] = (uint8_t)(off >> 24);
  int ok = ts_write(path, data, o);
  free(data);
  return ok;
}

/* decoder used by the test harness to check the encoder round-trips */
int ts_shp_read_frame0(const uint8_t *data, size_t len, uint8_t *out, int w, int h) {
  if (len < 40) return 0;
  int fw = data[2] | (data[3] << 8), fh = data[4] | (data[5] << 8);
  if (fw != w || fh != h) return 0;
  int comp = data[8 + 8];
  uint32_t off = (uint32_t)(data[8 + 20] | (data[8 + 21] << 8) | (data[8 + 22] << 16) | (data[8 + 23] << 24));
  if (comp != 3) return 0;
  memset(out, 0, (size_t)w * h);
  size_t p = off;
  for (int y = 0; y < h; y++) {
    if (p + 2 > len) return 0;
    uint16_t line_len = (uint16_t)(data[p] | (data[p + 1] << 8));
    if (!line_len) return 0;
    size_t end = p + line_len;
    if (end > len) return 0;
    p += 2;
    int x = 0;
    while (p < end) {
      uint8_t b = data[p++];
      if (b == 0) break;
      if (b & 0x80) { x += (b & 0x7f); }
      else {
        for (int k = 0; k < b && x < w; k++) { if (p >= end) return 0; out[(size_t)y * w + x++] = data[p++]; }
      }
    }
    p = end;
  }
  return 1;
}
