#!/usr/bin/env bash
# Downloads the MPVKit (LGPL) xcframeworks for iOS / tvOS into Frameworks/ next to
# this script; run it before `pod install`. MPVKit is distributed for SwiftPM only,
# so the binary targets of its Package.swift are vendored through TvboxMpv.podspec.
# The GPL variants, Libsmbclient (GPL only) and Libluajit (macOS only) are skipped.
#
# The pinned Package.swift is checked against MPVKIT_PACKAGE_SHA256 and every
# archive against the SwiftPM `checksum:` (SHA-256) Package.swift lists for it;
# any mismatch fails the script. To bump, change both defaults below.
#
#   MPVKIT_VERSION=1.0.0 bash rn/modules/mpv/ios/fetch-mpvkit.sh
set -euo pipefail

pinned_version=1.0.0
pinned_package_sha256=36f629e68ec8ed0d8c7963e726b40edb6beffc261b196cfba86789cf399f130c

version=${MPVKIT_VERSION:-$pinned_version}
if [ "$version" = "$pinned_version" ]; then
  package_sha256=${MPVKIT_PACKAGE_SHA256:-$pinned_package_sha256}
else
  package_sha256=${MPVKIT_PACKAGE_SHA256:-}
fi
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/Frameworks"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

sha256() {
  if command -v shasum > /dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    sha256sum "$1" | cut -d' ' -f1
  fi
}

verify() {
  local actual
  actual=$(sha256 "$1")
  if [ "$actual" != "$2" ]; then
    echo "error: checksum mismatch for $3: expected $2, got $actual" >&2
    exit 1
  fi
}

curl -fsSL "https://raw.githubusercontent.com/mpvkit/MPVKit/$version/Package.swift" -o "$tmp/Package.swift"
if [ -n "$package_sha256" ]; then
  verify "$tmp/Package.swift" "$package_sha256" "Package.swift $version"
else
  echo "warning: MPVKIT_PACKAGE_SHA256 is not set for $version; Package.swift itself is not verified" >&2
fi

# "<url> <checksum>" per binary target; every url line is followed by its checksum.
awk -F'"' '
  /url: *"https:[^"]*\.xcframework\.zip"/ { url = $2; next }
  /checksum: *"/ { if (url != "") print url, $2; url = "" }
' "$tmp/Package.swift" |
  grep -v -e '-GPL\.xcframework' -e '/Libsmbclient\.' -e '/Libluajit\.' | sort -u > "$tmp/targets"
if [ ! -s "$tmp/targets" ]; then
  echo "error: no checksummed xcframework targets found in Package.swift $version" >&2
  exit 1
fi

rm -rf "$dir"
mkdir -p "$dir"
while read -r url checksum; do
  name=$(basename "$url" .zip)
  echo "Fetching $name"
  curl -fsSL "$url" -o "$tmp/$name.zip"
  verify "$tmp/$name.zip" "$checksum" "$name"
  unzip -q "$tmp/$name.zip" -d "$dir"
done < "$tmp/targets"
echo "$version" > "$dir/VERSION"
