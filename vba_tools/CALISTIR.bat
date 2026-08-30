@echo off
REM FERRY VBA enjektoru - cift tiklayarak calistir.
REM Bu .bat, vba_inject.py ile ayni klasorde durmalidir.
setlocal
cd /d "%~dp0"

set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY (
    echo Python bulunamadi. https://www.python.org/downloads/ adresinden kurup
    echo "Add python.exe to PATH" secenegini isaretle, sonra tekrar dene.
    pause
    exit /b 1
)

echo pywin32 kontrol ediliyor...
%PY% -c "import win32com.client" >nul 2>nul
if not %errorlevel%==0 (
    echo pywin32 kurulu degil, kuruluyor...
    %PY% -m pip install pywin32
)

%PY% vba_inject.py %*
echo.
pause
