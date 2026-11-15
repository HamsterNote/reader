#!/usr/bin/env bash
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
cd "$repo"
out=${1:-"$repo/test-results/ham268-regression-$(date -u +%Y%m%dT%H%M%SZ)"}
mkdir -p "$out"

{
  echo "repo=$repo"
  echo "sha=$(git rev-parse HEAD)"
  echo "branch=$(git branch --show-current || true)"
  echo "utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  uname -a
  node --version
  yarn --version
} | tee "$out/environment.log"

failures=()
run_step() {
  local name=$1
  shift
  echo "== $name =="
  if "$@" 2>&1 | tee "$out/$name.log"; then
    echo "$name: exit=0"
  else
    local code=${PIPESTATUS[0]}
    echo "$name: exit=$code"
    failures+=("$name:$code")
  fi
}

run_step install yarn install --frozen-lockfile
run_step typecheck yarn typecheck
run_step typecheck-host yarn typecheck:host
run_step unit-full yarn test:run --maxWorkers=2
run_step native-pdf-unit yarn vitest run test/native-pdf
run_step web-regression node scripts/check-reader-browser.mjs
run_step geometry node scripts/check-native-pdf-geometry.mjs
run_step build yarn build
run_step host-check yarn host:check
run_step openspec openspec validate add-ios-native-pdf-reading --strict

echo "Regression logs: $out"
if ((${#failures[@]})); then
  printf 'Failed steps: %s\n' "${failures[*]}" >&2
  exit 1
fi
