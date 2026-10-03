# Netty
-dontwarn io.netty.**
-keep class io.netty.** { *; }
-dontwarn org.jctools.**
-dontwarn reactor.blockhound.**
-dontwarn com.aayushatharva.brotli4j.**
-dontwarn com.github.luben.zstd.**
-dontwarn com.jcraft.jzlib.**
-dontwarn com.ning.compress.**
-dontwarn lzma.sdk.**
-dontwarn net.jpountz.**
-dontwarn org.apache.log4j.**
-dontwarn org.apache.logging.log4j.**
-dontwarn org.eclipse.jetty.**
-dontwarn org.bouncycastle.**
-dontwarn org.conscrypt.**
-dontwarn sun.security.**
-dontwarn javax.annotation.**

# slf4j without a provider on Android
-dontwarn org.slf4j.**

# Crypto providers are looked up reflectively
-keep class org.whispersystems.curve25519.** { *; }
-keep class net.i2p.crypto.eddsa.** { *; }
