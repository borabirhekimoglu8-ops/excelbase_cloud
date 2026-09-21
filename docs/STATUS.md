# Proje durum özeti (güncellendi: 2026-09-21 aşama 2)

Kod incelemesi + birim testleri + kısmi Browser. Çalıştırılmayan kontroller başarılı sayılmadı.

## Bu aşamada doğrulanan / düzeltilen

- Vault-sync token-only belgelendi; IP hız sınırı eklendi (`docs/DATA_FLOWS.md`)
- `merge_duplicates` önek çakışması + `passport_key` PII yolu düzeltildi → `ref`
- `update_passenger_flags` şema/executor hizalandı
- Gate ↔ master ilişki belgesi: `docs/PASSENGER_STORES.md`
- Marka: kullanıcıya görünen metinler `product.ts`
- ANA tipografi/boşluk CSS iyileştirmesi; masaüstü+mobil ekran görüntüsü alındı

## Browser

- ANA desktop/mobile: görüldü (`/opt/cursor/artifacts/screenshots/home-*.png`)
- Ollama kapalı: probe `network` / bağlanılamadı (doğrulandı)
- Import / kayıt düzenleme / arama / export / offline: otomasyon PIN alanında takıldı — uçtan uca Browser tamamlanmadı

## Öncelik (sonraki)

1. Playwright ile kritik akış e2e (PIN setup fixture)
2. Kalan hardcoded marka (varsa) taraması
3. Bilgi grafı (henüz başlanmadı)
