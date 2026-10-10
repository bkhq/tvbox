# JAR spiders are loaded with DexClassLoader at runtime and link against the
# host's catvod classes and libraries by name: keep them unobfuscated.
# Modelled on app/proguard-rules.pro of the Java app.

# CatVod
-keep class com.github.catvod.** { *; }
-keep class * extends com.github.catvod.crawler.Spider

# Entry point the httpd module calls by reflection
-keep class expo.modules.jarspider.JarProxy { *; }

# Gson
-keep class com.google.gson.** { *; }

# OkHttp
-dontwarn okhttp3.**
-keep class okio.** { *; }
-keep class okhttp3.** { *; }

# Kotlin
-keeppackagenames kotlin.**
-keep class kotlin.** { *; }

# Libraries spiders commonly use
-keep class com.google.common.** { *; }
-keep class org.brotli.** { *; }
-keep class org.mozilla.universalchardet.** { *; }
-keep class com.orhanobut.logger.** { *; }
-keep class com.hierynomus.** { *; }
-dontwarn com.hierynomus.**
-dontwarn net.engio.**
-dontwarn javax.el.**
-dontwarn org.ietf.jgss.**

# Sardine
-keep class com.thegrizzlylabs.sardineandroid.** { *; }
-dontwarn com.thegrizzlylabs.sardineandroid.**

# Zxing QRCode ABI
-keep class com.google.zxing.* { *; }
-keep class com.google.zxing.common.BitMatrix { *; }
-keep class com.google.zxing.common.HybridBinarizer { *; }
-keep class com.google.zxing.qrcode.QRCodeReader { *; }
-keep class com.google.zxing.qrcode.QRCodeWriter { *; }
-keep class com.google.zxing.qrcode.decoder.ErrorCorrectionLevel { *; }
