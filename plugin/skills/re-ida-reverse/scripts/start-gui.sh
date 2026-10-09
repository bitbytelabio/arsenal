#!/usr/bin/env bash
# start-gui.sh
# Launch IDA Pro GUI workspace
set -euo pipefail
TARGET="${1:-}"
echo "[INFO] IDA GUI launcher: $TARGET"
