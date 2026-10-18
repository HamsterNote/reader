#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(realpath "${PDF_WEBKIT_REPO:-$script_dir/..}")"
browser_dir="${PDF_WEBKIT_BROWSERS_PATH:-$script_dir/../node_modules/.cache/playwright-noble}"
image="${PDF_WEBKIT_IMAGE:-localhost/ham40-webkit:noble}"
# Yarn prepends a temporary executable shim; ask Node for the actual binary.
node_binary="$(realpath -- "$(node -p 'process.execPath')")"
node_root="$(dirname -- "$(dirname -- "$node_binary")")"
mkdir -p "$browser_dir"
browser_dir="$(realpath "$browser_dir")"

# Install in Noble to select the ABI-compatible Ubuntu 24.04 browser build.
if [[ "${1:-}" == "--install" ]]; then
  exec podman run --rm --pull=never --network=host \
    -v "$repo_dir:/work:ro" -v "$browser_dir:/browsers" \
    -v "$node_root:/node:ro" \
    -e PLAYWRIGHT_BROWSERS_PATH=/browsers -e PLAYWRIGHT_SKIP_BROWSER_GC=1 \
    -e PATH=/node/bin:/usr/bin:/bin \
    -w /work "$image" node node_modules/@playwright/test/cli.js install webkit
fi

if [[ -f "$repo_dir/test/browser/pdf-reader.spec.ts" ]]; then
  (cd "$repo_dir" && yarn build:pdf-runtime)
elif [[ -f "$repo_dir/tests/e2e/pdf-reader.spec.ts" ]]; then
  (cd "$repo_dir" && pnpm --filter @hamster-note/native-reader-demo run build:web)
else
  printf '%s\n' 'Set PDF_WEBKIT_REPO to a reader or native-reader checkout.' >&2
  exit 1
fi

# Both test servers and browsers run inside this network-isolated container.
exec podman run --rm --pull=never --network=none \
  -v "$repo_dir:/work" -v "$script_dir:/pdf-test-tools:ro" \
  -v "$browser_dir:/browsers:ro" -v "$node_root:/node:ro" \
  -e PLAYWRIGHT_BROWSERS_PATH=/browsers -e PATH=/node/bin:/usr/bin:/bin \
  -e HTTP_PROXY= -e HTTPS_PROXY= -e ALL_PROXY= \
  -e http_proxy= -e https_proxy= -e all_proxy= \
  -e NO_PROXY=127.0.0.1,localhost -e no_proxy=127.0.0.1,localhost \
  -w /work "$image" node node_modules/@playwright/test/cli.js test \
  --config /pdf-test-tools/playwright.pdf-webkit.config.cjs \
  --project=webkit --reporter=line "$@"
