/**
 * Sumber tunggal transformasi data node untuk semua layar.
 * Mengubah data backend (locations + logs) menjadi bentuk node yang dipakai UI,
 * dan menghitung status risiko memakai ambang per-node (dikelola di web admin).
 */

const PALETTE = {
  safe: '#10B981', // Aman
  warning: '#F59E0B', // Waspada
  danger: '#EF4444', // Siaga / Bahaya
};

// risk: label peta/dashboard (AMAN/WASPADA/BAHAYA), text: label riwayat (Aman/Waspada/Siaga)
export const riskFromLevel = (levelCm, loc = {}) => {
  const med = Number(loc.risk_medium_cm ?? 150);
  const high = Number(loc.risk_high_cm ?? 200);
  const cm = Number(levelCm);
  if (cm >= high) return { risk: 'BAHAYA', text: 'Siaga', color: PALETTE.danger };
  if (cm >= med) return { risk: 'WASPADA', text: 'Waspada', color: PALETTE.warning };
  return { risk: 'AMAN', text: 'Aman', color: PALETTE.safe };
};

// Status manual dari web admin (kolom status_override) menimpa status hasil hitung sensor.
const OVERRIDE_MAP = {
  aman: { risk: 'AMAN', color: PALETTE.safe, flood: 0 },
  waspada: { risk: 'WASPADA', color: PALETTE.warning, flood: 0 },
  siaga: { risk: 'BAHAYA', color: PALETTE.danger, flood: 1 },
  bahaya: { risk: 'BAHAYA', color: PALETTE.danger, flood: 1 },
};
export const statusFromOverride = (value) => {
  if (value == null || value === '') return null;
  return OVERRIDE_MAP[String(value).trim().toLowerCase()] || null;
};

// "Alat kecil" = sensor banjir biner (output 1 = banjir, 0 = kering), bukan ketinggian cm.
const ALAT_KECIL_RE = /alat\s*kecil/i;
export const isBinaryDevice = (loc = {}) =>
  loc.device_type === 'alat_kecil' || loc.is_binary === true || ALAT_KECIL_RE.test(loc.name || '');

// Ketinggian air terakhir per location_id
export const latestLogByLocation = (logs) => {
  const latest = {};
  for (const log of logs) {
    const prev = latest[log.location_id];
    if (!prev || new Date(log.timestamp) > new Date(prev.timestamp)) latest[log.location_id] = log;
  }
  return latest;
};

export const buildNodes = (locations, logs) => {
  const latest = latestLogByLocation(logs);
  return locations.map((loc) => {
    const log = latest[loc.id];
    const binary = isBinaryDevice(loc);
    const raw = log ? Number(log.water_level_cm) : 0;

    let status;
    let flood; // 1 = jalan banjir, 0 = aman
    if (binary) {
      // Sensor biner: nilai >= 1 berarti jalan tergenang.
      flood = raw >= 1 ? 1 : 0;
      status = flood
        ? { risk: 'BAHAYA', text: 'Siaga', color: PALETTE.danger }
        : { risk: 'AMAN', text: 'Aman', color: PALETTE.safe };
    } else {
      const r = riskFromLevel(raw, loc);
      status = r;
      flood = r.risk === 'BAHAYA' ? 1 : 0;
    }

    // Jika admin menetapkan status manual, status itu menang atas hasil sensor.
    const override = statusFromOverride(loc.status_override);
    const risk = override ? override.risk : status.risk;
    const color = override ? override.color : status.color;
    if (override) flood = override.flood;

    return {
      id: String(loc.id),
      name: loc.name,
      coordinates: { latitude: Number(loc.latitude), longitude: Number(loc.longitude) },
      hardware: { has_sensor: loc.has_sensor !== false, has_camera: loc.has_camera === true },
      cctvUrl: loc.cctv_url || null,
      // Nama ruas jalan (opsional dari admin) untuk pengelompokan overlay banjir.
      road: loc.road ?? loc.jalan ?? null,
      isBinary: binary,
      // medium_cm/high_cm dipakai visualisasi tinggi sungai (garis ambang vs jalan)
      status: {
        level_cm: raw,
        risk,
        color,
        medium_cm: Number(loc.risk_medium_cm ?? 150),
        high_cm: Number(loc.risk_high_cm ?? 200),
        flood,
      },
    };
  });
};
