const INDICATOR_CUES = {
  COLD: [
    "belum merespons", "belum merespon", "belum membalas", "belum balas", "tidak membalas",
    "tidak balas", "read doang", "centang dua abu", "cuma dibaca", "salah sambung",
    "kepencet iklan", "iseng tanya", "berhenti dihubungi", "stop dihubungi", "minta berhenti",
    "blokir", "sudah ambil di tempat lain", "sudah membeli di tempat lain", "nggak dulu", "tidak dulu", "skip",
    "belum minat", "tidak tertarik", "belum tertarik", "tidak berminat", "belum membutuhkan",
    "belum ada rencana", "nanti dikabari", "lihat lihat dulu", "pikir pikir dulu", "di atas 6 bulan",
    "diatas 6 bulan", "lebih dari 6 bulan", "tahun depan", "kemahalan", "budget jauh di bawah",
    "jauh di bawah budget", "di luar jangkauan layanan", "diluar jangkauan layanan",
    "di luar jangkauan", "tidak terjangkau", "ghosting", "minta pricelist lalu menghilang",
    "cuma tanya berapa lalu tidak balas", "lowongan kerja", "kerja sama b2b", "akun bot", "spam",
    "akun palsu", "nomor tidak aktif", "salah nomor", "tidak punya wewenang",
    "bukan pengambil keputusan", "enggan meneruskan", "komplain tanpa solusi",
    "komparasi negatif", "jangan dihubungi", "tidak perlu dihubungi", "berhenti menghubungi"
  ],
  WARM: [
    "tanya detail", "spesifikasi produk", "tipe unit", "harga nett", "rincian biaya keseluruhan",
    "promo yang berlaku", "promo sedang berlaku", "diskon", "cashback", "skema pembayaran",
    "cicilan", "simulasi angsuran", "simulasi kpr", "ketersediaan stok", "sisa unit", "blok yang masih kosong",
    "lokasi detail", "patokan jalan", "jarak ke fasilitas umum", "akses jalan", "bebas banjir",
    "masuk mobil", "foto asli", "video kondisi lapangan", "real pict", "siteplan", "denah",
    "legalitas", "kelengkapan surat", "sertifikat", "garansi", "purnajual", "biaya tambahan", "pajak",
    "ongkir", "biaya admin", "notaris", "balik nama", "membandingkan keunggulan",
    "proyek lain", "minta rekomendasi", "konsultasi kebutuhan", "kondisi finansial",
    "cek kelayakan", "syarat berkas", "dokumen pengajuan", "diskusi dengan pasangan",
    "dihubungi ulang", "negosiasi ringan", "tawar harga", "minta bonus", "free item",
    "estimasi waktu", "serah terima", "aturan khusus", "custom", "menyimpan nomor sales",
    "membalas status", "update", "tanya harga", "tanya promo", "tanya stok",
    "tanya lokasi", "tanya legalitas", "tanya cicilan"
  ],
  HOT: [
    "siap survey", "survey lokasi", "datang ke kantor", "hari dan jam pasti", "janji temu",
    "janji survey", "jadwalkan survey", "shareloc titik kumpul", "segera meluncur",
    "sudah di jalan menuju lokasi", "siap booking", "booking unit", "booking fee",
    "kunci unit", "amankan stok", "nomor rekening", "link pembayaran resmi", "link pembayaran",
    "nominal transfer", "transfer tanda jadi", "sudah transfer", "pilih satu tipe",
    "memilih satu tipe", "pilih unit", "nomor blok spesifik",
    "foto ktp", "foto kk", "foto npwp", "kirim ktp", "kirim kk", "slip gaji",
    "bi checking", "slik ojk", "dibuatkan invoice", "minta invoice", "dokumen akad",
    "spk", "surat pemesanan", "batas akhir promo", "kehabisan kuota hari ini",
    "telepon sekarang", "video call sekarang", "sebelum tanda tangan", "detail akhir akad",
    "unit siap huni", "barang bisa langsung dikirim", "pasangan ikut datang",
    "pengambil keputusan ikut datang", "bukti transfer", "minta dokumen", "siap bayar dp",
    "repeat order", "beli unit tambahan",
    "merekomendasikan kerabat", "menyambungkan kontak", "siap akad", "proses akad",
    "minta akad", "tanda tangan spk", "siap bayar", "siap transfer", "mau booking"
  ]
};

function normalizeText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function includesPhrase(text, phrase) {
  const normalizedPhrase = normalizeText(phrase);
  const index = ` ${text} `.indexOf(` ${normalizedPhrase} `);
  if (index < 0) return false;
  const phraseStart = index;
  const precedingText = text.slice(Math.max(0, phraseStart - 18), phraseStart);
  return !/(?:^|\s)(?:belum|tidak|bukan|gak|nggak|enggan)\s+(?:mau\s+|bisa\s+|siap\s+)?$/.test(precedingText);
}

export function inferLeadIndicator(message) {
  const text = normalizeText(message);
  if (!text) return null;

  const matches = [];
  for (const [indicator, cues] of Object.entries(INDICATOR_CUES)) {
    if (cues.some((cue) => includesPhrase(text, cue))) matches.push(indicator);
  }
  if (["oke", "siap", "ya", "thanks", "sip"].includes(text)) matches.push("COLD");

  return matches.length === 1 ? matches[0] : null;
}

export function latestCommunication(lead) {
  return [...(lead.followUps || [])]
    .filter((item) => String(item.result || "").trim())
    .sort((left, right) => {
      const leftTime = Date.parse(left.createdAt || left.followUpDate || lead.createdAt);
      const rightTime = Date.parse(right.createdAt || right.followUpDate || lead.createdAt);
      return rightTime - leftTime || right.number - left.number;
    })[0]?.result || "";
}
