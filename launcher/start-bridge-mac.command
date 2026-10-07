#!/bin/bash
# MOMOSAI VJ bridge (smartphone remote / OSC / Art-Net) for the browser version.
# Needs Node.js 18+ (https://nodejs.org/). The desktop app (app/) has the bridge built in.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js was not found."
  echo "  Install Node.js LTS from https://nodejs.org/ and run this file again,"
  echo "  or use the desktop app version which includes the bridge."
  echo ""
  read -r -p "Press Enter to close..."
  exit 1
fi
node bridge/server.mjs "$@"
