# Rapor: WhatsApp pasaport görselleri → toplu biletleme

**Ürün:** Excelbase Operations (PWA)  
**Canlı sürüm (rapor tarihi):** 8.1.0 — https://excelbase.onrender.com  
**Rapor tarihi:** 2026-09-22  
**Kapsam:** Acente / operatör kanallarından (özellikle WhatsApp) gelen pasaport fotoğraflarının toplu biletleme (Gate Visa / operatör Excel) için yapılandırılmış veriye dönüştürülmesi.

> Test ve örneklerde yalnız uydurma kimlikler kullanılır (`Ada Yılmaz`, `U1000001`). Gerçek yolcu/pasaport verisi bu raporda yoktur.

---

## 1. Yönetici özeti

| Madde | Durum |
|--------|--------|
| **İş ihtiyacı** | WP’ten (ve benzeri kanallardan) gelen pasaport resimlerinden **toplu bilet listesi** üretmek |
| **Denenen yollar** | Uygulama içi OCR (Tesseract) · MRZ kopyala-yapıştır · PDF metin katmanı |
| **Sonuç** | İkisi de sahada yeterli bulunmadı; OCR kaldırıldı (8.1.0), yapıştırma kaldı ama parti UX’i zayıf |
| **Asıl darboğaz** | Motor değil: WhatsApp sıkıştırması + tek tek elle seçim + yapıştırmanın önceki satırları silmesi + katı parser |
| **Önerilen yön** | Toplu iOS Live Text/Kısayol + PWA “parti modu” (ekle/kalıcı/hoşgörülü parse); paralel acente mikro kuralı |

---

## 2. İş bağlamı (kullanıcı ihtiyacı)

Operatörler, acentelerden veya yolculardan **WhatsApp ile pasaport fotoğrafı** alıyor. Amaç:

1. Fotoğraflardaki kimlik bilgilerini (ad, soyad, pasaport no, doğum/bitiş, uyruk, mümkünse TC vb.) çıkarmak  
2. Bunları **toplu biletleme** için operatör Excel şablonuna (`Yolcu Adı`, `Yolcu Soyadı`, `Pasaport No`, …) dökmek  
3. Gate Visa / içe aktarma hattına vermek  

Bu ihtiyaç, “gemi gelmeden önce liste hazırlama (T-1)” anına aittir. Kapıda teyit veya acente Excel manifesti **paralel** çözümlerdir; WP fotoğraf akışı devam ettiği sürece ayrı bir boru hattı gerekir.

---

## 3. Denenen çözümler ve sonuçları

### 3.1 Uygulama içi OCR (Tesseract.js / WASM)

| Dönem | Ne yapıldı |
|--------|------------|
| Erken | JPG → Tesseract `eng` → Excel |
| Hız | Bant kırpma, 2 worker, JPEG kaldırma (“jet”) |
| Model | Doubango `mrz` tessdata + MRZ locator |
| PDF | Sayfa rasterize → aynı OCR |
| Doğruluk | Hücre ızgarası + check-digit (“doğrulanmış veya boş”) |
| Son | **OCR tamamen kaldırıldı** (PR #89 → 8.1.0) |

**Neden yetmedi**

- WhatsApp fotoğrafı küçültülüp yeniden sıkıştırılıyor; MRZ karakterleri çok küçük kalıyor.  
- Telefon kadrajı / parlama / açı; el yapımı “MRZ bulucu” tavanına çarpıyor.  
- Agresif “repair” yanlış ama check-digit geçen alanlar üretebiliyordu (kullanıcı şikâyeti: yanlış pasaport no / isim).  
- Ücretli SDK (Dynamsoft, BlinkID vb.) bilinçli olarak **elendi** (“paralı olmayacak”).  
- Sunucu / bulut OCR KVKK ve ürün kuralları nedeniyle birincil yol olarak **önerilmedi**.

### 3.2 OCR’suz düz metin (8.1.0 — mevcut canlı)

| Yol | Davranış |
|-----|----------|
| Yapıştır | İki TD3 MRZ satırı (ör. iPhone Live Text) |
| PDF/TXT | Yalnız **metin katmanı** (`getTextContent`); tarama PDF’i okunmaz |
| JPG | Bilinçli red: “Live Text ile kopyalayın” |

**Neden sahada “olmadı” (kod + UX teşhisi)**

1. **Üzerine yazma:** Her `applyText` / yapıştırma `setRows(next)` ile önceki satırları siliyor; parti biriktirmiyor.  
2. **Kalıcılık yok:** Satırlar yalnızca React state; WhatsApp’a dönüp PWA öldürülünce iş kaybolabiliyor.  
3. **Katı parser:** Tam 44 karakterlik koşular; Live Text’in kısalttığı `<` dolgusu veya 0/O karışıklığı → “İki adet 44 karakterlik satır bulunamadı”.  
4. **Throughput:** Yolcu başına manuel seç-kopyala-geç ≈ 1 dk → 40 yolcu ≈ 45–60 dk; toplu biletleme için kabul edilemez.

Sonuç: Live Text’in arkasındaki **Apple Vision motoru güçlü**; sorun **tek tek, elle, katı, biriktirmeyen** ürün yüzeyi.

### 3.3 Alternatif mimari öneriler (uygulanmadı)

| Öneri | Özet | Kullanıcı tepkisi / not |
|--------|------|-------------------------|
| Acente Excel / FAL-6 önce, kapı teyit | Fotoğraftan veri üretmeyi bırak | “Ben WP’den gelen resimlerle toplu biletleme istiyorum” — ihtiyaç fotoğraf kanalı |
| Ücretli WASM SDK | Dynamsoft vb. | Paralı olmayacak |
| ONNX / açık DL | Ücretsiz, ağır Ar-Ge | Tartışıldı, seçilmedi |
| NFC ePassport | Çip %100’e yakın | iOS’ta native + yıllık Apple Dev; WP fotoğrafına çözüm değil |

---

## 4. Kök neden analizi

```text
[Acente çeker] → [WhatsApp sıkıştırır] → [Operatör telefonu]
        ↓
   İstenen: toplu Excel satırları
        ↓
   Denenen: uygulama OCR  →  motor/ortam tavanı + yanlış alan riski
             tek tek yapıştır → UX/throughput + katı parse + satır silme
```

| Katman | Sorun |
|--------|--------|
| Kanal | WP görüntü kaybı; “Belge olarak gönder” nadiren kullanılıyor |
| Veri kaynağı | Fotoğraf, MRZ’nin en kayıplı kopyası (çip / acente sistemi üstte) |
| Ürün | Parti biriktirme ve hoşgörülü parse eksik |
| Kısıt | Ücretsiz yazılım; mümkün olduğunca cihaz içi; KVKK |

**KVKK notu:** Pasaport görsellerinin WhatsApp/Meta üzerinde dolaşması veri minimizasyonu açısından zayıf bir pratiktir. Teknik çözüm fotoğrafı okusa bile uzun vadede acente form/Excel’e geçiş uyumu güçlendirir. Kısa vadede operatör zaten görselleri telefonda tutuyor; yeni bulut OCR önerilmez.

---

## 5. Önerilen yol haritası (WhatsApp gerçeğine göre)

### 5.1 Birincil — Toplu Vision + PWA parti modu

**Operatör günü**

1. WhatsApp sohbet → Medya → çoklu seç  
2. Paylaş → iOS Kısayol “MRZ Çıkar” (cihazda, ücretsiz; App Store yok)  
3. Tek metin / `.txt` → Excelbase’e **bir kez** yapıştır veya TXT yükle  
4. Kontrol → Excel indir → biletleme  

**PWA’da yapılması gerekenler (henüz yok / kısmen eksik)**

| Özellik | Amaç |
|---------|------|
| **Ekle modu** | Yeni yapıştırma mevcut satırlara ekler; aynı pasaport no birleşir |
| **Taslak kalıcılığı** | Satırlar kasaya yazılır; PWA öldürülse parti kaybolmaz |
| **Hoşgörülü MRZ onarımı** | Check-digit ile sınırlı lookalike; `<` dolgu; Live Text kirini tolere et |
| **Bulunamadı listesi** | Hangi fotoğrafta MRZ yok → acenteye “yeniden çek” metni |

Beklenen etki (ölçülmeli): ~40 yolcu için ~45–60 dk → ~10–15 dk.

### 5.2 Paralel — Acente mikro kuralı

WhatsApp alışkanlığı bozulmadan:

- “Sıkıştırılmış foto” yerine **Belge olarak gönder / HD**  
- Mümkünse pasaportta **Metin Tara** → MRZ’yi **metin mesajı** olarak at  

### 5.3 İsteğe bağlı sonraki adımlar

| Adım | Ne zaman |
|------|----------|
| Mac/Windows masaüstü klasör + aynı Vision/OCR borusu | Ofiste WhatsApp Desktop yoğunsa |
| Native Share Extension (Vision) | Kısayol yetmezse; Apple Developer ~99 USD/yıl |
| Ucuz Android “gelen kutusu” | Hacim çok artarsa sıfır dokunuş |
| HID MRZ kaydırmalı okuyucu | Fiziksel pasaport ofisteyse; WP fotoğrafına çözüm değil |

---

## 6. Mevcut ürün durumu (8.1.0)

| Bileşen | Durum |
|---------|--------|
| Tesseract / MRZ locator / grid OCR | **Kaldırıldı** |
| MRZ yapıştır + PDF/TXT metin | **Var** |
| Check-digit / ICAO ülke / TC checksum altyapısı | **Var** (metin yoluyla) |
| Operatör Excel indirme | **Var** |
| Gate Visa Excel/ZIP içe aktarma (ayrı akış) | **Var** — acente zaten Excel gönderiyorsa tercih edilmeli |
| Parti biriktirme / kasa taslağı / hoşgörülü Live Text parse | **Eksik** — önerilen bir sonraki sprint |

İlgili birleştirmeler: PR #85 (OCR jet) · #86 (PDF raster) · #87 (doğrulanmış alanlar) · #89 (OCR kaldır, metin akışı).

---

## 7. Karar matrisi (kısa)

| Seçenek | WP fotoğrafla çalışır mı? | Ücret | Tavsiye |
|---------|---------------------------|-------|---------|
| Uygulama içi Tesseract’a dönüş | Zayıf | 0 | Hayır |
| Ücretli WASM SDK | Evet (daha iyi) | Yıllık | Hayır (kısıt) |
| Bulut OCR | Evet | Sayfa + KVKK | Hayır |
| Tek tek Live Text yapıştır (bugünkü UX) | Evet ama yavaş/kırılgan | 0 | Yetersiz |
| **Toplu Kısayol + parti PWA** | **Evet** | **0** | **Evet — birincil** |
| Acente Excel/form | Fotoğrafı azaltır | 0 | Paralel |
| NFC çip | Fiziksel pasaport | Cihaz/native | WP için hayır |

---

## 8. Açık sorular (ölçüm / ürün)

1. Operatör iOS sürümü (Live Text / Görüntüden Metin için iOS 16+)? Ofiste WhatsApp Desktop var mı?  
2. Tipik parti büyüklüğü ve günde kaç parti? Gelen fotoğraflarda MRZ’nin tam görünür oranı (kesik/açılı/kimlik)?  
3. Acenteler “Belge olarak / HD” veya MRZ metin mesajını kabul eder mi? En yüksek hacimli 2–3 acente kim?

---

## 9. Sonuç

Sorun “daha akıllı OCR” değil; **WhatsApp’tan gelen pasaport görsellerinin toplu biletleme verisine dönüştürülmesi** ve bunun **hızlı, biriktirilebilir, yanlış alan uydurmayan** bir şekilde yapılmasıdır.

- Uygulama OCR’ı ve bugünkü tek-tek yapıştırma bu ihtiyacı karşılamadı.  
- Ücretsiz ve KVKK’ya uygun en gerçekçi sonraki adım: **cihazdaki Apple Vision’ı toplu kullanmak (Kısayol) + PWA’yı parti biletleme moduna getirmek**, yanında acente mikro kuralları.  
- Acente Excel/manifest uzun vadede en temiz kaynak olmaya devam eder; WP fotoğrafı sürdüğü sürece yukarıdaki parti hattı gerekir.

---

*Bu rapor karar ve durum belgesidir; kod değişikliği içermez. Uygulama onayı sonrası ayrı PR açılmalıdır.*
