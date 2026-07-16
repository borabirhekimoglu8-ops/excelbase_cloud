#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

if [[ $# -ne 1 || ! -s "$1" ]]; then
  echo "Kullanım: $0 /tam/yol/excelbase-yedegi.dump" >&2
  exit 2
fi
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Hata: ${ENV_FILE} bulunamadı." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

if [[ -z "${OCI_BACKUP_BUCKET:-}" || -z "${BACKUP_AGE_RECIPIENT:-}" ]]; then
  echo "Hata: OCI_BACKUP_BUCKET ve BACKUP_AGE_RECIPIENT ayarlanmalı." >&2
  exit 1
fi
if [[ ! "${BACKUP_AGE_RECIPIENT}" =~ ^age1[0-9a-z]+$ ]]; then
  echo "Hata: BACKUP_AGE_RECIPIENT geçerli bir age public recipient olmalı." >&2
  exit 1
fi
for command_name in age oci; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Hata: ${command_name} kurulu değil; off-site yedek gönderilemedi." >&2
    exit 1
  fi
done

source_file="$(realpath -- "$1")"
source_name="$(basename -- "${source_file}")"
encrypted="${source_file}.age.partial"
cleanup() {
  rm -f -- "${encrypted}"
}
trap cleanup EXIT

umask 077
age --recipient "${BACKUP_AGE_RECIPIENT}" --output "${encrypted}" "${source_file}"
stamp_path="$(date -u +%Y/%m/%d)"
object_name="excelbase-v7/${stamp_path}/${source_name}.age"

# Instance principal uses the VM identity; no OCI user private key is stored
# on disk, in GitHub or in this repository.
oci os object put \
  --auth instance_principal \
  --bucket-name "${OCI_BACKUP_BUCKET}" \
  --name "${object_name}" \
  --file "${encrypted}" \
  --force >/dev/null

echo "Şifreli off-site yedek gönderildi: oci://${OCI_BACKUP_BUCKET}/${object_name}"
