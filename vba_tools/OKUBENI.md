# FERRY VBA enjektoru

`FERRY_VBA_FINAL.bas` icindeki kodu `ŞABLON_HAZIR.xlsx` dosyasina yazar ve
`ŞABLON_OTOMATIK.xlsm` olarak kaydeder.

| Kaynak | Hedef |
|---|---|
| `BÖLÜM 1` ile `BÖLÜM 2` arasi (27 satir, `Worksheet_Change`) | Sayfa1'in **sayfa kod modulu** |
| `BÖLÜM 2`den dosya sonuna (576 satir, 30 yordam) | Yeni **standart modul**: `modFerryOtomasyon` |

## Calistirma (Windows + masaustu Excel gerekir)

1. Bu klasoru Windows makineye kopyala (`vba_inject.py`, `CALISTIR.bat`,
   `FERRY_VBA_FINAL.bas`, `ŞABLON_HAZIR.xlsx` yan yana dursun).
2. Excel'de **Dosya → Secenekler → Guven Merkezi → Guven Merkezi Ayarlari →
   Makro Ayarlari** yolunda **"VBA proje nesne modeline guvenilen erisim"**
   kutusunu isaretle, Excel'i tamamen kapat.
   Script bu ayari sadece **okur**, asla degistirmez.
3. `CALISTIR.bat` dosyasina cift tikla. (Gerekirse `pip install pywin32`
   kendisi calisir.)

Excel gorunur halde acilir ve **islem sonunda acik birakilir**; Alt+F11 ile
modulleri kontrol edebilirsin.

## Secenekler

    python vba_inject.py                     # varsayilan dosyalarla calistir
    python vba_inject.py --xlsx yol\dosya.xlsx --out yol\cikti.xlsm
    python vba_inject.py --split-only        # Excel'e hic dokunma; iki bolumu
                                             # ayri dosyalara yaz (elle yapistirmak icin)
    python vba_inject.py --close             # is bitince Excel'i kapat

`--split-only` her isletim sisteminde calisir; guven ayarini acamazsan
ciktilari VBA duzenleyicisine elle yapistirabilirsin.

## Notlar

* Sayfa modulu **sekme adiyla degil `CodeName` ile** bulunur. `ŞABLON_HAZIR.xlsx`
  openpyxl ile uretildigi icin icinde `codeName` yok; Excel dosyayi acarken
  atar (Turkce arayuzde `Sayfa1`, Ingilizce arayuzde `Sheet1`). Bu yuzden
  script `Worksheets("Sayfa1").CodeName` degerini okuyup onu kullanir —
  arayuz dili ne olursa olsun dogru modulu bulur.
* Her iki modulun icerigi yazilmadan once temizlenir; script'i birden fazla
  kez calistirmak kod kopyalamaz.
* Hata cikarsa COM hatasinin tamami (hresult, scode, excepinfo) oldugu gibi
  yazdirilir.
