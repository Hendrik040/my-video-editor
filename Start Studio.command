#!/bin/zsh
set -e
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then
  echo "Install Node.js 22.13 or newer, then open this launcher again."
  read -r "?Press Enter to close."
  exit 1
fi
if [ ! -d node_modules ]; then npm ci; fi
if [ ! -f dist/index.html ]; then npm run build; fi
node scripts/launch.mjs
