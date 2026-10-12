#include "ts.h"

/* Valve Texture Format 7.x. Only the high-resolution image of the first frame is decoded,
   which is all a sidebar cameo needs. */
enum { VTF_RGBA8888 = 11, VTF_BGRA8888 = 12, VTF_RGB888 = 8, VTF_BGR888 = 9,
       VTF_RGB565 = 4, VTF_DXT1 = 1, VTF_DXT3 = 2, VTF_DXT5 = 5, VTF_BGRX8888 = 13 };

static uint32_t rd32(const uint8_t *p) { return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24); }
static uint16_t rd16(const uint8_t *p) { return (uint16_t)(p[0] | (p[1] << 8)); }

static size_t block_size(int fmt, int w, int h) {
  if (w < 1) w = 1; if (h < 1) h = 1;
  switch (fmt) {
    case VTF_DXT1: return ((size_t)((w + 3) / 4)) * ((size_t)((h + 3) / 4)) * 8;
    case VTF_DXT3: case VTF_DXT5: return ((size_t)((w + 3) / 4)) * ((size_t)((h + 3) / 4)) * 16;
    case VTF_RGBA8888: case VTF_BGRA8888: case VTF_BGRX8888: return (size_t)w * h * 4;
    case VTF_RGB888: case VTF_BGR888: return (size_t)w * h * 3;
    case VTF_RGB565: return (size_t)w * h * 2;
    default: return 0;
  }
}

static void decode_dxt_block(const uint8_t *src, uint8_t *dst, int dw, int dh, int bx, int by, int mode) {
  /* mode 1 = DXT1 (BC1), 3 = DXT5 alpha, 2 = DXT3 explicit alpha */
  uint16_t c0 = rd16(src), c1 = rd16(src + 2);
  uint32_t bits = rd32(src + 4);
  uint8_t pal[4][3];
  int opaque = c0 > c1;
  #define UNPACK(c, r, g, b) r = (((c) >> 11) & 31) * 255 / 31; g = (((c) >> 5) & 63) * 255 / 63; b = ((c) & 31) * 255 / 31
  UNPACK(c0, pal[0][0], pal[0][1], pal[0][2]);
  UNPACK(c1, pal[1][0], pal[1][1], pal[1][2]);
  if (mode == 1) {
    if (opaque) {
      for (int k = 0; k < 3; k++) { pal[2][k] = (uint8_t)((2 * pal[0][k] + pal[1][k]) / 3); pal[3][k] = (uint8_t)((pal[0][k] + 2 * pal[1][k]) / 3); }
    } else {
      for (int k = 0; k < 3; k++) { pal[2][k] = (uint8_t)((pal[0][k] + pal[1][k]) / 2); pal[3][k] = 0; }
    }
  } else {
    for (int k = 0; k < 3; k++) { pal[2][k] = (uint8_t)((2 * pal[0][k] + pal[1][k]) / 3); pal[3][k] = (uint8_t)((pal[0][k] + 2 * pal[1][k]) / 3); }
  }
  #undef UNPACK
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) {
      int px = bx * 4 + x, py = by * 4 + y;
      if (px >= dw || py >= dh) continue;
      int idx = (int)((bits >> (2 * (y * 4 + x))) & 3);
      uint8_t a = 255;
      if (mode == 1 && !opaque && idx == 3) a = 0;
      uint8_t *o = dst + ((size_t)py * dw + px) * 4;
      o[0] = pal[idx][0]; o[1] = pal[idx][1]; o[2] = pal[idx][2]; o[3] = a;
    }
  }
}

static void decode_dxt(const uint8_t *src, size_t src_len, uint8_t *dst, int w, int h, int fmt) {
  int bw = (w + 3) / 4, bh = (h + 3) / 4;
  size_t bsz = (fmt == VTF_DXT1) ? 8 : 16;
  for (int by = 0; by < bh; by++) {
    for (int bx = 0; bx < bw; bx++) {
      size_t at = ((size_t)by * bw + bx) * bsz;
      if (at + bsz > src_len) return;
      if (fmt == VTF_DXT1) decode_dxt_block(src + at, dst, w, h, bx, by, 1);
      else {
        /* alpha plane first (8 bytes), then colour block */
        uint8_t ab[16];
        memcpy(ab, src + at, 8);
        uint16_t c0 = ab[0], c1 = ab[1];
        uint8_t a[8]; a[0] = ab[0]; a[1] = ab[1];
        if (fmt == VTF_DXT5) {
          if (c0 > c1) { for (int k = 1; k < 7; k++) a[k + 1] = (uint8_t)(((8 - k) * c0 + (k - 1) * c1) / 7); }
          else { for (int k = 1; k < 5; k++) a[k + 1] = (uint8_t)(((6 - k) * c0 + (k - 1) * c1) / 5); a[6] = 0; a[7] = 255; }
          uint64_t idx = 0;
          for (int k = 0; k < 6; k++) idx |= ((uint64_t)ab[2 + k]) << (8 * k);
          decode_dxt_block(src + at + 8, dst, w, h, bx, by, 3);
          for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) {
            int px = bx * 4 + x, py = by * 4 + y;
            if (px >= w || py >= h) continue;
            int ii = (int)((idx >> (3 * (y * 4 + x))) & 7);
            dst[((size_t)py * w + px) * 4 + 3] = a[ii];
          }
        } else {
          decode_dxt_block(src + at + 8, dst, w, h, bx, by, 2);
          for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) {
            int px = bx * 4 + x, py = by * 4 + y;
            if (px >= w || py >= h) continue;
            uint8_t nib = ab[2 + (y * 4 + x) / 2];
            int v = ((y * 4 + x) & 1) ? (nib >> 4) : (nib & 15);
            dst[((size_t)py * w + px) * 4 + 3] = (uint8_t)(v * 17);
          }
        }
      }
    }
  }
}

int ts_vtf_decode(const uint8_t *d, size_t len, ts_rgba *out) {
  memset(out, 0, sizeof *out);
  if (len < 80 || memcmp(d, "VTF", 3)) { ts_logf(TS_LOG_WARN, "vtf: not a VTF file"); return 0; }
  uint32_t header_size = rd32(d + 12);
  int w = rd16(d + 16), h = rd16(d + 18);
  uint8_t low_w = d[55], low_h = d[56];
  int fmt = d[52];
  int mip = d[53];
  if (header_size < 16 || header_size > len || w <= 0 || h <= 0) { ts_logf(TS_LOG_WARN, "vtf: bad header"); return 0; }
  if (mip < 1) mip = 1;
  size_t off = header_size;
  if (low_w && low_h) off += block_size(VTF_DXT1, low_w, low_h);
  for (int m = mip - 1; m >= 1; m--) off += block_size(fmt, w >> m, h >> m);
  size_t need = block_size(fmt, w, h);
  if (!need) { ts_logf(TS_LOG_WARN, "vtf: unsupported image format %d", fmt); return 0; }
  if (off + need > len) { ts_logf(TS_LOG_WARN, "vtf: image data runs past end of file (need %zu at %zu of %zu)", need, off, len); return 0; }
  const uint8_t *img = d + off;
  out->w = w; out->h = h;
  out->px = (uint8_t *)calloc((size_t)w * h * 4, 1);
  switch (fmt) {
    case VTF_DXT1: case VTF_DXT3: case VTF_DXT5:
      decode_dxt(img, need, out->px, w, h, fmt);
      break;
    case VTF_BGRA8888: case VTF_BGRX8888: case VTF_RGBA8888: {
      int swap = (fmt == VTF_RGBA8888);
      for (int i = 0; i < w * h; i++) {
        out->px[i * 4 + 0] = img[i * 4 + (swap ? 0 : 2)];
        out->px[i * 4 + 1] = img[i * 4 + 1];
        out->px[i * 4 + 2] = img[i * 4 + (swap ? 2 : 0)];
        out->px[i * 4 + 3] = img[i * 4 + 3];
      }
      break;
    }
    case VTF_RGB888: case VTF_BGR888: {
      int swap = (fmt == VTF_BGR888);
      for (int i = 0; i < w * h; i++) {
        out->px[i * 4 + 0] = img[i * 3 + (swap ? 2 : 0)];
        out->px[i * 4 + 1] = img[i * 3 + 1];
        out->px[i * 4 + 2] = img[i * 3 + (swap ? 0 : 2)];
        out->px[i * 4 + 3] = 255;
      }
      break;
    }
    case VTF_RGB565:
      for (int i = 0; i < w * h; i++) {
        uint16_t v = rd16(img + i * 2);
        out->px[i * 4 + 0] = (uint8_t)(((v >> 11) & 31) * 255 / 31);
        out->px[i * 4 + 1] = (uint8_t)(((v >> 5) & 63) * 255 / 63);
        out->px[i * 4 + 2] = (uint8_t)((v & 31) * 255 / 31);
        out->px[i * 4 + 3] = 255;
      }
      break;
    default:
      free(out->px); out->px = NULL;
      return 0;
  }
  return 1;
}

void ts_rgba_free(ts_rgba *im) { free(im->px); memset(im, 0, sizeof *im); }

void ts_rgba_resize(const ts_rgba *src, ts_rgba *dst, int w, int h) {
  dst->w = w; dst->h = h;
  dst->px = (uint8_t *)calloc((size_t)w * h * 4, 1);
  for (int y = 0; y < h; y++) {
    int sy = (int)((long)y * src->h / h);
    if (sy >= src->h) sy = src->h - 1;
    for (int x = 0; x < w; x++) {
      int sx = (int)((long)x * src->w / w);
      if (sx >= src->w) sx = src->w - 1;
      memcpy(dst->px + ((size_t)y * w + x) * 4, src->px + ((size_t)sy * src->w + sx) * 4, 4);
    }
  }
}

int ts_pal_load(ts_pal *p, const uint8_t *data, size_t len) {
  if (len < 768) return 0;
  /* Westwood VGA palettes store 0..63, scaled to 0..255 by the game */
  for (int i = 0; i < 256; i++) {
    int r = data[i * 3 + 0], g = data[i * 3 + 1], b = data[i * 3 + 2];
    p->rgb[i][0] = (uint8_t)(r <= 63 ? r * 255 / 63 : r);
    p->rgb[i][1] = (uint8_t)(g <= 63 ? g * 255 / 63 : g);
    p->rgb[i][2] = (uint8_t)(b <= 63 ? b * 255 / 63 : b);
  }
  p->n = 256;
  return 1;
}

int ts_pal_nearest(const ts_pal *p, int r, int g, int b) {
  int best = 1, bd = 0x7fffffff;
  for (int i = 1; i < p->n; i++) {          /* index 0 is transparent, never used for art */
    int dr = p->rgb[i][0] - r, dg = p->rgb[i][1] - g, db = p->rgb[i][2] - b;
    int d = dr * dr * 3 + dg * dg * 4 + db * db * 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
