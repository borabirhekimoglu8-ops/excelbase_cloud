# Excelbase Offline Core

`excelbase-core`, iOS uygulamasının ağ bağlantısı olmadan kullandığı yol-temelli
tablo motorudur. FFI sınırından büyük satır dizileri geçirilmez: içe aktarımlar
V7 uyumlu NDJSON'a, ZIP envanteri ve fotoğraf listesi de yerel NDJSON
manifestlerine yazılır.

## Sabit veri sözleşmesi

Her yolcu satırı şu 13 V7 anahtarını taşır:

`No`, `Ad`, `Soyad`, `Yolcu Adı Soyadı`, `Pasaport No`, `Voucher`,
`Gidiş Tarihi`, `Varış Tarihi`, `Vize Ücreti Yetişkin`,
`Vize Ücreti Çocuk`, `Kaynak Dosya`, `Sayfa`, `Foto`.

Kimlik anahtarı yalnız normalize edilmiş pasaport ve ISO gidiş tarihinden
üretilir. İsim parametresi ABI kararlılığı için durur ancak kimliğe katılmaz.

CSV teslim çıktısı UTF-8 BOM ve noktalı virgül ayırıcı kullanır. XLSX çıktısı
`rust_xlsxwriter` sabit bellek modunda satır satır yazılır.

## UniFFI Swift sözleşmesi

Proc-macro scaffolding kullanılır; UDL dosyası yoktur. UniFFI 0.32'nin ürettiği
başlıca Swift sembolleri:

- `sniffFormat(path:)`
- `importToNdjson(inputPath:outputPath:)`
- `importZipToNdjson(zipPath:extractionDir:outputPath:)`
- `inventoryZipToNdjson(zipPath:outputPath:)`
- `exportNdjsonToXlsx(inputPath:outputPath:)`
- `exportNdjsonToCsv(inputPath:outputPath:)`
- `extractPhotoZip(zipPath:extractionDir:)`
- `identityKey(passport:departure:fullName:)`

Fotoğraf ZIP'i sonucu `PhotoArchiveSummary.manifestPath` verir. Manifestte her
satır `path`, `original_name` ve `bytes` alanlarını içerir; Swift fotoğraf kasası
bu dosyayı akış halinde okuyup dönüştürür.

Yerel Swift binding üretimi:

```bash
cargo build --features bindgen
cargo run --features bindgen --bin uniffi-bindgen -- \
  generate --library target/debug/libexcelbase_core.dylib \
  --language swift --out-dir ../../ios/Generated
```

Linux doğrulamasında kitaplık adı `.so` olur. Ham çıktı adları
`excelbase_core.swift`, `excelbase_coreFFI.h` ve
`excelbase_coreFFI.modulemap`'tir; iOS paketleme betiği bunları
`ExcelbaseCore` XCFramework/Swift hedefinde toplar.

## Güvenlik sınırları

ZIP işlemleri mutlak/üst dizin yollarını, ters bölü işaretli adları, sembolik
bağlantıları, şifreli girdileri, iç içe fotoğraf arşivlerini ve 200:1 üzeri
sıkıştırma oranını reddeder. Girdi sayısı, tek dosya boyutu ve toplam açılmış
boyut sınırlandırılmıştır. Fotoğraf uzantıları ayrıca dosya imzasıyla doğrulanır.

## Doğrulama

```bash
cargo fmt --all -- --check
cargo test
cargo clippy --all-targets --all-features -- -D warnings
```
