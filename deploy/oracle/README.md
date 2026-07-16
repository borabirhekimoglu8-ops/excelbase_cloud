# Excelbase V7 — Oracle Cloud ARM64 çalıştırma kılavuzu

Bu dizin yalnızca **V7** üretim ortamını çalıştırır. İnternete açılan tek
uygulama `v7-web` servisidir. Excel işlemleri `v7-worker` içinde yürür;
PostgreSQL dışarı port yayınlamaz. Caddy ayrıca `/v8`, `/v8.html` ve
`/api/v8/*` isteklerini açıkça `404` ile engeller.

## 1. Sunucuyu ve DNS'i hazırlayın

1. Oracle Cloud'da Ubuntu ARM64 bir VM oluşturun. Always Free deneme sonrası
   toplam sınırıyla uyumlu olarak **2 OCPU, 12 GB RAM** ve en az 50 GB kalıcı
   disk seçin. Compose bellek sınırları işletim sistemine de güvenli pay bırakır.
2. VM'ye sabit public IPv4 ayırın. Alan adınızda bir `A` kaydını bu adrese
   yönlendirin. DNS yayılmadan Caddy sertifika alamaz.
3. OCI Security List/NSG içinde TCP `80` ve `443` portlarını internete açın.
   HTTP/3 için UDP `443` isteğe bağlıdır. SSH `22` portunu yalnız kendi yönetim
   IP'nizle sınırlandırın. **PostgreSQL `5432` portunu açmayın.**
4. Docker Engine ve Docker Compose v2'yi Docker'ın resmi Ubuntu kurulum
   yönergesiyle yükleyin. Kullanıcıyı `docker` grubuna eklemek yerine mümkünse
   komutları yetkili bir bakım hesabıyla çalıştırın.

Önerilen dizin:

```bash
sudo install -d -o "$USER" -g "$USER" /opt/excelbase
git clone https://github.com/borabirhekimoglu8-ops/excelbase_cloud.git /opt/excelbase
cd /opt/excelbase
```

## 2. Sırları oluşturun

```bash
cp deploy/oracle/.env.example deploy/oracle/.env
openssl rand -hex 32
openssl rand -hex 32
chmod 600 deploy/oracle/.env
```

İlk çıktıyı `POSTGRES_PASSWORD` alanına yazın. Temiz kurulum yapıyorsanız ikinci
çıktıyı `GATEVISA_DATA_SECRET` alanına yazın. Render verisini taşıyacaksanız
ikinci bir değer üretmek yerine Render'daki **mevcut** `GATEVISA_DATA_SECRET`
değerini aynen koruyun; aksi hâlde taşınan şifreli günlük yedekler açılamaz.
`APP_DOMAIN` ve `ACME_EMAIL` örneklerini de değiştirin. Public OCI kurulumunda
`GATEVISA_API_KEY` kullanmayın; fotoğraf ve yolcu istekleri HttpOnly oturum
çereziyle yetkilendirilir.

`.env` dosyasını Git'e eklemeyin, ekran görüntüsünde göstermeyin ve sohbetten
göndermeyin. Özellikle `GATEVISA_DATA_SECRET` kaybolursa uygulama içi şifreli
günlük yedekler açılamaz.

## 3. İlk dağıtım

```bash
./deploy/oracle/deploy.sh
```

Betik Compose yapılandırmasını doğrular, ARM64 üzerinde imajı yerel olarak
oluşturur ve PostgreSQL → V7 web/worker sırasıyla başlatır. Web ve worker sağlık
kontrolleri gerçek veritabanı yazma işlemini transaction içinde geri alarak
doğrular.

Temiz veritabanında betik güvenlik için Caddy'yi başlatmadan durur. İlk
yöneticiyi yalnız sunucunun özel terminalinden oluşturun:

```bash
docker compose --env-file deploy/oracle/.env -f deploy/oracle/docker-compose.yml \
  exec v7-web python -m backend.bootstrap_admin
./deploy/oracle/deploy.sh
```

İkinci çalıştırma yönetici kaydını doğruladıktan sonra Caddy ve HTTPS'i açar.

Kontroller:

```bash
curl -fsS "https://ALAN_ADINIZ/health"
curl -sS -o /dev/null -w '%{http_code}\n' "https://ALAN_ADINIZ/v8"
curl -sS -o /dev/null -w '%{http_code}\n' "https://ALAN_ADINIZ/api/v8/health"
docker compose --env-file deploy/oracle/.env -f deploy/oracle/docker-compose.yml ps
```

`/health` yanıtında `persistence` değeri `database`, `database_writable` değeri
`true` olmalıdır. İki V8 kontrolü `404` dönmelidir.

## 4. Render verisini güvenle taşıma

Mevcut Render ortamını hemen kapatmayın. Geçişten önce tam PostgreSQL yedeği ve
uygulama içindeki JSON yedeğini ayrı ayrı alın. Tam veritabanı yedeği fotoğraf,
kullanıcı ve kuyruk tablolarını da korur; uygulama JSON yedeği tek başına
fotoğrafları ve kullanıcıları içermez.

Eski veritabanı dökümünü OCI'ye kopyaladıktan sonra:

```bash
./deploy/oracle/restore.sh /guvenli/yol/render-yedegi.dump --confirm RESTORE_EXCELBASE
```

Ardından en az şu kontrolleri yapın:

- Yolcu toplamı ve birkaç farklı tarih filtresi doğru mu?
- Rastgele seçilen eski fotoğraflar açılıyor mu?
- Küçük bir XLSX ve çok dosyalı/ZIP aktarımı tamamlanıyor mu?
- Aktarım sırasında Yolcular sayfası yanıt vermeye devam ediyor mu?
- Yönetici girişi ve yeni bir yedek alma çalışıyor mu?

Render'ı ancak bu doğrulamalardan ve en az 24 saatlik paralel gözlemden sonra
kapatın. Aynı anda iki ortamda veri girişi yapmayın; doğrulama boyunca Render'ı
salt okunur/geri dönüş kaynağı kabul edin.

## 5. Güncelleme, yedek ve geri dönüş

Güncelleme:

```bash
cd /opt/excelbase
git pull --ff-only
./deploy/oracle/deploy.sh
```

Dağıtım betiği çalışan bir veritabanı varsa önce yedek alır. Yeni imaj sağlık
kontrolünü geçemezse önceki yerel imaja otomatik döner.

Elle yedek:

```bash
./deploy/oracle/backup.sh
```

Dump dosyaları `deploy/oracle/backups/` altında, yalnızca sahibi okuyabilecek
izinlerle oluşturulur ve varsayılan 14 günlük yerel saklama uygulanır. Bu klasör
aynı VM üzerindedir. Canlı geçişten önce Object Storage'da versioning/retention
açık özel bir bucket oluşturun, VM'yi yalnız bu bucket'a yazabilen bir dynamic
group/policy ile yetkilendirin ve sunucuya OCI CLI ile `age` kurun. `.env` içinde
`OCI_BACKUP_BUCKET` ile yalnız public `BACKUP_AGE_RECIPIENT` değerini girin;
eşleşen age private key'i VM dışında bir parola yöneticisinde saklayın.

Bu iki ayar doluysa her `backup.sh` çağrısı dump'ı yerelde şifreleyip OCI'ye
`--auth instance_principal` ile yollar; kullanıcı API anahtarı veya private key
sunucuda tutulmaz. Off-site gönderim başarısızsa betik hata verir ve dağıtım
devam etmez. Ayarlar boşsa yerel yedek alınır ancak açık bir uyarı yazılır.

Günlük cron örneği (yolu kurulumunuza göre değiştirin):

```cron
15 2 * * * cd /opt/excelbase && ./deploy/oracle/backup.sh >> /var/log/excelbase-backup.log 2>&1
```

Önceki uygulama imajına dönmek (veritabanını değiştirmez):

```bash
./deploy/oracle/rollback.sh
```

Belirli bir yerel imaj etiketine dönmek:

```bash
./deploy/oracle/rollback.sh GIT_SHA_ETIKETI
```

Veriyi geri almak ayrı ve yıkıcı bir işlemdir; yalnızca doğrulanmış `.dump`
dosyasıyla `restore.sh` kullanın. Betik geri yüklemeden önce ek bir güvenlik
yedeği alır ve açık onay ifadesi olmadan çalışmaz.

## Operasyonel notlar

- `docker compose ... logs -f v7-web v7-worker` hata ayıklamak için yeterlidir;
  logları paylaşmadan önce yolcu adı, pasaport ve istek içeriğini temizleyin.
- Disk doluluğunu düzenli izleyin: `df -h` ve `docker system df`.
- `.env`, PostgreSQL dump'ları ve yolcu fotoğrafları özel nitelikli veridir.
- Docker ağı dışında yalnızca Caddy'nin `80/443` portları yayınlanır.
- Bu kurulum V8 konteyneri başlatmaz ve V8 yönlendirmesi yapmaz.
