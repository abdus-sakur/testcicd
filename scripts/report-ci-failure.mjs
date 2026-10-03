import { readFile } from 'node:fs/promises';

const allowedNames = [
  'halaman utama menyajikan HTML dengan pembatasan konten',
  'health check mengembalikan JSON yang dapat diperiksa proxy',
  'route tidak dikenal mengembalikan 404',
  'mutasi ditolak dengan 405 dan header Allow',
  'HEAD tidak mengirim body',
  'port memerlukan integer valid dalam rentang TCP',
  'deploy hanya setelah CI push master sukses dan head masih cocok',
  'referensi CI tidak layak tidak menjalankan CD',
  'deployment aktif dan commit sudah sehat tidak diduplikasi',
  'kegagalan dicatat dan tidak diulang tanpa push baru',
  'API Coolify gagal menghentikan deployment tanpa menyimpan attempt',
  'master yang maju selama pemeriksaan Coolify menunda CD lama',
  'status server tidak dikenal menghentikan CD',
  'deployment aktif pada halaman riwayat berikutnya mencegah CD',
  'entrypoint melalui symlink tetap menjalankan polling dan menolak konfigurasi kosong',
  'token lokal menerima format plain dan assignment tanpa mengeksekusi isi file',
  'CD lokal menunggu CI sukses untuk SHA yang sama',
  'CI gagal melarang CD',
  'hasil CI commit lain tidak memberi izin deployment',
  'konfigurasi menolak HTTP, credential URL, path, UUID dan SHA tidak valid',
  'HTTP hanya diizinkan untuk loopback lokal',
  'deployment mengunci SHA dan menunggu selesai dengan token sesuai izin',
  'API error menghentikan proses tanpa membocorkan response sensitif',
  'deployment commit lain tidak dianggap sukses',
  'respons non-JSON tidak membocorkan isinya pada error',
  'deployment yang terus antre memiliki batas waktu',
  'deployment gagal menyebabkan CI gagal',
  'respons tanpa deployment UUID tidak dianggap sukses',
  'lock bersama mencegah deployment paralel dan terlepas setelah error',
  'lock terlepas otomatis ketika proses mati',
];
const allowedErrors = ['ENOENT', 'EACCES', 'EPERM', 'ERR_ASSERTION', 'ERR_TEST_FAILURE', 'AbortError', 'TypeError',
  'Gagal memperoleh lock deployment.', 'Izin lock deployment tidak aman.',
  'LOCK_CHILD_EXITED_EARLY', 'LOCK_LOST_BEFORE_CRASH', 'LOCK_RETAINED_AFTER_CRASH'];
const raw = await readFile(process.argv[2], 'utf8');
const lines = raw.split('\n').filter((line) => /^(?:not ok \d+ - |✖ )/.test(line.trim()));
const names = allowedNames.filter((name) => lines.some((line) => line.includes(name)));
const errors = allowedErrors.filter((code) => raw.includes(code));
const message = JSON.stringify({ failed_tests: names, error_categories: errors });
console.log(`::error title=Diagnosis Unit Test::${message}`);
