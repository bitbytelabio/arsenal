#!/usr/bin/env bash
# decode.sh
# APK decompression and decompilation using jadx and apktool
set -euo pipefail
APK="${1:-}"
OUT="${2:-}"
if [ -z "$APK" ]; then
  echo "Usage: $0 <apk_path> [out_dir]" >&2
  exit 1
fi
