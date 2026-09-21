# Gate yolcu seti ↔ Master yolcu listesi

## İki ayrı depo

| | **Kapı (Gate Visa)** | **Yolcular (master roster)** |
|--|----------------------|------------------------------|
| UI | KAPI sekmesi / Gate listesi | YOLCULAR sekmesi |
| Depo | Vault içi yolcu kayıtları (`localApi` / IndexedDB) | `passengerListStore` (satış sayfası benzeri sheet’ler) |
| İçerik | Operasyonel kayıt: foto, PDF, bayraklar, eksikler | Referans Excel tabloları (sütun/satır) |
| Kaynak | İçe aktarma, manuel ekleme, pasaport tarama aktarımı | Roster’a yüklenen listeler |

Kod: `passengerListStore.ts` (master), `localApi.ts` (gate), köprü `passengerRosterTransfer.ts`.

## Hangi işlem hangisini esas alır?

- Kapıdaki filtre, paket, gün kapatma, asistan yolcu araçları → **yalnız Gate**.
- Yolcular sekmesinde aç/sil/yükle → **yalnız master roster**.
- “Kapıya aktar” → master’dan seçili satırlar XLSX blob’a çevrilir → **aynı Gate import kuyruğu** (`queueImportFile`). Roster satırları Gate’e kopyalanmaz; import sonucu yeni Gate kayıtları oluşur.

## Güncelleme aktarımı

- Gate’te düzenlenen yolcu **master’a yazılmaz**.
- Master’da silinen sheet Gate’i **etkilemez**.
- Aktarım tek yönlüdür (master → Gate import). Geri köprü yoktur.

## Çakışmalar

- Import `dupStrategy`: `skip` | `overwrite` | `add` (aktarım varsayılanı `skip`).
- Aynı pasaport+tarih Gate’te varsa `skip` ile yeni kayıt eklenmez; master satırı olduğu gibi kalır.
- İki depo arasında otomatik birleştirme / silme **yok**.

## Geçiş planı (şimdilik uygulamadı)

Geri alınabilir sonraki adımlar (onay sonrası):

1. UI’da “bu liste Gate’e aktarıldı” rozeti (meta, veri birleştirmeden).
2. Gate kaydında `source_roster_sheet_id` isteğe bağlı alan.
3. Çift yönlü senkron **yapılmayacak** unless ayrı ürün kararı; risk yüksek.

Bu aşamada veri birleştirme veya silme yapılmadı.
