/*
 * Platform-neutral QuickJS bridge shared by Android (JNI) and iOS/tvOS
 * (Swift). One QJSBridge owns one JSRuntime + JSContext. It is not
 * thread-safe: the platform layer must call every function for a given
 * bridge on that bridge's own serial thread.
 *
 * Strings crossing this API are UTF-8. Buffers returned by the bridge and
 * by host callbacks are allocated with malloc() and freed by the receiver
 * (free() / qjs_bridge_free_string()).
 */
#ifndef QJS_BRIDGE_H
#define QJS_BRIDGE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Result codes of qjs_bridge_evaluate / qjs_bridge_call. */
enum {
  QJS_OK = 0,
  QJS_ERR_EXCEPTION = 1, /* thrown exception or rejected promise */
  QJS_ERR_TIMEOUT = 2,   /* deadline passed */
  QJS_ERR_NO_OBJECT = 3, /* globalThis[objectName] is not an object */
  QJS_ERR_STALLED = 4,   /* promise pending with no jobs and no timers */
};

/* Callbacks supplied by the platform. All are invoked synchronously on the
 * bridge thread. Returned buffers are malloc()ed and owned by the caller. */
typedef struct QJSHost {
  /* HTTP request; returns the JSON response string (see the module's
   * README) or NULL on failure (the bridge substitutes the error JSON). */
  char *(*http)(void *opaque, const char *url, const char *options_json);
  /* Persistent string store keyed by the full key ("cache_..."). get
   * returns NULL when the key is missing. */
  char *(*local_get)(void *opaque, const char *key);
  void (*local_set)(void *opaque, const char *key, const char *value);
  void (*local_delete)(void *opaque, const char *key);
  void (*log)(void *opaque, const char *level, const char *message);
  /* Reads a bundled file, e.g. "lib/cat.js"; NULL when absent. */
  char *(*read_asset)(void *opaque, const char *path, size_t *len);
} QJSHost;

typedef struct QJSBridge QJSBridge;

/* Creates the runtime and context and installs the host globals. The host
 * struct is copied; opaque is passed back to every callback. */
QJSBridge *qjs_bridge_new(const QJSHost *host, void *opaque);
void qjs_bridge_free(QJSBridge *b);

/* Adds or replaces the source returned by the module loader for name. */
int qjs_bridge_register_module(QJSBridge *b, const char *name, const char *source, size_t len);

/* On error, *out_error receives "<message>\n<stack>" (malloc()ed). */
int qjs_bridge_evaluate(QJSBridge *b, const char *code, size_t len, const char *filename,
                        int as_module, int64_t timeout_ms, char **out_error);

/* On QJS_OK, *out receives the JSON result; otherwise the error message.
 * Both are malloc()ed. */
int qjs_bridge_call(QJSBridge *b, const char *object_name, const char *method,
                    const char *args_json, int64_t timeout_ms, char **out);

/* Exposed for tests: resolves a module name like the module loader does.
 * Returns a malloc()ed string. */
char *qjs_bridge_normalize(const char *base, const char *name);

void qjs_bridge_free_string(char *s);

#ifdef __cplusplus
}
#endif

#endif /* QJS_BRIDGE_H */
