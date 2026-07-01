# Gate Visa PAX

Kapı vizesi yolcu listesi yönetimi. Excel (GATE VISA PAX LIST) yükle → her satır bir yolcu kartı olur. Biyometrik fotoğrafları toplu ekle, tarihe göre arşivle, telefonda uygulama gibi kullan.

## Özellikler

- **Excel/CSV import** — GATE VISA PAX LIST şablonu (iki satırlı başlık) ve esnek format tespiti.
- **Yolcu kartları** — her satır = 1 kart; arama ve tüm başlıklara göre filtre.
- **Biyometrik foto toplu import** — dosya adı `TARİH_İSİM_SOYİSİM_PASAPORT` formatında ise kartla otomatik eşleşir.
- **Arşiv** — gidiş tarihine göre gruplanmış bölümler.
- **Kalıcı saklama** — veritabanı bağlıysa veriler ve fotoğraflar kalıcıdır; değilse yerel dosya yedeği.
- **iPhone/Android PWA** — Safari'de "Ana Ekrana Ekle" ile tam ekran uygulama gibi açılır.

## Lokal kurulum

```bash
pip install -r requirements.txt
streamlit run app.py
```

## v6 hedef mimari: Next.js PWA + FastAPI

Streamlit uygulaması korunurken, yeni nesil arayüz/API temeli paralel olarak eklendi:

- `backend/` — FastAPI servis katmanı. Mevcut Excel parser, yolcu şeması ve persistence modüllerini kullanır.
- `frontend/` — Next.js PWA. Deniz laciverti / uzay siyahı konseptinde mobil öncelikli React arayüzü.

### Backend çalıştırma

```bash
pip install -r backend/requirements.txt
GATEVISA_ALLOW_DEV_NO_AUTH=1 uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

Endpointler:

- `GET /health`
- `GET /api/summary`
- `GET /api/passengers?search=...`
- `POST /api/import`

### Frontend çalıştırma

```bash
cd frontend
npm install
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev
```

Frontend varsayılan olarak `http://localhost:8000` API adresini kullanır. Production için
`NEXT_PUBLIC_API_URL` ortam değişkeni ayarlanmalıdır.

### Production güvenlik ayarları

FastAPI backend public internete açılmadan önce aşağıdaki ortam değişkenleri ayarlanmalıdır:

```bash
export GATEVISA_API_KEY="uzun-rastgele-bir-anahtar"
export GATEVISA_CORS_ORIGINS="https://frontend-domaininiz.com"
export GATEVISA_MAX_UPLOAD_FILES=5
export GATEVISA_MAX_UPLOAD_BYTES=15728640
```

Frontend tarafında aynı API anahtarı:

```bash
NEXT_PUBLIC_API_KEY="uzun-rastgele-bir-anahtar"
```

> Not: `GATEVISA_API_KEY` boş bırakılırsa backend lokal geliştirme modu gibi davranır.
> Bunun için ayrıca `GATEVISA_ALLOW_DEV_NO_AUTH=1` verilmesi gerekir. Public deployment
> için API anahtarı boş bırakılmamalı ve gerçek kullanıcı bazlı auth (JWT/OIDC/session)
> eklenmeden yolcu PII verisi internete açılmamalıdır.

## Kalıcı veritabanı (önerilir)

Veriler ve fotoğraflar bir SQL veritabanında saklanır. En kolay yol **Supabase** (ücretsiz Postgres):

1. [supabase.com](https://supabase.com) üzerinde proje oluştur.
2. **Project Settings → Database → Connection string** (URI) kopyala. Örn:
   `postgresql://postgres:[PAROLA]@db.xxxx.supabase.co:5432/postgres`
3. Streamlit Cloud'da **App → Settings → Secrets** bölümüne ekle:

   ```toml
   DATABASE_URL = "postgresql://postgres:PAROLA@db.xxxx.supabase.co:5432/postgres"
   ```

   Lokal çalışırken `.streamlit/secrets.toml` dosyasına aynı satırı koyabilir ya da
   `export DATABASE_URL=...` ortam değişkenini kullanabilirsin.

Tablolar (`app_state`, `photos`) ilk açılışta otomatik oluşturulur. Herhangi bir
SQLAlchemy uyumlu URL çalışır (Postgres, MySQL, SQLite). Veritabanı yoksa uygulama
otomatik olarak yerel dosya yedeğine geçer.

## iPhone'da uygulama gibi kullanma (PWA)

1. Uygulama linkini **Safari**'de aç.
2. **Paylaş** → **Ana Ekrana Ekle**.
3. Ana ekranda Gate Visa ikonu çıkar; tarayıcı çubuğu olmadan tam ekran açılır.

> Not: Bu bir PWA'dır (web tabanlı, ana ekrana eklenebilir uygulama). App Store'da
> dağıtılan native bir iOS uygulaması için Capacitor/React Native + Xcode + Apple
> Developer hesabı gereken ayrı bir paketleme adımı gerekir.

## Render kurulumu

Render artık v6 tek-servis Docker deploy kullanır:

- Docker build sırasında `frontend/` Next.js statik PWA olarak build edilir.
- FastAPI (`backend.main:app`) aynı servis içinde hem `/api/*` endpointlerini hem de Next çıktısını sunar.
- Public URL doğrudan yeni v6 arayüzünü açar.

Blueprint: `render.yaml`
Dockerfile: `Dockerfile`
