# Excelbase — çevrimdışı yolcu operasyonları

Excelbase; yolcu listelerini, biyometrik fotoğrafları ve teslim paketlerini iPhone'da işleyen kurulabilir bir PWA'dır. Ana uygulamanın çalışma verileri sunucuya gönderilmez: içe aktarma, eşleştirme, filtreleme ve dışa aktarma tarayıcıda yapılır.

## Neler yapar?

- XLSX, XLS, XLSM, ODS ve CSV yolcu listelerini; ayrıca bu dosyaları içeren ZIP arşivlerini işler.
- Dosya adedi sınırı koymaz; dosyaları sırayla işleyerek mobil cihaz belleğini korur.
- Yolcu kayıtlarını ve kaynak dosyaları Web Crypto (AES-GCM) ile cihazda şifreli saklar.
- Fotoğraf ve fotoğraf ZIP'lerini pasaport numarası veya benzersiz ad eşleşmesiyle yolculara bağlar.
- Yolcuları tarih, durum ve metin ile filtreler; tekrarları ve eksik alanları gösterir.
- Excel, CSV, manifest, fotoğraf ZIP'i ve eksiksiz teslim paketi üretir.
- Şifreli cihaz yedeği alır ve geri yükler.
- Uygulama kabuğu ilk başarılı açılıştan sonra çevrimdışı çalışır.

## iPhone'a kurulum

1. Yayın adresini iPhone'da **Safari** ile açın.
2. Uygulamanın “Çevrimdışı kullanıma hazır” durumuna gelmesini bekleyin.
3. **Paylaş** → **Ana Ekrana Ekle** → **Ekle** yolunu izleyin.
4. Excelbase'i bundan sonra ana ekran simgesinden açın.

İlk kurulum ve yeni sürümü alma sırasında internet gerekir. Kurulumdan sonra yolcu listeleri, fotoğraflar ve çıktılar çevrimdışı kullanılabilir. iOS, ekran kapalıyken tarayıcı işlemini durdurabildiği için büyük bir içe aktarma tamamlanana kadar Excelbase'i ön planda tutun.

## Veri güvenliği ve yedek

- Kasa kodu sunucuya gönderilmez ve kurtarılamaz.
- Şifreleme anahtarı yalnızca kasa açıkken bellekte tutulur.
- IndexedDB'deki yolcu, iş ve dosya kayıtları şifreli içerik taşır.
- Kasa kodunu unutmak cihazdaki veriyi erişilemez yapar.
- Safari verisini silmeden, cihaz değiştirmeden veya uygulamayı kaldırmadan önce **Paket → Şifreli yedek al** ile yedeği Dosyalar'a kaydedin.

## Mimari

- `frontend/` — statik Next.js PWA, IndexedDB veri katmanı, Web Crypto kasası, dosya ayrıştırıcıları ve yerel çıktı üreticileri.
- `frontend/public/sw.js` — uygulama kabuğunu sürümleyip çevrimdışı açılışı sağlayan service worker.
- `backend/` — statik üretim çıktısını ve sağlık kontrolünü sunan mevcut FastAPI katmanı. Ana PWA çalışma verisi için bu API'ye bağlı değildir.
- `v8/` — ayrı tutulan eski/deneysel ilişkisel servis; ana PWA arayüzünde V8 sayfası bulunmaz.

## Yerel geliştirme

Frontend:

```bash
cd frontend
npm ci
npm run dev
```

Üretim çıktısı ve kontroller:

```bash
cd frontend
npm run lint
npm test
npm run build
```

FastAPI üzerinden üretim çıktısını sunmak için:

```bash
pip install -r backend/requirements.txt
cd frontend && npm ci && npm run build && cd ..
GATEVISA_ALLOW_DEV_NO_AUTH=1 uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

PWA özellikleri `localhost` veya HTTPS üzerinde kullanılabilir.

## Yayın

`Dockerfile`, frontend'i statik olarak derler ve FastAPI imajına kopyalar. `render.yaml` mevcut Render servislerini tanımlar. Yeni dağıtımda service worker sürümü değiştiğinde uygulama güncelleme bildirimi gösterir; kullanıcı onayladığında yeni kabuk etkinleşir.
