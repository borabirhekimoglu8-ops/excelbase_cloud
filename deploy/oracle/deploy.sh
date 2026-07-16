#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"
ENV_FILE="${SCRIPT_DIR}/.env"
TRACK_FILE="${SCRIPT_DIR}/.deployed-image"
PREVIOUS_FILE="${SCRIPT_DIR}/.previous-image"

for command_name in docker git; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Hata: ${command_name} kurulu değil." >&2
    exit 1
  fi
done
if ! docker compose version >/dev/null 2>&1; then
  echo "Hata: Docker Compose v2 eklentisi kurulu değil." >&2
  exit 1
fi
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Hata: cp deploy/oracle/.env.example deploy/oracle/.env ile başlayın." >&2
  exit 1
fi
if grep -Eq 'CHANGE_ME|example\.(com|net|org)' "${ENV_FILE}"; then
  echo "Hata: .env içindeki örnek alan adlarını ve tüm CHANGE_ME değerlerini değiştirin." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

required=(APP_DOMAIN ACME_EMAIL POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD GATEVISA_DATA_SECRET)
for variable_name in "${required[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    echo "Hata: ${variable_name} boş bırakılamaz." >&2
    exit 1
  fi
done
if [[ ! "${POSTGRES_PASSWORD}" =~ ^[A-Za-z0-9._~-]{32,}$ ]]; then
  echo "Hata: POSTGRES_PASSWORD en az 32 URL-güvenli karakter olmalı." >&2
  exit 1
fi
if [[ ! "${POSTGRES_DB}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ || ! "${POSTGRES_USER}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
  echo "Hata: POSTGRES_DB ve POSTGRES_USER yalnızca harf, rakam ve alt çizgi içerebilir." >&2
  exit 1
fi
if [[ ! "${APP_DOMAIN}" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$ ]]; then
  echo "Hata: APP_DOMAIN geçerli bir tam alan adı olmalı (https:// yazmayın)." >&2
  exit 1
fi
if [[ ! "${ACME_EMAIL}" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
  echo "Hata: ACME_EMAIL geçerli bir e-posta adresi olmalı." >&2
  exit 1
fi
if (( ${#GATEVISA_DATA_SECRET} < 32 )); then
  echo "Hata: GATEVISA_DATA_SECRET en az 32 karakter olmalı." >&2
  exit 1
fi

cd "${REPO_ROOT}"
new_tag="$(git rev-parse --short=12 HEAD)"
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  new_tag="${new_tag}-dirty-$(date -u +%Y%m%d%H%M%S)"
fi
previous_tag=""
if [[ -s "${TRACK_FILE}" ]]; then
  previous_tag="$(<"${TRACK_FILE}")"
fi

dc() {
  EXCELBASE_IMAGE_TAG="$1"
  shift
  EXCELBASE_IMAGE_TAG="${EXCELBASE_IMAGE_TAG}" docker compose \
    --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}

docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" config --quiet

if docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps --status running postgres \
  --format '{{.Service}}' 2>/dev/null | grep -qx postgres; then
  echo "Dağıtım öncesi veritabanı yedeği alınıyor..."
  "${SCRIPT_DIR}/backup.sh"
fi

echo "V7 ARM64 uyumlu imaj oluşturuluyor: excelbase-v7:${new_tag}"
dc "${new_tag}" build --pull v7-web
dc "${new_tag}" up -d postgres v7-web v7-worker

healthy=0
for _ in $(seq 1 36); do
  if dc "${new_tag}" exec -T v7-web python -c \
    "import json,urllib.request; d=json.load(urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=5)); assert d.get('database_writable') is True" \
    >/dev/null 2>&1 \
    && dc "${new_tag}" exec -T v7-worker python -c \
    "import os,time,db; p=os.environ['EXCELBASE_WORKER_HEALTH_FILE']; assert time.time()-os.path.getmtime(p)<30; assert db.probe_read() and db.probe_write()" \
    >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 5
done

if [[ "${healthy}" != "1" ]]; then
  echo "Hata: yeni V7 imajı sağlıklı olmadı." >&2
  dc "${new_tag}" logs --tail 120 v7-web v7-worker postgres >&2 || true
  if [[ -n "${previous_tag}" ]] && docker image inspect "excelbase-v7:${previous_tag}" >/dev/null 2>&1; then
    echo "Önceki imaja otomatik dönülüyor: ${previous_tag}" >&2
    dc "${previous_tag}" up -d --no-build v7-web v7-worker caddy
  fi
  exit 1
fi

setup_required="$(dc "${new_tag}" exec -T v7-web python -c \
  "import json,urllib.request; d=json.load(urllib.request.urlopen('http://127.0.0.1:8000/api/auth/status',timeout=5)); print('1' if d.get('setup_required') else '0')")"
if [[ "${setup_required}" == "1" ]]; then
  dc "${new_tag}" stop caddy >/dev/null 2>&1 || true
  printf '%s\n' "${new_tag}" > "${TRACK_FILE}"
  echo "İlk yönetici henüz yok; güvenlik için Caddy/internet erişimi başlatılmadı." >&2
  echo "Şimdi şu etkileşimli komutu çalıştırın:" >&2
  echo "docker compose --env-file deploy/oracle/.env -f deploy/oracle/docker-compose.yml exec v7-web python -m backend.bootstrap_admin" >&2
  echo "Ardından ./deploy/oracle/deploy.sh komutunu yeniden çalıştırın." >&2
  exit 3
fi

dc "${new_tag}" up -d caddy

if [[ -n "${previous_tag}" && "${previous_tag}" != "${new_tag}" ]]; then
  printf '%s\n' "${previous_tag}" > "${PREVIOUS_FILE}"
fi
printf '%s\n' "${new_tag}" > "${TRACK_FILE}"

echo "Dağıtım sağlıklı: https://${APP_DOMAIN}/health"
echo "V8 yayınlanmadı; https://${APP_DOMAIN}/v8 adresi 404 dönmelidir."
