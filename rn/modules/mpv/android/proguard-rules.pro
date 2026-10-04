# libplayer.so binds Java_is_xyz_mpv_MPVLib_* and calls the static event methods back by name.
-keep class is.xyz.mpv.** { *; }
