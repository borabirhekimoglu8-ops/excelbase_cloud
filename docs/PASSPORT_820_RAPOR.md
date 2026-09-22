# 8.2.0 pasaport OCR son durum raporu

## “PDF görüntüsünden Excel’e kadar gerçekten hangi motor çalıştı ve bunu hangi görüntü tabanlı test kanıtlıyor?”

Görüntü hattında çalışan motor **PaddleOCR 3.7.0 / PaddlePaddle 3.2.2 üzerindeki
PP-OCRv6** oldu. İlk eksiksiz sentetik görüntü-PDF → doğrulanmış TUR kaydı →
operatör Excel indirme zinciri tamamlandı. Kanıt,
`tests/passport_ocr_protocol/generate_and_run.py` işaretli pytest protokolünün
ürettiği `frontend/src/lib/passport/__fixtures__/engine-runs/ppocrv6-synthetic.json`
dosyası ve gerçek FastAPI üzerinde çalışan
`frontend/e2e/passport-engine-success.spec.ts` testinin yazdığı
`flow-proof.json` dosyasıdır. `/api/passport-ocr` mock edilmedi.

Normal başarı belgesi Ada Yılmaz / `U1000001`, düzenleyen devlet `TUR`, uyruk
`TUR` (ISO-2 `TR`) olacak şekilde geçerli ICAO TD3 kontrol haneleriyle üretildi.
MRZ’de O harfi yoktur. Temiz PNG ve görüntü-PDF sayfası doğal 2600×1625
çözünürlükte, monospace MRZ en az 48 px olacak şekilde çizildi.

TUR görüntü-PDF kaynak SHA-256 değeri
`5f3095d9231ef4bcbc706932139fdf53cb2dcb012ff627c8007709e9854f18f9`;
tarayıcı sözleşmesiyle eş JPEG SHA-256 değeri
`9ce07856190a068b4bf3fd62dcdc81b812c0beb3376e0158d018e63b7215d1b3`.
Kaynak `%PDF` ile başlar ve çıkarılabilir metin katmanı yoktur.

Gerçek tarayıcı koşusunda kaynak PDF FastAPI’nin servis ettiği PWA’ya yüklendi;
PP-OCRv6 satırları `pair_found: true`, `verified: true` üretti. Ekrandaki alanlar
ADA / YILMAZ / `U1000001` / `TUR` / `TR`, `reviewStatus=verified` oldu. Kullanıcı
alan düzeltmedi; Excel indirildi ve sayfada `TR`, `U1000001`, `ADA`, `YILMAZ`
doğrulandı.

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
- Normal başarı seti Ada Yılmaz / `U1000001` / `TUR` kullanır: doğal
  2600×1625 temiz PNG ve metin katmansız görüntü-PDF.
- UTO istisna seti ayrı tutulur: JPEG q=35 ve ±3° eğik PNG. XXA VIZ-only
  istisnası da ayrı kayıttır; başarı yolu olarak kullanılmaz.
- Sentetik PNG/JPEG kaynakları ile `%PDF` başlıklı görüntü-PDF
  `engine-runs/sources/` altında saklanır; kaynak/işlenmiş SHA-256 ve raster
  parametreleri sonuç JSON’unda denetlenebilir.
- `compressed-pages/*.txt` görüntü değildir. Hash ve ayrıştırıcı beklentileri
  `expectedOutputs.ts` ile kilitlenir; OCR motoru çalıştı iddiası taşımaz.

## Eski UTO ve VIZ tanısı

Eski UTO `clean_png` koşusunda ilk kırılan aşama `ocr_charset` idi. PP-OCRv6,
iki MRZ satırındaki UTO içindeki O harfini 0 okudu. Satır 1 bu nedenle
`/^[A-Z<]{44}$/` kapısından doğru biçimde reddedildi. Kaynak UTO TD3 kontrol
haneleri geçerlidir; parser kontrolü gevşetilmedi ve metin satırına 0→O
dönüşümü eklenmedi. Yeni UTO sıkıştırılmış/eğik istisnalarında reddetme nedeni
ayrı olarak `line1_charset` kaydedilir.

Eski `viz_only_xxa` son kullanma tarihi sonucu OCR hatası değildi: 1600×520
canvas, y=580’deki “Date of expiry / 31.12.2030” satırını kaynağın dışında
bırakıyordu; skorlayıcı eksik tokenı “wrong” sayıyordu. Canvas 1600×760
yapıldı. Yeni gerçek motor koşusunda altı VIZ alanının tamamı, son kullanma
tarihi dahil, `correct`; uyruk hâlâ XXA ve görüntüde MRZ yoktur.

## Sonuç sayıları

Altı gerçek motor protokol varyantı için birbirini dışlayan sayılar:

- **A — otomatik tam doğru:** 2 (TUR temiz PNG + TUR görüntü-PDF).
- **B — kullanıcı düzeltmesinden sonra Excel:** 0.
- **C — eksik / dışa aktarılamaz:** 4 (3 UTO `line1_charset`, 1 MRZ’siz ve
  özel uyruklu XXA görsel taslak).

Gerçek tarayıcı zincirine alınan TUR görüntü-PDF alt kümesinde A=1, B=0, C=0.
Bu kayıt otomatik doğrulandı; `flow-proof.json` içindeki `edited_fields` boş ve
`excel_downloaded` true.

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
- Linux/Chromium üzerinde `http://127.0.0.1:8000` gerçek FastAPI + PWA zinciri
  çalıştırıldı; TUR görüntü-PDF’den Excel indirme tamamlandı.
- Canlı dağıtım yapılmadı.
- Gerçek yolcu veya operatör WhatsApp PDF’i kullanılmadı.

## Doğrulama kaydı

- Gerçek PP-OCRv6 sentetik görüntü protokolü: 1 geçti (PaddleOCR 3.7.0 /
  PaddlePaddle 3.2.2 / PP-OCRv6, lang=en); TUR temiz PNG ve görüntü-PDF
  `pair_found=true`, `verified=true`.
- UTO JPEG/eğik varyantları `line1_charset` ile reddedildi; TD3 kapıları
  gevşetilmedi. XXA VIZ-only kaydında altı alanın altısı doğru okundu fakat
  durum `visual_draft` olarak kaldı.
- İlgili frontend Vitest koşusu: 6 dosya, 21 test geçti; 1 karşıt skip beklenen.
- Playwright gerçek motor koşusu: 1 geçti; FastAPI `:8000`, API mock yok,
  kullanıcı düzeltmesi yok, Excel indirme ve hücre doğrulamaları başarılı.
- Görüntü kanıtı yalnız sentetik protokole aittir; gerçek operatör belgesi
  çalıştırılmadı.
- Metin fixture / görüntü motoru ayrı raporlanır: `.txt` = ayrıştırıcı
  beklentisi; `ppocrv6-synthetic.json` = gerçek motor.
