# 8.2.0 son durum raporu

Tarih: 2026-09-22  
Dal: `cursor/passport-whatsapp-ocr-72a0`  
Taslak PR: https://github.com/borabirhekimoglu8-ops/excelbase_cloud/pull/93  
Sürüm: `8.2.0` (`UI_VERSION`, `APP_VERSION`, PWA kabuk, `8.2.0-offline`)  
Ana dala birleştirme: yok  
Canlıya dağıtım: yok

Bu rapor çalıştırılan kontrollere dayanır. Çalıştırılmayan test başarılı sayılmaz.

---

## Özet

8.1.0’da birincil yol Live Text / yapıştırılan MRZ idi; görüntü-PDF OCR’si yoktu. 8.2.0’da öncelik **WhatsApp kaynaklı görüntü-PDF ve pasaport fotoğrafı**dır. Live Text yalnız kapalı “Alternatif” bölümündedir.

OCR cihazda, tek Tesseract işçisiyle, kuyrukta çalışır. Pasaport verisi arama servisine veya bulut OCR’ye gitmez. Excel `Ülke Kodu 2` yalnız **uyruk**tan (MRZ satır 2) türetilir; düzenleyen devlet ayrı alandır.

Orijinal operatör WhatsApp PDF’leri depoda yoktu. Sıkıştırılmış 2/5 tanısı, kilitli sentetik dosyalar üzerindendir. Gerçek albümde başarı uydurulmaz.

---

## İstenen metrikler

Sentetik kimlik: Ada Yılmaz, pasaport `U1000001`. Gerçek yolcu verisi kullanılmadı.

| Metrik | Sayı | Açıklama |
|---|---:|---|
| Tamamı doğru ve eksiksiz yolcu | **2** | Sıkıştırılmış sayfa 1 ve 2. Live Text Ada Yılmaz kaydı UTO yüzünden eksiksiz sayılmaz. |
| Sıkıştırılmış sayfalarda başarı | **2 / 5** | Sayfa 1–2 başarılı; 3–5 başarısız. |
| MRZ olmadan görsel alandan çıkarılan kayıt | **1** | Ada Yılmaz taslak: ad, soyad, pasaport no, tarihler + kaynak koordinatı. Ülke boş. Excel’e gitmez. |
| Yanlış doldurulan kritik alan | **0 (bilinen uydurma yok)** | UTO → TR yazılmadı. Ad satırı hatasında ad/soyad boş bırakıldı; tahmin yok. |
| Kullanıcı düzeltmesi gereken kayıt | **3 + özel kod + taslaklar** | Sıkıştırılmış sayfa 3–5; UTO/XXA vb.; tüm `visual_draft` satırlar. |

Live Text e2e kaydı (Ada Yılmaz / UTO): alanlar okunur, `Ülke Kodu 2` boş kalır, “Kontrol ettim” ve geçerli uyruk seçilmeden Excel inmez. UTO→TR yalnız manuel düzenleme testi sayılır; doğru veri çıkarma sayılmaz.

---

## 1. Sıkıştırılmış 2/5 — sayfa bazında

Dosyalar: `frontend/src/lib/passport/__fixtures__/compressed-pages/`  
Motor: `tesseract-6-mrz-eng-lstm-300dpi-v1` · 300 dpi · LSTM · **1 işçi**  
Hash: dosya baytlarının SHA-256’sı (uydurma hash yok)

| Sayfa | Dosya | SHA-256 | Sonuç | Aşama | Neden |
|---|---|---|---|---|---|
| 1 | `page-1.mrz.txt` | `a8a51a9765fe6563264d89475f38e1433dd33974b2886b11bda73035d4fcc7d2` | Başarılı | — | MRZ bandı ve iki 44 hücreli satır doğrulandı |
| 2 | `page-2.mrz.txt` | `f6bb7d8acf9aeadcd0da3881d3328bc3b639822f78f5425905797bd9748f99fb` | Başarılı | — | Döndürülmüş sayfa yönü düzeltildi; kontroller doğrulandı |
| 3 | `page-3.name-line.txt` | `a74691bbe8918800d91cb98287981ce5fbfb3f04983cefc16bd527e983b8a9a7` | Başarısız | `field_matching` (`mrz_parser` sonrası) | Ad ve soyad tek çözümle doğrulanamadı — önceki ad satırı hatası aynı dosyada yeniden üretildi |
| 4 | `page-4.no-band.txt` | `bed8f3d209fc375b29a9b3c98a38a4a96bc5fc6cff52070e5e22d2ef3949acb8` | Başarısız | `text_detection` | Sıkıştırma sonrası MRZ bandı ayırt edilemedi |
| 5 | `page-5.grid-fail.txt` | `00c2d409314dcde75c840fe6e7043ddd8f181607bec79e6c92574af5a8fe950b` | Başarısız | `character_recognition` | Karakter kutuları 44 hücreli ızgaraya oturmadı |

Aşama sözlüğü: `text_detection` (mürekkep/bant yok) · `character_recognition` (OCR/ızgara) · `mrz_parser` (TD3 tek çözüm yok) · `field_matching` (alan eşleşmedi / ad satırı).

Gerçek WhatsApp sıkıştırmalı tarama bu koşuda **çalıştırılmadı**; depoda o PDF’ler yoktu.

---

## 2. MRZ yokken görsel alan

Uygulandı. MRZ kesikken etiketlere bağlı VIZ (görsel bölge) taslak üretir: ad, soyad, pasaport no, doğum, bitiş — kaynak dikdörtgeniyle. Tahmin yok; iki eşit aday veya tip kapısından geçmeyen değer yazılmaz. Görsel uyruk ipuçtur, koda çevrilmez.

Doğrulama: `vizOnlyExtraction.test.ts` — Ada Yılmaz taslak, `visual_draft`, koordinat var, `Ülke Kodu 2` boş.

---

## 3. Şifreli paket ve alan–görüntü

Kaynak sayfa JPEG `passport-page:{batchId}:{pageNo}` olarak kasaya yazılır. Satır `passport_row:` varlığında `sourceImageKey` + `provenance.rect` tutulur. Yedek formatı `excelbase-encrypted-vault`; geri yüklemede düz metin `YILMAZ` / `U1000001` yok.

Doğrulama: `passportVault.test.ts` (yaz → yedekle → sil → geri yükle). HTTPS PWA’ya aktarım bu birim yolla kanıtlandı. Canlı sunucu vault-sync uçtan uca **çalıştırılmadı**.

---

## 4. Kuyruk ve 429

Tek motor (`MAX_OCR_WORKERS = 1`). İş kimliği `sha256(sayfaHash + profil)`. Aynı hash ikinci iş üretmez. Geçici motor hataları kuyrukta (en fazla 3), kullanıcıya HTTP 429 gösterilmez. Çift tıklama / bırakma `enqueueInFlight` + `busy` ile kesilir.

---

## 5. Ülke: uyruk mu, düzenleyen mi?

| Alan | Kaynak | Excel |
|---|---|---|
| Uyruk | MRZ satır 2 (veya operatör seçimi) | `Ülke Kodu 2` = ISO-2, yalnız buradan |
| Düzenleyen devlet | MRZ satır 1 | Yazılmaz; ekranda salt okunur |

UTO / XXA / XXB / XXC / XXX / UNO / UNA / UNK / EUE boş kalır; rastgele ülkeye çevrilmez. Operatör belgedeki doğru bilgiyi seçer. Geçersiz kod kabul edilmez (`TR` veya “Türkiye” geçer; `QQ` / `UTO` seçim olarak geçmez).

Örnekler: `TUR→TR`, `GRC→GR`, `DEU→DE`, `GBR→GB`, `USA→US`. ICAO istisnaları (`D`, `GBD`…, `RKS`/`XKX`) ayrı `icao_alias` / `special` satırlarıdır; ISO alpha-3 ile aynı varsayılmaz.

Tek tablo: `frontend/src/lib/passport/icaoCountries.ts` (249 ISO devlet + istisnalar). Çalışma anında internet yok.

Kaynaklar (alınma: 2026-09-22):

- ISO 3166-1 OBP — https://www.iso.org/iso-3166-country-codes.html — alpha-2 iç kullanım / ticari olmayan ücretsiz; Collection XML’i dağıtılmadı
- UN M49 — https://unstats.un.org/unsd/methodology/m49/
- İngilizce kısa ad anlık görüntüsü (UN türevi) — https://github.com/lukes/ISO-3166-Countries-with-Regional-Codes
- Türkçe arayüz adları (CLDR) — https://github.com/umpirsky/country-list
- ICAO Doc 9303 Part 3, 8. baskı (2021) §5 — https://www.icao.int/publications/Documents/9303_p3_cons_en.pdf

---

## 6. Windows / macOS

| Ortam | Durum |
|---|---|
| Linux bulut VM | Birim test, derleme, Playwright, kısmi tarayıcı |
| Windows kurulum + uçtan uca | **Yapılmadı** — erişim yok. Yapılmış gibi raporlanmaz. |
| macOS | Test edilmedi. Windows pilotunun ön koşulu değildir. Destek iddia edilmez. |

---

## Doğrulama (çalıştırılan)

| Kontrol | Sonuç |
|---|---|
| Vitest pasaport + sürüm | 53 geçti |
| `next build` | geçti |
| Playwright `e2e/passport-scan.spec.ts` | 2/2 — birincil bırakma alanı, Live Text gizli, UTO boş, TUR→TR, Excel ancak “Kontrol ettim” sonrası |
| Tarayıcı | Birincil/alternatif görüldü; ülke listesinin açık kalması düzeltildi; Excel yolu Playwright ile doğrulandı |

---

## Açık kalanlar

1. Orijinal WhatsApp sıkıştırmalı PDF bu koşuda yoktu; 2/5 sentetik kilitli set üzerindedir.
2. Canlı HTTPS vault-sync + gerçek cihaz aktarımı çalıştırılmadı.
3. Windows kurulumu yok.
4. 30 sayfalık albümde iOS bellek bu koşuda ölçülmedi.
5. Ana dala birleştirme ve canlı dağıtım bilinçli olarak yapılmadı.

---

## Sonuç

8.2.0 dalı, asıl kullanım ihtiyacına (WhatsApp görüntü-PDF toplu yolcu listesi) dönmüş durumdadır. Live Text yedektir. Ülke eşlemesi yerel ve eksiksizdir; UTO başarı sayılmaz. Birleştirme / canlıya çıkış için önce gerçek sıkıştırılmış örneklerin aynı hash protokolüyle koşulması ve Windows pilotunun ayrıca planlanması gerekir.
