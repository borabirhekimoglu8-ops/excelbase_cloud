# Excelbase Operations — çevrimdışı iş ve evrak merkezi

Excelbase Operations; iş dosyalarını, C kodlarını, görevleri, notları, evrakları ve Gate Visa yolcu operasyonlarını iPhone'da tek yerde yöneten kurulabilir bir PWA'dır. Ana çalışma verileri sunucuya gönderilmez: kayıt, içe aktarma, eşleştirme, filtreleme ve dışa aktarma tarayıcıda yapılır.

## Neler yapar?

- İş dosyalarını C kodu/dosya no, firma, güzergâh, sorumlu, durum, öncelik ve tarihlerle takip eder.
- Yolcu, görev, operasyon notu ve genel ofis evraklarını aynı iş dosyasına bağlar.
- C kodlarını açıklama, geçerlilik tarihi ve etiketlerle aranabilir bir arşivde tutar.
- Yolcu evraklarıyla genel PDF, Word, Excel, görsel ve yazışmaları birleşik Evrak Merkezi'nde gösterir.
- ANA, İŞLER, YOLCULAR, EVRAKLAR ve RAPORLAR için tek bir mobil çalışma alanı sunar.
- Uygulama içindeki bağımsız Claude Sonnet çalışma alanında gerçek sohbet sunar; otomatik bağlam yalnız toplu operasyon sayılarını içerir.
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
- Sonnet için açılan çevrimiçi oturum cihaz kasasından ayrıdır; kasa PIN'i arka planda sunucuya gönderilmez.
- Anthropic API anahtarı yalnız FastAPI/Render ortamında tutulur; PWA paketine, IndexedDB'ye veya API yanıtına girmez.
- Şifreleme anahtarı yalnızca kasa açıkken bellekte tutulur.
- IndexedDB'deki yolcu, iş dosyası, C kodu, görev, not ve evrak kayıtları şifreli içerik taşır.
- Kasa kodunu unutmak cihazdaki veriyi erişilemez yapar.
- Safari verisini silmeden, cihaz değiştirmeden veya uygulamayı kaldırmadan önce **Paket → Şifreli yedek al** ile yedeği Dosyalar'a kaydedin.

## Mimari

- `frontend/` — statik Next.js PWA, IndexedDB veri katmanı, Web Crypto kasası, dosya ayrıştırıcıları ve yerel çıktı üreticileri.
- `frontend/public/sw.js` — uygulama kabuğunu sürümleyip çevrimdışı açılışı sağlayan service worker.
- `backend/` — statik üretim çıktısını, sağlık kontrolünü ve kimliği doğrulanmış Sonnet proxy'sini sunan FastAPI katmanı. Ana PWA çalışma verisi için bu API'ye bağlı değildir.
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

## Claude Sonnet yapılandırması

Sonnet çağrıları doğrudan tarayıcıdan yapılmaz. Üretimde Render servisinin gizli
değişkenlerine `ANTHROPIC_API_KEY` ve ilk yönetici oluşturulmadan önce güçlü,
rastgele bir `GATEVISA_BOOTSTRAP_TOKEN` eklenir. Kurulum ekranındaki “İlk
kurulum anahtarı” alanına bu ikinci değer girilir; ilk hesap açıldıktan sonra
Render'daki değer kaldırılabilir veya döndürülebilir. Gizli değerler repoya ya
da istemci paketine yazılmaz.

`render.yaml` şu güvenli varsayılanları tanımlar:

- sağlayıcı: `anthropic`
- model: `claude-sonnet-5`
- en fazla 1.200 çıktı tokenı
- kullanıcı başına dakikada 6/günde 100 ve kurulum genelinde günde 200 istek
- 35 saniye zaman aşımı ve aynı anda en fazla 2 çağrı
- PostgreSQL üzerinde kalıcı kota ve `X-Request-ID` yinelenen istek koruması
- yalnız otomatik bağlam toplu ve PII içermeyen verilerle sınırlı; yazılan
  mesaj ve konuşma geçmişi Anthropic'e gider, ham evrak aktarımı kapalı
- bugün etkin veri yeteneği yalnız ekrandaki toplu operasyon özetidir; dosya,
  evrak ve yolcu arama araçları ayrıca uygulanıp incelenmeden ilan edilmez

İlk kullanımda asistan ekranı ayrı bir çevrimiçi erişim kodu ister ve HttpOnly
oturum çerezi oluşturur. Bu kod cihaz kasasının PIN'i olmak zorunda değildir.
Üretim anahtarı açılmadan önce Anthropic Console'da Excelbase için ayrı bir
Workspace ve düşük harcama limiti ayarlanmalıdır; uygulamadaki istek kotaları
bu sağlayıcı tarafı bütçe sınırının yerini almaz.

## Yayın

`Dockerfile`, frontend'i statik olarak derler ve FastAPI imajına kopyalar. `render.yaml` mevcut Render servislerini tanımlar. Yeni dağıtımda service worker sürümü değiştiğinde uygulama güncelleme bildirimi gösterir; kullanıcı onayladığında yeni kabuk etkinleşir.
