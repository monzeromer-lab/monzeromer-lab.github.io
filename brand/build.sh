#!/usr/bin/env bash
# Write every brand asset from its source: the SVGs from mark.py, the icons
# from favicon.svg (Inkscape), and the sharing cards from poster.html
# (headless Chrome, for the real fonts). The outputs are committed, so the
# site's build in CI needs none of these tools; run this after changing the
# mark or the poster.
#
#   brand/build.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
public="$here/../public"
chrome="${WF_CHROME:-$(command -v google-chrome || command -v chromium || command -v chromium-browser)}"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

python3 "$here/mark.py" "$here" >/dev/null

# The site uses the two logos and the favicon as they are.
cp "$here/mo-logo.svg" "$here/mo-logo-on-dark.svg" "$public/"
cp "$here/favicon.svg" "$public/favicon.svg"

png() { inkscape "$1" --export-type=png --export-filename="$2" -w "$3" ${4:+-h "$4"} >/dev/null 2>&1; }

# Icons: the home-screen icon, a 512 for manifests and stores, and an .ico
# for whatever still asks for /favicon.ico.
png "$here/favicon.svg" "$public/apple-touch-icon.png" 180 180
png "$here/favicon.svg" "$public/icon-512.png" 512 512
for s in 16 32 48; do png "$here/favicon.svg" "$tmp/i$s.png" $s $s; done
magick "$tmp/i16.png" "$tmp/i32.png" "$tmp/i48.png" "$public/favicon.ico"

# Raster logos, for places that will not take an SVG.
png "$here/mo-logo.svg" "$here/mo-logo.png" 1200
png "$here/mo-logo-on-dark.svg" "$here/mo-logo-on-dark.png" 1200

# The sharing cards.
card() {
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size="$1,$2" --virtual-time-budget=8000 \
    --screenshot="$3" "file://$here/poster.html" >/dev/null 2>&1
}
card 1200 630 "$public/og.png"
card 1280 640 "$here/github-social-preview.png"

# Keep the PNGs small: they are fetched by every link preview.
for f in "$public"/*.png "$here"/*.png; do magick "$f" -strip -define png:compression-level=9 "$f"; done
echo "brand assets written"
