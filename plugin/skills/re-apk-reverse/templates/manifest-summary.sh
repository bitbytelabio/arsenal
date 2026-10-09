#!/usr/bin/env bash
# manifest-summary.sh
# Summarizes AndroidManifest.xml components and permissions
set -euo pipefail
MANIFEST="${1:-}"
if [ -z "$MANIFEST" ] || [ ! -f "$MANIFEST" ]; then
  echo "Usage: $0 <AndroidManifest.xml>" >&2
  exit 1
fi
grep -E "(package=|uses-permission|<activity|<service)" "$MANIFEST" || true
