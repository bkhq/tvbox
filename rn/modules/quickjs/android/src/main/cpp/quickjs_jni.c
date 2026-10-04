/*
 * JNI glue between expo.modules.quickjs.QuickJSNative and the shared C
 * bridge. Strings cross the boundary as UTF-8 byte arrays (JNI's modified
 * UTF-8 would mangle NUL and supplementary characters). Every function runs
 * on the context's own Java thread, so the host callbacks can use the
 * JNIEnv of that thread.
 */
#include <jni.h>
#include <stdlib.h>
#include <string.h>

#include "qjs_bridge.h"

typedef struct Handle {
  QJSBridge *bridge;
  JavaVM *vm;
  jobject host; /* global ref to QuickJSHost */
  jmethodID http, local_get, local_set, local_delete, log, read_asset;
} Handle;

static JNIEnv *get_env(Handle *h) {
  JNIEnv *env = NULL;
  (*h->vm)->GetEnv(h->vm, (void **)&env, JNI_VERSION_1_6);
  return env;
}

static jbyteArray to_bytes(JNIEnv *env, const char *s, size_t len) {
  jbyteArray arr = (*env)->NewByteArray(env, (jsize)len);
  if (arr) (*env)->SetByteArrayRegion(env, arr, 0, (jsize)len, (const jbyte *)s);
  return arr;
}

/* malloc()ed NUL-terminated copy of a byte array; NULL for a null array. */
static char *from_bytes(JNIEnv *env, jbyteArray arr, size_t *len_out) {
  jsize len;
  char *r;
  if (!arr) return NULL;
  len = (*env)->GetArrayLength(env, arr);
  r = malloc((size_t)len + 1);
  if (!r) return NULL;
  (*env)->GetByteArrayRegion(env, arr, 0, len, (jbyte *)r);
  r[len] = '\0';
  if (len_out) *len_out = (size_t)len;
  return r;
}

/* Drops any Java exception thrown by a callback; returns 1 if there was one. */
static int clear_exception(JNIEnv *env) {
  if (!(*env)->ExceptionCheck(env)) return 0;
  (*env)->ExceptionClear(env);
  return 1;
}

/* Calls a host method taking up to three strings and returning byte[] or void. */
static char *call_host(Handle *h, jmethodID method, int returns, const char *a, const char *b, const char *c,
                       size_t *len_out) {
  JNIEnv *env = get_env(h);
  jbyteArray ja = NULL, jb = NULL, jc = NULL, res = NULL;
  char *r = NULL;
  if (!env) return NULL;
  ja = to_bytes(env, a, strlen(a));
  if (b) jb = to_bytes(env, b, strlen(b));
  if (c) jc = to_bytes(env, c, strlen(c));
  if (!clear_exception(env)) {
    if (returns)
      res = (jbyteArray)(*env)->CallObjectMethod(env, h->host, method, ja, jb, jc);
    else
      (*env)->CallVoidMethod(env, h->host, method, ja, jb, jc);
    if (!clear_exception(env) && res) r = from_bytes(env, res, len_out);
  }
  if (res) (*env)->DeleteLocalRef(env, res);
  if (jc) (*env)->DeleteLocalRef(env, jc);
  if (jb) (*env)->DeleteLocalRef(env, jb);
  if (ja) (*env)->DeleteLocalRef(env, ja);
  return r;
}

static char *host_http(void *opaque, const char *url, const char *options) {
  Handle *h = opaque;
  return call_host(h, h->http, 1, url, options, NULL, NULL);
}

static char *host_local_get(void *opaque, const char *key) {
  Handle *h = opaque;
  return call_host(h, h->local_get, 1, key, NULL, NULL, NULL);
}

static void host_local_set(void *opaque, const char *key, const char *value) {
  Handle *h = opaque;
  call_host(h, h->local_set, 0, key, value, NULL, NULL);
}

static void host_local_delete(void *opaque, const char *key) {
  Handle *h = opaque;
  call_host(h, h->local_delete, 0, key, NULL, NULL, NULL);
}

static void host_log(void *opaque, const char *level, const char *message) {
  Handle *h = opaque;
  call_host(h, h->log, 0, level, message, NULL, NULL);
}

static char *host_read_asset(void *opaque, const char *path, size_t *len) {
  Handle *h = opaque;
  return call_host(h, h->read_asset, 1, path, NULL, NULL, len);
}

static void throw_error(JNIEnv *env, int code, const char *message) {
  jclass cls = (*env)->FindClass(env, "expo/modules/quickjs/QuickJSException");
  jmethodID ctor;
  jbyteArray msg;
  jthrowable err;
  if (!cls) return;
  ctor = (*env)->GetMethodID(env, cls, "<init>", "(I[B)V");
  if (!ctor) return;
  msg = to_bytes(env, message ? message : "", message ? strlen(message) : 0);
  err = (jthrowable)(*env)->NewObject(env, cls, ctor, (jint)code, msg);
  if (err) (*env)->Throw(env, err);
}

static Handle *handle_of(JNIEnv *env, jlong ptr) {
  Handle *h = (Handle *)(intptr_t)ptr;
  if (!h) throw_error(env, -1, "QuickJS context is closed");
  return h;
}

JNIEXPORT jlong JNICALL Java_expo_modules_quickjs_QuickJSNative_create(JNIEnv *env, jclass cls, jobject host) {
  static const QJSHost callbacks = {host_http, host_local_get, host_local_set, host_local_delete, host_log,
                                    host_read_asset};
  Handle *h = calloc(1, sizeof(*h));
  jclass host_cls;
  (void)cls;
  if (!h) return 0;
  (*env)->GetJavaVM(env, &h->vm);
  host_cls = (*env)->GetObjectClass(env, host);
  h->http = (*env)->GetMethodID(env, host_cls, "http", "([B[B)[B");
  h->local_get = (*env)->GetMethodID(env, host_cls, "localGet", "([B)[B");
  h->local_set = (*env)->GetMethodID(env, host_cls, "localSet", "([B[B)V");
  h->local_delete = (*env)->GetMethodID(env, host_cls, "localDelete", "([B)V");
  h->log = (*env)->GetMethodID(env, host_cls, "log", "([B[B)V");
  h->read_asset = (*env)->GetMethodID(env, host_cls, "readAsset", "([B)[B");
  (*env)->DeleteLocalRef(env, host_cls);
  if ((*env)->ExceptionCheck(env)) {
    free(h);
    return 0;
  }
  h->host = (*env)->NewGlobalRef(env, host);
  h->bridge = qjs_bridge_new(&callbacks, h);
  if (!h->bridge) {
    (*env)->DeleteGlobalRef(env, h->host);
    free(h);
    throw_error(env, QJS_ERR_EXCEPTION, "failed to create the QuickJS runtime");
    return 0;
  }
  return (jlong)(intptr_t)h;
}

JNIEXPORT void JNICALL Java_expo_modules_quickjs_QuickJSNative_destroy(JNIEnv *env, jclass cls, jlong ptr) {
  Handle *h = (Handle *)(intptr_t)ptr;
  (void)cls;
  if (!h) return;
  qjs_bridge_free(h->bridge);
  (*env)->DeleteGlobalRef(env, h->host);
  free(h);
}

JNIEXPORT void JNICALL Java_expo_modules_quickjs_QuickJSNative_registerModule(JNIEnv *env, jclass cls, jlong ptr,
                                                                             jbyteArray name, jbyteArray source) {
  Handle *h = handle_of(env, ptr);
  size_t len = 0;
  char *n, *s;
  (void)cls;
  if (!h) return;
  n = from_bytes(env, name, NULL);
  s = from_bytes(env, source, &len);
  if (!n || !s || qjs_bridge_register_module(h->bridge, n, s, len) != 0)
    throw_error(env, QJS_ERR_EXCEPTION, "out of memory");
  free(n);
  free(s);
}

JNIEXPORT void JNICALL Java_expo_modules_quickjs_QuickJSNative_evaluate(JNIEnv *env, jclass cls, jlong ptr,
                                                                       jbyteArray code, jbyteArray filename,
                                                                       jboolean as_module, jlong timeout_ms) {
  Handle *h = handle_of(env, ptr);
  size_t len = 0;
  char *c, *f, *err = NULL;
  int r;
  (void)cls;
  if (!h) return;
  c = from_bytes(env, code, &len);
  f = from_bytes(env, filename, NULL);
  if (!c || !f) {
    throw_error(env, QJS_ERR_EXCEPTION, "out of memory");
  } else {
    r = qjs_bridge_evaluate(h->bridge, c, len, f, as_module, timeout_ms, &err);
    if (r != QJS_OK) throw_error(env, r, err);
  }
  qjs_bridge_free_string(err);
  free(c);
  free(f);
}

JNIEXPORT jbyteArray JNICALL Java_expo_modules_quickjs_QuickJSNative_call(JNIEnv *env, jclass cls, jlong ptr,
                                                                         jbyteArray object_name, jbyteArray method,
                                                                         jbyteArray args, jlong timeout_ms) {
  Handle *h = handle_of(env, ptr);
  char *o, *m, *a, *out = NULL;
  jbyteArray result = NULL;
  int r;
  (void)cls;
  if (!h) return NULL;
  o = from_bytes(env, object_name, NULL);
  m = from_bytes(env, method, NULL);
  a = from_bytes(env, args, NULL);
  if (!o || !m || !a) {
    throw_error(env, QJS_ERR_EXCEPTION, "out of memory");
  } else {
    r = qjs_bridge_call(h->bridge, o, m, a, timeout_ms, &out);
    if (r == QJS_OK)
      result = to_bytes(env, out ? out : "null", out ? strlen(out) : 4);
    else
      throw_error(env, r, out);
  }
  qjs_bridge_free_string(out);
  free(o);
  free(m);
  free(a);
  return result;
}
