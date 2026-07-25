# Excelbase Operations — Docker'siz calistirma (Windows PowerShell).
#
#   .\run.ps1              ilk sefer kurar, sonra baslatir
#   .\run.ps1 -SkipBuild   frontend'i yeniden derlemeden baslatir
#
# Gerekenler: Python 3.11+ ve Node.js 20+ (yalnizca ilk derleme icin).
# Veritabani SQLite dosyasidir; kurulacak bir sunucu yoktur.

param([switch]$SkipBuild)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

# --- .env ------------------------------------------------------------------
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host ""
    Write-Host "  .env olusturuldu. Acip su iki degeri doldurun, sonra tekrar calistirin:" -ForegroundColor Yellow
    Write-Host "    GATEVISA_DATA_SECRET   (rastgele uzun bir metin)"
    Write-Host "    ANTHROPIC_API_KEY      (sk-ant- ile baslar; bos birakilirsa asistan kapali calisir)"
    Write-Host ""
    exit 1
}

# Satirlari ortama tasi. Tirnaklar kirpilir: panodan yapistirilan bir deger
# tirnaklariyla gelirse Anthropic onu gecersiz anahtar sayardi.
Get-Content ".env" | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
        $name, $value = $line.Split("=", 2)
        $value = $value.Trim().Trim('"').Trim("'")
        [Environment]::SetEnvironmentVariable($name.Trim(), $value, "Process")
    }
}

# --- varsayilanlar ---------------------------------------------------------
# Postgres yerine tek dosya. Kurulum gerektirmez, yedeklemesi kopyalamaktir.
if (-not $env:DATABASE_URL) {
    New-Item -ItemType Directory -Force -Path ".data" | Out-Null
    $dbPath = (Resolve-Path ".data").Path -replace '\\', '/'
    $env:DATABASE_URL = "sqlite:///$dbPath/excelbase.db"
}
if (-not $env:APP_ENV) { $env:APP_ENV = "production" }
if (-not $env:GATEVISA_REQUIRE_AUTH) { $env:GATEVISA_REQUIRE_AUTH = "1" }
# Dogrudan erisilen bir surec: onunde vekil yok.
if (-not $env:EXCELBASE_ASSISTANT_TRUSTED_PROXY_HOPS) { $env:EXCELBASE_ASSISTANT_TRUSTED_PROXY_HOPS = "0" }

$bind = if ($env:BIND_ADDRESS) { $env:BIND_ADDRESS } else { "127.0.0.1" }
$port = if ($env:HOST_PORT) { $env:HOST_PORT } else { "8000" }

# --- Python ----------------------------------------------------------------
if (-not (Test-Path ".venv")) {
    Write-Host "Python ortami kuruluyor..." -ForegroundColor Cyan
    python -m venv .venv
    & .\.venv\Scripts\python.exe -m pip install --upgrade pip --quiet
    & .\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt --quiet
}

# --- frontend --------------------------------------------------------------
# FastAPI, frontend/out icindeki statik ciktiyi servis eder.
if (-not $SkipBuild -and -not (Test-Path "frontend\out\index.html")) {
    Write-Host "Arayuz derleniyor (ilk sefer birkac dakika)..." -ForegroundColor Cyan
    Push-Location frontend
    npm ci
    npm run build
    Pop-Location
}

Write-Host ""
Write-Host "  Excelbase calisiyor:  http://$bind`:$port" -ForegroundColor Green
Write-Host "  Durdurmak icin: Ctrl+C"
Write-Host ""

& .\.venv\Scripts\python.exe -m uvicorn backend.main:app --host $bind --port $port
