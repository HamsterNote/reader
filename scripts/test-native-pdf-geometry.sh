#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

usage() {
  echo "usage: $0 --run | --typecheck" >&2
  echo "  --run       compile and execute XCTest geometry cases on Linux/corelibs-xctest" >&2
  echo "  --typecheck type-check production geometry against Apple's simulator SDK on macOS" >&2
}

case "${1:-}" in
  --run)
    if [[ "$(uname -s)" == "Darwin" ]]; then
      echo "--run is for Linux/corelibs-xctest; use --typecheck on macOS" >&2
      exit 2
    fi
    test_dir=$(mktemp -d)
    trap 'rm -rf "$test_dir"' EXIT
    swiftc -warnings-as-errors \
      app/modules/reader-pdf/ios/ReaderPdfGeometry.swift \
      test/native-pdf/swift/main.swift \
      -o "$test_dir/reader-pdf-geometry-tests"
    "$test_dir/reader-pdf-geometry-tests"
    ;;
  --typecheck)
    if [[ "$(uname -s)" != "Darwin" ]]; then
      echo "--typecheck requires macOS Xcode simulator SDK" >&2
      exit 2
    fi
    xcrun --sdk iphonesimulator swiftc -warnings-as-errors -typecheck \
      app/modules/reader-pdf/ios/ReaderPdfGeometry.swift
    ;;
  *)
    usage
    exit 2
    ;;
esac
