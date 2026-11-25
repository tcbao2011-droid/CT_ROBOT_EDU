#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Can cai Node.js 20.19+ truoc." >&2; exit 1; }
exec node server/bridge.js
