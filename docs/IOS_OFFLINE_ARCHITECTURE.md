# Excelbase Offline iOS mimarisi

Excelbase Offline, yolcu listelerini ve biyometrik fotoğrafları bir sunucuya göndermeden iPhone üzerinde işler. Uygulama kurulduktan sonra temel operasyon akışı için internet, Render/Oracle hesabı veya açık bir ofis bilgisayarı gerekmez.

## Hedefler

- iOS 17 ve sonrası için gerçek SwiftUI uygulaması.
- Dosya seçimine uygulama kaynaklı adet limiti koymayan, sıraya alınmış ve yeniden başlatılabilir aktarım.
- XLSX, XLS, XLSM, CSV, ODS ve ZIP girdilerini düşük bellek kullanımıyla işleyen Rust çekirdeği.
- Yolcuları, aktarım durumlarını ve arşiv özetlerini yerel SQLite veritabanında tutma.
- Fotoğrafları uygulamanın korumalı konteynerinde saklama ve pasaport numarasıyla eşleştirme.
- Excel/CSV çıktısını iOS paylaşım sayfasına verme.
- İnternet erişimi gerektirmeyen, tek cihazlı ve hata durumunda kaldığı yerden devam eden operasyon.

## Katmanlar

```text
SwiftUI ekranları
      │
      ▼
@Observable AppModel
      │
      ▼
LiveAppDataProvider
      ├── AppDatabase (GRDB / SQLite)
      ├── ImportCoordinator (kalıcı iş kuyruğu)
      ├── PhotoVault (korumalı dosyalar + eşleştirme)
      └── ExportService (cihaz içi çıktı)
                  │
                  ▼
       UniFFI / ExcelbaseCore.xcframework
                  │
                  ▼
       Rust excelbase-core (streaming parser/exporter)
```

### SwiftUI ve uygulama durumu

`AppModel`, ekranların yalnızca kullanıcıya gösterilecek özet modelleriyle çalıştığı ana aktördür. Veri erişimi `AppDataProviding` protokolünün arkasındadır. Bu sınır, UI iş parçacığında Excel ayrıştırılmasını engeller ve ekranların aktarım motorundan bağımsız test edilebilmesini sağlar.

Altı ana ekran vardır: Genel, Yolcular, Aktarım, Galeri, Arşiv ve Ayarlar. Tasarım iOS semantik renklerini ve SF Symbols kullanır; açık/koyu mod, Dynamic Type ve VoiceOver sistem davranışlarını korur.

### Yerel veritabanı

GRDB `7.11.1` üzerinden SQLite kullanılır. Veritabanı uygulamanın Application Support alanındadır. Şema değişiklikleri GRDB migrator ile sürümlenir. Yolcu, ücret ve belge gibi kişisel alanlar cihaz içi anahtarla kayıt seviyesinde şifrelenir. Anahtar Keychain'de, veritabanından ayrı tutulur.

Veritabanı ve dosyalar `NSFileProtectionCompleteUntilFirstUserAuthentication` veri koruması altındadır. Uygulama iCloud konteyneri veya ağ servisi tanımlamaz.

### Rust aktarım motoru

`native/excelbase-core`, yol tabanlı API kullanır; büyük dosya içeriklerini Swift ile Rust arasında bellek kopyası olarak taşımaz. UniFFI bağları `ios/Generated` altında üretilir ve cihaz/simülatör static library'leri `ExcelbaseCore.xcframework` içinde paketlenir.

Rust çekirdeği:

- uzantıya güvenmeden dosya biçimini denetler;
- Excel/CSV/ODS satırlarını ara NDJSON'a akıtır;
- ZIP girişlerini güvenli bir çalışma dizinine çıkarır;
- çıktı XLSX/CSV dosyalarını sabit bellek yaklaşımıyla üretir;
- dosya ve satır bazlı özet/hata döndürür.

### Kalıcı aktarım kuyruğu

Dosya seçildikten sonra güvenlik kapsamlı URL açıkken uygulamanın korumalı `Staging` alanına kopyalanır. Her dosya için kalıcı bir iş kaydı oluşturulur. Durumlar: bekliyor, işleniyor, duraklatıldı, tamamlandı ve hata.

Kuyruk şu garantileri hedefler:

1. Uygulama seçilen dosya sayısına yapay limit koymaz.
2. Aynı anda sınırlı sayıda dosya işlenir; kalanlar diskte bekler.
3. Her tamamlanan dosya ve veri partisi sonrası kontrol noktası yazılır.
4. iOS uygulamayı askıya alır veya sonlandırırsa yarım iş `duraklatıldı` olur.
5. Bir sonraki açılışta kullanıcı kuyruğu topluca veya dosya bazında sürdürebilir.

“Sınırsız seçim” fiziksel depolama ve iOS Dosyalar seçicisinin sınırlarını ortadan kaldırmaz; uygulama tarafından sabit bir 10/20/50 dosya sınırı uygulanmadığı anlamına gelir.

### Fotoğraf kasası

Seçilen fotoğraflar ve fotoğraf ZIP'leri cihaz içi kasaya alınır. ZIP içeriği yol geçişi, sembolik bağlantı, dosya adedi, açılmış boyut ve sıkıştırma oranı sınırlarından geçirilir. Güvenli dosya adı normalizasyonundan sonra fotoğraflar pasaport numarasıyla eşleştirilir. Veritabanı yalnız göreli referans ve bütünlük bilgisini tutar. Kaynak fotoğraf silinse veya Dosyalar erişimi sona erse bile kasadaki kopya kullanılabilir.

### Çıktı ve gelecek yedek tasarımı

Çıktılar geçici `Exports` alanında oluşturulur ve `ShareLink` ile Dosyalar, AirDrop veya takılı harici diske gönderilebilir. Uygulama paylaşım hedefinin ağ kullanıp kullanmadığını kontrol etmez; temel üretim işlemi tamamen cihaz içindedir.

İlk sürüm yalnız Excel/CSV'yi taşınabilir çıktı olarak sunar. Kaynakta bulunan yedek arayüzü üretime kapalıdır: tüm fotoğraf paketi şifrelenmeden ve kurtarılabilir anahtar/geri yükleme akışı doğrulanmadan UI'da yedek seçeneği gösterilmez. Tek iPhone, donanım kaybına karşı tek başına yedek değildir.

## Arka plan davranışı

iOS, kullanıcı uygulamayı kapattığında uzun süreli Excel işleminin kesintisiz devam edeceğini garanti etmez. Bu nedenle ürün “arka planda mutlaka tamamlanır” iddiasında bulunmaz. Güvenilirlik; önce yerel kopya, kalıcı kuyruk, küçük veri partileri ve yeniden başlatma kontrol noktalarıyla sağlanır.

## Derleme

Gereksinimler: macOS, Swift 6.1 araç zincirini içeren Xcode 16.3 veya sonrası, Rust 1.88 ve XcodeGen.

```bash
brew install xcodegen
bash ios/scripts/build-ios.sh
```

Betik sırasıyla Rust UniFFI bağlarını ve XCFramework'ü üretir, Xcode projesini oluşturur ve kod imzası olmadan simülatör derlemesi alır. Gerçek iPhone kurulumu için Xcode'da bir Apple Development takımı seçilmelidir.

## Yayın öncesi doğrulama

- Gerçek operasyon örnekleriyle XLSX/XLS/XLSM/CSV/ODS/ZIP uyumluluğu.
- 50, 100 ve 500 dosyalı kuyrukta bellek, depolama ve yeniden başlatma testi.
- Uygulama zorla kapatılırken veri bütünlüğü testi.
- Türkçe karakterli dosya adları ve farklı tarih/sayı biçimleri.
- Büyük fotoğraf ZIP'lerinde disk kapasitesi ve eşleştirme doğruluğu.
- Taşınabilir yedek yayınlanmadan önce anahtar kurtarma, tüm paket şifreleme ve gerçek geri yükleme tatbikatı.
- VoiceOver, Dynamic Type, açık/koyu mod ve düşük güç modu.
