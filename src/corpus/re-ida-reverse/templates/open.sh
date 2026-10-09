#!/usr/bin/env bash
# open.sh
# Open binary in IDA Pro via HTTP API
set -euo pipefail
TARGET="${1:-}"
PORT="${2:-13337}"
echo "[INFO] Opening $TARGET via IDA MCP on port $PORT"
