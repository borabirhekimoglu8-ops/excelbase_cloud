# Pasaport OCR 8.2.0

## Hangi motor çalıştı, hangi görüntü testi kanıtlıyor?

PDF-raster → OCR → doğrulanmış satır yolunda PaddleOCR 3.7.0 üzerindeki
**PP-OCRv6** çalıştı. Görüntü kanıtı, işaretli pytest
`tests/passport_ocr_protocol/generate_and_run.py` ve onun ürettiği
`frontend/src/lib/passport/__fixtures__/engine-runs/ppocrv6-synthetic.json`
dosyasıdır. `engineProtocol.test.ts` gerçek PDF-raster motor çıktısını frontend
satır boru hattında doğrular.

Sentetik satır UTO taşıdığı için Excel şablonunda temsil edilemez ve indirme
bilinçli olarak kapalıdır. Dolayısıyla motor-kaynaklı başarılı Excel dosyası
iddiası yoktur. `compressed-pages/*.txt` dosyaları yalnız ayrıştırıcı için
beklenen/kaydedilmiş metin çıktılarıdır; görüntü veya OCR motoru kanıtı değildir.

Görüntü yolu yalnız yerel FastAPI içindeki PaddleOCR / PP-OCRv6 servisidir.
Tesseract bağımlılığı, worker/WASM varlıkları ve tanıma yolu yoktur; motor
hazır değilse görüntü reddedilir.

## Ofis PC kurulumu

`.env`:

```dotenv
BIND_ADDRESS=127.0.0.1
EXCELBASE_ASSISTANT_OPEN_ACCESS=0
EXCELBASE_PASSPORT_OCR=1
EXCELBASE_PASSPORT_OCR_VERSIONS=PP-OCRv6
EXCELBASE_PASSPORT_OCR_LANG=en
```

`./run.sh` veya Windows’ta `run.ps1` ile başlatın, yerel servis oturumunu açın
ve uygulamayı `http://127.0.0.1:8000` adresinden kullanın. Görüntü OCR’si LAN
hostundan veya canlı HTTPS PWA’dan çağrılmaz. Metin katmanlı PDF ve MRZ
yapıştırma, motor hazır değilken de kullanılabilir.

## Akış

- PDF metin katmanı önce tarayıcıda denenir.
- Metin yoksa sayfa 250 dpi, en fazla 2600 px uzun kenar ve JPEG 0.9 ile
  rasterleştirilir.
- Tek kuyruk işçisi göreli `/api/passport-ocr/v1/` uçlarını çağırır.
- MRZ doğrulanamazsa PP-OCR satır kutuları yalnız etiketli VIZ taslağına
  dönüştürülür.
- Gerçek kaynak boyutu ve alan dikdörtgeni şifreli kasada satırla birlikte
  saklanır.

## Uyruk

UTO/XXA gibi ülke olmayan ICAO durumları listelenir ve aynen korunur. ISO-2
uydurulmaz; bu satırlar Excel şablonunda temsil edilemediği için dışa aktarılmaz.

## Kanıt protokolü

```bash
python3 -m pytest -m engine tests/passport_ocr_protocol/generate_and_run.py
```

Komut yalnız gerçek PaddleOCR kurulumu varsa JSON kanıt üretir; motor yoksa
atlar ve NOT RUN durumunu korur. Sentetik ad ve numaralar dışında veri
kullanılmaz.

Windows test edilmedi. Bu durum Tesseract geri dönüşü eklemek için gerekçe
değildir. Vault-sync ve canlı HTTPS aktarımı da bu koşuda çalıştırılmadı.
