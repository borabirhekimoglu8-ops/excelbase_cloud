---
name: surum-kontrol
description: Sürüm ve PWA kabuk sürümünü senkron tutma kontrol listesi.
---

# Sürüm kontrol

1. `frontend/src/lib/version.ts` → `UI_VERSION`
2. `backend/state.py` → `APP_VERSION` (uye uyumlu tut)
3. `frontend/public/sw.js` kabuk cache adı / yorum sürümü
4. `frontend/src/components/pwa/PwaBootstrap.tsx` shell version sabiti
5. Değişiklik kullanıcıya “güncelle” diye görünmeli; sessiz kırılma yok
6. `vitest` pwaVersion testini çalıştır
