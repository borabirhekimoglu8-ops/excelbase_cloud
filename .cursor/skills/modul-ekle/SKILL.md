---
name: modul-ekle
description: Mevcut PWA üzerine yeni iş modülü ekleme adımları.
---

# Modül ekle

1. Gerekçe: hangi nesne tipi (iş dosyası, evrak, sefer…)? Mevcut sekme yeterli mi?
2. Veri: vault / `workspace.ts` şeması; sunucuya PII yazma.
3. UI: `OperationApp` screen + gerekirse `BottomNav` (5 sekme kuralına dikkat).
4. Araçlar: asistan tool’u eklenecekse pseudonym ref; onaylı yazma.
5. Test: vitest birim + mümkünse e2e sentetik.
6. Doküman: README’ye tek paragraf; abartılı vaat yok.
