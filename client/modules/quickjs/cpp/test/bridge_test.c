/* Host test of qjs_bridge.c with fake platform callbacks. Run via run.sh. */
#define _POSIX_C_SOURCE 200809L

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "qjs_bridge.h"

static int failures;

#define CHECK(cond)                                                    \
  do {                                                                 \
    if (!(cond)) {                                                     \
      fprintf(stderr, "%s:%d: CHECK failed: %s\n", __FILE__, __LINE__, #cond); \
      failures++;                                                      \
    }                                                                  \
  } while (0)

/* ---- fake host ---------------------------------------------------------- */

static char store_key[256], store_value[256];
static int http_calls;

static char *fake_http(void *opaque, const char *url, const char *options) {
  (void)opaque;
  http_calls++;
  if (strcmp(url, "https://example.com/js/remote.js") == 0)
    return strdup("{\"code\":200,\"headers\":{},\"content\":\"import {dep} from './dep.js'; export const remote = 'r' + dep;\"}");
  if (strcmp(url, "https://example.com/js/dep.js") == 0)
    return strdup("{\"code\":200,\"headers\":{},\"content\":\"export const dep = 'd';\"}");
  if (strcmp(url, "https://echo/") == 0) {
    char *r = malloc(strlen(options) + 64);
    sprintf(r, "{\"code\":200,\"headers\":{},\"content\":%s}", "\"echo\"");
    return r;
  }
  return NULL;
}

static char *fake_local_get(void *opaque, const char *key) {
  (void)opaque;
  return strcmp(key, store_key) == 0 ? strdup(store_value) : NULL;
}

static void fake_local_set(void *opaque, const char *key, const char *value) {
  (void)opaque;
  snprintf(store_key, sizeof(store_key), "%s", key);
  snprintf(store_value, sizeof(store_value), "%s", value);
}

static void fake_local_delete(void *opaque, const char *key) {
  (void)opaque;
  if (strcmp(key, store_key) == 0) store_key[0] = store_value[0] = '\0';
}

static char last_log[256];

static void fake_log(void *opaque, const char *level, const char *message) {
  (void)opaque;
  snprintf(last_log, sizeof(last_log), "%s:%s", level, message);
}

static char *fake_read_asset(void *opaque, const char *path, size_t *len) {
  const char *src;
  char *r;
  (void)opaque;
  if (strcmp(path, "lib/util.js") == 0)
    src = "export function twice(x) { return x * 2; }";
  else
    return NULL;
  *len = strlen(src);
  r = malloc(*len); /* deliberately not NUL-terminated */
  memcpy(r, src, *len);
  return r;
}

static const QJSHost host = {fake_http, fake_local_get, fake_local_set, fake_local_delete, fake_log, fake_read_asset};

/* Minimal stand-in for the TS prelude's timers. */
static const char *timers_js =
    "var __timers = []; var __seq = 0;"
    "globalThis.setTimeout = function (fn, ms) { var id = ++__seq;"
    "  __timers.push({ id: id, fn: fn, at: Date.now() + (ms || 0) }); return id; };"
    "globalThis.__drainTimers = function () { var now = Date.now();"
    "  var due = __timers.filter(function (t) { return t.at <= now; });"
    "  __timers = __timers.filter(function (t) { return t.at > now; });"
    "  due.forEach(function (t) { t.fn(); });"
    "  if (!__timers.length) return -1;"
    "  return Math.max(0, Math.min.apply(null, __timers.map(function (t) { return t.at; })) - Date.now()); };";

static int eval(QJSBridge *b, const char *code, const char *name, int module, char **err) {
  return qjs_bridge_evaluate(b, code, strlen(code), name, module, 5000, err);
}

static int call(QJSBridge *b, const char *method, const char *args, int64_t timeout, char **out) {
  return qjs_bridge_call(b, "spider", method, args, timeout, out);
}

static void expect_call(QJSBridge *b, const char *method, const char *args, int code, const char *prefix) {
  char *out = NULL;
  int r = call(b, method, args, 3000, &out);
  if (r != code || !out || strncmp(out, prefix, strlen(prefix)) != 0) {
    fprintf(stderr, "call %s(%s): got %d '%s', want %d '%s...'\n", method, args, r, out ? out : "(null)", code, prefix);
    failures++;
  }
  free(out);
}

static void test_normalize(void) {
  static const char *cases[][3] = {
      {"https://a.com/x/y/spider.js", "./lib.js", "https://a.com/x/y/lib.js"},
      {"https://a.com/x/y/spider.js?v=1", "../z.js", "https://a.com/x/z.js"},
      {"https://a.com/x/spider.js", "/root.js", "https://a.com/root.js"},
      {"https://a.com", "a.js", "https://a.com/a.js"},
      {"https://a.com/x/s.js", "//b.com/c.js", "https://b.com/c.js"},
      {"https://a.com/x/s.js", "lib/cat.js", "lib/cat.js"},
      {"https://a.com/x/s.js", "assets://js/lib/cat.js", "assets://js/lib/cat.js"},
      {"assets://js/lib/cat.js", "./gbk.js", "assets://js/lib/gbk.js"},
      {"lib/cat.js", "./gbk.js", "lib/gbk.js"},
      {"spider.js", "./a/../b.js", "b.js"},
      {"dir/spider.js", "b.js?x=../y", "dir/b.js?x=../y"},
      {"", "x.js", "x.js"},
  };
  size_t i;
  for (i = 0; i < sizeof(cases) / sizeof(cases[0]); i++) {
    char *r = qjs_bridge_normalize(cases[i][0], cases[i][1]);
    if (!r || strcmp(r, cases[i][2]) != 0) {
      fprintf(stderr, "normalize(%s, %s) = %s, want %s\n", cases[i][0], cases[i][1], r ? r : "(null)", cases[i][2]);
      failures++;
    }
    free(r);
  }
}

static void test_calls(void) {
  QJSBridge *b = qjs_bridge_new(&host, NULL);
  char *err = NULL, *out = NULL;
  int r;

  CHECK(b != NULL);
  CHECK(eval(b, timers_js, "timers.js", 0, &err) == QJS_OK);
  free(err);

  r = eval(b,
           "globalThis.spider = {"
           "  add(a, b) { return a + b; },"
           "  obj(o) { return { got: o, list: [1, 'x', null] }; },"
           "  undef() {},"
           "  async later(v) { await new Promise(r => setTimeout(r, 30)); return v + '!'; },"
           "  thenable() { return { then(ok) { ok(7); } }; },"
           "  boom() { throw new TypeError('bad thing'); },"
           "  async reject() { throw new Error('nope'); },"
           "  stall() { return new Promise(() => {}); },"
           "  spin() { for (;;) {} },"
           "  sleepy() { return new Promise(r => setTimeout(r, 10000)); },"
           "  http() { return JSON.parse(__host_http('https://echo/', '{\"method\":\"get\"}')).content; },"
           "  httpFail() { return JSON.parse(__host_http('https://nowhere/')); },"
           "  local(v) { __host_local_set('r', 'k', v); var a = __host_local_get('r', 'k');"
           "    __host_local_delete('r', 'k'); return [a, __host_local_get('r', 'k')]; },"
           "  log() { __host_log('w', 'hello'); },"
           "};",
           "spider.js", 0, &err);
  CHECK(r == QJS_OK);
  free(err);

  expect_call(b, "add", "[1,2]", QJS_OK, "3");
  expect_call(b, "obj", "[{\"a\":\"中文\"}]", QJS_OK, "{\"got\":{\"a\":\"中文\"},\"list\":[1,\"x\",null]}");
  expect_call(b, "undef", "[]", QJS_OK, "null");
  expect_call(b, "missing", "[]", QJS_OK, "null");
  expect_call(b, "later", "[\"v\"]", QJS_OK, "\"v!\"");
  expect_call(b, "thenable", "[]", QJS_OK, "7");
  expect_call(b, "boom", "[]", QJS_ERR_EXCEPTION, "TypeError: bad thing\n");
  expect_call(b, "reject", "[]", QJS_ERR_EXCEPTION, "Error: nope\n");
  expect_call(b, "stall", "[]", QJS_ERR_STALLED, "");
  expect_call(b, "http", "[]", QJS_OK, "\"echo\"");
  expect_call(b, "httpFail", "[]", QJS_OK, "{\"code\":\"\",\"headers\":{},\"content\":\"\"}");
  expect_call(b, "local", "[\"val\"]", QJS_OK, "[\"val\",\"\"]");
  CHECK(strcmp(store_key, "") == 0);
  fake_local_set(NULL, "x", "y");
  expect_call(b, "log", "[]", QJS_OK, "null");
  CHECK(strcmp(last_log, "w:hello") == 0);

  r = qjs_bridge_call(b, "nothing", "x", "[]", 1000, &out);
  CHECK(r == QJS_ERR_NO_OBJECT);
  free(out);

  r = call(b, "spin", "[]", 200, &out);
  CHECK(r == QJS_ERR_TIMEOUT);
  free(out);
  r = call(b, "sleepy", "[]", 200, &out);
  CHECK(r == QJS_ERR_TIMEOUT);
  free(out);
  /* still usable after timeouts */
  expect_call(b, "add", "[2,3]", QJS_OK, "5");

  r = eval(b, "throw new Error('script')", "bad.js", 0, &err);
  CHECK(r == QJS_ERR_EXCEPTION && err && strstr(err, "script"));
  free(err);
  qjs_bridge_free(b);
}

static void test_modules(void) {
  QJSBridge *b = qjs_bridge_new(&host, NULL);
  char *err = NULL;
  int r;
  const char *mod = "export const local = 'L';";
  const char *main_src =
      "import { local } from './local.js';"
      "import { twice } from 'lib/util.js';"
      "import { twice as t2 } from 'assets://js/lib/util.js';"
      "import { remote } from './remote.js';"
      "await new Promise(r => setTimeout(r, 5));"
      "globalThis.spider = { get: () => [local, twice(2), t2(3), remote] };";

  CHECK(eval(b, timers_js, "timers.js", 0, &err) == QJS_OK);
  free(err);
  CHECK(qjs_bridge_register_module(b, "https://example.com/js/local.js", mod, strlen(mod)) == 0);
  r = eval(b, main_src, "https://example.com/js/main.js", 1, &err);
  if (r != QJS_OK) fprintf(stderr, "module eval: %d %s\n", r, err ? err : "");
  CHECK(r == QJS_OK);
  free(err);
  expect_call(b, "get", "[]", QJS_OK, "[\"L\",4,6,\"rd\"]");

  http_calls = 0;
  r = eval(b, "import { remote } from 'https://example.com/js/remote.js'; globalThis.again = remote;", "m2.js", 1, &err);
  CHECK(r == QJS_OK && http_calls == 0); /* already loaded */
  free(err);

  r = eval(b, "import 'lib/missing.js';", "m3.js", 1, &err);
  CHECK(r == QJS_ERR_EXCEPTION && err && strstr(err, "could not load module 'lib/missing.js'"));
  free(err);

  r = qjs_bridge_evaluate(b, "for (;;) {}", 11, "loop.js", 0, 100, &err);
  CHECK(r == QJS_ERR_TIMEOUT);
  free(err);
  qjs_bridge_free(b);
}

int main(void) {
  test_normalize();
  test_calls();
  test_modules();
  if (failures) {
    fprintf(stderr, "%d failure(s)\n", failures);
    return 1;
  }
  printf("bridge_test: all checks passed\n");
  return 0;
}
