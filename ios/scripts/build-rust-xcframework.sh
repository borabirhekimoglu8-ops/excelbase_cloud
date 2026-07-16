#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${IOS_DIR}/.." && pwd)"
MANIFEST="${REPO_ROOT}/native/excelbase-core/Cargo.toml"
GENERATED="${IOS_DIR}/Generated"
BUILD_DIR="${IOS_DIR}/.build/rust"
TARGET_DIR="${BUILD_DIR}/target"
FRAMEWORK="${GENERATED}/ExcelbaseCore.xcframework"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Rust XCFramework yalnız macOS üzerinde üretilebilir." >&2
  exit 1
fi

for command in cargo rustup xcrun xcodebuild; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "Eksik araç: ${command}" >&2
    exit 1
  fi
done

if [[ ! -f "${MANIFEST}" ]]; then
  echo "Rust manifest bulunamadı: ${MANIFEST}" >&2
  exit 1
fi

mkdir -p "${GENERATED}" "${BUILD_DIR}/headers" "${BUILD_DIR}/simulator"
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios

export CARGO_TARGET_DIR="${TARGET_DIR}"

# Host dylib, UniFFI metadatasını okuyup Swift bağlarını üretir.
cargo build --locked --release --manifest-path "${MANIFEST}"
pushd "$(dirname "${MANIFEST}")" >/dev/null
cargo run --locked --release \
  --manifest-path Cargo.toml \
  --features bindgen \
  --bin uniffi-bindgen -- \
  generate \
  --library "${TARGET_DIR}/release/libexcelbase_core.dylib" \
  --language swift \
  --out-dir "${GENERATED}"
popd >/dev/null

cargo build --locked --release --manifest-path "${MANIFEST}" --target aarch64-apple-ios
cargo build --locked --release --manifest-path "${MANIFEST}" --target aarch64-apple-ios-sim
cargo build --locked --release --manifest-path "${MANIFEST}" --target x86_64-apple-ios

xcrun lipo -create \
  "${TARGET_DIR}/aarch64-apple-ios-sim/release/libexcelbase_core.a" \
  "${TARGET_DIR}/x86_64-apple-ios/release/libexcelbase_core.a" \
  -output "${BUILD_DIR}/simulator/libexcelbase_core.a"

HEADER="$(find "${GENERATED}" -maxdepth 1 -name '*FFI.h' -print -quit)"
MODULEMAP="$(find "${GENERATED}" -maxdepth 1 -name '*.modulemap' -print -quit)"
if [[ -z "${HEADER}" || -z "${MODULEMAP}" ]]; then
  echo "UniFFI header/modulemap üretilemedi." >&2
  exit 1
fi

cp "${HEADER}" "${BUILD_DIR}/headers/"
cp "${MODULEMAP}" "${BUILD_DIR}/headers/module.modulemap"
rm -rf "${FRAMEWORK}"
xcodebuild -create-xcframework \
  -library "${TARGET_DIR}/aarch64-apple-ios/release/libexcelbase_core.a" \
  -headers "${BUILD_DIR}/headers" \
  -library "${BUILD_DIR}/simulator/libexcelbase_core.a" \
  -headers "${BUILD_DIR}/headers" \
  -output "${FRAMEWORK}"

echo "Hazır: ${FRAMEWORK}"
