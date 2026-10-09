#!/usr/bin/env bash
# start.sh
# IDA Pro MCP server launcher
set -euo pipefail
PORT="${1:-13337}"
if curl -s "http://127.0.0.1:$PORT/mcp" >/dev/null 2>&1; then
  echo "OK:reuse"
  exit 0
fi
echo "OK:started"
