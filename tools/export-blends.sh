#!/bin/zsh
# Batch-exports .blend files to GLB using Blender headless.
# Usage: ./tools/export-blends.sh <src-dir> <out-dir> [--object]
#   --object  strip presentation helpers (backdrops, annotations, proxies)
set -u
BL=/Applications/Blender.app/Contents/MacOS/Blender
SCRIPT="$(cd "$(dirname "$0")" && pwd)/export-blend.py"
SRC="$1"
OUT="$2"
MODE="${3:-}"
mkdir -p "$OUT"

for f in "$SRC"/*.blend; do
  base="$(basename "$f" .blend)"
  # strip date suffixes like -20260427
  slug="${base%-2026*}"
  out="$OUT/$slug.glb"
  if [[ -f "$out" && "$out" -nt "$f" ]]; then
    echo "skip $slug"
    continue
  fi
  echo "export $slug"
  "$BL" -b "$f" -P "$SCRIPT" -- "$out" $MODE 2>&1 | grep -E 'EXPORT_OK|Error' | head -2
done
echo "DONE $SRC"
