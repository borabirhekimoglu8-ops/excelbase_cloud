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

Build: `pip install -r requirements.txt`
Start: `streamlit run app.py --server.address=0.0.0.0 --server.port=$PORT`
