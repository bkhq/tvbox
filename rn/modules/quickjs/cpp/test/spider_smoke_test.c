/*
 * Smoke test of the TS spider bootstrap (rn/src/spider/prelude.ts) on the
 * real C bridge + quickjs-ng: prelude script, crypto and parser modules with
 * the bundled libs, then a FongMi-style and a cat-style fixture spider driven
 * through init/home/category/detail/search/play like JsSpiderProvider does.
 *
 * Usage: spider_smoke_test <generated dir> <fixtures dir> <assets lib dir>
 * (the generated dir comes from gen-spider-sources.mjs). Run via run.sh.
 */
#define _POSIX_C_SOURCE 200809L

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "qjs_bridge.h"

#define TIMEOUT 30000 /* generous: the libs are large and the build uses ASan */

static int failures;
static const char *gen_dir, *fixtures_dir, *lib_dir;

static char *read_file(const char *dir, const char *name, size_t *len) {
  char path[1024];
  FILE *f;
  char *buf;
  long size;
  snprintf(path, sizeof(path), "%s/%s", dir, name);
  f = fopen(path, "rb");
  if (!f) return NULL;
  fseek(f, 0, SEEK_END);
  size = ftell(f);
  fseek(f, 0, SEEK_SET);
  buf = malloc((size_t)size + 1);
  if (fread(buf, 1, (size_t)size, f) != (size_t)size) size = 0;
  buf[size] = '\0';
  fclose(f);
  if (len) *len = (size_t)size;
  return buf;
}

static char *must_read(const char *dir, const char *name) {
  char *s = read_file(dir, name, NULL);
  if (!s) {
    fprintf(stderr, "missing %s/%s\n", dir, name);
    exit(2);
  }
  return s;
}

/* ---- stub host ---------------------------------------------------------- */

static const char *INDEX_HTML =
    "<html><body><div class='nav'><ul>"
    "<li><a href='/type/1'>电影</a></li><li><a href='/type/2'>剧集</a></li>"
    "</ul></div><ul class='vods'>"
    "<li><a href='/vod/7.html'>Seven</a><img data-src='../img/7.jpg'></li>"
    "<li><a href='https://cdn.test/vod/8.html'>Eight</a><img data-src='/img/8.jpg'></li>"
    "</ul></body></html>";

static char last_http_options[1024];

/* JSON string literal of s (ASCII escapes only; enough for the fixtures). */
static char *json_quote(const char *s) {
  char *r = malloc(strlen(s) * 2 + 3), *p = r;
  *p++ = '"';
  for (; *s; s++) {
    if (*s == '"' || *s == '\\') *p++ = '\\';
    *p++ = *s;
  }
  *p++ = '"';
  *p = '\0';
  return r;
}

static char *response(const char *content_json) {
  char *r = malloc(strlen(content_json) + 64);
  sprintf(r, "{\"code\":200,\"headers\":{\"Content-Type\":\"text/html\"},\"content\":%s}", content_json);
  return r;
}

static char *stub_http(void *opaque, const char *url, const char *options) {
  char *quoted, *r;
  (void)opaque;
  snprintf(last_http_options, sizeof(last_http_options), "%s", options);
  if (strcmp(url, "https://fixtures.test/index.html") == 0) {
    quoted = json_quote(INDEX_HTML);
  } else if (strcmp(url, "https://fixtures.test/echo") == 0) {
    quoted = json_quote(options);
  } else if (strcmp(url, "https://fixtures.test/bytes") == 0) {
    quoted = json_quote(strstr(options, "\"buffer\":2") ? "aGn/" : "wrong buffer option");
  } else {
    return NULL;
  }
  r = response(quoted);
  free(quoted);
  return r;
}

#define STORE_SIZE 16
static char *store_keys[STORE_SIZE], *store_values[STORE_SIZE];

static int store_find(const char *key) {
  int i;
  for (i = 0; i < STORE_SIZE; i++)
    if (store_keys[i] && strcmp(store_keys[i], key) == 0) return i;
  return -1;
}

static char *stub_local_get(void *opaque, const char *key) {
  int i = store_find(key);
  (void)opaque;
  return i < 0 ? NULL : strdup(store_values[i]);
}

static void stub_local_delete(void *opaque, const char *key) {
  int i = store_find(key);
  (void)opaque;
  if (i < 0) return;
  free(store_keys[i]);
  free(store_values[i]);
  store_keys[i] = store_values[i] = NULL;
}

static void stub_local_set(void *opaque, const char *key, const char *value) {
  int i;
  stub_local_delete(opaque, key);
  for (i = 0; i < STORE_SIZE; i++) {
    if (!store_keys[i]) {
      store_keys[i] = strdup(key);
      store_values[i] = strdup(value);
      return;
    }
  }
}

static void stub_log(void *opaque, const char *level, const char *message) {
  (void)opaque;
  fprintf(stderr, "[js %s] %s\n", level, message);
}

static char *stub_read_asset(void *opaque, const char *path, size_t *len) {
  (void)opaque;
  if (strncmp(path, "lib/", 4) != 0) return NULL;
  return read_file(lib_dir, path + 4, len);
}

static const QJSHost host = {stub_http, stub_local_get, stub_local_set, stub_local_delete, stub_log, stub_read_asset};

/* ---- helpers ------------------------------------------------------------ */

static char filenames[4][64]; /* prelude, crypto, parser, entry */

static void load_filenames(void) {
  char *text = must_read(gen_dir, "filenames.txt"), *line, *save = NULL;
  int i = 0;
  for (line = strtok_r(text, "\n", &save); line && i < 4; line = strtok_r(NULL, "\n", &save), i++)
    snprintf(filenames[i], sizeof(filenames[i]), "%s", line);
  free(text);
}

static int eval_file(QJSBridge *b, const char *dir, const char *file, const char *filename, int module) {
  char *code = must_read(dir, file), *err = NULL;
  int r = qjs_bridge_evaluate(b, code, strlen(code), filename, module, TIMEOUT, &err);
  if (r != QJS_OK) {
    fprintf(stderr, "evaluate %s (%s): %d %s\n", file, filename, r, err ? err : "");
    failures++;
  }
  free(code);
  free(err);
  return r;
}

static void expect_call(QJSBridge *b, const char *method, const char *args, const char *want) {
  char *out = NULL;
  int r = qjs_bridge_call(b, "__JS_SPIDER__", method, args, TIMEOUT, &out);
  if (r != QJS_OK || !out || strcmp(out, want) != 0) {
    fprintf(stderr, "%s(%s):\n  got  %d %s\n  want 0 %s\n", method, args, r, out ? out : "(null)", want);
    failures++;
  }
  free(out);
}

/* JsSpiderProvider.bootstrap: prelude, crypto, parser, spider module, entry. */
static QJSBridge *bootstrap(const char *fixture, const char *api, const char *entry) {
  QJSBridge *b = qjs_bridge_new(&host, NULL);
  size_t len;
  char *source = read_file(fixtures_dir, fixture, &len);
  if (!b || !source) {
    fprintf(stderr, "bootstrap %s failed\n", fixture);
    exit(2);
  }
  eval_file(b, gen_dir, "prelude.js", filenames[0], 0);
  eval_file(b, gen_dir, "crypto.js", filenames[1], 1);
  eval_file(b, gen_dir, "parser.js", filenames[2], 1);
  if (qjs_bridge_register_module(b, api, source, len) != 0) failures++;
  free(source);
  eval_file(b, gen_dir, entry, filenames[3], 1);
  return b;
}

/* ---- tests -------------------------------------------------------------- */

static void test_helpers(void) {
  QJSBridge *b = qjs_bridge_new(&host, NULL);
  eval_file(b, gen_dir, "prelude.js", filenames[0], 0);
  eval_file(b, gen_dir, "crypto.js", filenames[1], 1);
  eval_file(b, gen_dir, "parser.js", filenames[2], 1);
  eval_file(b, fixtures_dir, "helpers.js", "helpers.js", 0);
  qjs_bridge_free(b);
}

static void test_fongmi(void) {
  QJSBridge *b = bootstrap("fongmi.js", "https://fixtures.test/spider/fongmi.js", "entry-fongmi.js");
  expect_call(b, "init", "[\"fixture-ext\"]", "null");
  expect_call(b, "home", "[false]",
              "\"{\\\"class\\\":[{\\\"type_id\\\":\\\"/type/1\\\",\\\"type_name\\\":\\\"电影\\\"},"
              "{\\\"type_id\\\":\\\"/type/2\\\",\\\"type_name\\\":\\\"剧集\\\"}]}\"");
  if (!strstr(last_http_options, "\"User-Agent\":\"smoke\"")) {
    fprintf(stderr, "req headers not passed: %s\n", last_http_options);
    failures++;
  }
  expect_call(b, "homeVod", "[]",
              "\"{\\\"list\\\":[{\\\"vod_id\\\":\\\"https://fixtures.test/vod/7.html\\\",\\\"vod_name\\\":\\\"Seven\\\"},"
              "{\\\"vod_id\\\":\\\"https://cdn.test/vod/8.html\\\",\\\"vod_name\\\":\\\"Eight\\\"}]}\"");
  expect_call(b, "category", "[\"1\",\"2\",false,{\"area\":\"cn\"}]",
              "\"{\\\"page\\\":2,\\\"list\\\":[{\\\"vod_id\\\":\\\"https://fixtures.test/vod/7.html\\\",\\\"vod_name\\\":\\\"Seven\\\","
              "\\\"vod_pic\\\":\\\"https://fixtures.test/img/7.jpg\\\"},{\\\"vod_id\\\":\\\"https://cdn.test/vod/8.html\\\","
              "\\\"vod_name\\\":\\\"Eight\\\",\\\"vod_pic\\\":\\\"https://fixtures.test/img/8.jpg\\\"}],\\\"tid\\\":\\\"1\\\","
              "\\\"extend\\\":{\\\"area\\\":\\\"cn\\\"}}\"");
  expect_call(b, "detail", "[\"42\"]",
              "{\"list\":[{\"vod_id\":\"42\",\"vod_name\":\"a1d0c6e83f027327d8461063f4ac58a6\",\"vod_content\":\"fixture-ext\","
              "\"vod_play_from\":\"smoke\",\"vod_play_url\":\"ep1$Ph+G47z0ScV31qvBk2D0Yg==\"}]}");
  expect_call(b, "search", "[\"关键字\",true]",
              "\"{\\\"list\\\":[{\\\"vod_id\\\":\\\"关键字\\\",\\\"vod_name\\\":\\\"关键字:quick\\\"}]}\"");
  expect_call(b, "play", "[\"smoke\",\"Ph+G47z0ScV31qvBk2D0Yg==\",[]]",
              "\"{\\\"parse\\\":0,\\\"url\\\":\\\"hello tvbox\\\",\\\"flag\\\":\\\"smoke\\\",\\\"ext\\\":\\\"fixture-ext\\\"}\"");
  qjs_bridge_free(b);
}

static void test_cat(void) {
  QJSBridge *b = bootstrap("cat.js", "https://fixtures.test/spider/cat.js", "entry-cat.js");
  expect_call(b, "init", "[{\"stype\":3,\"skey\":\"cat\",\"ext\":\"fixture-ext\"}]", "null");
  expect_call(b, "home", "[true]",
              "\"{\\\"class\\\":[{\\\"type_id\\\":\\\"/type/1\\\",\\\"type_name\\\":\\\"电影\\\"},"
              "{\\\"type_id\\\":\\\"/type/2\\\",\\\"type_name\\\":\\\"剧集\\\"}]}\"");
  expect_call(b, "category", "[\"1\",\"1\",false,{}]",
              "\"{\\\"page\\\":\\\"1\\\",\\\"list\\\":[{\\\"vod_id\\\":\\\"1\\\",\\\"vod_name\\\":\\\"cat/3/fixture-ext\\\"}]}\"");
  expect_call(b, "detail", "[\"42\"]",
              "\"{\\\"list\\\":[{\\\"vod_id\\\":\\\"42\\\",\\\"vod_name\\\":\\\"a1d0c6e83f027327d8461063f4ac58a6\\\"}]}\"");
  expect_call(b, "search", "[\"tvbox\",false]",
              "\"{\\\"list\\\":[{\\\"vod_id\\\":\\\"tvbox\\\",\\\"vod_name\\\":\\\"5060550e1d841c91a8cc7aa0ce63fd03\\\"}]}\"");
  expect_call(b, "play", "[\"f\",\"https://v.test/1.m3u8\",[]]",
              "\"{\\\"parse\\\":0,\\\"url\\\":\\\"https://v.test/1.m3u8\\\",\\\"header\\\":{\\\"Referer\\\":\\\"https://fixtures.test/\\\"}}\"");
  qjs_bridge_free(b);
}

int main(int argc, char **argv) {
  int i;
  if (argc != 4) {
    fprintf(stderr, "usage: %s <generated dir> <fixtures dir> <assets lib dir>\n", argv[0]);
    return 2;
  }
  gen_dir = argv[1];
  fixtures_dir = argv[2];
  lib_dir = argv[3];
  load_filenames();
  test_helpers();
  test_fongmi();
  test_cat();
  for (i = 0; i < STORE_SIZE; i++) {
    free(store_keys[i]);
    free(store_values[i]);
  }
  if (failures) {
    fprintf(stderr, "%d failure(s)\n", failures);
    return 1;
  }
  printf("spider_smoke_test: all checks passed\n");
  return 0;
}
