#!/bin/bash
# Bakes each eval scene's Blender World to /tmp/eval-skies/<slug>.png
# via tools/bake-sky.py. Skips slugs that already have a PNG.
B=/Applications/Blender.app/Contents/MacOS/Blender
S="$(cd "$(dirname "$0")" && pwd)/bake-sky.py"
OUT=/tmp/eval-skies
mkdir -p "$OUT"
for f in ~/Desktop/eval-blends/run1-65561cdc/*.blend; do
  n=$(basename "$f" .blend)
  [ -s "$OUT/$n-v1.png" ] || "$B" -b "$f" -P "$S" -- "$OUT/$n-v1.png" 2>&1 | grep -o 'SKY_BAKE_OK.*' | head -c 200
  echo " <- $n-v1"
done
for f in ~/Desktop/eval-blends/run2-7ecaa3c8/*.blend; do
  n=$(basename "$f" .blend)
  [ -s "$OUT/$n-v2.png" ] || "$B" -b "$f" -P "$S" -- "$OUT/$n-v2.png" 2>&1 | grep -o 'SKY_BAKE_OK.*' | head -c 200
  echo " <- $n-v2"
done
echo SKY_BAKES_ALL_DONE
