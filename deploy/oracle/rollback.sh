#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"
ENV_FILE="${SCRIPT_DIR}/.env"
TRACK_FILE="${SCRIPT_DIR}/.deployed-image"
PREVIOUS_FILE="${SCRIPT_DIR}/.previous-image"

target_tag="${1:-}"
if [[ -z "${target_tag}" && -s "${PREVIOUS_FILE}" ]]; then
  target_tag="$(<"${PREVIOUS_FILE}")"
fi
if [[ -z "${target_tag}" ]]; then
  echo "Kullanım: $0 [önceden-oluşturulmuş-imaj-etiketi]" >&2
  exit 2
fi
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Hata: ${ENV_FILE} bulunamadı." >&2
  exit 1
fi
if ! docker image inspect "excelbase-v7:${target_tag}" >/dev/null 2>&1; then
  echo "Hata: excelbase-v7:${target_tag} bu makinede bulunamadı." >&2
  exit 1
fi

current_tag="current"
if [[ -s "${TRACK_FILE}" ]]; then
  current_tag="$(<"${TRACK_FILE}")"
fi

dc() {
  EXCELBASE_IMAGE_TAG="$1"
  shift
  EXCELBASE_IMAGE_TAG="${EXCELBASE_IMAGE_TAG}" docker compose \
    --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}

echo "Kod geri dönüşünden önce veritabanı yedeği alınıyor..."
"${SCRIPT_DIR}/backup.sh"
dc "${target_tag}" stop caddy >/dev/null 2>&1 || true
dc "${target_tag}" up -d --no-build v7-web v7-worker

healthy=0
for _ in $(seq 1 24); do
  if dc "${target_tag}" exec -T v7-web python -c \
    "import json,urllib.request; d=json.load(urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=5)); assert d.get('database_writable') is True" \
    >/dev/null 2>&1 \
    && dc "${target_tag}" exec -T v7-worker python -c \
    "import os,time,db; p=os.environ['EXCELBASE_WORKER_HEALTH_FILE']; assert time.time()-os.path.getmtime(p)<30; assert db.probe_read() and db.probe_write()" \
    >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 5
done

if [[ "${healthy}" != "1" ]]; then
  echo "Hata: hedef imaj sağlıklı olmadı; ${current_tag} yeniden başlatılıyor." >&2
  dc "${current_tag}" up -d --no-build v7-web v7-worker caddy || true
  exit 1
fi

setup_required="$(dc "${target_tag}" exec -T v7-web python -c \
  "import json,urllib.request; d=json.load(urllib.request.urlopen('http://127.0.0.1:8000/api/auth/status',timeout=5)); print('1' if d.get('setup_required') else '0')")"
if [[ "${setup_required}" == "1" ]]; then
  echo "Hedef imajda ilk yönetici yok; güvenlik için Caddy kapalı bırakıldı." >&2
  exit 3
fi
dc "${target_tag}" up -d --no-build caddy

printf '%s\n' "${current_tag}" > "${PREVIOUS_FILE}"
printf '%s\n' "${target_tag}" > "${TRACK_FILE}"
echo "Kod geri dönüşü tamamlandı: excelbase-v7:${target_tag}"
echo "Not: veritabanı değiştirilmedi. Veri geri dönüşü gerekiyorsa restore.sh kullanın."
