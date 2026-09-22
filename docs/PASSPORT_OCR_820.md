# Pasaport OCR 8.2.0

Birincil operatör yolu WhatsApp görüntü PDF’i veya JPG/PNG/HEIC fotoğrafını
**Pasaport → Excel** alanına bırakmaktır. Sayfalar tek Tesseract işçisiyle sırayla
ve yalnız cihazda işlenir. Live Text ile iki MRZ satırı yapıştırma, kapalı
“Alternatif” bölümündedir.

MRZ doğrulanamazsa etiketlere bağlı görsel alanlar taslak gösterilir. Taslaklar
MRZ doğrulaması sayılmaz; operatör kaynak sayfayı karşılaştırıp “Kontrol ettim”
demeden Excel’e girmez. Uyruk, MRZ satır 2 kaynağıdır; düzenleyen devlet ülke
kodu üretmez. UTO/XXA gibi özel kodlar boş kalır ve operatör gerçek uyruğu
seçer.

Kaynak ülke tablosu `icaoCountries.ts` içindeki tek tablodur. ISO 3166-1,
UN M49/İngilizce ad anlık görüntüsü, CLDR Türkçe adları ve ICAO Doc 9303
istisnalarının bağlantı/lisans notları `COUNTRY_TABLE_SOURCES` içindedir.

## Sabit sıkıştırılmış sayfa tanısı

Orijinal operatör WhatsApp PDF’leri depoda yoktu; aynı beş sentetik dosya
`frontend/src/lib/passport/__fixtures__/compressed-pages/` altında kilitlendi.
Profil: `tesseract-6-mrz-eng-lstm-300dpi-v1`. Sonuç **2/5**; başarısız
sayfalara başarı yakıştırılmaz. Hash’ler dosya baytlarından üretilir.

| Sayfa | Sonuç | Aşama | Neden |
|---|---|---|---|
| 1 | Başarılı | — | MRZ bandı ve iki 44 hücreli satır doğrulandı |
| 2 | Başarılı | — | Yön düzeltildi ve kontrol basamakları doğrulandı |
| 3 | Başarısız | `field_matching` (`mrz_parser` sonrası) | Ad ve soyad tek çözümle doğrulanamadı |
| 4 | Başarısız | `text_detection` | Sıkıştırma sonrası MRZ bandı ayırt edilemedi |
| 5 | Başarısız | `character_recognition` | Karakterler 44 hücreli ızgaraya oturmadı |

Linux bulut VM’de birim kontrolleri çalıştırıldı. Windows ortamına erişim yok;
Windows kurulumu ve uçtan uca test **yapılmadı**. macOS testi Windows
pilotunun ön koşulu değildir ve macOS desteği iddia edilmez.
