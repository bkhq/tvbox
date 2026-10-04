#!/usr/bin/env bash
# Downloads the MPVKit (LGPL) xcframeworks for iOS / tvOS into Frameworks/ next to
# this script; run it before `pod install`. MPVKit is distributed for SwiftPM only,
# so the binary targets of its Package.swift are vendored through TvboxMpv.podspec.
# The GPL variants, Libsmbclient (GPL only) and Libluajit (macOS only) are skipped.
#
#   MPVKIT_VERSION=1.0.0 bash rn/modules/mpv/ios/fetch-mpvkit.sh
set -euo pipefail

version=${MPVKIT_VERSION:-1.0.0}
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/Frameworks"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

curl -fsSL "https://raw.githubusercontent.com/mpvkit/MPVKit/$version/Package.swift" -o "$tmp/Package.swift"
urls=$(grep -o 'https://[^"]*\.xcframework\.zip' "$tmp/Package.swift" |
  grep -v -e '-GPL\.xcframework' -e '/Libsmbclient\.' -e '/Libluajit\.' | sort -u)

rm -rf "$dir"
mkdir -p "$dir"
for url in $urls; do
  name=$(basename "$url" .zip)
  echo "Fetching $name"
  curl -fsSL "$url" -o "$tmp/$name.zip"
  unzip -q "$tmp/$name.zip" -d "$dir"
done
echo "$version" > "$dir/VERSION"
