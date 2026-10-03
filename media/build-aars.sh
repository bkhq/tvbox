#!/usr/bin/env bash
# Build the Media3 AARs the app depends on and copy them into app/libs.
# Requires JDK 21 and an Android SDK with NDK 29.0.14206865 and CMake 3.22.1
# (ANDROID_HOME must point to it).
set -euo pipefail

cd "$(dirname "$0")"
tasks=()
while IFS= read -r name; do
    name="${name%$'\r'}"
    [ -z "$name" ] && continue
    tasks+=(":${name%-release.aar}:assembleRelease")
done < move.txt

bash ./gradlew --no-daemon --console=plain "${tasks[@]}"

mkdir -p ../app/libs
find libraries -path '*/buildout/outputs/aar/lib-*-release.aar' -exec cp {} ../app/libs/ \;
ls -l ../app/libs/lib-*.aar
