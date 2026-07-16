# Gate Visa PAX — V7

Kapı vizesi yolcu listesi yönetimi. Excel (GATE VISA PAX LIST) yükle → her satır bir yolcu kartı olur. Biyometrik fotoğrafları toplu ekle, tarihe göre arşivle, eksikleri düzelt, teslim paketi oluştur — hepsi telefonda native uygulama gibi.

**V7**, eski Streamlit uygulamasının **tüm fonksiyonlarını** modern tek servise taşır: **FastAPI backend + Next.js PWA**. Streamlit dosyası (`app.py`) referans olarak repoda kalır ama Render'da yayınlanan tek servis artık V7'dir.

## Özellikler (V7)

- **Ana (Kokpit)** — operasyon hazırlık yüzdesi, bugünkü operasyon, özet metrikler, hızlı aksiyonlar, son hareketler.
- **Yolcular** — arama, durum filtresi (Hazır/Eksik/Fotosuz/Pasaportsuz/Tekrarlı), sıralama, sayfalama, toplu seçim + silme, kart detayında düzenleme.
- **Eksikler** — kategori sayaçları, hazırlık ısı çubuğu, hızlı düzeltme (detay aç / doğrudan foto ata), tekrarlı pasaport birleştirme.
- **Galeri** — eşleşmiş biyometrik fotoğraflar, ZIP indirme.
- **Arşiv** — gidiş tarihine göre gruplar, tarih bazlı Excel/CSV/Foto indirme, operasyon durumu/görevli/not kaydı.
- **Import** — Excel/CSV içe aktarma (değiştir / ekle / atla / üzerine yaz), foto & ZIP otomatik eşleştirme, şablon indirme, import geçmişi.
- **Paket** — teslim paketi (ZIP: Excel + CSV + rapor + fotoğraflar), yazdırılabilir manifest, JSON yedek al / geri yükle, tümünü temizle.
- **iPhone/Android PWA** — Safari'de "Ana Ekrana Ekle" ile tam ekran, alt tab bar ile native gezinme, HEIC foto desteği.

## Mimari

- `backend/` — FastAPI servis katmanı. Mevcut Excel parser, yolcu şeması, persistence ve foto modüllerini kullanır. Tüm iş mantığı REST endpoint'lerinden sunulur ve Next.js statik çıktısını da aynı servisten yayınlar.
- `frontend/` — Next.js PWA (deniz laciverti / uzay siyahı holografik tema, mobil öncelikli React).
- `app.py` + yardımcı modüller — orijinal Streamlit uygulaması (referans / iş mantığı kaynağı).

### Tamamen çevrimdışı iPhone sürümü

`ios/` altındaki native SwiftUI uygulaması; Excel/ZIP işlemlerini Rust çekirdeğiyle, yolcu ve fotoğraf verilerini ise iPhone'un korumalı yerel alanında yönetir. Kurulduktan sonra internet, sunucu veya açık ofis bilgisayarı gerektirmez.

- [iOS Offline mimarisi](docs/IOS_OFFLINE_ARCHITECTURE.md)
- [V7 → iOS işlev eşliği ve saha kabul ölçütleri](docs/IOS_PARITY_MATRIX.md)

### API endpoint'leri

| Alan | Endpoint |
| --- | --- |
| Sağlık | `GET /health` |
| Özet | `GET /api/summary` |
| Yolcular | `GET /api/passengers?search=&status=&sort=` |
| Güncelle/Sil | `PATCH /api/passengers/{id}` · `DELETE /api/passengers/{id}` |
| Toplu sil / temizle | `POST /api/passengers/bulk-delete` · `POST /api/passengers/clear` |
| Import | `POST /api/import?replace=&dup_strategy=` |
| Foto | `POST /api/passengers/{id}/photo` · `DELETE .../photo` · `POST /api/photos/match` · `GET /api/photo/{ref}` |
| Tekrarlı | `POST /api/merge-duplicates` |
| Arşiv | `GET /api/archive?range=` · `POST /api/operation-meta` |
| Çıktı | `GET /api/export?kind=` · `GET /api/manifest` · `GET /api/package` · `GET /api/photos-zip` · `GET /api/template` |
| Yedek | `GET /api/backup` · `POST /api/restore` |
| Demo | `POST /api/demo` |

## Lokal çalıştırma

Backend (Next build ile aynı servisten sunmak için önce frontend build alın):

```bash
pip install -r backend/requirements.txt
cd frontend && npm install && npm run build && cd ..
GATEVISA_ALLOW_DEV_NO_AUTH=1 uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
# http://localhost:8000
```

Frontend'i ayrı geliştirme sunucusunda çalıştırmak isterseniz:

```bash
cd frontend
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev
```

### Production güvenlik ayarları

Yolcu PII verisi internete açılmadan önce API anahtarı ayarlanmalıdır:

```bash
export GATEVISA_API_KEY="uzun-rastgele-bir-anahtar"
export GATEVISA_CORS_ORIGINS="https://frontend-domaininiz.com"
```

Frontend build'inde aynı anahtar (görsel/indirmeler query param `?k=` ile de gönderilir):

```bash
NEXT_PUBLIC_API_KEY="uzun-rastgele-bir-anahtar"
```

> `GATEVISA_API_KEY` boşsa backend yalnızca `GATEVISA_ALLOW_DEV_NO_AUTH=1` ile açılır (lokal geliştirme).

## Kalıcı veritabanı (önerilir)

Render free plan diski kalıcı değildir. Veri ve fotoğrafların kalıcı olması için `DATABASE_URL` (Postgres) ayarlayın:

```
DATABASE_URL = "postgresql://postgres:PAROLA@db.xxxx.supabase.co:5432/postgres"
```

Tablolar (`app_state`, `photos`) otomatik oluşturulur. DB yoksa uygulama yerel dosya yedeğine geçer.

## Render kurulumu

- Tek servis, Docker deploy (`render.yaml` + `Dockerfile`).
- Docker build sırasında `frontend/` statik PWA olarak build edilir; FastAPI hem `/api/*` hem de PWA'yı sunar.
- Public URL doğrudan V7 arayüzünü açar.

## iPhone'da uygulama gibi kullanma (PWA)

1. Uygulama linkini **Safari**'de aç.
2. **Paylaş** → **Ana Ekrana Ekle**.
3. Ana ekranda Gate Visa ikonu ile tam ekran açılır.
