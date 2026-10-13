#!/usr/bin/env bash
# Collects a performance baseline of the installed app on a device over adb:
# cold start time, memory, frame stats while paging down the home grid, and the
# busiest threads during that scroll. Compare runs before and after a change.
#
# Usage: scripts/perf-baseline.sh [out-file]
#   ADB=adb            adb binary (default: adb on PATH)
#   ANDROID_SERIAL=... device to use when several are connected
#   PKG=...            package (default: com.fongmi.android.tv)
#   KEYS=12            DPAD_DOWN presses in the scroll test
#
# The app must already have a config with a home grid. The scroll starts from
# wherever the home screen puts the focus after launch.
set -euo pipefail

ADB=${ADB:-adb}
PKG=${PKG:-com.fongmi.android.tv}
KEYS=${KEYS:-12}
out=${1:-perf-$(date +%Y%m%d-%H%M%S).txt}

adb() { "$ADB" "$@"; }
section() { printf '\n## %s\n' "$1" | tee -a "$out"; }

activity=$(adb shell cmd package resolve-activity --brief -c android.intent.category.LEANBACK_LAUNCHER "$PKG" | tail -1 | tr -d '\r')
if [[ "$activity" != */* ]]; then
  activity=$(adb shell cmd package resolve-activity --brief "$PKG" | tail -1 | tr -d '\r')
fi

: > "$out"
section "device"
{
  echo "model: $(adb shell getprop ro.product.model | tr -d '\r')"
  echo "android: $(adb shell getprop ro.build.version.release | tr -d '\r')"
  echo "abi: $(adb shell getprop ro.product.cpu.abi | tr -d '\r')"
  adb shell dumpsys package "$PKG" | awk '/versionName/ && !seen { sub(/^ */, "app: "); print; seen = 1 }'
} | tee -a "$out"

section "cold start (am start -W, ms)"
for _ in 1 2 3; do
  adb shell am force-stop "$PKG"
  sleep 2
  adb shell am start -W -n "$activity" | grep -E 'TotalTime' | tee -a "$out"
done

# Give the home screen time to load its content before measuring it.
sleep 15

section "memory"
adb shell dumpsys meminfo "$PKG" | sed -n '/App Summary/,/TOTAL SWAP/p' | tee -a "$out"

section "scroll: $KEYS x DPAD_DOWN"
pid=$(adb shell pidof "$PKG" | tr -d '\r')
adb shell dumpsys gfxinfo "$PKG" reset > /dev/null
# Keys are sent from a loop on the device: one adb round trip per key is too slow to stress the UI.
adb shell "for i in \$(seq 1 $KEYS); do input keyevent 20; sleep 0.15; done" &
keys=$!
top_out=$(adb shell top -H -p "$pid" -b -d 1 -n 3 -o TID,%CPU,NAME)
wait "$keys"
sleep 1
adb shell dumpsys gfxinfo "$PKG" |
  grep -E 'Total frames|^Janky frames:|50th percentile|90th percentile|99th percentile|Slow UI|deadline missed:' |
  tee -a "$out"

section "busiest threads during the scroll (%CPU per sample)"
echo "$top_out" | awk '$1 ~ /^[0-9]+$/ && $2 + 0 >= 5 { print $1, $2 }' | while read -r tid cpu; do
  name=$(adb shell cat "/proc/$pid/task/$tid/comm" 2> /dev/null | tr -d '\r')
  echo "$cpu ${name:-$tid}"
done | sort -k2,2 -k1,1nr | tee -a "$out"

echo
echo "saved to $out"
