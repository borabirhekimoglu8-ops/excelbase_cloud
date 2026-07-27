#!/usr/bin/env bash
# Excelbase Operations — Docker'sız çalıştırma (macOS / Linux).
#
#   ./run.sh                ilk sefer kurar, sonra başlatır
#   SKIP_BUILD=1 ./run.sh   frontend'i yeniden derlemeden başlatır
#
# Gerekenler: Python 3.11+ ve Node.js 20+ (yalnızca ilk derleme için).
# Veritabanı SQLite dosyasıdır; kurulacak bir sunucu yoktur.

set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
    cp .env.example .env
    echo "  .env oluşturuldu."
fi

# Şifreleme anahtarını insan uydurmamalı: rastgeleliği burada üretmek hem daha
# güvenli hem de kurulumdan bir adım siler.
if ! grep -qE '^GATEVISA_DATA_SECRET=.+$' .env; then
    secret=$(head -c 48 /dev/urandom | base64 | tr -d '\n')
    if grep -qE '^GATEVISA_DATA_SECRET=' .env; then
        tmp=$(mktemp)
        sed "s|^GATEVISA_DATA_SECRET=.*$|GATEVISA_DATA_SECRET=$secret|" .env > "$tmp" && mv "$tmp" .env
    else
        printf '\nGATEVISA_DATA_SECRET=%s\n' "$secret" >> .env
    fi
    echo "  Şifreleme anahtarı üretildi ve .env içine yazıldı."
fi

# Satırları ortama taşı. Tırnaklar kırpılır: panodan yapıştırılan bir değer
# tırnaklarıyla gelirse Anthropic onu geçersiz anahtar sayardı.
while IFS= read -r line; do
    case "$line" in ''|'#'*) continue ;; esac
    case "$line" in *=*) ;; *) continue ;; esac
    name=${line%%=*}
    value=${line#*=}
    value=$(printf '%s' "$value" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/")
    export "${name// /}=$value"
done < .env

# Postgres yerine tek dosya. Kurulum gerektirmez, yedeklemesi kopyalamaktır.
if [ -z "${DATABASE_URL:-}" ]; then
    mkdir -p .data
    export DATABASE_URL="sqlite:///$(pwd)/.data/excelbase.db"
fi
export APP_ENV="${APP_ENV:-production}"
export GATEVISA_REQUIRE_AUTH="${GATEVISA_REQUIRE_AUTH:-1}"
# Doğrudan erişilen bir süreç: önünde vekil yok.
export EXCELBASE_ASSISTANT_TRUSTED_PROXY_HOPS="${EXCELBASE_ASSISTANT_TRUSTED_PROXY_HOPS:-0}"

BIND="${BIND_ADDRESS:-127.0.0.1}"
PORT="${HOST_PORT:-8000}"

if [ ! -d .venv ]; then
    echo "Python ortamı kuruluyor..."
    python3 -m venv .venv
    ./.venv/bin/python -m pip install --upgrade pip --quiet
fi

# Bağımlılıklar yalnızca .venv yokken kurulsaydı, `git pull` ile gelen yeni bir
# paket hiçbir zaman kurulmazdı: uygulama eski paketlerle sessizce çalışır ve
# yeni özellik "açmadım mı?" diye aranırdı. Damga dosyası son kurulumdan bu yana
# requirements değişti mi sorusunu cevaplar.
stamp=.venv/.requirements-installed
if [ ! -f "$stamp" ] || [ requirements.txt -nt "$stamp" ] || [ backend/requirements.txt -nt "$stamp" ]; then
    echo "Python bağımlılıkları kuruluyor/güncelleniyor..."
    ./.venv/bin/python -m pip install -r backend/requirements.txt --quiet
    touch "$stamp"
fi

# FastAPI, frontend/out içindeki statik çıktıyı servis eder. Kaynaklardan biri
# derlemeden yeniyse yeniden derlenir; yoksa `git pull` ile gelen arayüz
# değişikliği tarayıcıya hiç ulaşmaz ve "çalışmıyor" gibi görünür.
frontend_is_stale() {
    [ -f frontend/out/index.html ] || return 0
    local newer=""
    # Paths are listed explicitly rather than globbed: an unmatched glob would
    # be passed to find literally. `|| true` because find still exits non-zero
    # after reporting a path that no longer exists, and `set -e` would take
    # that as a reason to stop the whole script.
    newer=$(find \
        frontend/src \
        frontend/public \
        frontend/package.json \
        frontend/package-lock.json \
        frontend/next.config.ts \
        frontend/tsconfig.json \
        -newer frontend/out/index.html -print -quit 2>/dev/null) || true
    [ -n "$newer" ]
}

if [ -z "${SKIP_BUILD:-}" ] && frontend_is_stale; then
    echo "Arayüz derleniyor (ilk sefer birkaç dakika)..."
    (
        cd frontend
        if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then npm ci; fi
        npm run build
    )
fi

echo
echo "  Excelbase çalışıyor:  http://$BIND:$PORT"
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    # Uygulamanın geri kalanı anahtarsız çalışır; yalnızca asistan kapalı olur.
    echo "  Claude asistanı kapalı. Açmak için .env içindeki ANTHROPIC_API_KEY"
    echo "  satırına anahtarınızı yazıp betiği yeniden çalıştırın."
fi
echo "  Durdurmak için: Ctrl+C"
echo

exec ./.venv/bin/python -m uvicorn backend.main:app --host "$BIND" --port "$PORT"
