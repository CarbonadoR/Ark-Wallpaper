#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(!((a===20&&b>=19)||(a===22&&b>=12)||a>=24))throw Error("Install Node.js 22.12+ or 24 LTS with npm")'
runtime=$(node scripts/prepare-release-launch.mjs)
server_url=$(node -e 'const r=JSON.parse(process.argv[1]);console.log(`http://${r.host==="::1"?"[::1]":r.host}:${r.port}`)' "$runtime")
lock_hash=$(shasum -a 256 package-lock.json | cut -d ' ' -f 1)
marker=node_modules/.release-dependencies.sha256
if [[ ! -f "$marker" ]] || [[ "$(cat "$marker")" != "$lock_hash" ]]; then
  npm ci --include=dev --ignore-scripts=false
  printf '%s' "$lock_hash" > "$marker"
fi
if [[ "${1:-}" == "--prepare-only" ]]; then
  printf 'Launch configuration prepared.\n'
  exit 0
fi
export ARKNIGHTS_WALLPAPER_PROJECT_ROOT="$PWD"
export ARKNIGHTS_WALLPAPER_NPM="$(command -v npm)"
export ARKNIGHTS_WALLPAPER_SERVER_URL="$server_url"
nohup "$PWD/app/Arknights Dynamic Wallpaper.app/Contents/MacOS/ArknightsWallpaper" >/dev/null 2>&1 &
printf 'Ark Wallpaper started. Use the menu bar icon to open the resource library.\n'
