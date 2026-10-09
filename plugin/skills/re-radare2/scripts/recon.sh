#!/usr/bin/env bash
# recon.sh
# Binary triage and reconnaissance using radare2 / rabin2
set -euo pipefail
TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  echo "Usage: $0 <target_path> [--analyze]" >&2
  exit 1
fi
echo "Target binary: $TARGET"
rabin2 -I "$TARGET" 2>/dev/null || true
