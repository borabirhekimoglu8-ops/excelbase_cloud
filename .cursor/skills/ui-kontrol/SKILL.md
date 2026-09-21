---
name: ui-kontrol
description: ANA ve kabuk UI değişikliklerini tasarım sözleşmesine göre kontrol et.
---

# UI kontrol

1. `frontend/DESIGN.md` ve `frontend/src/lib/product.ts` oku.
2. Değişen ekranda kontrol et:
   - Marka `PRODUCT` / `productBrandLine()` üzerinden mi?
   - Token’lar (`--navy-*`, `--ido-*`, tip ölçeği) mi kullanılmış?
   - Yükleniyor / boş / hata durumları var mı?
   - Odak görünür mü; kontrast yeterli mi?
   - `prefers-reduced-motion` kırılmamış mı?
3. Mümkünse Browser ile ANA + bir liste ekranı sentetik veriyle bak.
4. Sonuç: geç / kalan sorunlar (uydurma özellik yazma).
