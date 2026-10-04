#!/usr/bin/env bash
# Host sanity check for the shared C bridge: compiles quickjs-ng + qjs_bridge.c
# with gcc (ASan/UBSan, assertions on) and runs bridge_test.c, then
# spider_smoke_test.c on the TS spider bootstrap (sources generated from
# rn/src/spider/prelude.ts with node into a temp dir). Outputs go to
# rn/.tmp/quickjs-host-test (gitignored).
set -euo pipefail

cpp=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
out="$cpp/../../../.tmp/quickjs-host-test"
mkdir -p "$out"

cc=${CC:-gcc}
engine=(quickjs.c dtoa.c libregexp.c libunicode.c)
objs=()
for src in "${engine[@]}"; do
  obj="$out/${src%.c}.o"
  if [ ! -f "$obj" ] || [ "$cpp/quickjs-ng/$src" -nt "$obj" ]; then
    "$cc" -std=gnu11 -O1 -g -D_GNU_SOURCE -fsanitize=address,undefined -w \
      -c "$cpp/quickjs-ng/$src" -o "$obj"
  fi
  objs+=("$obj")
done

"$cc" -std=c11 -O1 -g -Wall -Wextra -Werror -fsanitize=address,undefined \
  -I"$cpp" "$cpp/qjs_bridge.c" "$cpp/test/bridge_test.c" "${objs[@]}" -lm -lpthread \
  -o "$out/bridge_test"
"$out/bridge_test"

"$cc" -std=c11 -O1 -g -Wall -Wextra -Werror -fsanitize=address,undefined \
  -I"$cpp" "$cpp/qjs_bridge.c" "$cpp/test/spider_smoke_test.c" "${objs[@]}" -lm -lpthread \
  -o "$out/spider_smoke_test"
gen=$(mktemp -d)
trap 'rm -rf "$gen"' EXIT
node --no-warnings "$cpp/test/gen-spider-sources.mjs" "$gen"
"$out/spider_smoke_test" "$gen" "$cpp/test/fixtures" "$cpp/../assets/lib"
