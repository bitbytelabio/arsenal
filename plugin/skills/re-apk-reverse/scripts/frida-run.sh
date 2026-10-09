#!/usr/bin/env bash
# frida-run.sh
# Frida instrumentation launcher
set -euo pipefail
PACKAGE="${1:-}"
if [ -z "$PACKAGE" ]; then
  echo "Usage: $0 <package_name> [script_path]" >&2
  exit 1
fi
frida -U -f "$PACKAGE"
