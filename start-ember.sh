#!/bin/sh
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo 'Ember needs Node.js 24 or newer for browser mode. The desktop package includes its own runtime.' >&2
  exit 1
fi
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) { console.error("Ember requires Node.js 24 or newer."); process.exit(1); }'
exec node server/index.mjs
