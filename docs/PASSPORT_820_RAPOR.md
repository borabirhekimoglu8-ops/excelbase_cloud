# 8.2.0 pasaport OCR son durum raporu

## “PDF görüntüsünden Excel’e kadar gerçekten hangi motor çalıştı ve bunu hangi görüntü tabanlı test kanıtlıyor?”

Görüntü hattında çalışan motor **PaddleOCR 3.7.0 / PaddlePaddle 3.2.2 üzerindeki
PP-OCRv6** oldu. Kanıt,
`tests/passport_ocr_protocol/generate_and_run.py` işaretli pytest protokolünün
ürettiği `frontend/src/lib/passport/__fixtures__/engine-runs/ppocrv6-synthetic.json`
dosyasıdır. Bu koşu sentetik Ada Yılmaz kaynak PNG/JPEG, ±3° eğik PNG, VIZ-only
kırpım ve `%PDF` başlıklı görüntü-PDF’den üretilmiş 250 dpi / uzun kenar 2600 /
JPEG 90 işlenmiş görüntüyü gerçek motora verdi.

PDF-raster varyantı: kaynak SHA-256
`ef63dc0be71da7b7082aa34137c529b13cb717d01840be676b632542ab902aba`
(`sources/image-pdf-250dpi.pdf`); motora giden JPEG SHA-256
`d05a2ea9bcf0738d34b3ea10a1a309d58f70b348a380b0d3bd04beed478b0d91`.
Bu koşuda PDF, pdfium/poppler ile ikinci kez rasterleştirilmedi; işlenen görüntü
PDF’e gömülen sayfa piksellerinin tarayıcı sözleşmesiyle aynı JPEG karşılığıdır.

Ham OCR satırlarında pasaport no / ad / soyad / uyruk / doğum tarihi token’ları
görüldü; TD3 çifti **doğrulanmadı** (`parser_result.verified: false`,
`pair_found: false`). Bu yüzden hiçbir motor PDF görüntüsü → doğrulanmış satır
→ operatör Excel zincirini tamamlamadı. `engineProtocol.test.ts` bu olumsuz
sonucu kilitler. “Correct” alan skorları ham OCR’de token bulunmasıdır; Excel
kanıtı değildir.

Windows veya gerçek cihaz erişimi yoktu; bu, motoru Tesseract’a çevirmek için
kullanılmadı. İki-tarayıcı paket e2e mock OCR’dir. Vault-sync çalıştırılmadı.
`compressed-pages/*.txt` yalnız `text_fixture_expected_output` ayrıştırıcı
beklenen çıktısıdır.

Tarih: 2026-09-22  
Dal: `cursor/passport-whatsapp-ocr-72a0`  
Ana dala birleştirme: yok  
Canlıya dağıtım: yok

## #91 ile #93 arasındaki sapma

Paylaşılan taban `ecb06b6` (PR #89) Tesseract’ı silmiş, metin katmanı / yapıştırma
yolunu bırakmıştı.

- PR #91 (`cursor/passport-batch-ocr-2f6a` @ `d7fbe25`, açık): onaylanan
  mimari. `backend/passportocr/` (Paddle / PP-OCRv6),
  `backend/requirements-ocr.txt`, loopback FastAPI
  `/api/passport-ocr/v1/{status,warmup,recognize}`,
  `frontend/.../ocr/localFastApiEngine.ts`. Tesseract kapsam dışı.
- PR #93 ilk hali (`be6741d` ve sonrası): WhatsApp görüntü-PDF, ülke tablosu,
  şifreli kaynak görüntü, VIZ taslağı ve seri kuyruk için #89 sonrası dalı
  yeniden yazdı; görüntü motoru olarak #91’i almadı. Bunun yerine #89 öncesi
  Tesseract.js / WASM / `mrz.traineddata` işçisini geri getirdi. PP-OCRv6
  kodu #91 dalında kaldı; #93’te “devreden çıkarmak” tek bir silme değil,
  yanlış tabandan yeniden inşa idi.

Bu tur #91 ile #93’ü körlemesine birleştirmedi. #91 motor/servis yüzeyi geri
alındı; #91’in paralel `store.ts` / `candidates.ts` / `batch.ts` katmanı
alınmadı. #93 ülke tablosu, şifreli paket, VIZ ve kuyruk PP-OCR satır
kutularına bağlandı. Tesseract WASM/lang-data silindi; sessiz fallback yok.

Uygulamanın görüntü yolu yalnız loopback FastAPI üzerindeki PaddleOCR /
PP-OCRv6’dır. Metin katmanlı PDF ve yapıştırılan MRZ, görüntü motoru hazır
olmasa da çalışır.

## Kanıt sınırı

- Gerçek PP-OCRv6 görüntü protokolü:
  `tests/passport_ocr_protocol/generate_and_run.py`.
- Durum:
  `frontend/src/lib/passport/__fixtures__/engine-runs/README.md` — **RUN**.
- Protokol yalnız `paddleocr` gerçekten kurulup motor başlatılabildiğinde
  `ppocrv6-synthetic.json` üretir. Sahte sonuç yazmaz.
- Sentetik set Ada Yılmaz / `U1000001` / `UTO` / `XXA` kullanır; temiz PNG,
  JPEG q=35, ±3° eğim, 250 dpi / 2600 px / JPEG 0.9 PDF-raster eşdeğeri ve
  VIZ-only kırpımı kapsar.
- Sentetik PNG/JPEG kaynakları ile `%PDF` başlıklı görüntü-PDF
  `engine-runs/sources/` altında saklanır; kaynak/işlenmiş SHA-256 ve raster
  parametreleri sonuç JSON’unda denetlenebilir.
- `compressed-pages/*.txt` görüntü değildir. Hash ve ayrıştırıcı beklentileri
  `expectedOutputs.ts` ile kilitlenir; OCR motoru çalıştı iddiası taşımaz.

## Uygulanan akış

1. PDF’de kullanılabilir metin katmanı varsa TD3 satırları tarayıcıda ayrıştırılır.
2. Metin katmanı yoksa PDF 250 dpi, uzun kenar en çok 2600 px, JPEG 0.9 olarak
   rasterleştirilir.
3. Görüntü, yalnız aynı kaynaktaki
   `/api/passport-ocr/v1/recognize` loopback servisine gönderilir.
4. PP-OCR satırlarından MRZ çifti aranır. Doğrulanamazsa aynı satır kutuları
   VIZ etiket eşlemesine girer ve yalnız `visual_draft` üretir.
5. Kaynak sayfa ve satır şifreli cihaz kasasında saklanır.

Motor hazır değilse görüntü kabul edilmez. Arayüz kurulum, yerel servis girişi
ve `http://127.0.0.1` gereğini gösterir; Tesseract’a geri dönüş yoktur.

## Uyruk ve Excel

Excel `Ülke Kodu 2` yalnız MRZ satır 2 uyruğundan türetilir. UTO, XXA ve diğer
özel ICAO durumları gerçek kodlarıyla korunur; ülkeye zorlanmaz. Örnek engel:

`Uyruk UTO (Ütopya (ICAO örnek belge)) bu şablonda temsil edilemiyor — Ülke Kodu 2 yok`

Böyle bir satır varken Excel dışa aktarımı tamamen durur; satır sessizce
atlanmaz. Operatör satırı siler veya ayrı işler, sonra dışa aktarır. Ülke seçici
özel durumları listeler; operatör daha önce değiştirilmiş bir satırı gerçek özel
durumuna geri alabilir.

## Şifreli iki-tarayıcı paketi

Sonuç paketi satırları ve kaynak sayfa ikililerini AES-GCM şifreli içerikte
taşır. Dış paket gövdesinde önizleme URL’si veya düz metin yolcu alanı bulunmaz.
İki ayrı tarayıcı bağlamı testi mock OCR olarak açıkça etiketlidir; motor kanıtı
değildir. İkinci, boş depolamalı bağlam paketi açar ve kaynak görüntü ile alan
dikdörtgenini blob URL üzerinden gösterir.

Bu paket testi vault-sync veya canlı HTTPS aktarımının çalıştığını kanıtlamaz.
Vault-sync bu koşuda çalıştırılmadı.

## Ortam durumu

- Windows kurulumu ve uçtan uca çalışma test edilmedi.
- Windows’un test edilmemiş olması Tesseract tutmak için gerekçe değildir.
- Canlı dağıtım yapılmadı.
- Gerçek yolcu veya operatör WhatsApp PDF’i kullanılmadı.

## Doğrulama kaydı

- Gerçek PP-OCRv6 sentetik görüntü protokolü: 1 geçti (PaddleOCR 3.7.0 /
  PaddlePaddle 3.2.2 / PP-OCRv6, lang=en).
- Ham OCR token skorları (doğrulanmış MRZ değil): temiz PNG, JPEG q=35,
  ±3° eğim ve PDF-raster 6/6 doğru; VIZ-only XXA kırpımında son kullanma
  tarihi yanlış, diğer 5 alan doğru.
- Protokol sonucu tüketen frontend testi: PDF-raster çıktı alındı, MRZ satırı
  doğrulanmadı ve Excel’e girmedi.
- Görüntü kanıtı yalnız sentetik protokole aittir; gerçek operatör belgesi
  çalıştırılmadı.
- Metin fixture / görüntü motoru ayrı raporlanır: `.txt` = ayrıştırıcı
  beklentisi; `ppocrv6-synthetic.json` = gerçek motor.
