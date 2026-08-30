# -*- coding: utf-8 -*-
"""
FERRY VBA enjektoru
===================

FERRY_VBA_FINAL.bas icindeki kodu SABLON_HAZIR.xlsx dosyasina yazip
SABLON_OTOMATIK.xlsm olarak kaydeder.

  BOLUM 1  ->  Sayfa1'in sayfa (worksheet) kod modulu
  BOLUM 2  ->  "modFerryOtomasyon" adli yeni standart modul

Bu script YALNIZCA Windows + Masaustu Excel uzerinde calisir; Excel'i COM
uzerinden surer. Excel acik birakilir, kapatilmaz.

Kullanim (bu klasorde):
    python vba_inject.py
    python vba_inject.py --bas yol\\FERRY_VBA_FINAL.bas --xlsx yol\\SABLON_HAZIR.xlsx
    python vba_inject.py --split-only        # Excel'e dokunmaz, kodu ayirip dosyaya yazar
"""

import argparse
import os
import re
import sys

# Windows konsolu cp857/cp437 olabilir; Turkce karakterli yollari
# yazdirirken cokmek yerine soru isaretine dusmesi yeterli.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(errors="replace")
    except (AttributeError, ValueError):
        pass

# --- vbext_ComponentType sabitleri (Excel'e baglanmadan da lazim) ---
VBEXT_CT_STD_MODULE = 1
XL_OPEN_XML_WORKBOOK_MACRO_ENABLED = 52

DEFAULT_BAS = "FERRY_VBA_FINAL.bas"
DEFAULT_XLSX = "ŞABLON_HAZIR.xlsx"
DEFAULT_OUT = "ŞABLON_OTOMATIK.xlsm"
SHEET_TAB_NAME = "Sayfa1"
STD_MODULE_NAME = "modFerryOtomasyon"

BANNER = re.compile(r"^'=+\s*$")


# ----------------------------------------------------------------------
# 1) .bas dosyasini BOLUM 1 / BOLUM 2 olarak ayirma
# ----------------------------------------------------------------------

def _trim(lines):
    """Bastaki ve sondaki bos satirlari ve '==== seklindeki banner
    yorumlarini atar. Anlamli yorumlara dokunmaz."""
    start, end = 0, len(lines)
    while start < end and (not lines[start].strip() or BANNER.match(lines[start])):
        start += 1
    while end > start and (not lines[end - 1].strip() or BANNER.match(lines[end - 1])):
        end -= 1
    return lines[start:end]


def split_bas(text):
    """BOLUM 1 ve BOLUM 2 basliklarina gore kodu ikiye ayirir.

    Basliklarin kendisi ve etrafindaki banner satirlari sonuca dahil edilmez.
    Donus: (bolum1_kaynak, bolum2_kaynak)
    """
    lines = text.splitlines()
    marks = {}
    for i, line in enumerate(lines):
        m = re.search(r"B[OÖ]L[UÜ]M\s*([12])\b", line)
        if m:
            marks.setdefault(m.group(1), i)

    for key, label in (("1", "BÖLÜM 1"), ("2", "BÖLÜM 2")):
        if key not in marks:
            raise ValueError(
                "%s basligi .bas dosyasinda bulunamadi. Dosya beklenen "
                "yapida degil." % label
            )
    if marks["1"] >= marks["2"]:
        raise ValueError("BÖLÜM 1 basligi BÖLÜM 2'den sonra geliyor; "
                         "dosya yapisi beklenmedik.")

    part1 = _trim(lines[marks["1"] + 1:marks["2"]])
    part2 = _trim(lines[marks["2"] + 1:])

    # Basliklarin altinda kalan "buraya yapistir" aciklamalarini atiyoruz ki
    # moduller kodun kendisiyle bassin (BOLUM 2'de Option Explicit ilk satir
    # olmali). Kodun icindeki aciklamalara dokunulmuyor.
    for part in (part1, part2):
        while part and (not part[0].strip() or part[0].lstrip().startswith("'")):
            part.pop(0)

    if not part1:
        raise ValueError("BÖLÜM 1 bos cikti.")
    if not part2:
        raise ValueError("BÖLÜM 2 bos cikti.")
    return "\n".join(part1) + "\n", "\n".join(part2) + "\n"


def read_bas(path):
    with open(path, "rb") as fh:
        raw = fh.read()
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]
    for enc in ("utf-8", "cp1254", "cp857", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    raise ValueError("%s karakter kodlamasi cozulemedi." % path)


# ----------------------------------------------------------------------
# 2) Ortam kontrolleri
# ----------------------------------------------------------------------

def check_platform():
    if not sys.platform.startswith("win"):
        sys.exit(
            "HATA: Bu script yalnizca Windows'ta calisir.\n"
            "  Su anki platform: %s\n"
            "  pywin32/Excel COM otomasyonu Windows'a ozgudur; Linux veya\n"
            "  macOS'ta Excel'in VBA proje nesne modeline erisim yoktur.\n"
            "  Kodu ayirip dosyaya yazmak icin: python vba_inject.py --split-only"
            % sys.platform
        )


def import_win32():
    try:
        import win32com.client  # noqa: F401
        import pythoncom  # noqa: F401
        import pywintypes  # noqa: F401
    except ImportError as exc:
        sys.exit(
            "HATA: pywin32 kurulu degil (%s).\n"
            "  Kurmak icin:  pip install pywin32\n"
            "  Kurulumdan sonra bu scripti tekrar calistir." % exc
        )
    import win32com.client as client
    import pywintypes
    return client, pywintypes


def report_trust_setting():
    """AccessVBOM ayarini SADECE OKUR. Hicbir kayit defteri degeri yazilmaz."""
    try:
        import winreg
    except ImportError:
        return None
    found = []
    try:
        office = winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                                r"Software\Microsoft\Office")
    except OSError:
        return found
    with office:
        i = 0
        while True:
            try:
                ver = winreg.EnumKey(office, i)
            except OSError:
                break
            i += 1
            if not re.match(r"^\d+\.\d+$", ver):
                continue
            path = r"Software\Microsoft\Office\%s\Excel\Security" % ver
            try:
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, path) as key:
                    value, _ = winreg.QueryValueEx(key, "AccessVBOM")
                    found.append((ver, int(value)))
            except OSError:
                continue
    return found


TRUST_HELP = (
    "Excel'de:  Dosya -> Secenekler -> Guven Merkezi -> Guven Merkezi Ayarlari\n"
    "           -> Makro Ayarlari -> 'VBA proje nesne modeline guvenilen erisim'\n"
    "           (Trust access to the VBA project object model) kutusunu isaretle,\n"
    "           Excel'i tamamen kapatip yeniden ac."
)


# ----------------------------------------------------------------------
# 3) COM hatalarini oldugu gibi raporlama
# ----------------------------------------------------------------------

def format_com_error(exc):
    parts = ["COM hatasi: %r" % (exc,)]
    args = getattr(exc, "args", None)
    if args:
        parts.append("  args        : %r" % (args,))
    hresult = getattr(exc, "hresult", None)
    if hresult is not None:
        parts.append("  hresult     : 0x%08X" % (hresult & 0xFFFFFFFF))
    strerror = getattr(exc, "strerror", None)
    if strerror:
        parts.append("  strerror    : %s" % strerror)
    excepinfo = getattr(exc, "excepinfo", None)
    if excepinfo:
        parts.append("  excepinfo   : %r" % (excepinfo,))
        try:
            parts.append("  kaynak      : %s" % excepinfo[1])
            parts.append("  aciklama    : %s" % excepinfo[2])
            parts.append("  scode       : 0x%08X" % (excepinfo[5] & 0xFFFFFFFF))
        except (IndexError, TypeError):
            pass
    argerror = getattr(exc, "argerror", None)
    if argerror is not None:
        parts.append("  argerror    : %r" % (argerror,))
    return "\n".join(parts)


# ----------------------------------------------------------------------
# 4) Asil is
# ----------------------------------------------------------------------

def overwrite_module(component, source):
    """Modulun mevcut icerigini tamamen silip yerine source'u yazar.

    Silme adimi onemli: Excel'de 'Degisken bildirimi gerektir' acikken yeni
    modul zaten bir 'Option Explicit' satiriyla olusur, bunun uzerine
    BOLUM 2'yi eklemek ikinci bir Option Explicit'e ve derleme hatasina
    yol acar."""
    code_module = component.CodeModule
    if code_module.CountOfLines > 0:
        code_module.DeleteLines(1, code_module.CountOfLines)
    code_module.AddFromString(source)
    return code_module.CountOfLines


def run(bas_path, xlsx_path, out_path, keep_open=True):
    client, pywintypes = import_win32()

    part1, part2 = split_bas(read_bas(bas_path))
    print("[1/6] .bas ayristirildi: BOLUM 1 = %d satir, BOLUM 2 = %d satir"
          % (part1.count("\n"), part2.count("\n")))

    trust = report_trust_setting()
    if trust is None:
        print("[2/6] Guven ayari okunamadi (winreg yok).")
    elif not trust:
        print("[2/6] UYARI: HKCU altinda Excel AccessVBOM degeri bulunamadi.\n"
              "      Ayar hic acilmamis olabilir. Acik degilse asagidaki adim gerekli:\n"
              + TRUST_HELP)
    else:
        for ver, value in trust:
            state = "ACIK" if value == 1 else "KAPALI"
            print("[2/6] Office %s -> AccessVBOM = %d (%s)" % (ver, value, state))
        if not any(v == 1 for _, v in trust):
            print("      Ayar kapali gorunuyor. Bu ayari ben degistirmiyorum.\n"
                  + TRUST_HELP)

    excel = client.DispatchEx("Excel.Application")
    excel.Visible = True
    excel.DisplayAlerts = True
    print("[3/6] Excel baslatildi (Visible=True), surum %s" % excel.Version)

    wb = excel.Workbooks.Open(xlsx_path)
    print("[3/6] Acildi: %s" % wb.FullName)

    try:
        project = wb.VBProject
        _ = project.VBComponents.Count
    except pywintypes.com_error as exc:
        print("\nHATA: VBA projesine erisilemedi.\n" + format_com_error(exc))
        print("\nEn olasi neden: 'VBA proje nesne modeline guvenilen erisim' kapali.\n"
              + TRUST_HELP)
        print("\nExcel acik birakildi; ayari acip scripti tekrar calistirabilirsin.")
        raise SystemExit(2)

    # --- BOLUM 1 -> sayfa modulu ---
    # Sayfa modulunun VBComponent adi sekme adi degil CodeName'dir. xlsx
    # openpyxl ile uretildigi icin codeName tasimiyor; Excel dosyayi acarken
    # atiyor (TR arayuzde "Sayfa1", EN arayuzde "Sheet1"). Bu yuzden sabit
    # isim yerine sayfanin kendi CodeName'ini kullaniyoruz.
    ws = wb.Worksheets(SHEET_TAB_NAME)
    code_name = ws.CodeName
    print("[4/6] '%s' sekmesinin CodeName'i: %s" % (SHEET_TAB_NAME, code_name))
    sheet_component = project.VBComponents(code_name)
    n1 = overwrite_module(sheet_component, part1)
    print("[4/6] BOLUM 1 yazildi -> VBComponents(\"%s\").CodeModule (%d satir)"
          % (code_name, n1))

    # --- BOLUM 2 -> yeni standart modul ---
    for existing in list(project.VBComponents):
        if existing.Name == STD_MODULE_NAME:
            print("[5/6] Ayni adli eski modul bulundu, kaldiriliyor: %s"
                  % STD_MODULE_NAME)
            project.VBComponents.Remove(existing)
            break

    std = project.VBComponents.Add(VBEXT_CT_STD_MODULE)
    std.Name = STD_MODULE_NAME
    n2 = overwrite_module(std, part2)
    print("[5/6] BOLUM 2 yazildi -> yeni standart modul \"%s\" (%d satir)"
          % (STD_MODULE_NAME, n2))

    # --- .xlsm olarak kaydet ---
    excel.DisplayAlerts = False
    try:
        wb.SaveAs(out_path, FileFormat=XL_OPEN_XML_WORKBOOK_MACRO_ENABLED)
    finally:
        excel.DisplayAlerts = True
    print("[6/6] Kaydedildi (FileFormat=52): %s" % wb.FullName)

    print("\nModuller:")
    for comp in project.VBComponents:
        print("  - %-24s tip=%d  satir=%d"
              % (comp.Name, comp.Type, comp.CodeModule.CountOfLines))

    if not keep_open:
        wb.Close(SaveChanges=False)
        excel.Quit()
    else:
        print("\nExcel acik birakildi. Alt+F11 ile VBA duzenleyicisinden kontrol edebilirsin.")


def main(argv=None):
    here = os.path.dirname(os.path.abspath(__file__))
    parser = argparse.ArgumentParser(description="FERRY VBA kodunu sabona yazar.")
    parser.add_argument("--bas", default=os.path.join(here, DEFAULT_BAS))
    parser.add_argument("--xlsx", default=os.path.join(here, DEFAULT_XLSX))
    parser.add_argument("--out", default=None,
                        help="Cikis .xlsm yolu (varsayilan: xlsx ile ayni klasor)")
    parser.add_argument("--split-only", action="store_true",
                        help="Excel'e hic dokunma; BOLUM 1/2'yi .txt olarak yaz")
    parser.add_argument("--close", action="store_true",
                        help="Isi bitince Excel'i kapat (varsayilan: acik birak)")
    args = parser.parse_args(argv)

    bas_path = os.path.abspath(args.bas)
    xlsx_path = os.path.abspath(args.xlsx)
    out_path = os.path.abspath(args.out) if args.out else \
        os.path.join(os.path.dirname(xlsx_path), DEFAULT_OUT)

    if not os.path.isfile(bas_path):
        sys.exit("HATA: .bas dosyasi yok: %s" % bas_path)

    if args.split_only:
        part1, part2 = split_bas(read_bas(bas_path))
        out_dir = os.path.dirname(bas_path)
        p1 = os.path.join(out_dir, "BOLUM1_Sayfa1.txt")
        p2 = os.path.join(out_dir, "BOLUM2_%s.bas" % STD_MODULE_NAME)
        for path, body in ((p1, part1), (p2, part2)):
            with open(path, "w", encoding="utf-8", newline="\r\n") as fh:
                fh.write(body)
        print("BOLUM 1 (%d satir) -> %s" % (part1.count("\n"), p1))
        print("BOLUM 2 (%d satir) -> %s" % (part2.count("\n"), p2))
        return 0

    check_platform()
    if not os.path.isfile(xlsx_path):
        sys.exit("HATA: .xlsx dosyasi yok: %s" % xlsx_path)

    client, pywintypes = import_win32()
    try:
        run(bas_path, xlsx_path, out_path, keep_open=not args.close)
    except pywintypes.com_error as exc:
        print("\nISLEM YARIDA KESILDI.\n" + format_com_error(exc))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
