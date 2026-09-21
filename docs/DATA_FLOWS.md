# Veri akışları ve güvenlik bulguları

Kod incelemesi + sentetik yeniden üretim notları. Gerçek kasa açılmadı.

## 1. Vault-sync: “token-only” ne demek?

**Konum:** `backend/vault_sync.py`, `backend/main.py` (`PUT/GET /api/vault/sync`), `frontend/src/lib/offline/vaultSync.ts`

**Anlam:** İstekte oturum çerezi, kullanıcı hesabı veya API anahtarı **yok**. Kimlik doğrulama yalnızca `X-Vault-Sync-Token` başlığındaki rastgele kod. Token SHA-256 ile dosya adına çevrilir; gövde şifreli `.excelbase-backup` blob’udur. Sunucu PIN/DEK görmez.

**Etki (doğrulandı — AÇIK risk, tasarım gereği):**
- Token’ı bilen herkes aynı blob’u **indirebilir** veya **üzerine yazabilir**.
- Blob hâlâ istemci şifreli olduğu için sunucu içeriği okuyamaz; asıl zarar: yedek çalma (brute-force/PIN saldırısı için malzeme) veya yedeği bozma.

**Yeniden üretim (sentetik):**
1. `createSyncToken()` ile token üret.
2. `PUT /api/vault/sync` + sentetik bayt gövdesi.
3. Aynı token ile `GET` → aynı baytlar.
4. Oturum/API anahtarı olmadan da çalışır.

**Bu aşamada düzeltme:** İstek başına IP hız sınırı (sessiz DoS/tarama baskısını azaltır). Davranış (token ile sync) korunur. Kapatma veya oturum zorunluluğu sync’i kıracağı için varsayılan kapalı tutulmadı; `docs` uyarısı eklendi.

## 2. `merge_duplicates` + `passport_key`

**Konum:** `backend/assistant/tools.py`, `frontend/.../toolExecutor.ts` → `localMergeDuplicates` (`localApi.ts`)

**Eski sözleşme:** Modele `passport_key` string’i veriliyordu.

**Yanlış eşleşme / veri kaybı koşulları (doğrulandı):**
1. **Önek çakışması:** `passportKey="U12"` iken kimlik `U123|2026-09-21` ve `U124|2026-09-21` ikisi de `startsWith("U12")` ile seçilir → yanlış gruplar birleşebilir.
2. **Boş anahtar:** Tüm yinelenen gruplar birleşir (bilinçli “hepsi” davranışı; model boş gönderirse geniş etki).
3. **PII sızıntısı:** Pasaport numarası tool argümanı olarak model geçmişine girer (bulut/yerel fark etmez).

**Düzeltme:** Araç artık `ref` (ör. `p_42`) ister; birleştirme o kaydın kimlik anahtarıyla sınırlıdır. `passport_key` kaldırıldı.

## 3. Sunucu passenger API

**Konum:** `backend/main.py` `/api/passengers*`, `/api/import*`, …  
**Erişim:** `require_api_key` / `require_write_access` / `require_admin_access` (`backend/security.py`, `backend/auth.py`).  
`GATEVISA_API_KEY` yoksa ve `GATEVISA_ALLOW_DEV_NO_AUTH=1` değilse 503.  
`require_api_key_flexible` ayrıca `?k=` query kabul eder (img etiketleri için).

**PWA kullanıcıları:** `frontend/src/lib/api.ts` yalnız `local*` fonksiyonlarını dışa açar; UI bu uçlara gitmez. Sunucu API, eski/istemci-dışı veya yanlışlıkla açık bırakılmış dağıtımlar içindir.

**Bu aşamada:** Kaldırılmadı (kullanılmadığı kanıtlanmadan silme yasağı). Belgelendi.

## 4. Asistan araç tutarsızlıkları (kullanıcı etkisi)

| Araç | Sorun | Kullanıcı etkisi | Düzeltme |
|------|--------|------------------|----------|
| `update_passenger_flags` | Şemada `has_photo`, `fee_paid` var; executor uygulamıyor | Model “foto işaretledim” der, kayıt değişmez | Şemadan kaldırıldı; yalnız pasaport/voucher temizleme |
| `update_passenger_flags` | `has_passport:true` yok sayılır | Yanlış güven | true reddedilir |
| `merge_duplicates` | `passport_key` | Yukarıda | `ref` |

## 5. Gate vs master yolcu (birleştirme yok)

Ayrıntı: `docs/PASSENGER_STORES.md`
