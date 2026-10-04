#!/usr/bin/env bash
# Builds the Android debug APK (rn/android/app/build/outputs/apk/debug/) in a
# sibling container: npm ci, expo prebuild, gradle assembleDebug.
#
# Only rn/ is mounted (same path on both sides) plus the shared Android SDK,
# read-only. Packages missing from the shared SDK (e.g. the NDK version React
# Native pins) are installed into a per-checkout overlay in rn/.tmp/android-sdk.
set -euo pipefail

IMAGE=ai-agent/tvbox-rn-build
SHARED_SDK=${SHARED_ANDROID_SDK:-/srv/zzci/tvbox/.tmp/android-sdk}

rn_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
# The docker daemon runs on the host: translate container-local aliases.
case "$rn_dir" in
  /work/*) rn_dir="/srv/station/work/${rn_dir#/work/}" ;;
  /root/*) rn_dir="/srv/station/root/${rn_dir#/root/}" ;;
esac

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  docker build --label ai-agent=true -t "$IMAGE" "$rn_dir/docker"
fi

mkdir -p "$rn_dir/.tmp"

docker run --rm \
  --label ai-agent=true \
  --name "ai-agent-tvbox-rn-$$" \
  --network traefik \
  -v "$rn_dir:$rn_dir" \
  -v "$SHARED_SDK:$SHARED_SDK:ro" \
  -w "$rn_dir" \
  -e CI=1 \
  -e SHARED_SDK="$SHARED_SDK" \
  -e WORKER_URL="${WORKER_URL:-}" \
  "$IMAGE" bash -euo pipefail -c '
    sdk="$PWD/.tmp/android-sdk"
    export ANDROID_HOME="$sdk" ANDROID_SDK_ROOT="$sdk"
    export GRADLE_USER_HOME="$PWD/.tmp/gradle-home"
    export npm_config_cache="$PWD/.tmp/npm-cache"

    npm ci

    # SDK overlay: link every shared package, install what is missing here.
    mkdir -p "$sdk"
    cp -r --update=none "$SHARED_SDK/licenses" "$sdk/"
    ln -sfn "$SHARED_SDK/platform-tools" "$sdk/platform-tools"
    for group in build-tools platforms cmake ndk cmdline-tools; do
      [ -d "$SHARED_SDK/$group" ] || continue
      mkdir -p "$sdk/$group"
      for pkg in "$SHARED_SDK/$group"/*; do
        [ -e "$sdk/$group/$(basename "$pkg")" ] || ln -s "$pkg" "$sdk/$group/"
      done
    done
    version() { sed -n "s/^$1 = \"\(.*\)\"/\1/p" node_modules/react-native/gradle/libs.versions.toml; }
    wanted=("platforms;android-$(version compileSdk)" "build-tools;$(version buildTools)" "ndk;$(version ndkVersion)")
    missing=()
    for pkg in "${wanted[@]}"; do
      [ -d "$sdk/${pkg//;//}" ] || missing+=("$pkg")
    done
    if [ ${#missing[@]} -gt 0 ]; then
      echo "Installing into the SDK overlay: ${missing[*]}"
      { yes || true; } | "$sdk/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$sdk" "${missing[@]}" >/dev/null
    fi

    npx expo prebuild --platform android --no-install
    cd android
    ./gradlew --no-daemon assembleDebug
    ls -l app/build/outputs/apk/debug/
  '
