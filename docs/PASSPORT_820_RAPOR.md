# 8.2.0 pasaport OCR son durum raporu

## “PDF görüntüsünden Excel’e kadar gerçekten hangi motor çalıştı ve bunu hangi görüntü tabanlı test kanıtlıyor?”

Çalışan motor **PP-OCRv6 (PaddleOCR 3.7.x)** oldu.
`tests/passport_ocr_protocol/generate_and_run.py`, Ada Yılmaz sentetik kaynak
görüntülerini ve gerçek bir görüntü-PDF’den hazırlanmış PDF-raster eşdeğerini
motora verir; kanıtı
`frontend/src/lib/passport/__fixtures__/engine-runs/ppocrv6-synthetic.json`
dosyasına yazar. JSON artık kaynak yolu/türü/SHA-256 değerini, motora gerçekten
gönderilen görüntünün SHA-256 değerini, PDF raster ayarlarını ve işlenmiş
boyutları, yüklü `paddleocr`/`paddlepaddle` paket sürümlerini, ham OCR
satırlarını, ayrıştırıcı sonucunu, kritik alan skorlarını ve süreyi kaydeder.

Ancak hiçbir motor bu koşuda doğrulanmış MRZ → Excel akışını tamamlamadı.
Özellikle PDF-raster motor çıktısındaki MRZ doğrulanmadı ve Excel’e alınmadı;
PDF → Excel başarısı iddia edilmez. `frontend/src/lib/passport/engineProtocol.test.ts`
bu olumsuz sonucu kilitler. Windows test edilmedi. İki-tarayıcı paket e2e testi
mock OCR kullanır ve motor kanıtı değildir. Vault-sync çalıştırılmadı.
`compressed-pages/*.txt` dosyaları görüntü OCR’ı değil, yalnız
`text_fixture_expected_output` etiketli ayrıştırıcı beklenen çıktılarıdır.

Sentetik belge ülke olmayan UTO kodunu taşır; bu da doğrulansa bile ilgili
Excel şablonunun ISO-2 ülke alanına zorlanmaz.

Uygulamanın görüntü yolu artık yalnız loopback FastAPI üzerindeki PaddleOCR /
PP-OCRv6 servisidir. Tesseract çalışma zamanı, bağımlılığı, worker/WASM
dosyaları ve tanıma yolu kaldırıldı. Metin katmanlı PDF ile yapıştırılan MRZ,
görüntü motoru hazır olmasa da çalışır.

Tarih: 2026-09-22  
Dal: `cursor/passport-whatsapp-ocr-72a0`  
Ana dala birleştirme: yok  
Canlıya dağıtım: yok

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

Bu satırlar Excel’den atlanır. Dışa aktarılabilir başka satır yoksa Excel
düğmesi kapalı kalır. Ülke seçici özel durumları listeler; operatör daha önce
değiştirilmiş bir satırı gerçek özel durumuna geri alabilir.

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

- Gerçek PP-OCRv6 sentetik görüntü protokolü: 1 geçti.
- Protokol sonucu tüketen frontend testi: PDF-raster çıktı alındı, MRZ satırı
  doğrulanmadı ve Excel’e girmedi.
- Görüntü kanıtı yalnız sentetik protokole aittir; gerçek operatör belgesi
  çalıştırılmadı.
