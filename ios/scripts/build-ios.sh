#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

"${SCRIPT_DIR}/generate-project.sh"

xcodebuild \
  -project "${IOS_DIR}/ExcelbaseOffline.xcodeproj" \
  -scheme ExcelbaseOffline \
  -configuration Debug \
  -destination "generic/platform=iOS Simulator" \
  -derivedDataPath "${IOS_DIR}/.build/DerivedData" \
  CODE_SIGNING_ALLOWED=NO \
  build
