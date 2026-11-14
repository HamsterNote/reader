#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
# Parse UIKit integration too; this is syntax checking, not iOS type checking.
swiftc -frontend -parse app/modules/reader-pdf/ios/ReaderPdfModule.swift
swiftc -warnings-as-errors app/modules/reader-pdf/ios/ReaderPdfGeometry.swift \
  test/native-pdf/swift/main.swift -o "$test_dir/reader-pdf-geometry-tests"
"$test_dir/reader-pdf-geometry-tests"
