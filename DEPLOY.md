# Excelbase Operations — Render dışında çalıştırma

Uygulama tek bir Docker imajı. Render'a bağlı hiçbir şey yok: `render.yaml`
yalnızca Render için bir tarif, `docker-compose.yml` ise aynı imajı kendi
makinenizde, ofis sunucunuzda veya herhangi bir VPS'te çalıştırır.

## Sunucunun ne yaptığı (ve yapmadığı)

Bunu bilmek taşıma kararını kolaylaştırıyor:

| Sunucuda | Sunucuda **değil** |
|---|---|
| PWA'nın statik dosyaları | Yolcu kayıtları |
| Anthropic proxy'si (API anahtarı burada durur) | Pasaport, fotoğraf, evrak |
| Erişim hesapları ve asistan kotaları (Postgres) | Notlar, görevler, iş dosyaları |

**Yolcu verisi hiçbir zaman sunucuya gitmez** — her tarayıcının kendi şifreli
kasasında durur. Bu yüzden sunucu taşımak veriyi taşımaz; kullanıcıların
verisi tarayıcılarında kaldığı yerde kalır. Taşınacak tek kalıcı şey Postgres
içindeki erişim hesapları.

## 1. Kurulum

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

`.env` içindeki `BIND_ADDRESS` bunu belirler ve **varsayılan kapalıdır**:

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

> Uzaktan da erişmeniz gerekiyorsa doğru çözüm portu internete açmak değil,
> **VPN** (WireGuard/Tailscale). Cihaz VPN'e girdiğinde LAN'daymış gibi
> davranır, kurulum aynı kalır.

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
| Kendi makineniz / ofis sunucusu | `docker compose up -d` — yukarıdaki akış |
| Herhangi bir VPS (Hetzner, DigitalOcean…) | Aynı compose dosyası, `BIND_ADDRESS=0.0.0.0` + ters vekil |
| Fly.io / Railway | `Dockerfile`'ı kullanır; Postgres'i eklentiden alın, `DATABASE_SSL` ayarını **silin** (TLS gerekir) |

`DATABASE_SSL=disable` yalnızca aynı özel ağdaki TLS'siz Postgres içindir;
yönetilen bir veritabanına bağlanırken bu satırı kaldırın.

## Render'ı kapatmadan önce

1. Yeni kurulumda giriş yapıp asistanın çalıştığını doğrulayın.
2. Postgres yedeğini alın (yukarıda).
3. Kullanıcılara söyleyin: **tarayıcı kasaları taşınmaz.** Yeni adreste
   veriler boş görünür; her cihaz kendi verisini uygulamanın yedekleme/geri
   yükleme akışıyla taşımalı.
