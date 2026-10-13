# jUPnP binds services from annotations and loads parsers reflectively
-dontwarn org.jupnp.**
-keep class org.jupnp.** { *; }
-keep class io.bk.tv.dlna.** { *; }
-dontwarn javax.annotation.**
-dontwarn org.osgi.**
-dontwarn org.slf4j.**
