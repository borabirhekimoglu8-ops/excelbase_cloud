# Proje durum özeti (2026-09-21)

Kod incelemesine dayalı; çalıştırılmayan kontroller başarılı sayılmadı.

## Çalışan

- Çevrimdışı PWA + şifreli IndexedDB kasası
- Gate Visa: içe aktarma, yolcular, foto/evrak, paketler, istatistik
- İş dosyaları, görevler, ofis evrakları, satış/raporlar
- Pasaport OCR → Excel, toplu foto eşleme
- Asistan (Anthropic ve/veya Ollama), workstation katalog, drive audit (env kapılı)
- Şifreli yedek / geri yükleme

## Eksik / yarım

- Tek merkezli bilgi grafı (Sefer↔Yazışma↔Evrak) yok
- Ürün adı dağınıktı → `product.ts` eklendi (bu PR)
- Çift yolcu düzlemi (Gate vs master roster)
- Sunucu passenger API’si PWA tarafından kullanılmıyor ama duruyor
- Asistan `merge_duplicates` / flag tool tutarsızlıkları
- Tasarım önekleri (`ido`/`ops`/`xb`/`ic`) birleşmemiş

## Teknoloji

Next 16 static + React 19 · FastAPI · idb vault · xlsx/zip · tesseract · Anthropic/Ollama

## Öncelik sırası

1. Marka tek kaynak + tasarım sözleşmesi (bu aşama)
2. ANA → diğer ekranlarda token tutarlılığı
3. Bilgi grafı çekirdeği (mevcut katalog/audit üzerine)
4. Araçlı yerel ajan
5. Sunucu/PWA çift düzlemini sadeleştirme
