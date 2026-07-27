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
    Write-Host "  .env olusturuldu." -ForegroundColor Cyan
}

# Sifreleme anahtarini insan uydurmamali: rastgeleligi burada uretmek hem daha
# guvenli hem de kurulumdan bir adim siler.
$envText = Get-Content ".env" -Raw
if ($envText -notmatch '(?m)^GATEVISA_DATA_SECRET=.+$') {
    $bytes = New-Object byte[] 48
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $secret = [Convert]::ToBase64String($bytes)
    if ($envText -match '(?m)^GATEVISA_DATA_SECRET=') {
        $envText = $envText -replace '(?m)^GATEVISA_DATA_SECRET=.*$', "GATEVISA_DATA_SECRET=$secret"
    } else {
        $envText = $envText.TrimEnd() + "`nGATEVISA_DATA_SECRET=$secret`n"
    }
    Set-Content ".env" $envText -NoNewline
    Write-Host "  Sifreleme anahtari uretildi ve .env icine yazildi." -ForegroundColor Cyan
}

# Satirlari ortama tasi. Tirnaklar kirpilir: panodan yapistirilan bir deger
# tirnaklariyla gelirse Anthropic onu gecersiz anahtar sayardi.
#
# Ayirma islemi IndexOf ile yapilir, Split ile degil: PowerShell'de
# `.Split("=", 2)` beklenen "en fazla iki parca" degil, ikinci argumani
# StringSplitOptions sayan baska bir asiri yuke baglanabilir ve icinde "="
# gecen bir deger sessizce kirpilir. Bir API anahtarinin yarisi, gecersiz bir
# anahtardan daha kotudur: hata mesaji dogruyu soylemez.
Get-Content ".env" | ForEach-Object {
    $line = $_.Trim()
    # Notepad "UTF-8" olarak kaydederse dosyanin basina BOM koyar; kirpilmazsa
    # ilk degisken adi gorunmez bir karakterle baslar ve hicbir zaman eslesmez.
    $line = $line.TrimStart([char]0xFEFF)
    if ($line -and -not $line.StartsWith("#")) {
        $separator = $line.IndexOf("=")
        if ($separator -gt 0) {
            $name = $line.Substring(0, $separator).Trim()
            $value = $line.Substring($separator + 1).Trim().Trim('"').Trim("'")
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
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
}

# Bagimliliklar yalnizca .venv yokken kurulsaydi, `git pull` ile gelen yeni bir
# paket hicbir zaman kurulmazdi: uygulama eski paketlerle sessizce calisir ve
# yeni ozellik "acmadim mi?" diye aranirdi. Damga dosyasi son kurulumdan bu yana
# requirements degisti mi sorusunu cevaplar.
$stamp = ".venv\.requirements-installed"
$needsInstall = -not (Test-Path $stamp)
if (-not $needsInstall) {
    $stampTime = (Get-Item $stamp).LastWriteTimeUtc
    foreach ($file in @("requirements.txt", "backend\requirements.txt")) {
        if ((Get-Item $file).LastWriteTimeUtc -gt $stampTime) { $needsInstall = $true }
    }
}
if ($needsInstall) {
    Write-Host "Python bagimliliklari kuruluyor/guncelleniyor..." -ForegroundColor Cyan
    & .\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt --quiet
    New-Item -ItemType File -Path $stamp -Force | Out-Null
}

# --- frontend --------------------------------------------------------------
# FastAPI, frontend/out icindeki statik ciktiyi servis eder. Kaynaklardan biri
# derlemeden yeniyse yeniden derlenir; yoksa `git pull` ile gelen arayuz
# degisikligi tarayiciya hic ulasmaz ve "calismiyor" gibi gorunur.
function Test-FrontendStale {
    if (-not (Test-Path "frontend\out\index.html")) { return $true }
    $built = (Get-Item "frontend\out\index.html").LastWriteTimeUtc
    $sources = @(Get-ChildItem -Path "frontend\src" -Recurse -File -ErrorAction SilentlyContinue)
    $sources += @(Get-ChildItem -Path "frontend\public" -Recurse -File -ErrorAction SilentlyContinue)
    # Kok dizindeki dosyalar tek tek sayilir. "Tum dosyalar" denseydi derleme
    # sirasinda yazilan tsconfig.tsbuildinfo her seferinde ciktidan yeni gorunur
    # ve arayuz her acilista bastan derlenirdi.
    foreach ($name in @("package.json", "package-lock.json", "next.config.ts", "tsconfig.json")) {
        $path = Join-Path "frontend" $name
        if (Test-Path $path) { $sources += @(Get-Item $path) }
    }
    foreach ($source in $sources) {
        if ($source.LastWriteTimeUtc -gt $built) { return $true }
    }
    return $false
}

if (-not $SkipBuild -and (Test-FrontendStale)) {
    Write-Host "Arayuz derleniyor (ilk sefer birkac dakika)..." -ForegroundColor Cyan
    Push-Location frontend
    if (-not (Test-Path "node_modules") -or ((Get-Item "package-lock.json").LastWriteTimeUtc -gt (Get-Item "node_modules").LastWriteTimeUtc)) {
        npm ci
    }
    npm run build
    Pop-Location
}

Write-Host ""
Write-Host "  Excelbase calisiyor:  http://$bind`:$port" -ForegroundColor Green
if (-not $env:ANTHROPIC_API_KEY) {
    # Uygulamanin geri kalani anahtarsiz calisir; yalnizca asistan kapali olur.
    # Dosyanin tam yolu yazilir: ayni depodan birden fazla klasor acilmissa
    # "ama ben yazdim" ile "orada yazmiyor" ayni anda dogru olabilir.
    Write-Host "  Claude asistani kapali: ANTHROPIC_API_KEY bos." -ForegroundColor Yellow
    Write-Host "  Duzenlenecek dosya: $((Resolve-Path '.env').Path)" -ForegroundColor Yellow
    Write-Host "  Yazdiktan sonra bu pencereyi kapatip tekrar calistirin." -ForegroundColor Yellow
}
# Gelistirme paneli neden gorunmuyor sorusunu tarayiciya bakmadan cevaplar.
$devState = & .\.venv\Scripts\python.exe -c "from backend.devagent.service import dev_agent_state; print(dev_agent_state())" 2>$null
if ($devState -and $devState -ne "ready") {
    $devReason = switch ($devState) {
        "disabled"             { ".env icinde EXCELBASE_DEV_AGENT=1 yok" }
        "blocked_open_network" { "kurulum acik; once erisim kodu veya IP kisiti gerekir" }
        "api_key_missing"      { "ANTHROPIC_API_KEY bos" }
        "not_a_repository"     { "bu klasor bir git deposu degil" }
        "sdk_missing"          { "claude-agent-sdk kurulu degil" }
        default                { $devState }
    }
    Write-Host "  Uygulama ici gelistirme kapali: $devReason" -ForegroundColor Yellow
}
Write-Host "  Durdurmak icin: Ctrl+C"
Write-Host ""

& .\.venv\Scripts\python.exe -m uvicorn backend.main:app --host $bind --port $port
