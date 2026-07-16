#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${IOS_DIR}/.." && pwd)"
SKIP_RUST=0

if [[ "${1:-}" == "--skip-rust" ]]; then
  SKIP_RUST=1
fi

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "XcodeGen bulunamadı. Kurulum: brew install xcodegen" >&2
  exit 1
fi

APP_ICON="${IOS_DIR}/ExcelbaseOffline/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png"
if [[ ! -f "${APP_ICON}" ]]; then
  if ! command -v sips >/dev/null 2>&1; then
    echo "Uygulama ikonu üretmek için macOS sips aracı bulunamadı." >&2
    exit 1
  fi
  sips -z 1024 1024 "${REPO_ROOT}/static/icon-512.png" --out "${APP_ICON}" >/dev/null
fi

if [[ ${SKIP_RUST} -eq 0 && ! -d "${IOS_DIR}/Generated/ExcelbaseCore.xcframework" ]]; then
  "${SCRIPT_DIR}/build-rust-xcframework.sh"
fi

if [[ ! -d "${IOS_DIR}/Generated/ExcelbaseCore.xcframework" ]]; then
  echo "ExcelbaseCore.xcframework bulunamadı; önce Rust üretim betiğini çalıştırın." >&2
  exit 1
fi

cd "${IOS_DIR}"
xcodegen generate --spec project.yml
echo "Hazır: ${IOS_DIR}/ExcelbaseOffline.xcodeproj"
