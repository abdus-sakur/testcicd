# Sampel CI/CD Coolify

Sampel aplikasi Node.js 24 tanpa dependensi eksternal. GitHub Actions menjalankan tes dan build Docker, lalu Coolify men-deploy SHA commit yang sama. Halaman utama tersedia di `/`, health check di `/health`.

Repo yang sudah dikonfigurasi: `git@github.com:abdus-sakur/testcicd.git`. Workflow mengikuti branch `master`. Jika default branch diganti, sesuaikan seluruh filter branch dan kondisi deployment pada `.github/workflows/ci-cd.yml` serta branch aplikasi Coolify.

## Jalankan Lokal

```bash
cd ~/project/mini/testcicd
npm run check
npm test
npm start
```

Buka `http://localhost:3000`. Tidak perlu `npm install`: seluruh modul memakai API bawaan Node.js. Variabel `PORT` opsional, default `3000`, harus integer `1`–`65535`.

## Jalankan Docker

```bash
docker build --pull --tag testcicd:local .
docker run --rm --name testcicd --read-only --cap-drop ALL --security-opt no-new-privileges --publish 127.0.0.1:3000:3000 testcicd:local
```

Build menjalankan pemeriksaan sintaks dan tes sebelum membuat image runtime. Image runtime berjalan sebagai user `node`, hanya membawa source aplikasi dan metadata package. Build context memakai allowlist sehingga `.git`, `.env`, dan dokumen tidak ikut terkirim. Base image `node:24-alpine` dikunci dengan digest agar CI dan Coolify memakai base image yang sama. Perbarui digest pada kedua stage secara berkala untuk mengambil pembaruan keamanan.

## Konfigurasi Coolify

1. Siapkan instance Coolify yang dapat diakses runner melalui HTTPS dengan sertifikat valid. Untuk instance hanya di jaringan internal, gunakan runner tepercaya yang memiliki akses jaringan tersebut dan sesuaikan `runs-on`.
2. Buat project dan resource aplikasi dari repository GitHub di atas. Gunakan GitHub App atau deploy key read-only jika repository privat.
3. Pilih branch `master`, Build Pack **Dockerfile**, Base Directory `/`, lokasi Dockerfile `/Dockerfile`, dan Ports Exposes `3000`.
4. Atur domain HTTPS. Jangan membuka port container langsung ke internet; gunakan reverse proxy Coolify.
5. Matikan **Auto Deploy** dan preview deployment otomatis sebelum push pertama. Deployment harus dimulai oleh job CD setelah CI lolos.
6. Aktifkan health check: metode `GET`, host `127.0.0.1`, path `/health`, port `3000`, scheme `http`, expected status `200`. Container mendengarkan `0.0.0.0`. Gunakan IPv4 loopback secara eksplisit: pada Alpine, `localhost` dapat memilih IPv6 `::1` dan menghasilkan connection refused meskipun aplikasi sehat.
7. Catat UUID resource aplikasi. Pipeline ini khusus resource Git + Dockerfile, bukan Docker Compose atau Docker Image.
8. Buat dua token API pada team khusus aplikasi ini: token konfigurasi dengan izin `read` dan `write`, serta token deployment dengan izin `deploy`. Jangan gunakan `root` atau `read:sensitive`. Token konfigurasi memerlukan izin tulis untuk mengunci `git_commit_sha`, dan izin baca untuk memeriksa status deployment.
9. Pastikan API Access aktif. Jika memakai IP allowlist, runner harus memiliki IP keluar yang diizinkan. Hindari membuka allowlist lebih luas hanya untuk runner publik; gunakan runner dengan IP tetap bila dibutuhkan.

Token konfigurasi tetap dapat mengubah resource lain dalam team sesuai hak pemiliknya. Gunakan team khusus dan batasi akses GitHub environment `production` kepada maintainer tepercaya.

## Konfigurasi GitHub

CD remote bersifat opt-in. Tambahkan **repository variable** `COOLIFY_REMOTE_DEPLOY` bernilai `true` hanya jika runner dapat mengakses origin HTTPS Coolify dan seluruh variable serta secret di bawah sudah tersedia. Tanpa flag ini, CI tetap berjalan dan job CD remote dilewati. Untuk Coolify lokal, gunakan jalur CD lokal di bawah.

Buat environment **production** pada **Settings > Environments**. Tambahkan nilai berikut pada environment tersebut:

| Jenis | Nama | Nilai |
| --- | --- | --- |
| Variable | `COOLIFY_URL` | Origin HTTPS instance, misalnya `https://coolify.example.com`, tanpa `/api/v1` |
| Variable | `COOLIFY_APP_UUID` | UUID resource aplikasi |
| Secret | `COOLIFY_CONFIG_TOKEN` | Token Coolify dengan izin `read` dan `write` |
| Secret | `COOLIFY_DEPLOY_TOKEN` | Token Coolify dengan izin `deploy` |

`GITHUB_SHA` disediakan otomatis oleh GitHub Actions. Token tidak boleh ditempatkan di source code, variable biasa, screenshot, atau log. Batasi environment deployment ke branch `master` dan lindungi branch dengan required status check **Unit Test dan Build Docker**. Pilihan required reviewer dapat digunakan jika deployment perlu persetujuan manusia.

Setelah konfigurasi selesai, commit dan push file project:

```bash
git add .
git commit -m "feat: add Node.js sample with unit tests, Docker verification, and commit-pinned Coolify CI/CD"
git push -u origin master
```

## Alur Pipeline

1. Push ke `master`, pull request menuju `master`, atau **Run workflow** memulai CI.
2. CI memeriksa sintaks, menjalankan unit test, build Docker, lalu memeriksa `/health` dan memastikan container tidak berjalan sebagai root.
3. Pull request hanya menjalankan CI. Pada jalur lokal, push `master` yang lolos CI menerbitkan referensi `ci-success`, lalu timer lokal men-deploy SHA yang sama. CD remote hanya berjalan untuk branch `master` setelah CI sukses dan flag `COOLIFY_REMOTE_DEPLOY` aktif.
4. CD mengunci `git_commit_sha` ke `GITHUB_SHA` dan memastikan auto-deploy mati melalui `PATCH /api/v1/applications/{uuid}`.
5. CD memicu `POST /api/v1/deploy`, lalu memeriksa `GET /api/v1/deployments/{uuid}` sampai selesai. Status `failed`, `cancelled`, response tidak valid, timeout, atau SHA berbeda membuat workflow gagal.
6. Job CD memakai concurrency tunggal dengan `cancel-in-progress: false`. Deployment aktif tidak dibatalkan saat push baru masuk. GitHub dapat mengganti job pending dengan push lebih baru; sampel ini tidak menjamin setiap push mendapat deployment.

Coolify membangun ulang source commit yang lolos CI dengan base image yang dikunci; sampel tidak mempromosikan image hasil CI dari registry. Pada sistem yang membutuhkan promosi artefak identik, gunakan registry dengan image digest immutable.

Jangan menjalankan deploy manual atau pipeline lain untuk resource yang sama saat job CD aktif. Lock GitHub hanya berlaku pada workflow yang memakai concurrency group sama; mutasi konfigurasi dan pemicu deploy merupakan dua request API terpisah. Jika workflow terputus atau timeout, periksa status Coolify sebelum memulai deployment berikutnya. Timeout tidak otomatis membatalkan deployment server.

## Struktur

```text
.github/workflows/ci-cd.yml
scripts/deploy.mjs
scripts/deploy-local.mjs
scripts/cd-auto.mjs
scripts/local-runtime.mjs
scripts/install-auto-cd.mjs
ops/systemd/testcicd-cd.service
ops/systemd/testcicd-cd.timer
src/app.mjs
src/server.mjs
tests/unit/app.test.mjs
tests/unit/deploy.test.mjs
Dockerfile
package.json
```

Tes berada terpisah dari source. Tes deployment memakai respons API terkendali; tidak menghubungi instance produksi dan tidak membutuhkan token asli.

## CD Untuk Coolify Lokal

Jika Coolify hanya tersedia di `http://127.0.0.1:8000`, jalankan CI di GitHub lalu CD dari mesin lokal. Token tidak perlu diunggah ke GitHub, dan tidak diperlukan self-hosted runner pada repository publik. HTTP diizinkan hanya untuk loopback; instance di jaringan lain tetap wajib HTTPS.

Simpan token Coolify yang memiliki hak baca, konfigurasi aplikasi, dan deployment pada `~/coolify-token.conf` dengan izin `0600`. Format file dapat berupa token plain atau assignment `COOLIFY_TOKEN="..."`; file tidak dieksekusi sebagai shell. Simpan metadata non-rahasia pada `~/.config/testcicd/deploy.json`:

```json
{
  "coolify_url": "http://127.0.0.1:8000",
  "application_uuid": "UUID_RESOURCE_COOLIFY",
  "repository": "abdus-sakur/testcicd"
}
```

Pasang CD otomatis sekali dari checkout yang sudah ditinjau:

```bash
npm run cd:auto:install
loginctl enable-linger "$USER"
systemctl --user status testcicd-cd.timer
```

Timer pengguna membaca referensi Git publik setiap 120 detik. Setelah CI push `master` sukses, job `publish-ci` menerbitkan branch penanda `ci-success` menggunakan `GITHUB_TOKEN` bawaan dengan izin tulis hanya pada job tersebut. SHA penanda harus sama dengan HEAD `master` sebelum CD lokal berjalan. Pull request, pemicu manual workflow, CI gagal, serta commit tertinggal tidak menerbitkan penanda deployment. Branch penanda khusus ini bukan branch pengembangan dan hanya boleh diperbarui workflow CI atau maintainer tepercaya. GitHub Actions tidak memicu workflow baru untuk push memakai token bawaannya. Token Coolify tetap lokal, tanpa PAT tambahan dan tanpa ketergantungan kuota GitHub REST API.

Installer menyalin skrip terpercaya ke snapshot versi pada `~/.local/lib/testcicd/releases/`, mengganti symlink `current` secara atomik dan unit ke `~/.config/systemd/user/`. Timer tidak mengeksekusi skrip dari push atau checkout yang berubah. Setelah memperbarui skrip CD, tinjau perubahan lalu jalankan installer lagi. Node.js 24 harus tetap tersedia di lokasi yang dipakai saat instalasi. Linger menjaga timer pengguna tetap berjalan setelah logout dan mengaktifkannya saat boot; layanan Coolify dan Docker juga harus berjalan.

State berada di `~/.local/state/testcicd/auto-cd.json`. Satu SHA hanya memicu satu deployment otomatis. Deployment gagal atau proses yang terputus tidak diulang otomatis untuk SHA yang sama; periksa Coolify, lalu push commit perbaikan atau gunakan deployment manual setelah penyebabnya diselesaikan. Deployment yang sudah selesai pada SHA yang sama dilewati. Lock OS bersama dengan `deploy:local` mencegah benturan dan terlepas otomatis ketika proses mati; file `deploy.flock` jangan dihapus saat proses berjalan. Deployment Coolify yang masih aktif pada seluruh halaman riwayat juga menunda deployment berikutnya. Pemeriksaan dibatasi 10.000 entri dan berhenti dengan error jika riwayat melebihi batas; arsipkan riwayat lama pada instance yang mencapai batas tersebut.

Periksa hasil dan hentikan timer dengan:

```bash
journalctl --user -u testcicd-cd.service -n 20 --no-pager
systemctl --user list-timers testcicd-cd.timer
systemctl --user disable --now testcicd-cd.timer
```

`npm run deploy:local` tetap tersedia untuk deployment manual dari working tree bersih pada branch `master`, setelah CI untuk SHA lokal sukses. Jangan aktifkan CD remote bersamaan dengan timer lokal untuk resource yang sama: lock lokal tidak mengunci runner remote atau tombol deploy pada dashboard Coolify.

### Akses Lokal Dengan Proxy Terpisah

Pada mesin ini, destination default `coolify` gagal mengakses HTTPS GitHub dari helper, sedangkan jaringan Docker terpisah berhasil. Sampel memakai destination `testcicd-network`; jaringan aplikasi existing tidak diubah. Untuk membuat jaringan yang sama pada mesin lain bila dibutuhkan:

```bash
docker network create --driver bridge --opt com.docker.network.driver.mtu=1280 testcicd-network
```

Daftarkan jaringan existing tersebut sebagai destination pada server Coolify, pilih destination itu saat membuat resource, dan tetapkan **Custom Network Aliases** menjadi `testcicd-app`. MTU `1280` dipakai agar sesuai batas uplink lokal; lakukan diagnosis jaringan sebelum menyalin nilai ini ke lingkungan lain. API Coolify versi mesin ini tidak mengizinkan perubahan destination aplikasi existing melalui PATCH.

Proxy lokal terpisah tersedia pada `ops/compose.local.yml`. Proxy memakai Nginx non-root, image dengan digest tetap, filesystem read-only, seluruh capability dihapus, dan tidak memasang Docker socket. Port hanya dibind ke loopback. Proxy shared yang melayani aplikasi lain tidak diubah.

```bash
docker compose -f ops/compose.local.yml up -d
```

Buka `http://127.0.0.1:3001` dan health check `http://127.0.0.1:3001/health`. Proxy memakai DNS Docker dan alias aplikasi agar pergantian container setelah redeploy tetap dapat dirutekan. Source aplikasi dan lifecycle deployment tetap dikelola Coolify; Compose ini hanya mengelola akses lokal. Untuk menghentikan proxy sampel:

```bash
docker compose -f ops/compose.local.yml down
```

## Troubleshooting

- `401` / `403`: periksa team, pemilik, masa berlaku token, API Access, izin token, dan IP allowlist.
- `404`: periksa origin instance dan UUID resource/deployment.
- Deployment gagal: periksa log build pada Coolify; jangan menyalin token atau log sensitif ke repository.
- Health check gagal: pastikan port aplikasi dan Ports Exposes sama-sama `3000`, path `/health`, dan scheme internal `http`.
- SHA berbeda: periksa apakah ada deploy manual atau pipeline lain yang mengubah resource. Jangan mengabaikan error ini.
- Docker lokal `permission denied`: gunakan akses Docker yang sudah disetujui administrator. Verifikasi Docker juga dijalankan GitHub Actions.

## Referensi

- [Coolify: Update Application](https://coolify.io/docs/api/endpoints/applications/update-application-by-uuid)
- [Coolify: Deploy](https://coolify.io/docs/api/endpoints/deployments/deploy-by-tag-or-uuid)
- [Coolify: Get Deployment](https://coolify.io/docs/api/endpoints/deployments/get-deployment-by-uuid)
- [Coolify: API Token Permissions](https://coolify.io/docs/core/security/credentials/api-tokens)
- [Node.js 24 HTTP API](https://nodejs.org/docs/latest-v24.x/api/http.html)
