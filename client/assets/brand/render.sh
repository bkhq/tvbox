#!/bin/sh
# Renders the launcher icons, TV banner and iOS icon from the SVG masters.
# Needs rsvg-convert, ImageMagick and Noto Sans CJK; run from the repo root, e.g.:
#   docker run --rm --label ai-agent=true -v "$PWD/client/assets:/assets" -w /assets alpine:3.20 \
#     sh -c 'apk add -q rsvg-convert imagemagick font-noto-cjk && sh brand/render.sh'
set -eu
res=android-res
for pair in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  density=${pair%:*} size=${pair#*:}
  rsvg-convert -w "$size" -h "$size" brand/launcher.svg -o "$res/mipmap-$density/ic_launcher.png"
  rsvg-convert -w "$size" -h "$size" brand/launcher-round.svg -o "$res/mipmap-$density/ic_launcher_round.png"
done
# Opaque assets stay RGB without alpha.
rsvg-convert -w 320 -h 180 brand/banner.svg | magick - -alpha off PNG24:"$res/mipmap-xhdpi/ic_banner.png"
rsvg-convert -w 1024 -h 1024 icon.svg | magick - -alpha off PNG24:icon.png
