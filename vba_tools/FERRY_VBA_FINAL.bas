'================================================================
' FERRY VISA — NİHAİ (FİNAL) VBA PAKETİ
' Bu dosyadaki her şey ŞABLON_HAZIR.xlsx için hazırlandı.
' Panel (L1:M10) ve DURUM sütunu (J) zaten dosyada hazır —
' hiçbir hücreye elle format eklemene gerek yok.
'================================================================


'================================================================
'  BÖLÜM 1 — "Sayfa1" SAYFA MODÜLÜNE YAPIŞTIRILACAK
'  (Sol ağaçta "Sayfa1 (Sayfa1)" öğesine ÇİFT TIKLA, buraya yapıştır)
'================================================================

Private Sub Worksheet_Change(ByVal Target As Range)
    On Error GoTo CleanUp

    If Target.Row < 5 Then Exit Sub
    If Intersect(Target, Me.Range("A5:G2000")) Is Nothing Then Exit Sub

    Application.EnableEvents = False

    Dim cell As Range
    Dim processedRows As New Collection
    Dim r As Long

    For Each cell In Intersect(Target, Me.Range("A5:G2000")).Cells
        r = cell.Row
        On Error Resume Next
        processedRows.Add r, CStr(r)
        On Error GoTo 0
    Next cell

    Dim rr As Variant
    For Each rr In processedRows
        Call CheckAndCreateFolder(Me, CLng(rr))
    Next rr

CleanUp:
    Application.EnableEvents = True
End Sub


'================================================================
'  BÖLÜM 2 — YENİ BİR STANDART MODÜLE YAPIŞTIRILACAK
'  (Insert > Module ile yeni modül oluştur, buraya yapıştır)
'  Bu tek blok, konuştuğumuz HER ÖZELLİĞİ içeriyor:
'   - Klasör otomasyonu (Excel'e satır girince)
'   - PDF / Foto ekleme (özel adlandırma + biometric klasörü)
'   - Ana / Tarih / Kişi / Biometric klasörünü Explorer'da açma
'   - Panodan (Ctrl+C) okuyan "Hızlı Giriş Paneli" (L1:M10)
'================================================================

Option Explicit

'---------------- AYARLAR ----------------

Public Function GetBasePath() As String
    Dim ws As Worksheet
    Set ws = GetOrCreateSettingsSheet()

    If ws.Range("B1").Value = "" Then
        Dim fd As FileDialog
        Set fd = Application.FileDialog(msoFileDialogFolderPicker)
        fd.Title = "Klasörlerin oluşturulacağı ana dizini seç"
        If fd.Show = -1 Then
            ws.Range("B1").Value = fd.SelectedItems(1)
            ThisWorkbook.Save
        Else
            GetBasePath = ""
            Exit Function
        End If
    End If

    GetBasePath = ws.Range("B1").Value
End Function

Private Function GetOrCreateSettingsSheet() As Worksheet
    Dim ws As Worksheet
    On Error Resume Next
    Set ws = ThisWorkbook.Sheets("Settings")
    On Error GoTo 0

    If ws Is Nothing Then
        Set ws = ThisWorkbook.Sheets.Add(After:=ThisWorkbook.Sheets(ThisWorkbook.Sheets.Count))
        ws.Name = "Settings"
        ws.Range("A1").Value = "BasePath"
        ws.Visible = xlSheetVeryHidden
    End If
    Set GetOrCreateSettingsSheet = ws
End Function

Public Sub KlasorKonumunuSifirla()
    Dim ws As Worksheet
    Set ws = GetOrCreateSettingsSheet()
    ws.Range("B1").ClearContents
    ThisWorkbook.Save
    MsgBox "Klasör konumu sıfırlandı." & vbCrLf & _
           "Bir sonraki satır tamamlandığında tekrar soracak.", vbInformation
End Sub

Public Sub KlasorKonumunuGoster()
    Dim ws As Worksheet
    Set ws = GetOrCreateSettingsSheet()
    If ws.Range("B1").Value = "" Then
        MsgBox "Henüz klasör konumu seçilmedi.", vbInformation
    Else
        MsgBox "Mevcut klasör konumu:" & vbCrLf & ws.Range("B1").Value, vbInformation
    End If
End Sub


'---------------- ORTAK YARDIMCI FONKSİYONLAR ----------------

Public Function SanitizeFolderName(s As String) As String
    Dim badChars As Variant, ch As Variant
    badChars = Array("\", "/", ":", "*", "?", Chr(34), "<", ">", "|")
    Dim result As String
    result = Trim(s)
    For Each ch In badChars
        result = Replace(result, ch, "_")
    Next ch
    SanitizeFolderName = result
End Function

Private Function GetUniqueFileName(folderPath As String, baseName As String, ext As String) As String
    Dim candidate As String
    Dim n As Integer
    candidate = baseName & "." & ext
    n = 1
    Do While Dir(folderPath & candidate) <> ""
        n = n + 1
        candidate = baseName & " (" & n & ")." & ext
    Loop
    GetUniqueFileName = candidate
End Function


'---------------- KLASÖR OLUŞTURMA ----------------
' Klasör adı: gün.ay.yıl (dd.mm.yyyy)
' Dosya adı (PDF/JPG içinde kullanılacak): yıl-ay-gün (yyyy-mm-dd)
' Biometric fotoğraflar ana klasördeki TEK "biometric" klasörüne gider

Public Sub CheckAndCreateFolder(ws As Worksheet, r As Long)
    Dim noVal As Variant, nameVal As String, surnameVal As String, depVal As Variant

    noVal = ws.Cells(r, 1).Value
    nameVal = Trim(ws.Cells(r, 2).Value)
    surnameVal = Trim(ws.Cells(r, 3).Value)
    depVal = ws.Cells(r, 6).Value

    If noVal = "" Or nameVal = "" Or surnameVal = "" Or depVal = "" Then Exit Sub

    Dim folderDate As String
    If IsDate(depVal) Then
        folderDate = Format(CDate(depVal), "dd.mm.yyyy")
    Else
        folderDate = SanitizeFolderName(CStr(depVal))
    End If

    Dim basePath As String
    basePath = GetBasePath()
    If basePath = "" Then Exit Sub
    If Right(basePath, 1) <> "\" Then basePath = basePath & "\"

    Dim personFolder As String
    personFolder = SanitizeFolderName(Format(CLng(noVal), "00") & "_" & nameVal & "_" & surnameVal)

    Dim dateFolder As String, personPath As String, docsPath As String, biometricRoot As String
    dateFolder = basePath & folderDate & "\"
    personPath = dateFolder & personFolder & "\"
    docsPath = personPath & "documents\"
    biometricRoot = basePath & "biometric\"

    Dim wasNew As Boolean
    wasNew = (Dir(personPath, vbDirectory) = "")

    If Dir(dateFolder, vbDirectory) = "" Then MkDir dateFolder
    If Dir(personPath, vbDirectory) = "" Then MkDir personPath
    If Dir(docsPath, vbDirectory) = "" Then MkDir docsPath
    If Dir(biometricRoot, vbDirectory) = "" Then MkDir biometricRoot

    ws.Cells(r, 10).Value = "OK Klasor hazir"
    ws.Cells(r, 10).Interior.Color = RGB(223, 243, 230)
    ws.Cells(r, 10).Font.Color = RGB(63, 156, 110)

    If wasNew Then
        Application.StatusBar = "Olusturuldu: " & folderDate & "\" & personFolder
    End If
End Sub


'---------------- PDF EKLEME ----------------
' Dosya adı: "yyyy-mm-dd Ad Soyad Pasaport.pdf"

Public Sub PdfEkle()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets("Sayfa1")

    Dim r As Long
    r = ActiveCell.Row
    If r < 5 Then
        MsgBox "Lütfen önce bir yolcu satırı seç (A5'ten itibaren).", vbExclamation
        Exit Sub
    End If

    Dim noVal As Variant, nameVal As String, surnameVal As String, depVal As Variant, passportVal As String
    noVal = ws.Cells(r, 1).Value
    nameVal = Trim(ws.Cells(r, 2).Value)
    surnameVal = Trim(ws.Cells(r, 3).Value)
    passportVal = Trim(ws.Cells(r, 4).Value)
    depVal = ws.Cells(r, 6).Value

    If nameVal = "" Or surnameVal = "" Or depVal = "" Then
        MsgBox "Bu satırda ad, soyad veya gidiş tarihi eksik.", vbExclamation
        Exit Sub
    End If

    Dim folderDate As String, fileDate As String
    folderDate = IIf(IsDate(depVal), Format(CDate(depVal), "dd.mm.yyyy"), SanitizeFolderName(CStr(depVal)))
    fileDate = IIf(IsDate(depVal), Format(CDate(depVal), "yyyy-mm-dd"), SanitizeFolderName(CStr(depVal)))

    Dim basePath As String
    basePath = GetBasePath()
    If basePath = "" Then Exit Sub
    If Right(basePath, 1) <> "\" Then basePath = basePath & "\"

    Dim personFolder As String
    personFolder = SanitizeFolderName(Format(CLng(noVal), "00") & "_" & nameVal & "_" & surnameVal)

    Dim docsPath As String
    docsPath = basePath & folderDate & "\" & personFolder & "\documents\"

    If Dir(docsPath, vbDirectory) = "" Then Call CheckAndCreateFolder(ws, r)

    Dim baseName As String
    baseName = SanitizeFolderName(fileDate & " " & nameVal & " " & surnameVal & IIf(passportVal <> "", " " & passportVal, ""))

    Dim fd As FileDialog
    Set fd = Application.FileDialog(msoFileDialogFilePicker)
    fd.Title = nameVal & " " & surnameVal & " icin PDF sec"
    fd.Filters.Clear
    fd.Filters.Add "PDF Dosyalari", "*.pdf"
    fd.AllowMultiSelect = True

    Dim fso As Object
    Set fso = CreateObject("Scripting.FileSystemObject")

    If fd.Show = -1 Then
        Dim f As Variant, count As Integer: count = 0
        For Each f In fd.SelectedItems
            Dim newName As String
            newName = GetUniqueFileName(docsPath, baseName, "pdf")
            fso.CopyFile f, docsPath & newName, True
            count = count + 1
        Next f
        MsgBox count & " PDF dosyasi eklendi:" & vbCrLf & docsPath, vbInformation
    End If
End Sub


'---------------- FOTOĞRAF EKLEME ----------------
' Ana klasördeki TEK "biometric" klasörüne, aynı adlandırma kalıbıyla gider

Public Sub FotoEkle()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets("Sayfa1")

    Dim r As Long
    r = ActiveCell.Row
    If r < 5 Then
        MsgBox "Lütfen önce bir yolcu satırı seç (A5'ten itibaren).", vbExclamation
        Exit Sub
    End If

    Dim noVal As Variant, nameVal As String, surnameVal As String, depVal As Variant, passportVal As String
    noVal = ws.Cells(r, 1).Value
    nameVal = Trim(ws.Cells(r, 2).Value)
    surnameVal = Trim(ws.Cells(r, 3).Value)
    passportVal = Trim(ws.Cells(r, 4).Value)
    depVal = ws.Cells(r, 6).Value

    If nameVal = "" Or surnameVal = "" Or depVal = "" Then
        MsgBox "Bu satırda ad, soyad veya gidiş tarihi eksik.", vbExclamation
        Exit Sub
    End If

    Dim fileDate As String
    fileDate = IIf(IsDate(depVal), Format(CDate(depVal), "yyyy-mm-dd"), SanitizeFolderName(CStr(depVal)))

    Dim basePath As String
    basePath = GetBasePath()
    If basePath = "" Then Exit Sub
    If Right(basePath, 1) <> "\" Then basePath = basePath & "\"

    Dim biometricRoot As String
    biometricRoot = basePath & "biometric\"
    If Dir(biometricRoot, vbDirectory) = "" Then MkDir biometricRoot

    Dim baseName As String
    baseName = SanitizeFolderName(fileDate & " " & nameVal & " " & surnameVal & IIf(passportVal <> "", " " & passportVal, ""))

    Dim fd As FileDialog
    Set fd = Application.FileDialog(msoFileDialogFilePicker)
    fd.Title = nameVal & " " & surnameVal & " icin fotograf sec"
    fd.Filters.Clear
    fd.Filters.Add "Gorsel Dosyalari", "*.jpg; *.jpeg; *.png"
    fd.AllowMultiSelect = False

    Dim fso As Object
    Set fso = CreateObject("Scripting.FileSystemObject")

    If fd.Show = -1 Then
        Dim f As String
        f = fd.SelectedItems(1)
        Dim ext As String
        ext = fso.GetExtensionName(f)
        Dim newName As String
        newName = GetUniqueFileName(biometricRoot, baseName, ext)
        fso.CopyFile f, biometricRoot & newName, True
        MsgBox "Fotograf eklendi:" & vbCrLf & biometricRoot & newName, vbInformation
    End If
End Sub


'---------------- KLASÖRLERİ EXPLORER'DA AÇMA ----------------

Public Sub AnaKlasoruAc()
    Dim basePath As String
    basePath = GetBasePath()
    If basePath = "" Then Exit Sub
    If Dir(basePath, vbDirectory) = "" Then
        MsgBox "Klasör bulunamadı:" & vbCrLf & basePath, vbCritical
        Exit Sub
    End If
    Shell "explorer.exe """ & basePath & """", vbNormalFocus
End Sub

Public Sub BiometricKlasorunuAc()
    Dim basePath As String
    basePath = GetBasePath()
    If basePath = "" Then Exit Sub
    If Right(basePath, 1) <> "\" Then basePath = basePath & "\"
    Dim biometricRoot As String
    biometricRoot = basePath & "biometric\"
    If Dir(biometricRoot, vbDirectory) = "" Then
        MsgBox "Biometric klasörü henüz oluşmadı.", vbExclamation
        Exit Sub
    End If
    Shell "explorer.exe """ & biometricRoot & """", vbNormalFocus
End Sub

Public Sub TarihKlasorunuAc()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets("Sayfa1")
    Dim r As Long
    r = ActiveCell.Row
    If r < 5 Then
        MsgBox "Lütfen önce bir yolcu satırı seç.", vbExclamation
        Exit Sub
    End If
    Dim depVal As Variant
    depVal = ws.Cells(r, 6).Value
    If depVal = "" Then
        MsgBox "Bu satırda gidiş tarihi boş.", vbExclamation
        Exit Sub
    End If
    Dim folderDate As String
    folderDate = IIf(IsDate(depVal), Format(CDate(depVal), "dd.mm.yyyy"), SanitizeFolderName(CStr(depVal)))
    Dim basePath As String
    basePath = GetBasePath()
    If basePath = "" Then Exit Sub
    If Right(basePath, 1) <> "\" Then basePath = basePath & "\"
    Dim dateFolder As String
    dateFolder = basePath & folderDate & "\"
    If Dir(dateFolder, vbDirectory) = "" Then
        MsgBox "Bu tarih için henüz klasör yok:" & vbCrLf & dateFolder, vbExclamation
        Exit Sub
    End If
    Shell "explorer.exe """ & dateFolder & """", vbNormalFocus
End Sub

Public Sub KisiKlasorunuAc()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets("Sayfa1")
    Dim r As Long
    r = ActiveCell.Row
    If r < 5 Then
        MsgBox "Lütfen önce bir yolcu satırı seç.", vbExclamation
        Exit Sub
    End If
    Dim noVal As Variant, nameVal As String, surnameVal As String, depVal As Variant
    noVal = ws.Cells(r, 1).Value
    nameVal = Trim(ws.Cells(r, 2).Value)
    surnameVal = Trim(ws.Cells(r, 3).Value)
    depVal = ws.Cells(r, 6).Value
    If noVal = "" Or nameVal = "" Or surnameVal = "" Or depVal = "" Then
        MsgBox "Bu satırda eksik bilgi var.", vbExclamation
        Exit Sub
    End If
    Dim folderDate As String
    folderDate = IIf(IsDate(depVal), Format(CDate(depVal), "dd.mm.yyyy"), SanitizeFolderName(CStr(depVal)))
    Dim basePath As String
    basePath = GetBasePath()
    If basePath = "" Then Exit Sub
    If Right(basePath, 1) <> "\" Then basePath = basePath & "\"
    Dim personFolder As String
    personFolder = SanitizeFolderName(Format(CLng(noVal), "00") & "_" & nameVal & "_" & surnameVal)
    Dim personPath As String
    personPath = basePath & folderDate & "\" & personFolder & "\"
    If Dir(personPath, vbDirectory) = "" Then
        MsgBox "Bu kişi için henüz klasör yok:" & vbCrLf & personPath, vbExclamation
        Exit Sub
    End If
    Shell "explorer.exe """ & personPath & """", vbNormalFocus
End Sub

Public Sub TumListeyiTara()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets("Sayfa1")
    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
    Dim r As Long, islenen As Integer: islenen = 0
    For r = 5 To lastRow
        If ws.Cells(r, 1).Value <> "" And ws.Cells(r, 2).Value <> "" _
           And ws.Cells(r, 3).Value <> "" And ws.Cells(r, 6).Value <> "" Then
            Call CheckAndCreateFolder(ws, r)
            islenen = islenen + 1
        End If
    Next r
    MsgBox islenen & " yolcu icin klasor kontrol edildi.", vbInformation
End Sub


'================================================================
' HIZLI GİRİŞ PANELİ (klavyesiz — panodan/Ctrl+C okuma)
' Panel zaten ŞABLON_HAZIR.xlsx içinde L1:M10'da hazır.
'================================================================

Public Function GetClipboardText() As String
    Dim DataObj As Object
    On Error GoTo Hata
    Set DataObj = CreateObject("Forms.DataObject.1")
    DataObj.GetFromClipboard
    GetClipboardText = DataObj.GetText(1)
    Exit Function
Hata:
    GetClipboardText = ""
End Function

Public Sub AdAl()
    ThisWorkbook.Sheets("Sayfa1").Range("M3").Value = Trim(GetClipboardText())
End Sub

Public Sub SoyadAl()
    ThisWorkbook.Sheets("Sayfa1").Range("M4").Value = Trim(GetClipboardText())
End Sub

Public Sub PasaportAl()
    ThisWorkbook.Sheets("Sayfa1").Range("M5").Value = Trim(GetClipboardText())
End Sub

Public Sub VoucherAl()
    ThisWorkbook.Sheets("Sayfa1").Range("M6").Value = Trim(GetClipboardText())
End Sub

Public Sub GidisAl()
    Dim d As Variant
    d = ParseDateFlexiblePanel(GetClipboardText())
    If IsNull(d) Then
        MsgBox "Panodaki metin tarih olarak tanınmadı:" & vbCrLf & GetClipboardText(), vbExclamation
        Exit Sub
    End If
    ThisWorkbook.Sheets("Sayfa1").Range("M7").Value = CDate(d)
End Sub

Public Sub DonusAl()
    Dim d As Variant
    d = ParseDateFlexiblePanel(GetClipboardText())
    If IsNull(d) Then
        MsgBox "Panodaki metin tarih olarak tanınmadı:" & vbCrLf & GetClipboardText(), vbExclamation
        Exit Sub
    End If
    ThisWorkbook.Sheets("Sayfa1").Range("M8").Value = CDate(d)
End Sub

Public Sub GidisIleri()
    Call TarihAyarlaPanel("M7", 1)
End Sub
Public Sub GidisGeri()
    Call TarihAyarlaPanel("M7", -1)
End Sub
Public Sub DonusIleri()
    Call TarihAyarlaPanel("M8", 1)
End Sub
Public Sub DonusGeri()
    Call TarihAyarlaPanel("M8", -1)
End Sub

Private Sub TarihAyarlaPanel(hucre As String, delta As Integer)
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets("Sayfa1")
    Dim d As Date
    If ws.Range(hucre).Value = "" Then
        d = Date
    ElseIf IsDate(ws.Range(hucre).Value) Then
        d = CDate(ws.Range(hucre).Value)
    Else
        d = Date
    End If
    d = d + delta
    ws.Range(hucre).Value = d
End Sub

Private Function ParseDateFlexiblePanel(s As String) As Variant
    Dim t As String
    t = Trim(s)
    If t = "" Then ParseDateFlexiblePanel = Null: Exit Function

    If IsDate(t) Then
        ParseDateFlexiblePanel = CDate(t)
        Exit Function
    End If

    Dim months As Variant, monthNums As Variant
    months = Array("ocak", "şubat", "subat", "mart", "nisan", "mayıs", "mayis", "haziran", _
                   "temmuz", "ağustos", "agustos", "eylül", "eylul", "ekim", "kasım", "kasim", "aralık", "aralik", _
                   "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")
    monthNums = Array(1, 2, 2, 3, 4, 5, 5, 6, 7, 8, 8, 9, 9, 10, 11, 11, 12, 12, _
                       1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)

    Dim lowerT As String
    lowerT = LCase(t)
    Dim i As Integer
    For i = 0 To UBound(months)
        If InStr(lowerT, months(i)) > 0 Then
            lowerT = Replace(lowerT, months(i), monthNums(i))
        End If
    Next i

    Dim cleaned As String
    Dim ch As String, j As Integer
    For j = 1 To Len(lowerT)
        ch = Mid(lowerT, j, 1)
        If ch Like "[0-9]" Or ch = "." Or ch = "/" Or ch = "-" Or ch = " " Then
            cleaned = cleaned & ch
        End If
    Next j
    cleaned = Trim(cleaned)

    If IsDate(cleaned) Then
        ParseDateFlexiblePanel = CDate(cleaned)
    Else
        ParseDateFlexiblePanel = Null
    End If
End Function

Public Sub PanelEkle()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets("Sayfa1")

    Dim noVal As Variant, adVal As String, soyadVal As String, pasaportVal As String
    Dim voucherVal As String, gidisVal As Variant, donusVal As Variant

    noVal = ws.Range("M2").Value
    adVal = Trim(ws.Range("M3").Value)
    soyadVal = Trim(ws.Range("M4").Value)
    pasaportVal = Trim(ws.Range("M5").Value)
    voucherVal = Trim(ws.Range("M6").Value)
    gidisVal = ws.Range("M7").Value
    donusVal = ws.Range("M8").Value

    If adVal = "" Or soyadVal = "" Or gidisVal = "" Then
        ws.Range("M10").Value = "X Ad, Soyad ve Gidis Tarihi zorunlu."
        ws.Range("M10").Font.Color = RGB(207, 91, 78)
        Exit Sub
    End If
    If Not IsDate(gidisVal) Then
        ws.Range("M10").Value = "X Gidis tarihi gecersiz."
        ws.Range("M10").Font.Color = RGB(207, 91, 78)
        Exit Sub
    End If
    If donusVal <> "" And Not IsDate(donusVal) Then
        ws.Range("M10").Value = "X Donus tarihi gecersiz."
        ws.Range("M10").Font.Color = RGB(207, 91, 78)
        Exit Sub
    End If
    If Not IsNumeric(noVal) Then noVal = GetNextNoPanel(ws)

    Dim r As Long
    r = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row + 1
    If r < 5 Then r = 5

    ws.Cells(r, 1).Value = CLng(noVal)
    ws.Cells(r, 2).Value = adVal
    ws.Cells(r, 3).Value = soyadVal
    ws.Cells(r, 4).Value = pasaportVal
    ws.Cells(r, 5).Value = voucherVal
    ws.Cells(r, 6).Value = CDate(gidisVal)
    If donusVal <> "" Then ws.Cells(r, 7).Value = CDate(donusVal)

    Application.EnableEvents = False
    Call CheckAndCreateFolder(ws, r)
    Application.EnableEvents = True

    ws.Range("M10").Value = "OK Eklendi: " & adVal & " " & soyadVal & " (satir " & r & ")"
    ws.Range("M10").Font.Color = RGB(63, 156, 110)

    Call PanelTemizle
End Sub

Public Sub PanelTemizle()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets("Sayfa1")
    ws.Range("M2").Value = GetNextNoPanel(ws)
    ws.Range("M3:M8").ClearContents
End Sub

Private Function GetNextNoPanel(ws As Worksheet) As Long
    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
    If lastRow < 5 Then
        GetNextNoPanel = 1
    ElseIf IsNumeric(ws.Cells(lastRow, 1).Value) Then
        GetNextNoPanel = ws.Cells(lastRow, 1).Value + 1
    Else
        GetNextNoPanel = 1
    End If
End Function
