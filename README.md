# Excelbase Operations — çevrimdışı iş ve evrak merkezi

Excelbase Operations; iş dosyalarını, C kodlarını, görevleri, notları, evrakları ve Gate Visa yolcu operasyonlarını iPhone'da tek yerde yöneten kurulabilir bir PWA'dır. Ana çalışma verileri sunucuya gönderilmez: kayıt, içe aktarma, eşleştirme, filtreleme ve dışa aktarma tarayıcıda yapılır.

## Neler yapar?

- İş dosyalarını C kodu/dosya no, firma, güzergâh, sorumlu, durum, öncelik ve tarihlerle takip eder.
- Yolcu, görev, operasyon notu ve genel ofis evraklarını aynı iş dosyasına bağlar.
- C kodlarını açıklama, geçerlilik tarihi ve etiketlerle aranabilir bir arşivde tutar.
- Yolcu evraklarıyla genel PDF, Word, Excel, görsel ve yazışmaları birleşik Evrak Merkezi'nde gösterir.
- ANA, İŞLER, YOLCULAR, EVRAKLAR ve RAPORLAR için tek bir mobil çalışma alanı sunar.
- Asistan için yalnız toplu sayıları hazırlayan, kişisel veriyi dışarı taşımayan ve varsayılan olarak kapalı güvenli bir entegrasyon temeli içerir.
- Gate Visa modülünde:
  - XLSX, XLS, XLSM, ODS ve CSV yolcu listelerini; ayrıca bu dosyaları içeren ZIP arşivlerini işler.
  - Dosya adedi sınırı koymaz; dosyaları sırayla işleyerek mobil cihaz belleğini korur.
  - Yolcu kartından birden fazla PDF evrak ve JPG/JPEG biyometrik fotoğraf ekler.
  - Yolcuları tarih, durum ve metin ile filtreler; tekrarları ve eksik alanları gösterir.
  - İDO logolu günlük liste, Excel, CSV, manifest, fotoğraf/evrak ZIP'i ve teslim paketi üretir.
- Yolcu, çalışma alanı ve ikili dosya kayıtlarını Web Crypto (AES-GCM) ile cihazda şifreli saklar.
- Şifreli cihaz yedeği alır ve geri yükler.
- Uygulama kabuğu ilk başarılı açılıştan sonra çevrimdışı çalışır.

## iPhone'a kurulum

1. Yayın adresini iPhone'da **Safari** ile açın.
2. Uygulamanın “Çevrimdışı kullanıma hazır” durumuna gelmesini bekleyin.
3. **Paylaş** → **Ana Ekrana Ekle** → **Ekle** yolunu izleyin.
4. Excelbase Operations'ı bundan sonra İDO ana ekran simgesinden açın.

İlk kurulum ve yeni sürümü alma sırasında internet gerekir. Kurulumdan sonra iş dosyaları, yolcu listeleri, PDF evraklar, fotoğraflar ve çıktılar çevrimdışı kullanılabilir. iOS, ekran kapalıyken tarayıcı işlemini durdurabildiği için büyük bir içe aktarma tamamlanana kadar Excelbase Operations'ı ön planda tutun.

## Veri güvenliği ve yedek

- Kasa kodu sunucuya gönderilmez ve kurtarılamaz.
- Şifreleme anahtarı yalnızca kasa açıkken bellekte tutulur.
- IndexedDB'deki yolcu, iş dosyası, C kodu, görev, not ve evrak kayıtları şifreli içerik taşır.
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
