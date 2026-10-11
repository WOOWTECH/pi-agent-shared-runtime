#!/usr/bin/env bash
set -euo pipefail
package_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$package_dir"
command -v pi >/dev/null || { echo 'Install the Pi host first.' >&2; exit 1; }
npm ci --omit=dev --legacy-peer-deps
pi install "$package_dir"
node bin/cli.mjs install-host
node bin/cli.mjs boot --current --once
