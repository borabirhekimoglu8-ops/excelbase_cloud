#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"
ENV_FILE="${SCRIPT_DIR}/.env"
TRACK_FILE="${SCRIPT_DIR}/.deployed-image"

usage() {
  echo "Kullanım: $0 /tam/yol/yedek.dump --confirm RESTORE_EXCELBASE" >&2
}

if [[ $# -ne 3 || "$2" != "--confirm" || "$3" != "RESTORE_EXCELBASE" ]]; then
  usage
  exit 2
fi

if [[ ! -f "$1" || ! -s "$1" ]]; then
  echo "Hata: okunabilir, dolu bir yedek dosyası gerekli." >&2
  exit 1
fi
backup_file="$(realpath -- "$1")"
checksum_file="${backup_file}.sha256"
if [[ -f "${checksum_file}" ]]; then
  expected_checksum="$(awk 'NR == 1 {print $1}' "${checksum_file}")"
  if [[ ! "${expected_checksum}" =~ ^[0-9a-fA-F]{64}$ ]]; then
    echo "Hata: geçersiz SHA-256 dosyası: ${checksum_file}" >&2
    exit 1
  fi
  printf '%s  %s\n' "${expected_checksum}" "${backup_file}" | sha256sum --check --status - || {
    echo "Hata: yedek SHA-256 doğrulamasını geçemedi." >&2
    exit 1
  }
fi
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Hata: ${ENV_FILE} bulunamadı." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

image_tag="current"
if [[ -s "${TRACK_FILE}" ]]; then
  image_tag="$(<"${TRACK_FILE}")"
fi

dc() {
  EXCELBASE_IMAGE_TAG="${image_tag}" docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}

# Reject corrupt/non-custom dumps before stopping the application.
dc exec -T postgres pg_restore --list < "${backup_file}" > /dev/null

echo "Geri yükleme öncesi güvenlik yedeği alınıyor..."
"${SCRIPT_DIR}/backup.sh"

echo "Dış erişim, V7 web ve worker durduruluyor..."
dc stop caddy v7-web v7-worker
restart_needed=1
restart_apps() {
  if [[ "${restart_needed}" == "1" ]]; then
    # Fail closed: an interrupted restore never re-exposes a database whose
    # administrator state has not been verified.
    dc up -d --no-build v7-web v7-worker >/dev/null || true
  fi
}
trap restart_apps EXIT

dc exec -T postgres pg_restore \
  --username "${POSTGRES_USER}" \
  --dbname "${POSTGRES_DB}" \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --single-transaction \
  --exit-on-error < "${backup_file}"

dc up -d --no-build v7-web v7-worker
ready=0
for _ in $(seq 1 24); do
  if dc exec -T v7-web python -c \
    "import json,urllib.request; d=json.load(urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=5)); assert d.get('database_writable') is True" \
    >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 5
done
if [[ "${ready}" != "1" ]]; then
  echo "Geri yükleme tamamlandı ancak V7 sağlık kontrolü geçmedi; Caddy kapalı bırakıldı." >&2
  restart_needed=0
  trap - EXIT
  exit 1
fi
setup_required="$(dc exec -T v7-web python -c \
  "import json,urllib.request; d=json.load(urllib.request.urlopen('http://127.0.0.1:8000/api/auth/status',timeout=5)); print('1' if d.get('setup_required') else '0')")"
if [[ "${setup_required}" == "1" ]]; then
  restart_needed=0
  trap - EXIT
  echo "Geri yüklenen veritabanında yönetici yok; Caddy kapalı bırakıldı." >&2
  echo "python -m backend.bootstrap_admin komutunu container içinde çalıştırıp deploy.sh'i yeniden çalıştırın." >&2
  exit 3
fi
dc up -d --no-build caddy
restart_needed=0
trap - EXIT

echo "Veritabanı geri yüklendi. /health ve yolcu/fotoğraf sayılarını doğrulayın."
