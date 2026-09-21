# Tasarım yönü — kişisel iş merkezi

Bu belge ekranlara uydurulmuş kısa bir tasarım sözleşmesidir.
Kaynak tokenlar: `frontend/src/app/globals.css` (`:root`).
Ürün adı: `frontend/src/lib/product.ts`.

## Kimlik

- Atmosfer: Concept H uzamsal köprü — koyu `#0b1219` zemin, holografik Aegean vurgu, kontrollü turuncu CTA.
- Tipografi: **Bricolage Grotesque** (gösterim / kahraman), **Source Sans 3** (gövde / listeler).
- Marka sinyali: yalnız `frontend/src/lib/product.ts`; ANA’da `PRODUCT.shortName` hero seviyesinde okunur.

## İlkeler

1. Bir kompozisyon: ilk viewport dashboard yığını değil; marka + bir selamlama + bir CTA grubu.
2. Yoğun listelerde satır yüksekliği ve kontrast önce gelir; süs ikincildir.
3. Kart yalnız etkileşim veya gruplama gerektiriyorsa.
4. Hareket: sayfa geçişi ve kuyruk odağı için ölçülü; `prefers-reduced-motion` kapatır.
5. Durumlar tasarlanır: yükleniyor, boş, hata, başarı, çevrimdışı.

## Token özeti

| Rol | Değişken |
|-----|----------|
| Zemin | `--navy-950`, `--navy-900` |
| Metin | `--ink`, `--muted` |
| Vurgu / CTA | `--ido-primary` (turuncu), `--ido-sea` |
| Yüzey | `--surface`, `--glass` |
| Tip ölçeği | `--type-11` … `--type-28` |
| Yarıçap | `--ido-radius-sm` … `--ido-radius-lg` |

## Bileşen önekleri (geçiş dönemi)

| Önek | Alan |
|------|------|
| `ido-` | Kabuk: header, nav, frame |
| `ops-` | Sayfa / form / birincil düğmeler |
| `xb-` | ANA (home) |
| `ic-` | Satır listeleri / Gate |

Yeni UI önce mevcut öneklerle yazılır. Yeni paket (`shadcn`, Magic UI vb.) ancak mevcut bileşen aynı işi görmüyorsa ve lisans/sürüm kontrolünden sonra.

## Hareket

- Geçiş ≤ 200ms, ease-out.
- Liste kaydırma native; dekoratif parallax yok.
- `prefers-reduced-motion: reduce` → animasyon yok.

## Paket kararı (bu aşama)

- **Kurulmadı:** shadcn, Motion, react-bits, Magic UI, TanStack Table — mevcut CSS + listeler yeterli.
- **İleride:** yoğun master-roster tablosu için TanStack Table değerlendirilir; önce `PassengerRosterTab` ihtiyacı ölçülür.
