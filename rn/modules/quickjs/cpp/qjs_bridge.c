/* clock_gettime/nanosleep; Apple and _GNU_SOURCE builds expose them already. */
#if !defined(__APPLE__) && !defined(_GNU_SOURCE)
#define _POSIX_C_SOURCE 200809L
#endif

#include "qjs_bridge.h"

#include <ctype.h>
#include <errno.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "quickjs-ng/quickjs.h"

/* JS stack limit; the platform threads are created with a larger stack. */
#define QJS_MAX_STACK_SIZE (4 * 1024 * 1024)

static const char HTTP_ERROR_JSON[] = "{\"code\":\"\",\"headers\":{},\"content\":\"\"}";

typedef struct Source {
  char *name;
  char *text; /* NUL-terminated */
  size_t len;
  struct Source *next;
} Source;

struct QJSBridge {
  JSRuntime *rt;
  JSContext *ctx;
  QJSHost host;
  void *opaque;
  int64_t deadline; /* monotonic ms, 0 = none */
  int interrupted;
  Source *modules;    /* registerModule */
  Source *http_cache; /* modules fetched over http(s) */
};

/* ---- utilities ---------------------------------------------------------- */

static int64_t now_ms(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (int64_t)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

static void sleep_ms(int64_t ms) {
  struct timespec ts;
  ts.tv_sec = (time_t)(ms / 1000);
  ts.tv_nsec = (long)(ms % 1000) * 1000000L;
  while (nanosleep(&ts, &ts) == -1 && errno == EINTR) {
  }
}

static char *dup_len(const char *s, size_t len) {
  char *r = malloc(len + 1);
  if (!r) return NULL;
  memcpy(r, s, len);
  r[len] = '\0';
  return r;
}

static char *dup_str(const char *s) { return dup_len(s, strlen(s)); }

static char *concat3(const char *a, const char *b, const char *c) {
  size_t la = strlen(a), lb = strlen(b), lc = strlen(c);
  char *r = malloc(la + lb + lc + 1);
  if (!r) return NULL;
  memcpy(r, a, la);
  memcpy(r + la, b, lb);
  memcpy(r + la + lb, c, lc);
  r[la + lb + lc] = '\0';
  return r;
}

static Source *source_find(Source *list, const char *name) {
  for (; list; list = list->next)
    if (strcmp(list->name, name) == 0) return list;
  return NULL;
}

static int source_put(Source **list, const char *name, const char *text, size_t len) {
  Source *s = source_find(*list, name);
  char *copy = dup_len(text, len);
  if (!copy) return -1;
  if (s) {
    free(s->text);
  } else {
    s = calloc(1, sizeof(*s));
    if (!s || !(s->name = dup_str(name))) {
      free(s);
      free(copy);
      return -1;
    }
    s->next = *list;
    *list = s;
  }
  s->text = copy;
  s->len = len;
  return 0;
}

static void source_free_all(Source *s) {
  while (s) {
    Source *next = s->next;
    free(s->name);
    free(s->text);
    free(s);
    s = next;
  }
}

/* ---- module name resolution -------------------------------------------- */

/* Length of "scheme://" when s starts with one, else 0. */
static size_t scheme_len(const char *s) {
  const char *p = s;
  if (!isalpha((unsigned char)*p)) return 0;
  p++;
  while (isalnum((unsigned char)*p) || *p == '+' || *p == '.' || *p == '-') p++;
  if (p[0] == ':' && p[1] == '/' && p[2] == '/') return (size_t)(p - s) + 3;
  return 0;
}

/* RFC 3986 remove_dot_segments for a path without query/fragment. Leading
 * ".." of a relative path are kept. */
static char *remove_dots(const char *path, size_t len) {
  const char **seg = malloc(sizeof(*seg) * (len + 2));
  size_t *seg_len = malloc(sizeof(*seg_len) * (len + 2));
  char *out = malloc(len + 2);
  size_t n = 0, i, o = 0;
  int absolute = len > 0 && path[0] == '/';
  if (!seg || !seg_len || !out) {
    free(seg);
    free(seg_len);
    free(out);
    return NULL;
  }
  i = absolute ? 1 : 0;
  while (i <= len) {
    size_t j = i;
    int last;
    while (j < len && path[j] != '/') j++;
    last = j >= len;
    if (j - i == 1 && path[i] == '.') {
      if (last) seg[n] = "", seg_len[n++] = 0;
    } else if (j - i == 2 && path[i] == '.' && path[i + 1] == '.') {
      if (n > 0 && !(seg_len[n - 1] == 2 && seg[n - 1][0] == '.' && seg[n - 1][1] == '.'))
        n--;
      else if (!absolute)
        seg[n] = "..", seg_len[n++] = 2;
      if (last) seg[n] = "", seg_len[n++] = 0;
    } else {
      seg[n] = path + i, seg_len[n++] = j - i;
    }
    i = j + 1;
  }
  if (absolute) out[o++] = '/';
  for (i = 0; i < n; i++) {
    if (i > 0) out[o++] = '/';
    memcpy(out + o, seg[i], seg_len[i]);
    o += seg_len[i];
  }
  out[o] = '\0';
  free(seg);
  free(seg_len);
  return out;
}

char *qjs_bridge_normalize(const char *base, const char *name) {
  size_t base_scheme, origin_len = 0, dir_len = 0, path_len, suffix_at;
  char *joined, *path, *result;
  const char *p;

  if (scheme_len(name) || strncmp(name, "lib/", 4) == 0) return dup_str(name);
  if (!base) base = "";

  base_scheme = scheme_len(base);
  if (base_scheme) {
    if (name[0] == '/' && name[1] == '/') {
      /* network-path reference: keep the base scheme only */
      char *scheme = dup_len(base, base_scheme - 2);
      if (!scheme) return NULL;
      result = concat3(scheme, "", name);
      free(scheme);
      return result;
    }
    origin_len = base_scheme + strcspn(base + base_scheme, "/?#");
  }

  if (name[0] == '/') {
    joined = dup_str(name);
  } else {
    /* directory of the base path, query and fragment stripped */
    size_t base_path_end = origin_len + strcspn(base + origin_len, "?#");
    for (p = base + base_path_end; p > base + origin_len; p--)
      if (p[-1] == '/') break;
    dir_len = (size_t)(p - (base + origin_len));
    if (origin_len && dir_len == 0) {
      joined = concat3("/", "", name);
    } else {
      char *dir = dup_len(base + origin_len, dir_len);
      if (!dir) return NULL;
      joined = concat3(dir, "", name);
      free(dir);
    }
  }
  if (!joined) return NULL;

  /* dot segments are removed from the path only, not the query/fragment */
  suffix_at = strcspn(joined, "?#");
  path_len = suffix_at;
  path = remove_dots(joined, path_len);
  if (!path) {
    free(joined);
    return NULL;
  }
  {
    char *origin = dup_len(base, origin_len);
    result = origin ? concat3(origin, path, joined + suffix_at) : NULL;
    free(origin);
  }
  free(path);
  free(joined);
  return result;
}

/* ---- exceptions --------------------------------------------------------- */

static char *format_exception(JSContext *ctx, JSValueConst exc) {
  const char *msg = JS_ToCString(ctx, exc);
  const char *stack = NULL;
  JSValue stack_val = JS_UNDEFINED;
  char *result;

  if (!msg) JS_FreeValue(ctx, JS_GetException(ctx));
  if (JS_IsObject(exc)) {
    stack_val = JS_GetPropertyStr(ctx, exc, "stack");
    if (JS_IsException(stack_val))
      JS_FreeValue(ctx, JS_GetException(ctx));
    else if (JS_IsString(stack_val))
      stack = JS_ToCString(ctx, stack_val);
  }
  result = concat3(msg ? msg : "exception", "\n", stack ? stack : "");
  if (msg) JS_FreeCString(ctx, msg);
  if (stack) JS_FreeCString(ctx, stack);
  JS_FreeValue(ctx, stack_val);
  return result;
}

static char *timeout_message(void) { return dup_str("QuickJS operation timed out\n"); }

/* Consumes the pending exception of ctx. */
static int take_exception(QJSBridge *b, JSContext *ctx, char **out) {
  JSValue exc = JS_GetException(ctx);
  if (b->interrupted) {
    *out = timeout_message();
    JS_FreeValue(ctx, exc);
    return QJS_ERR_TIMEOUT;
  }
  *out = format_exception(ctx, exc);
  JS_FreeValue(ctx, exc);
  return QJS_ERR_EXCEPTION;
}

/* ---- deadline ----------------------------------------------------------- */

static int interrupt_handler(JSRuntime *rt, void *opaque) {
  QJSBridge *b = opaque;
  (void)rt;
  if (b->deadline && now_ms() >= b->deadline) {
    b->interrupted = 1;
    return 1;
  }
  return 0;
}

static int deadline_passed(QJSBridge *b) { return b->deadline && now_ms() >= b->deadline; }

static void begin_op(QJSBridge *b, int64_t timeout_ms) {
  JS_UpdateStackTop(b->rt);
  b->interrupted = 0;
  b->deadline = timeout_ms > 0 ? now_ms() + timeout_ms : 0;
}

static void end_op(QJSBridge *b) {
  b->deadline = 0;
  b->interrupted = 0;
}

/* ---- job / timer loop --------------------------------------------------- */

static int run_jobs(QJSBridge *b, char **out) {
  for (;;) {
    JSContext *job_ctx;
    int r;
    if (deadline_passed(b)) b->interrupted = 1;
    if (b->interrupted) {
      *out = timeout_message();
      return QJS_ERR_TIMEOUT;
    }
    r = JS_ExecutePendingJob(b->rt, &job_ctx);
    if (r == 0) return QJS_OK;
    if (r < 0) return take_exception(b, job_ctx, out);
  }
}

static int is_thenable(JSContext *ctx, JSValueConst v) {
  JSValue then;
  int r;
  if (!JS_IsObject(v)) return 0;
  then = JS_GetPropertyStr(ctx, v, "then");
  if (JS_IsException(then)) return -1;
  r = JS_IsFunction(ctx, then);
  JS_FreeValue(ctx, then);
  return r;
}

/* Calls globalThis.__drainTimers(); *next = ms until the next timer or -1. */
static int drain_timers(QJSBridge *b, int64_t *next, char **out) {
  JSContext *ctx = b->ctx;
  JSValue global = JS_GetGlobalObject(ctx);
  JSValue fn = JS_GetPropertyStr(ctx, global, "__drainTimers");
  JSValue r;
  double d;
  *next = -1;
  if (JS_IsException(fn)) {
    JS_FreeValue(ctx, global);
    return take_exception(b, ctx, out);
  }
  if (!JS_IsFunction(ctx, fn)) {
    JS_FreeValue(ctx, fn);
    JS_FreeValue(ctx, global);
    return QJS_OK;
  }
  r = JS_Call(ctx, fn, global, 0, NULL);
  JS_FreeValue(ctx, fn);
  JS_FreeValue(ctx, global);
  if (JS_IsException(r)) return take_exception(b, ctx, out);
  if (JS_ToFloat64(ctx, &d, r) < 0) {
    JS_FreeValue(ctx, r);
    return take_exception(b, ctx, out);
  }
  JS_FreeValue(ctx, r);
  if (!isnan(d) && d >= 0) *next = (int64_t)ceil(d);
  return QJS_OK;
}

/* Waits for *val (owned) to settle when it is a promise or thenable. On
 * QJS_OK, *val is replaced by the settled value (owned). */
static int await_value(QJSBridge *b, JSValue *val, char **out) {
  JSContext *ctx = b->ctx;
  JSValue promise = *val;
  int thenable, r;

  *val = JS_UNDEFINED;
  if (!JS_IsPromise(promise)) {
    thenable = is_thenable(ctx, promise);
    if (thenable < 0) {
      JS_FreeValue(ctx, promise);
      return take_exception(b, ctx, out);
    }
    if (!thenable) {
      *val = promise;
      return QJS_OK;
    }
    {
      /* adopt a foreign thenable: Promise.resolve(value) */
      JSValue global = JS_GetGlobalObject(ctx);
      JSValue ctor = JS_GetPropertyStr(ctx, global, "Promise");
      JSValue resolve = JS_GetPropertyStr(ctx, ctor, "resolve");
      JSValue wrapped = JS_Call(ctx, resolve, ctor, 1, (JSValueConst *)&promise);
      JS_FreeValue(ctx, resolve);
      JS_FreeValue(ctx, ctor);
      JS_FreeValue(ctx, global);
      JS_FreeValue(ctx, promise);
      if (JS_IsException(wrapped)) return take_exception(b, ctx, out);
      promise = wrapped;
    }
  }

  for (;;) {
    JSPromiseStateEnum state;
    int64_t next, wait;

    r = run_jobs(b, out);
    if (r != QJS_OK) break;

    state = JS_PromiseState(ctx, promise);
    if (state == JS_PROMISE_FULFILLED) {
      *val = JS_PromiseResult(ctx, promise);
      break;
    }
    if (state == JS_PROMISE_REJECTED) {
      JSValue reason = JS_PromiseResult(ctx, promise);
      if (b->interrupted) {
        *out = timeout_message();
        r = QJS_ERR_TIMEOUT;
      } else {
        *out = format_exception(ctx, reason);
        r = QJS_ERR_EXCEPTION;
      }
      JS_FreeValue(ctx, reason);
      break;
    }

    r = drain_timers(b, &next, out);
    if (r != QJS_OK) break;
    if (JS_IsJobPending(b->rt) || JS_PromiseState(ctx, promise) != JS_PROMISE_PENDING) continue;
    if (next < 0) {
      *out = dup_str("Promise is pending with no pending jobs or timers\n");
      r = QJS_ERR_STALLED;
      break;
    }
    wait = next;
    if (b->deadline) {
      int64_t remaining = b->deadline - now_ms();
      if (remaining <= 0) {
        *out = timeout_message();
        r = QJS_ERR_TIMEOUT;
        break;
      }
      if (remaining < wait) wait = remaining;
    }
    if (wait > 0) sleep_ms(wait);
  }
  JS_FreeValue(ctx, promise);
  return r;
}

/* ---- host globals ------------------------------------------------------- */

/* malloc()ed string of argv[i]; "" for missing/undefined/null; NULL on
 * exception. */
static char *arg_string(JSContext *ctx, int argc, JSValueConst *argv, int i) {
  const char *s;
  size_t len;
  char *r;
  if (i >= argc || JS_IsUndefined(argv[i]) || JS_IsNull(argv[i])) return dup_str("");
  s = JS_ToCStringLen(ctx, &len, argv[i]);
  if (!s) return NULL;
  r = dup_len(s, len);
  JS_FreeCString(ctx, s);
  return r;
}

static char *local_key(const char *rule, const char *key) {
  size_t lr = strlen(rule);
  char *prefix, *r;
  if (lr == 0) return concat3("cache_", "", key);
  prefix = concat3("cache_", rule, "_");
  if (!prefix) return NULL;
  r = concat3(prefix, key, "");
  free(prefix);
  return r;
}

static JSValue js_host_http(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  QJSBridge *b = JS_GetContextOpaque(ctx);
  char *url = arg_string(ctx, argc, argv, 0);
  char *opts = url ? arg_string(ctx, argc, argv, 1) : NULL;
  char *res = NULL;
  JSValue v;
  (void)this_val;
  if (!url || !opts) {
    free(url);
    return JS_EXCEPTION;
  }
  if (b->host.http) res = b->host.http(b->opaque, url, opts[0] ? opts : "{}");
  v = JS_NewString(ctx, res ? res : HTTP_ERROR_JSON);
  free(res);
  free(opts);
  free(url);
  return v;
}

static JSValue js_host_local_get(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  QJSBridge *b = JS_GetContextOpaque(ctx);
  char *rule = arg_string(ctx, argc, argv, 0);
  char *key = rule ? arg_string(ctx, argc, argv, 1) : NULL;
  char *full = key ? local_key(rule, key) : NULL;
  char *value = NULL;
  JSValue v;
  (void)this_val;
  free(rule);
  free(key);
  if (!full) return JS_EXCEPTION;
  if (b->host.local_get) value = b->host.local_get(b->opaque, full);
  v = JS_NewString(ctx, value ? value : "");
  free(value);
  free(full);
  return v;
}

static JSValue js_host_local_set(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  QJSBridge *b = JS_GetContextOpaque(ctx);
  char *rule = arg_string(ctx, argc, argv, 0);
  char *key = rule ? arg_string(ctx, argc, argv, 1) : NULL;
  char *value = key ? arg_string(ctx, argc, argv, 2) : NULL;
  char *full = value ? local_key(rule, key) : NULL;
  (void)this_val;
  if (full && b->host.local_set) b->host.local_set(b->opaque, full, value);
  free(rule);
  free(key);
  free(value);
  if (!full) return JS_EXCEPTION;
  free(full);
  return JS_UNDEFINED;
}

static JSValue js_host_local_delete(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  QJSBridge *b = JS_GetContextOpaque(ctx);
  char *rule = arg_string(ctx, argc, argv, 0);
  char *key = rule ? arg_string(ctx, argc, argv, 1) : NULL;
  char *full = key ? local_key(rule, key) : NULL;
  (void)this_val;
  if (full && b->host.local_delete) b->host.local_delete(b->opaque, full);
  free(rule);
  free(key);
  if (!full) return JS_EXCEPTION;
  free(full);
  return JS_UNDEFINED;
}

static JSValue js_host_log(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  QJSBridge *b = JS_GetContextOpaque(ctx);
  char *level = arg_string(ctx, argc, argv, 0);
  char *message = level ? arg_string(ctx, argc, argv, 1) : NULL;
  (void)this_val;
  if (message && b->host.log) b->host.log(b->opaque, level, message);
  free(level);
  if (!message) return JS_EXCEPTION;
  free(message);
  return JS_UNDEFINED;
}

static int install_globals(JSContext *ctx) {
  static const struct {
    const char *name;
    JSCFunction *fn;
    int length;
  } fns[] = {
      {"__host_http", js_host_http, 2},
      {"__host_local_get", js_host_local_get, 2},
      {"__host_local_set", js_host_local_set, 3},
      {"__host_local_delete", js_host_local_delete, 2},
      {"__host_log", js_host_log, 2},
  };
  JSValue global = JS_GetGlobalObject(ctx);
  size_t i;
  int r = 0;
  for (i = 0; i < sizeof(fns) / sizeof(fns[0]); i++) {
    if (JS_SetPropertyStr(ctx, global, fns[i].name, JS_NewCFunction(ctx, fns[i].fn, fns[i].name, fns[i].length)) < 0) {
      r = -1;
      break;
    }
  }
  JS_FreeValue(ctx, global);
  return r;
}

/* ---- module loader ------------------------------------------------------ */

static char *module_normalize(JSContext *ctx, const char *base, const char *name, void *opaque) {
  char *resolved = qjs_bridge_normalize(base, name);
  char *r;
  (void)opaque;
  if (!resolved) {
    JS_ThrowOutOfMemory(ctx);
    return NULL;
  }
  r = js_strdup(ctx, resolved);
  free(resolved);
  return r;
}

/* Fetches an http(s) module; returns a malloc()ed body or NULL. */
static char *fetch_module(QJSBridge *b, const char *url, size_t *len) {
  JSContext *ctx = b->ctx;
  char *res;
  JSValue json, code, content;
  char *body = NULL;

  if (!b->host.http) return NULL;
  res = b->host.http(b->opaque, url, "{}");
  if (!res) return NULL;
  json = JS_ParseJSON(ctx, res, strlen(res), "<http>");
  free(res);
  if (JS_IsException(json)) {
    JS_FreeValue(ctx, JS_GetException(ctx));
    return NULL;
  }
  code = JS_GetPropertyStr(ctx, json, "code");
  content = JS_GetPropertyStr(ctx, json, "content");
  if (JS_IsNumber(code) && JS_IsString(content)) {
    const char *s = JS_ToCStringLen(ctx, len, content);
    if (s && *len > 0) body = dup_len(s, *len);
    if (s) JS_FreeCString(ctx, s);
  }
  if (JS_HasException(ctx)) JS_FreeValue(ctx, JS_GetException(ctx));
  JS_FreeValue(ctx, code);
  JS_FreeValue(ctx, content);
  JS_FreeValue(ctx, json);
  return body;
}

static JSModuleDef *module_loader(JSContext *ctx, const char *name, void *opaque) {
  QJSBridge *b = opaque;
  Source *s = source_find(b->modules, name);
  const char *text = NULL;
  char *owned = NULL;
  size_t len = 0;
  JSValue fn;
  JSModuleDef *m;

  if (s) {
    text = s->text;
    len = s->len;
  } else if (strncmp(name, "lib/", 4) == 0 || strncmp(name, "assets://js/lib/", 16) == 0) {
    const char *lib = name[0] == 'l' ? name : name + strlen("assets://js/");
    if (b->host.read_asset) {
      char *raw = b->host.read_asset(b->opaque, lib, &len);
      if (raw) {
        owned = dup_len(raw, len); /* guarantee NUL termination */
        free(raw);
        text = owned;
      }
    }
  } else if (strncmp(name, "http://", 7) == 0 || strncmp(name, "https://", 8) == 0) {
    s = source_find(b->http_cache, name);
    if (!s) {
      char *body = fetch_module(b, name, &len);
      if (body) {
        if (source_put(&b->http_cache, name, body, len) == 0) s = source_find(b->http_cache, name);
        free(body);
      }
    }
    if (s) {
      text = s->text;
      len = s->len;
    }
  }

  if (!text) {
    JS_ThrowReferenceError(ctx, "could not load module '%s'", name);
    return NULL;
  }
  fn = JS_Eval(ctx, text, len, name, JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY);
  free(owned);
  if (JS_IsException(fn)) return NULL;
  m = JS_VALUE_GET_PTR(fn);
  JS_FreeValue(ctx, fn);
  return m;
}

/* ---- public API --------------------------------------------------------- */

QJSBridge *qjs_bridge_new(const QJSHost *host, void *opaque) {
  QJSBridge *b = calloc(1, sizeof(*b));
  if (!b) return NULL;
  b->host = *host;
  b->opaque = opaque;
  b->rt = JS_NewRuntime();
  if (!b->rt) goto fail;
  JS_SetMaxStackSize(b->rt, QJS_MAX_STACK_SIZE);
  JS_SetInterruptHandler(b->rt, interrupt_handler, b);
  JS_SetModuleLoaderFunc(b->rt, module_normalize, module_loader, b);
  b->ctx = JS_NewContext(b->rt);
  if (!b->ctx) goto fail;
  JS_SetContextOpaque(b->ctx, b);
  if (install_globals(b->ctx) < 0) goto fail;
  return b;
fail:
  qjs_bridge_free(b);
  return NULL;
}

void qjs_bridge_free(QJSBridge *b) {
  if (!b) return;
  if (b->rt) JS_UpdateStackTop(b->rt);
  if (b->ctx) JS_FreeContext(b->ctx);
  if (b->rt) JS_FreeRuntime(b->rt);
  source_free_all(b->modules);
  source_free_all(b->http_cache);
  free(b);
}

int qjs_bridge_register_module(QJSBridge *b, const char *name, const char *source, size_t len) {
  return source_put(&b->modules, name, source, len);
}

int qjs_bridge_evaluate(QJSBridge *b, const char *code, size_t len, const char *filename,
                        int as_module, int64_t timeout_ms, char **out_error) {
  JSContext *ctx = b->ctx;
  char *buf = dup_len(code, len); /* the parser needs a NUL terminator */
  JSValue v;
  int r;

  *out_error = NULL;
  if (!buf) {
    *out_error = dup_str("out of memory\n");
    return QJS_ERR_EXCEPTION;
  }
  begin_op(b, timeout_ms);
  v = JS_Eval(ctx, buf, len, filename, as_module ? JS_EVAL_TYPE_MODULE : JS_EVAL_TYPE_GLOBAL);
  free(buf);
  if (JS_IsException(v)) {
    r = take_exception(b, ctx, out_error);
  } else if (as_module) {
    r = await_value(b, &v, out_error);
    JS_FreeValue(ctx, v);
  } else {
    JS_FreeValue(ctx, v);
    r = run_jobs(b, out_error);
  }
  end_op(b);
  return r;
}

static int call_inner(QJSBridge *b, JSValueConst global, const char *object_name, const char *method,
                      const char *args_json, char **out) {
  JSContext *ctx = b->ctx;
  JSValue obj, fn = JS_UNDEFINED, args = JS_UNDEFINED, res = JS_UNDEFINED, json;
  JSValue *argv = NULL;
  int64_t argc = 0, i;
  int r;

  obj = JS_GetPropertyStr(ctx, global, object_name);
  if (JS_IsException(obj)) return take_exception(b, ctx, out);
  if (!JS_IsObject(obj)) {
    JS_FreeValue(ctx, obj);
    *out = concat3("globalThis.", object_name, " is not an object\n");
    return QJS_ERR_NO_OBJECT;
  }
  fn = JS_GetPropertyStr(ctx, obj, method);
  if (JS_IsException(fn)) {
    r = take_exception(b, ctx, out);
    goto done;
  }
  if (!JS_IsFunction(ctx, fn)) {
    *out = dup_str("null");
    r = QJS_OK;
    goto done;
  }

  args = JS_ParseJSON(ctx, args_json, strlen(args_json), "<args>");
  if (JS_IsException(args)) {
    r = take_exception(b, ctx, out);
    goto done;
  }
  if (JS_IsArray(args)) {
    if (JS_GetLength(ctx, args, &argc) < 0) {
      r = take_exception(b, ctx, out);
      goto done;
    }
  } else if (!JS_IsUndefined(args) && !JS_IsNull(args)) {
    *out = dup_str("TypeError: call arguments must be a JSON array\n");
    r = QJS_ERR_EXCEPTION;
    goto done;
  }
  if (argc > 0) {
    argv = calloc((size_t)argc, sizeof(*argv));
    if (!argv) {
      *out = dup_str("out of memory\n");
      r = QJS_ERR_EXCEPTION;
      goto done;
    }
    for (i = 0; i < argc; i++) argv[i] = JS_GetPropertyInt64(ctx, args, i);
  }

  res = JS_Call(ctx, fn, obj, (int)argc, (JSValueConst *)argv);
  if (JS_IsException(res)) {
    res = JS_UNDEFINED;
    r = take_exception(b, ctx, out);
    goto done;
  }
  r = await_value(b, &res, out);
  if (r != QJS_OK) goto done;

  json = JS_JSONStringify(ctx, res, JS_UNDEFINED, JS_UNDEFINED);
  if (JS_IsException(json)) {
    r = take_exception(b, ctx, out);
  } else if (JS_IsUndefined(json)) {
    *out = dup_str("null");
  } else {
    size_t len;
    const char *s = JS_ToCStringLen(ctx, &len, json);
    if (s) {
      *out = dup_len(s, len);
      JS_FreeCString(ctx, s);
    } else {
      r = take_exception(b, ctx, out);
    }
  }
  JS_FreeValue(ctx, json);

done:
  if (argv) {
    for (i = 0; i < argc; i++) JS_FreeValue(ctx, argv[i]);
    free(argv);
  }
  JS_FreeValue(ctx, res);
  JS_FreeValue(ctx, args);
  JS_FreeValue(ctx, fn);
  JS_FreeValue(ctx, obj);
  return r;
}

int qjs_bridge_call(QJSBridge *b, const char *object_name, const char *method,
                    const char *args_json, int64_t timeout_ms, char **out) {
  JSValue global;
  int r;
  *out = NULL;
  begin_op(b, timeout_ms);
  global = JS_GetGlobalObject(b->ctx);
  r = call_inner(b, global, object_name, method, args_json, out);
  JS_FreeValue(b->ctx, global);
  end_op(b);
  return r;
}

void qjs_bridge_free_string(char *s) { free(s); }
