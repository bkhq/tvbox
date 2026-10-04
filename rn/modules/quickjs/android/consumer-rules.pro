# Called from native code (android/src/main/cpp/quickjs_jni.c).
-keep class expo.modules.quickjs.QuickJSNative { *; }
-keep class expo.modules.quickjs.QuickJSHost { *; }
-keep class expo.modules.quickjs.QuickJSException { <init>(int, byte[]); }
