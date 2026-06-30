# ExcelBase Cloud Final

Bu paket, telefonda dosya gibi açılan `index.html` değildir. Gerçek web uygulamasıdır. Excel dosyalarını backend okur; telefon sadece arayüzdür. Bu yüzden iPhone/Safari/ChatGPT önizleme kaynaklı dosya yükleme sorunu yaşamaz.

## Özellikler

- `.xlsx`, `.xls`, `.xlsm`, `.ods`, `.csv` okur.
- Birden fazla dosyayı ve Excel içindeki birden fazla sayfayı tek tabloya alır.
- Varsayılan modda Excel başlıklarını aynen korur.
- Kapı Vizesi, Feribot Satış ve CRM formatlarına otomatik kolon eşleştirir.
- Telefonda tablo düzenleme sağlar.
- Arama, satır ekleme, boş satır silme, tekrarlı satır silme sağlar.
- Excel ve CSV dışa aktarır.

## Lokal kurulum

Bilgisayarda:

```bash
pip install -r requirements.txt
streamlit run app.py
```

Sonra açılan adresi telefondan da kullanmak için aynı Wi-Fi ağındaysan terminalde görünen `Network URL` adresini aç.

## Streamlit Cloud kurulumu

1. Bu klasörü GitHub reposuna yükle.
2. Streamlit Cloud'da `New app` seç.
3. Repository ve `app.py` dosyasını seç.
4. Deploy et.
5. Oluşan linki telefonda aç.

## Render kurulumu

1. Bu klasörü GitHub reposuna yükle.
2. Render'da `New Web Service` seç.
3. Repo'yu bağla.
4. Build command: `pip install -r requirements.txt`
5. Start command: `streamlit run app.py --server.address=0.0.0.0 --server.port=$PORT`

## Kullanım

1. Sol menüden tablo modunu seç.
2. Excel / CSV dosyalarını yükle.
3. Tablo otomatik oluşur.
4. Hücreleri düzenle.
5. Excel indir veya CSV indir.

## Not

Önceki lokal HTML sürümleri iPhone'da güvenilir değildi. Bu sürümün farkı, Excel okuma/yazma işini tarayıcı yerine Python backend tarafında yapmasıdır.
