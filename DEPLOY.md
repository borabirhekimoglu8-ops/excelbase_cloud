# Excelbase Operations — Render dışında çalıştırma

Render'a bağlı hiçbir şey yok. `render.yaml` yalnızca Render için bir tarif;
uygulama kendi makinenizde, ofis sunucunuzda veya herhangi bir VPS'te
çalışır — **Docker olmadan da**.

## Sunucunun ne yaptığı (ve yapmadığı)

Bunu bilmek taşıma kararını kolaylaştırıyor:

| Sunucuda | Sunucuda **değil** |
|---|---|
| PWA'nın statik dosyaları | Yolcu kayıtları |
| Anthropic proxy'si (API anahtarı burada durur) | Pasaport, fotoğraf, evrak |
| Erişim hesapları ve asistan kotaları | Notlar, görevler, iş dosyaları |

**Yolcu verisi hiçbir zaman sunucuya gitmez** — her tarayıcının kendi şifreli
kasasında durur. Bu yüzden sunucu taşımak veriyi taşımaz; kullanıcıların
verisi tarayıcılarında kaldığı yerde kalır. Taşınacak tek kalıcı şey
veritabanındaki erişim hesapları — onlar da isteğe bağlı.

## 1. Kurulum — Docker'sız (önerilen)

Docker gerekmez, Postgres de gerekmez. Veritabanı tek bir SQLite dosyasıdır:
`.data/excelbase.db`. Yedeklemek onu kopyalamaktır.

Gerekenler: **Python 3.11+** ve **Node.js 20+** (Node yalnızca ilk derleme için).

**Windows (PowerShell):**
```powershell
git clone https://github.com/borabirhekimoglu8-ops/excelbase_cloud
cd excelbase_cloud
.\run.ps1
```

**macOS / Linux:**
```sh
git clone https://github.com/borabirhekimoglu8-ops/excelbase_cloud
cd excelbase_cloud
./run.sh
```

Hepsi bu. Betik gerekli her şeyi kurar, şifreleme anahtarını kendisi üretir ve
sunucuyu başlatır: `http://127.0.0.1:8000`.

**Claude asistanını açmak için** (uygulamanın geri kalanı anahtarsız da çalışır)
proje klasöründeki `.env` dosyasını Not Defteri ile açın, şu satırı bulun:

```
ANTHROPIC_API_KEY=
```

`=` işaretinin sağına anahtarınızı yapıştırın — boşluk ve tırnak olmadan:

```
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxx
```

Kaydedin, pencereyi kapatın, betiği tekrar çalıştırın. (Anahtar:
console.anthropic.com → Settings → API Keys)

Sonraki çalıştırmalar hazır ortamı kullanır; arayüzü yeniden derlememek için
`.\run.ps1 -SkipBuild` (veya `SKIP_BUILD=1 ./run.sh`).

Durdurmak: **Ctrl+C**. Güncellemek: `git pull` ve tekrar çalıştırın.

> Sunucu kendini yeniden başlatmaz. Makine açıldığında otomatik çalışsın
> isterseniz Windows'ta Görev Zamanlayıcı'ya (Task Scheduler) "oturum
> açıldığında `run.ps1`" görevi ekleyin.

## 1b. Kurulum — Docker ile

Birden çok makineye tekrarlanabilir kurulum yapacaksanız veya Postgres
istiyorsanız:

```sh
git clone <repo> && cd excelbase_cloud
cp .env.example .env
```

`.env` içinde en az şu üçünü doldurun:

```sh
openssl rand -base64 32   # POSTGRES_PASSWORD
openssl rand -base64 48   # GATEVISA_DATA_SECRET
openssl rand -hex 24      # GATEVISA_BOOTSTRAP_TOKEN (ilk hesabı açmak için)
```

`ANTHROPIC_API_KEY` boş bırakılabilir; asistan kapalı çalışır, gerisi çalışır.

```sh
docker compose up -d --build
curl http://127.0.0.1:8000/health
```

İlk açılışta imaj kurulur (frontend derlenir), birkaç dakika sürer.

## 2. Nereden erişilebilir olacağı

`.env` içindeki `BIND_ADDRESS` bunu belirler ve **varsayılan kapalıdır**
(her iki kurulum yolunda da):

| Değer | Kim erişir |
|---|---|
| `127.0.0.1` (varsayılan) | Yalnızca sunucunun kendisi |
| `192.168.1.50` | Yalnızca o LAN arayüzü — ofis ağı |
| `0.0.0.0` | Makineye ulaşan herkes (internete açıksa: herkes) |

**Aradığınız "kapalı sunucu" büyük ihtimalle ikinci satır.** Ofis ağındaki bir
makinede `BIND_ADDRESS=192.168.1.50` ile çalıştırın: uygulama yalnızca o ağdan
açılır, dışarıdan hiç görünmez. Tam otonomi bu kurulumda güvenle açılabilir:

```
EXCELBASE_ASSISTANT_OPEN_ACCESS=1     # ağ zaten kapalı, kod sormaya gerek yok
EXCELBASE_ASSISTANT_ALLOW_WRITES=1    # Claude kayıt değiştirebilir
EXCELBASE_ASSISTANT_ALLOWED_IPS=192.168.1.0/24
```

## 2b. iPhone ve diğer telefonlar — HTTPS zorunlu

**Telefondan düz `http://192.168.1.50:8000` adresi çalışmaz.** Sebebi Safari
değil, tarayıcı standardı: `crypto.subtle` yalnızca **güvenli bağlamda**
(https:// veya sunucunun kendisindeki localhost) tanımlıdır. Şifreli kasa buna
dayandığı için güvensiz bir adreste hiç açılmaz; servis işçisi de kaydolmaz,
yani çevrimdışı mod da gider.

Uygulama bu durumda artık doğru sebebi söylüyor ("Bu adres güvenli değil"),
ama çözüm adresi HTTPS yapmaktır. Kapalı kalmayı sürdüren en kısa yol:

### Tailscale (önerilen)

Ücretsiz, port açmaz, hem ofiste hem dışarıda çalışır ve **geçerli bir HTTPS
sertifikası** verir — telefona sertifika yüklemek gerekmez.

1. Sunucu makinesine ve iPhone'a Tailscale kurun, ikisinde de aynı hesapla
   oturum açın (App Store'da "Tailscale").
2. Tailscale yönetim panelinde **HTTPS Certificates** ayarını açın.
3. Sunucuda:

```sh
tailscale serve --bg 8000
tailscale serve status        # verilen https adresini gösterir
```

4. iPhone'da Safari ile `https://<makine-adi>.<tailnet>.ts.net` açın →
   **Paylaş → Ana Ekrana Ekle**. Uygulama tam ekran PWA olarak çalışır.

Sunucu yerelde dinlemeye devam etsin (`BIND_ADDRESS=127.0.0.1`); Tailscale
zaten önüne geçiyor. IP kısıtı kullanacaksanız Tailscale aralığını verin:

```
EXCELBASE_ASSISTANT_TRUSTED_PROXY_HOPS=1
EXCELBASE_ASSISTANT_ALLOWED_IPS=100.64.0.0/10
```

### Alternatifler

| Yol | Not |
|---|---|
| Gerçek alan adı + Caddy | Port 80/443 açmayı ve DNS'i gerektirir; artık kapalı değil |
| Kendi imzalı sertifika | iPhone'a profil yükleyip **Ayarlar → Genel → Hakkında → Sertifika Güveni**'nden güvenmek gerekir; her cihazda tekrar |
| Yalnızca masaüstü | Sunucunun kendisinde `http://127.0.0.1:8000` güvenli bağlam sayılır, sorunsuz çalışır |

> Uzaktan erişim için portu internete açmayın; Tailscale/WireGuard cihazı
> LAN'daymış gibi davrandırır ve kurulum aynı kalır.

## 3. İnternete açacaksanız

Konteyner portunu doğrudan açmayın; önüne TLS sonlandıran bir ters vekil
koyun (Caddy en kısası):

```
excelbase.ornek.com {
    reverse_proxy 127.0.0.1:8000
}
```

Sonra `.env` içinde **`EXCELBASE_ASSISTANT_TRUSTED_PROXY_HOPS=1`** yapın.
Bu sayı önünüzdeki vekil sayısıyla eşleşmezse IP kısıtı yanlış adresi okur —
Cloudflare da kullanıyorsanız `2` olur. Yanlış ayarlanırsa kısıtlama ya
herkesi engeller ya da kimseyi.

## 4. Render'daki hesapları taşımak (isteğe bağlı)

Yalnızca mevcut erişim hesaplarını korumak istiyorsanız gerekir; sıfırdan
kurmak da tamamen geçerli (bootstrap token ile yeni yönetici açarsınız).

```sh
# Render → excelbase-v8-db → Connect → External Connection String
pg_dump "<render-external-url>" --no-owner --no-acl -Fc -f excelbase.dump

docker compose cp excelbase.dump db:/tmp/excelbase.dump
docker compose exec db pg_restore -U excelbase -d excelbase --clean --if-exists /tmp/excelbase.dump
```

`GATEVISA_DATA_SECRET` değerini Render'daki ile **aynı** tutun; farklı olursa
şifreli satırlar okunamaz.

## 5. Güncelleme, yedek, geri alma

**Docker'sız kurulumda:**

```sh
git pull                                  # güncelle, sonra run betiğini çalıştır
cp .data/excelbase.db yedek-$(date +%F).db   # yedek: dosyayı kopyalamak yeterli
```

**Docker'lı kurulumda:**

```sh
git pull && docker compose up -d --build          # güncelle
docker compose exec db pg_dump -U excelbase excelbase | gzip > yedek-$(date +%F).sql.gz
docker compose logs -f app                        # kayıtlar
docker compose down                               # durdur (veri kalır)
```

Postgres verisi `db-data` adlı Docker volume'ünde durur; `docker compose down`
onu silmez, `down -v` siler.

## 6. Diğer barındırma seçenekleri

Aynı `Dockerfile` her yerde çalışır. Yalnızca `DATABASE_URL` ve `PORT`
sağlayın:

| Nereye | Not |
|---|---|
| Kendi makineniz / ofis sunucusu | `run.ps1` / `run.sh` — Docker gerekmez, SQLite yeter |
| Herhangi bir VPS (Hetzner, DigitalOcean…) | Aynı compose dosyası, `BIND_ADDRESS=0.0.0.0` + ters vekil |
| Fly.io / Railway | `Dockerfile`'ı kullanır; Postgres'i eklentiden alın, `DATABASE_SSL` ayarını **silin** (TLS gerekir) |

`DATABASE_SSL=disable` yalnızca aynı özel ağdaki TLS'siz Postgres içindir;
yönetilen bir veritabanına bağlanırken bu satırı kaldırın.

### SQLite mi Postgres mi?

`run.ps1` / `run.sh` SQLite kullanır ve tek makinede çalışan bir kurulum için
bu yeterlidir: erişim hesapları ve asistan kotaları aynı şekilde kalıcıdır.
Postgres'e yalnızca aynı veritabanını **birden çok uygulama süreci**
paylaşacaksa geçin — `DATABASE_URL` değerini `.env` içinde tanımlarsanız
betikler SQLite varsayılanını kullanmaz.

## Render'ı kapatmadan önce

1. Yeni kurulumda giriş yapıp asistanın çalıştığını doğrulayın.
2. Postgres yedeğini alın (yukarıda).
3. Kullanıcılara söyleyin: **tarayıcı kasaları taşınmaz.** Yeni adreste
   veriler boş görünür; her cihaz kendi verisini uygulamanın yedekleme/geri
   yükleme akışıyla taşımalı.
