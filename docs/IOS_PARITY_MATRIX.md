# iOS Offline işlev eşliği

Bu tablo, V7 web uygulamasındaki operasyon işlevlerinin ilk native iOS sürümündeki karşılığını gösterir. “Hazır” kaynakta ve UI akışında karşılığı bulunan; “doğrulama gerekli” gerçek operasyon dosyalarıyla kabul testi bekleyen; “sonraki sürüm” ise bilinçli olarak ilk paketin dışında tutulan işlevdir.

| V7 işlevi | iOS Offline karşılığı | Durum | Not |
| --- | --- | --- | --- |
| Genel operasyon özeti | Yolcu, hazır, eksik fotoğraf, eşleşen fotoğraf, kontrol ve ücret kartları | Hazır | Yerel DB'den hesaplanır. |
| Yolcu listesi | Native liste ve ad/pasaport araması | Hazır | Ağ sayfalaması yok; sorgu doğrudan SQLite'a gider. |
| Gidiş tarihi filtresi | Tümü / Bugün / Bu hafta / Bu ay | Hazır | Arama sonucuyla birlikte cihaz içinde uygulanır. |
| Yolcu kartı ayrıntı/düzenleme | Özet satırı mevcut | Sonraki sürüm | Alan bazlı editör ve doğrulama ekranı eklenecek. |
| Hazır/eksik/fotosuz/pasaportsuz filtreleri | Sorun sayısı ve durum göstergesi | Sonraki sürüm | Çoklu filtre çubuğu henüz UI'da yok. |
| Tekrarlı pasaport tespiti | Yolcu satırında tekrarlı işareti, aktarım stratejisi | Hazır | Birleştirme editörü sonraki sürüm. |
| Toplu Excel seçimi | iOS çoklu Dosyalar seçici, uygulama kaynaklı adet sınırı yok | Hazır | Fiziksel depolama/iOS sınırları geçerlidir. |
| XLSX/XLS/XLSM/CSV/ODS | Rust `excelbase-core` yol tabanlı ayrıştırma | Doğrulama gerekli | Gerçek saha şablonlarıyla fixture kabul testi şart. |
| ZIP içindeki listeler | Güvenli açma ve kuyruk oluşturma | Doğrulama gerekli | Büyük ve iç içe ZIP limitleri test edilmeli. |
| Mevcut listeyi değiştir | İlk dosyada toplu değişim niyeti | Hazır | İş başlamadan önce seçilir. |
| Tekrar stratejisi | Koru / güncelle / ayrı ekle | Hazır | Pasaport + sefer kimliği üzerinden uygulanır. |
| Otomatik aktarım | Kalıcı yerel iş kuyruğu | Hazır | Uygulama askıya alınırsa kontrol noktasından sürer. |
| Aktarım geçmişi | Dosya kartları, satır ilerlemesi, hata, yeniden dene/kaldır | Hazır | Tamamlanan kayıtlar yerel tutulur. |
| Fotoğraf çoklu seçim | Fotoğraflar ve Dosyalar seçicisi | Hazır | Uygulama kaynaklı seçim adedi limiti yok. |
| Fotoğraf ZIP'i | Güvenli, boyut sınırlı Rust çıkarıcı + cihaz içi kasa | Doğrulama gerekli | Gerçek HEIC/JPEG paketleri ve pasaport adı eşleştirmesiyle kabul testi yapılmalı. |
| Galeri | Eşleşme durumu ve yerel küçük resimler | Hazır | Fotoğraf düzenleme yok. |
| Tarih arşivi | Gidiş tarihine göre operasyon grupları ve hazırlık oranı | Hazır | Operasyon notu/görevli alanı sonraki sürüm. |
| Excel çıktı | Cihaz içi XLSX üretimi | Doğrulama gerekli | Yunanistan teslim şablonuyla görsel karşılaştırma gerekli. |
| CSV çıktı | Cihaz içi CSV üretimi | Hazır | UTF-8 ve Türkçe karakter testi CI fixture'larında olmalı. |
| Teslim paketi ZIP'i | Henüz yok | Sonraki sürüm | Rust çekirdeğine XLSX + CSV + fotoğraf paketi yazıcısı eklenecek. |
| JSON/yedek dışa aktarma | UI'da sunulmuyor | Sonraki sürüm | Tüm paket şifreleme ve kurtarılabilir anahtar tasarımı tamamlanmadan hazır sayılmayacak. |
| Yedekten geri yükleme | UI'da sunulmuyor | Sonraki sürüm | Tehdit modeli, ön izleme ve gerçek geri yükleme testi gerekir. |
| Tümünü temizle | Ayarlar'da geri alınamaz silme onayı | Hazır | Önce Excel/CSV dışa aktarma uyarısı gösterilir. |
| PWA çevrimdışı önbellek | Gerçek native uygulama | Hazır | Web sunucusu/service worker yok. |
| Kullanıcı girişi/API anahtarı | Tek cihaz + iOS cihaz kilidi/Keychain | Uygulanmaz | İnternete açık API bulunmaz. |
| Render/PostgreSQL | Yerel GRDB/SQLite | Uygulanmaz | Sunucu veya internet gerekmez. |
| Birden fazla cihazda eşzamanlama | Yok | Sonraki sürüm | Eklenecekse açık rıza ve uçtan uca şifreleme gerekir. |

## İlk saha kabul eşiği

Native sürüm, aşağıdaki uçtan uca senaryo gerçek cihazda geçmeden web sürümünün yerine ana üretim aracı olarak kullanılmamalıdır:

1. En az 49 gerçek Excel dosyasını tek seçimle kuyruğa alma.
2. Uygulamayı zorla kapatıp yeniden açtıktan sonra kaldığı yerden devam etme.
3. Yolcu sayısı, pasaport, voucher, gidiş/dönüş, yetişkin/çocuk ücretlerini kaynak Excel'le karşılaştırma.
4. Fotoğraf ZIP'ini içe aktarıp pasaport numarasıyla doğru eşleştirme.
5. Teslim Excel'ini oluşturup ayrı bir cihazda açma; ZIP paketi eklenince aynı testi fotoğraflarla tekrarlama.
6. Uçak modunda tüm adımları yeniden tamamlama.
7. Taşınabilir Excel/CSV kopyasını ayrı cihazda açma; yedek özelliğini güvenli paket ve geri yükleme tamamlanana kadar üretime almama.
