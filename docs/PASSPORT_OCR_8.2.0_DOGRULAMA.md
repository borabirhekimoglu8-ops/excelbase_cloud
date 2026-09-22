# 8.2.0 pasaport OCR — kullanım doğrulama raporu

**Karar:** Linux ofis-PC yolunda gerçek PP-OCRv6 ile uçtan uca akış **geçti**. Ana dala birleştirmeyin; Windows/macOS ve paket görüntü aktarımı kapanmadan canlıya almayın.

| | |
|---|---|
| Dal | `cursor/passport-batch-ocr-2f6a` |
| Taslak PR | [#91](https://github.com/borabirhekimoglu8-ops/excelbase_cloud/pull/91) |
| Sürüm | 8.2.0 |
| Ortam | Linux x86_64, 4 vCPU Xeon, 15 GB RAM, CPU |
| Motor | PaddleOCR 3.7 / PP-OCRv6 (mock yok) |
| Tarih | 22 Eylül 2026 |
| Veri | Sentetik: Ada Yılmaz, ICAO UTO ERIKSSON / ANNA MARIA. Gerçek yolcu yok. |

---

## 1. Ne doğrulandı

| Madde | Sonuç |
|---|---|
| FastAPI + gerçek PP-OCRv6 + PWA birlikte | Geçti (`http://127.0.0.1:8000`) |
| Görüntü-PDF → OCR → düzeltme → onay → Excel | Geçti |
| Boş zorunlu alan onay/Excel’i keser | Geçti (`UTO` ülke boş → butonlar kapalı; `TR` yazınca açıldı) |
| 20 sayfalık görüntü-PDF (net / eğik / JPEG / kesik MRZ) | Sayılar §2 |
| Yenileme: onaylı satır + düzeltme kalır, mükerrer yok | Geçti |
| Kesilen iş “kapanmış; yeniden dene” der | Geçti |
| Servis kapanınca satırlar durur, yeniden deneme bekler | Geçti |
| Şifreli paket → HTTPS PWA içe aktarma | Yolcu / düzeltme / onay geçti; **görüntü geçmedi** |
| Model önbelleğinden sonra ağ kapalı OCR | Geçti |
| Windows | **Henüz test edilmedi** |
| macOS | **Henüz test edilmedi** |

Mock OCR veya yalnız statik sunucu kullanılmadı.

---

## 2. 20 sayfa — alan sayıları

Zorunlu alanlar: soyad, ad, pasaport no, ülke (ISO2), doğum, bitiş, belge tipi.

Süre: model yükleme **2,4 s** + 20 sayfa tanıma **39,2 s**.

| Sonuç | Sayı | Anlamı |
|---|---|---|
| Doğru | **97** | Operatör düzeltmeden isabet |
| Yanlış | **0** | Yanlış değer üretilmedi |
| Boş | **42** | 6 sayfa hiç eşleşmedi (7 alan × 6) |
| Beklenen boş | **1** | `UTO` ülke kodu (kurgusal ICAO; ISO2 yok) |
| Kontrolden geçip yanlış | **0** | Sessiz kabul yok |

Sayfa kalitesi:

| Varyant | Tamam |
|---|---|
| Net | 7/8 (eksik olan sayfa 1 yalnızca `UTO` ülke) |
| Eğik | 4/4 |
| Sıkıştırılmış JPEG | 2/4 |
| Eğik + sıkışık | 0/1 |
| MRZ kesik | 0/3 |

Boş kalan sayfalar onay ve Excel’e girmedi. Bu doğru davranış.

---

## 3. Ad satırı neden kaçıyordu?

Aşama: **karakter tanıma** — metin tespiti veya alan eşlemesi değil.

Önceki sert örnekte 2 satır / 88 karakter vardı, pasaport jetonu okunuyordu, soyad jetonu OCR metninde yoktu. Test görseli büyütülmedi, kolaylaştırılmadı.

Bu koşuda aynı ICAO örneği (görsel alanda kocaman isim yok, gerçekçi 300 dpi MRZ) 2 satır, 44+44, `P` ile başlayan üst satır, soyad eşleşmesi verdi (~1,1 s).

Parser kuralı duruyor: ad/soyad tek çözümle doğrulanmazsa **boş bırakılır**, uydurulmaz. `UTO` gibi bilinmeyen ülke de ISO2’ye kısaltılmaz; operatör yazar.

---

## 4. Paket ve dayanıklılık

- Yerel dışa aktarma → HTTPS içe aktarma: ERIKSSON / ANNA MARIA / L898902C3 / **TR** / onaylı / tek satır.
- Kaynak görüntü **taşınmadı** (`Kaynak görüntü yok`). `page_id` gelir, sayfa PNG/PDF gelmez.
- Sayfa yenileme + kasa PIN: onay ve `TR` durdu, ikinci satır oluşmadı.
- OCR sırasında yenileme: işlenen sayfalar “Uygulama işlem sırasında kapanmış; yeniden dene”.
- Servis kapanınca tamamlananlar durdu; açık işler yeniden deneme bekledi.
- Aynı anda birkaç “Yeniden dene” → **429 / meşgul** (eşzaman 1). Tek tek denemek gerekir.

Doğrulama sırasında üç kullanım hatası düzeltildi (yeni özellik değil):

1. Üretimde `Secure` çerez `http://127.0.0.1` jar’ını düşürüyordu (özellikle Safari).
2. `warmup` ilk çağrıda 500 veriyordu.
3. İlk durum `engine_missing` görünüp modeli hiç ısıtmıyordu; kasa açılınca kuyruktaki sayfalar “kapanmış” işaretlenmiyordu.

---

## 5. Öneriler (öncelik sırası)

**Birleştirmeyin / canlıya almayın** ta ki 1–3 bitsin.

1. **Ofis PC’de Windows ve mümkünse bir macOS denemesi**  
   Linux sonucu diğerlerini kanıtlamaz. Aynı akış: `.\run.ps1` / `./run.sh` → `http://127.0.0.1:8000` → bir taranmış PDF → onay → Excel → paket. Safari’de çerez düzeltmesini özellikle kontrol edin.

2. **Pakete sayfa görüntüsü (veya kaynak dosya) ekleyin**  
   HTTPS PWA’da operatör şu an kaydı görür, pasaport resmini görmez. Düzeltme kalitesi düşer. Şifreli pakete `keep_page_images` ile sayfa blob’u koymak, “kaynak bağlantısı” vaadini tamamlar. İçe aktarmada mevcut `id` atlanır (mükerrer yok) — bu kalsın.

3. **Yeniden denemeyi kuyruğa alın**  
   Eşzaman 1 iken ikinci tıklama 429 oluyor. Butonu iş bitene kadar kilitleyin veya sunucuda bekletin. Operatöre “meşgul, sıradasın” deyin.

4. **Tarama kalitesi için ofis kuralı yazın**  
   Motor uydurmasın diye kesik/kötü JPEG’i boş bırakıyor — doğru. Operatöre: düz tarama, MRZ’nin tamamı karede, ağır WhatsApp sıkıştırması yok. iPhone’da Live Text ile iki MRZ satırını yapıştırmak birincil yol olarak kalsın.

5. **Ülke kodu boşluğunu UI’da açıklayın**  
   `UTO` / bilinmeyen 3 harf sessizce `TR` olmamalı (şimdi olmuyor). Satırda “ülke eşleşmedi, 2 harf yazın” yeter; aksi halde “OCR bozuldu” sanılır.

6. **Kurulum metnini netleştirin**  
   OCR yalnız kapalı kurulumda açılır: `EXCELBASE_ASSISTANT_OPEN_ACCESS=0` **veya** `OPEN_ACCESS=1` + `ALLOWED_IPS=127.0.0.1`. İkisi birden boş/açık olursa OCR kapalıdır. İlk model indirmesi internet ister; sonra kapalı çalışır.

7. **Canlı HTTPS’e OCR koymayın**  
   Karışık içerik / iPhone localhost tuzak. Mimari doğru: ofis PC’de işle, paketi telefona al. Güvenliği kapatmayı önermeyin.

8. **İlk ofis günü için küçük deneme seti**  
   3 net + 1 eğik + 1 kötü JPEG. 20 sayfalık sentetik set birim testi olarak kalsın; gerçek pasaport kullanmayın.

---

## 6. Ofiste ilk deneme

Linux bu raporda doğrulandı. Windows/macOS aynı adımlar; henüz kanıtlanmadı.

1. Python 3.11+, ilk derleme için Node 20+.
2. Dal: `cursor/passport-batch-ocr-2f6a`.
3. `cp .env.example .env`
4. `.env`:
   - `BIND_ADDRESS=127.0.0.1`
   - `HOST_PORT=8000`
   - `EXCELBASE_PASSPORT_OCR=1`
   - `EXCELBASE_ASSISTANT_OPEN_ACCESS=0` **veya** `1` + `EXCELBASE_ASSISTANT_ALLOWED_IPS=127.0.0.1`
5. Linux/macOS: `./run.sh` — Windows: `.\run.ps1`. İlk sefer model iner.
6. Tarayıcı: **http://127.0.0.1:8000** — canlı HTTPS adres değil.
7. Kasa adı + 6 haneli PIN → Kapı → Pasaport MRZ.
8. Kart **Yerel OCR hazır** olana kadar “Durumu yenile”.
9. Taranmış PDF yükle → boş zorunlu alanları doldur → Satırı onayla → Excel indir.
10. Telefondaki PWA için: Paket dışa aktar, kodu ayrı gönder, orada Paket içe aktar.

---

## 7. Özet

8.2.0 Linux’ta gerçek motorla işe yarıyor ve boş/yanlış alanı sessizce Excel’e basmıyor. Birleştirmeyi Windows denemesi + paket görüntüsü + yeniden deneme kuyruğuna bağlayın.
