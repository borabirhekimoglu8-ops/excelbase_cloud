#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"
ENV_FILE="${SCRIPT_DIR}/.env"
BACKUP_DIR="${SCRIPT_DIR}/backups"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Hata: ${ENV_FILE} bulunamadı. Önce .env.example dosyasını kopyalayın." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

retention="${BACKUP_RETENTION_DAYS:-14}"
if [[ ! "${retention}" =~ ^[0-9]+$ ]] || (( retention < 1 )); then
  echo "Hata: BACKUP_RETENTION_DAYS pozitif bir tam sayı olmalı." >&2
  exit 1
fi

umask 077
mkdir -p "${BACKUP_DIR}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="${BACKUP_DIR}/excelbase-v7-${stamp}-$$.dump"
partial="${target}.partial"
cleanup_partial() {
  rm -f -- "${partial}"
}
trap cleanup_partial EXIT

docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T postgres \
  pg_dump \
    --username "${POSTGRES_USER}" \
    --dbname "${POSTGRES_DB}" \
    --format custom \
    --compress=6 \
    --no-owner \
    --no-acl > "${partial}"

if [[ ! -s "${partial}" ]]; then
  echo "Hata: boş yedek üretildi; dosya siliniyor." >&2
  exit 1
fi

docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T postgres \
  pg_restore --list < "${partial}" > /dev/null
mv -- "${partial}" "${target}"
trap - EXIT

target_name="$(basename -- "${target}")"
(
  cd "${BACKUP_DIR}"
  sha256sum "${target_name}" > "${target_name}.sha256"
)
find "${BACKUP_DIR}" -type f \( -name '*.dump' -o -name '*.dump.sha256' \) \
  -mtime "+${retention}" -delete

echo "Yedek hazır: ${target}"
if [[ -n "${OCI_BACKUP_BUCKET:-}" || -n "${BACKUP_AGE_RECIPIENT:-}" ]]; then
  "${SCRIPT_DIR}/offsite-backup.sh" "${target}"
else
  echo "Uyarı: off-site yedek ayarlı değil; OCI_BACKUP_BUCKET ve BACKUP_AGE_RECIPIENT boş." >&2
fi
