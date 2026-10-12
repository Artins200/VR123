/* Unit tests for the format code. Every function here is the same code the shipped
   Windows build runs; it is compiled for Linux with gcc so it can actually be executed. */
#include "../src/ts.h"

static int g_pass, g_fail;
#define CHECK(cond, ...) do { if (cond) { g_pass++; } else { g_fail++; printf("  FAIL: "); printf(__VA_ARGS__); printf("\n"); } } while (0)

static void wr16(uint8_t *p, uint16_t v) { p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); }
static void wr32(uint8_t *p, uint32_t v) { p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); p[2] = (uint8_t)(v >> 16); p[3] = (uint8_t)(v >> 24); }

/* ---------------- ini ---------------- */
static void test_ini(void) {
  const char *text =
    "; comment\n\n"
    "[General]\nName=test\nCrateMoney=2000 ; trailing\n\n"
    "[InfantryTypes]\n1=E1\n2=E2\n\n"
    "[E1]\nPrimary=M60\nCost=200\n";
  ts_ini ini;
  CHECK(ts_ini_parse(&ini, text, strlen(text)), "ini did not parse");
  CHECK(ts_ini_has(&ini, "general"), "ini section lookup is case-insensitive");
  char v[64];
  CHECK(ts_ini_value(&ini, "General", "CrateMoney", v, sizeof v) && !strcmp(v, "2000"), "CrateMoney read as '%s'", v);
  CHECK(ts_ini_value(&ini, "E1", "Primary", v, sizeof v) && !strcmp(v, "M60"), "E1 Primary read as '%s'", v);
  int idx = ts_ini_list_add(&ini, "InfantryTypes", "TSCTA");
  CHECK(idx == 3, "list_add returned %d, expected 3", idx);
  CHECK(ts_ini_set(&ini, "General", "CrateMoney", "3000"), "set failed");
  CHECK(ts_ini_value(&ini, "General", "CrateMoney", v, sizeof v) && !strcmp(v, "3000"), "after set CrateMoney is '%s'", v);
  size_t len = 0;
  char *out = ts_ini_render(&ini, &len);
  ts_ini again;
  CHECK(ts_ini_parse(&again, out, len), "rendered ini does not re-parse");
  CHECK(ts_ini_value(&again, "E1", "Cost", v, sizeof v) && !strcmp(v, "200"), "E1 Cost lost in round trip: '%s'", v);
  CHECK(strstr(out, "3=TSCTA") != NULL, "new list entry missing from rendered ini");
  CHECK(strstr(out, "[General]") != NULL, "[General] lost");
  ts_ini_free(&again);
  free(out);
  ts_ini_free(&ini);
}

/* ---------------- kv ---------------- */
static void test_kv(void) {
  const char *txt =
    "WeaponData\n{\n"
    "  // weapon cost\n"
    "  \"MaxPlayerSpeed\" \"221\"\n"
    "  \"Damage\" \"36\"\n"
    "  \"ClipSize\" 30\n"
    "  \"CycleTime\" \"0.10\"\n"
    "  \"Range\" \"8192\"\n"
    "  /* block comment\n     spanning lines */\n"
    "  \"PrimaryClipSize\" \"30\"\n"
    "}\n";
  ts_kvlist kv;
  int n = ts_kv_parse(&kv, txt, strlen(txt));
  CHECK(n >= 5, "kv parsed %d keys, expected at least 5", n);
  CHECK(ts_kv_num(&kv, "Damage", 0) == 36, "Damage = %g", ts_kv_num(&kv, "Damage", 0));
  CHECK(ts_kv_num(&kv, "ClipSize", 0) == 30, "ClipSize = %g", ts_kv_num(&kv, "ClipSize", 0));
  CHECK(ts_kv_num(&kv, "CycleTime", -1) > 0.09 && ts_kv_num(&kv, "CycleTime", -1) < 0.11, "CycleTime = %g", ts_kv_num(&kv, "CycleTime", -1));
  CHECK(ts_kv_num(&kv, "Range", 0) == 8192, "Range = %g", ts_kv_num(&kv, "Range", 0));
  CHECK(ts_kv_get(&kv, "NoSuchKey") == NULL, "absent key returned a value");
  CHECK(ts_kv_num(&kv, "NoSuchKey", 7) == 7, "absent key did not use the fallback");
  ts_kv_free(&kv);
}

/* ---------------- mix ---------------- */
static uint8_t *make_mix(const char *fname, const char *body, size_t blen, int v2, size_t *out_len) {
  (void)fname;
  uint32_t bsz = (uint32_t)blen;
  size_t hdr = v2 ? 10 : 6;
  size_t total = hdr + 12 + bsz;
  uint8_t *m = (uint8_t *)calloc(total, 1);
  size_t o = 0;
  if (v2) { wr32(m, 0); o = 4; }
  wr16(m + o, 1);
  wr32(m + o + 2, bsz);
  o = hdr;
  wr32(m + o, 0x12345678);
  wr32(m + o + 4, 0);
  wr32(m + o + 8, bsz);
  memcpy(m + hdr + 12, body, bsz);
  *out_len = total;
  return m;
}

static void test_mix(void) {
  size_t n = 0;
  uint8_t *m = make_mix("rulesmd.ini", "[General]\nName=x\n[InfantryTypes]\n1=E1\n", strlen("[General]\nName=x\n[InfantryTypes]\n1=E1\n"), 1, &n);
  CHECK(ts_write("/tmp/ts_test_a.mix", m, n), "cannot write mix fixture");
  free(m);
  ts_mix mx;
  CHECK(ts_mix_open(&mx, "/tmp/ts_test_a.mix"), "mix v2 did not open");
  CHECK(mx.n_files == 1, "mix has %d files", mx.n_files);
  uint8_t *out = NULL; size_t olen = 0; int idx = -1;
  CHECK(ts_mix_find_by_marker(&mx, "[InfantryTypes]", 15, &out, &olen, &idx), "marker not found in mix");
  CHECK(out && strstr((char *)out, "1=E1"), "mix content wrong");
  free(out);
  /* nested */
  size_t inner_len = 0;
  uint8_t *inner = make_mix("rulesmd.ini", "[InfantryTypes]\n1=E1\n[Warheads]\n", strlen("[InfantryTypes]\n1=E1\n[Warheads]\n"), 1, &inner_len);
  char *as_str = (char *)inner;
  size_t outer_len = 0;
  uint8_t *outer = make_mix("genericmd.mix", as_str, inner_len, 1, &outer_len);
  CHECK(ts_write("/tmp/ts_test_outer.mix", outer, outer_len), "cannot write outer mix");
  free(inner); free(outer);
  ts_mix om;
  CHECK(ts_mix_open(&om, "/tmp/ts_test_outer.mix"), "outer mix did not open");
  ts_mix im;
  CHECK(ts_mix_open_nested(&im, &om, 0), "nested mix did not open");
  out = NULL;
  CHECK(ts_mix_find_by_marker(&im, "[Warheads]", 10, &out, &olen, &idx), "marker not found in nested mix");
  free(out);
  ts_mix_close(&im);
  ts_mix_close(&om);
  ts_mix_close(&mx);
}

/* ---------------- vpk ---------------- */
static void test_vpk(void) {
  /* one entry: scripts/weapon_ak47.txt held in the dir file itself (archive 0x7fff) */
  const char *payload = "WeaponData\n{\n\"Damage\" \"36\"\n\"ClipSize\" \"30\"\n\"CycleTime\" \"0.1\"\n\"Range\" \"8192\"\n}\n";
  size_t plen = strlen(payload);
  const char *ext = "txt", *dir = "scripts", *name = "weapon_ak47";
  size_t tree = (strlen(ext) + 1) + (strlen(dir) + 1) + (strlen(name) + 1) + 18 + 1 + 1 + 1;
  size_t total = 12 + tree + plen;
  uint8_t *v = (uint8_t *)calloc(total, 1);
  wr32(v, 0x55AA1234u);
  wr32(v + 4, 1);
  wr32(v + 8, (uint32_t)tree);
  size_t o = 12;
  memcpy(v + o, ext, strlen(ext) + 1); o += strlen(ext) + 1;
  memcpy(v + o, dir, strlen(dir) + 1); o += strlen(dir) + 1;
  memcpy(v + o, name, strlen(name) + 1); o += strlen(name) + 1;
  wr32(v + o, 0);                 /* crc */
  wr16(v + o + 4, 0);             /* preload */
  wr16(v + o + 6, 0x7fff);        /* in the dir file */
  wr32(v + o + 8, 0);             /* offset after the tree */
  wr32(v + o + 12, (uint32_t)plen);
  wr16(v + o + 16, 0xffff);
  o += 18;
  v[o++] = 0; v[o++] = 0; v[o++] = 0;
  memcpy(v + o, payload, plen); o += plen;
  CHECK(o == total, "vpk fixture size %zu != %zu", o, total);
  CHECK(ts_write("/tmp/ts_test_dir.vpk", v, total), "cannot write vpk fixture");
  free(v);

  ts_vpk vp;
  CHECK(ts_vpk_open(&vp, "/tmp/ts_test_dir.vpk"), "vpk did not open");
  const ts_vpk_entry *e = ts_vpk_find(&vp, "weapon_ak47");
  CHECK(e != NULL, "entry not found");
  if (e) {
    char p[256]; ts_vpk_path(e, p, sizeof p);
    CHECK(!strcmp(p, "scripts/weapon_ak47.txt"), "path is '%s'", p);
    uint8_t *d = NULL; size_t l = 0;
    CHECK(ts_vpk_read(&vp, e, &d, &l) && l == plen, "read gave %zu bytes", l);
    if (d) {
      ts_kvlist kv;
      ts_kv_parse(&kv, (char *)d, l);
      CHECK(ts_kv_num(&kv, "Damage", 0) == 36, "damage from vpk entry = %g", ts_kv_num(&kv, "Damage", 0));
      ts_kv_free(&kv);
      free(d);
    }
  }
  ts_vpk_close(&vp);
}

/* ---------------- vtf ---------------- */
static void test_vtf(void) {
  int w = 4, h = 4;
  size_t total = 80 + (size_t)w * h * 4;
  uint8_t *v = (uint8_t *)calloc(total, 1);
  memcpy(v, "VTF", 3);
  wr32(v + 4, 7); wr32(v + 8 - 4 + 4, 2);      /* version[0]=7, version[1]=2 */
  wr32(v + 4, 7); wr32(v + 8, 2);
  wr32(v + 12, 80);                            /* headerSize */
  wr16(v + 16, (uint16_t)w); wr16(v + 18, (uint16_t)h);
  v[52] = 12;                                  /* BGRA8888 */
  v[53] = 1;                                   /* mipmapCount */
  v[55] = 0; v[56] = 0;                        /* no thumbnail */
  for (int i = 0; i < w * h; i++) {
    v[80 + i * 4 + 0] = 200;   /* B */
    v[80 + i * 4 + 1] = 100;   /* G */
    v[80 + i * 4 + 2] = 50;    /* R */
    v[80 + i * 4 + 3] = 255;   /* A */
  }
  ts_rgba img;
  CHECK(ts_vtf_decode(v, total, &img), "vtf did not decode");
  if (img.px) {
    CHECK(img.w == w && img.h == h, "vtf size %dx%d", img.w, img.h);
    CHECK(img.px[0] == 50 && img.px[1] == 100 && img.px[2] == 200, "bgra->rgb swap wrong: %d,%d,%d", img.px[0], img.px[1], img.px[2]);
    ts_rgba small;
    ts_rgba_resize(&img, &small, 2, 2);
    CHECK(small.w == 2 && small.h == 2, "resize size %dx%d", small.w, small.h);
    CHECK(small.px[0] == 50, "resize lost colour: %d", small.px[0]);
    ts_rgba_free(&small);
    ts_rgba_free(&img);
  }
  free(v);
}

/* ---------------- palette + shp ---------------- */
static void test_shp(void) {
  ts_pal pal;
  uint8_t paldata[768];
  for (int i = 0; i < 256; i++) { paldata[i * 3] = (uint8_t)i / 4; paldata[i * 3 + 1] = (uint8_t)(i / 4); paldata[i * 3 + 2] = (uint8_t)(i / 4); }
  CHECK(ts_pal_load(&pal, paldata, 768), "palette did not load");
  int idx = ts_pal_nearest(&pal, 255, 255, 255);
  CHECK(idx > 0, "nearest for white is %d", idx);
  CHECK(pal.rgb[idx][0] > 200, "nearest for white is dark: %d", pal.rgb[idx][0]);

  int w = 8, h = 6;
  uint8_t *art = (uint8_t *)calloc((size_t)w * h, 1);
  for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) if (x > 1 && x < 6 && y > 0 && y < 5) art[y * w + x] = (uint8_t)(3 + x + y);
  CHECK(ts_shp_write_cameo("/tmp/ts_test_cameo.shp", art, w, h, NULL), "shp write failed");
  size_t len = 0;
  char *data = ts_slurp("/tmp/ts_test_cameo.shp", &len);
  CHECK(data != NULL, "cannot read the shp back");
  if (data) {
    uint8_t *back = (uint8_t *)calloc((size_t)w * h, 1);
    CHECK(ts_shp_read_frame0((uint8_t *)data, len, back, w, h), "shp frame did not decode");
    int same = 1;
    for (int i = 0; i < w * h; i++) if (art[i] != back[i]) same = 0;
    CHECK(same, "shp round trip changed pixels");
    free(back);
    free(data);
  }
  free(art);
}

/* ---------------- wav + bag ---------------- */
static void test_audio(void) {
  int rate = 44100, frames = 441;
  size_t datalen = (size_t)frames * 2 * 2;      /* stereo 16-bit */
  size_t total = 44 + datalen;
  uint8_t *w = (uint8_t *)calloc(total, 1);
  memcpy(w, "RIFF", 4); wr32(w + 4, (uint32_t)(total - 8)); memcpy(w + 8, "WAVE", 4);
  memcpy(w + 12, "fmt ", 4); wr32(w + 16, 16);
  wr16(w + 20, 1); wr16(w + 22, 2); wr32(w + 24, (uint32_t)rate);
  wr32(w + 28, (uint32_t)(rate * 4)); wr16(w + 32, 4); wr16(w + 34, 16);
  memcpy(w + 36, "data", 4); wr32(w + 40, (uint32_t)datalen);
  for (int i = 0; i < frames; i++) {
    int16_t s = (int16_t)(i * 10);
    wr16(w + 44 + i * 4 + 0, (uint16_t)s);
    wr16(w + 44 + i * 4 + 2, (uint16_t)s);
  }
  ts_wav wav;
  CHECK(ts_wav_parse(w, total, &wav), "wav did not parse");
  CHECK(wav.rate == rate && wav.channels == 2 && wav.bits == 16, "wav header %d/%d/%d", wav.rate, wav.channels, wav.bits);
  CHECK(ts_wav_convert(&wav, 22050), "wav convert failed");
  CHECK(wav.rate == 22050 && wav.channels == 1, "after convert %d/%d", wav.rate, wav.channels);
  CHECK(wav.pcm_len == 220 * 2, "after convert pcm_len %zu, expected 440", wav.pcm_len);

  /* rebuild a 22050 mono RIFF for the bag */
  size_t rl = 44 + wav.pcm_len;
  uint8_t *r = (uint8_t *)calloc(rl, 1);
  memcpy(r, "RIFF", 4); wr32(r + 4, (uint32_t)(rl - 8)); memcpy(r + 8, "WAVE", 4);
  memcpy(r + 12, "fmt ", 4); wr32(r + 16, 16);
  wr16(r + 20, 1); wr16(r + 22, 1); wr32(r + 24, 22050); wr32(r + 28, 22050 * 2); wr16(r + 32, 2); wr16(r + 34, 16);
  memcpy(r + 36, "data", 4); wr32(r + 40, (uint32_t)wav.pcm_len);
  memcpy(r + 44, wav.pcm, wav.pcm_len);
  ts_bag b;
  ts_bag_init(&b);
  CHECK(ts_bag_add(&b, "tsak47.wav", r, rl, 22050), "bag_add failed");
  CHECK(ts_bag_write(&b, "/tmp/ts_test_audio.bag", "/tmp/ts_test_audio.idx"), "bag write failed");
  size_t il = 0;
  char *ix = ts_slurp("/tmp/ts_test_audio.idx", &il);
  CHECK(ix != NULL && il == 12 + 36, "idx is %zu bytes, expected 48", il);
  if (ix) {
    uint32_t magic = (uint32_t)ix[0] | ((uint32_t)ix[1] << 8) | ((uint32_t)ix[2] << 16) | ((uint32_t)ix[3] << 24);
    CHECK(magic == 0x47414241u, "idx magic %08X", magic);
    uint32_t cnt = (uint32_t)(uint8_t)ix[8] | ((uint32_t)(uint8_t)ix[9] << 8);
    CHECK(cnt == 1, "idx count %u", cnt);
    CHECK(!memcmp(ix + 12, "tsak47.wav", 10), "idx name wrong");
    uint32_t sz = (uint32_t)(uint8_t)ix[12 + 20] | ((uint32_t)(uint8_t)ix[12 + 21] << 8) | ((uint32_t)(uint8_t)ix[12 + 22] << 16) | ((uint32_t)(uint8_t)ix[12 + 23] << 24);
    CHECK(sz == rl, "idx size %u, expected %zu", sz, rl);
    free(ix);
  }
  ts_bag_free(&b);
  free(r);
  ts_wav_free(&wav);
  free(w);
}

int main(void) {
  setvbuf(stdout, NULL, _IONBF, 0);
  printf("Terror Strike format tests\n");
  printf("[ini]\n");   test_ini();
  printf("[kv]\n");    test_kv();
  printf("[mix]\n");   test_mix();
  printf("[vpk]\n");   test_vpk();
  printf("[vtf]\n");   test_vtf();
  printf("[shp]\n");   test_shp();
  printf("[audio]\n"); test_audio();
  printf("%d passed, %d failed\n", g_pass, g_fail);
  return g_fail ? 1 : 0;
}
