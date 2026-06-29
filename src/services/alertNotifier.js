import notifee, { AndroidImportance, AndroidVisibility } from '@notifee/react-native';

const CHANNEL_ID = 'rivereye_flood';

// Urutan keparahan — lebih besar = lebih berbahaya
const RISK_ORDER = {
  AMAN: 0, Aman: 0,
  WASPADA: 1, Waspada: 1,
  BAHAYA: 2, Siaga: 2,
};

// id perangkat/node → risk level terakhir yang diketahui
const lastRisk = new Map();
let channelReady = false;

// Daftar node yang diketahui: id → nama (untuk deteksi tambah/hapus)
const knownNodeIds = new Map();
let nodeListSeeded = false;

async function ensureChannel() {
  if (channelReady) return;
  await notifee.createChannel({
    id: CHANNEL_ID,
    name: 'Peringatan Banjir',
    importance: AndroidImportance.HIGH,
    visibility: AndroidVisibility.PUBLIC,
    vibration: true,
    sound: 'default',
  });
  channelReady = true;
}

async function sendAlert(title, body) {
  try {
    await ensureChannel();
    await notifee.displayNotification({
      title,
      body,
      android: {
        channelId: CHANNEL_ID,
        smallIcon: 'ic_launcher',
        importance: AndroidImportance.HIGH,
        pressAction: { id: 'default' },
        showTimestamp: true,
      },
    });
  } catch (e) {
    console.warn('[alertNotifier] Gagal menampilkan notifikasi:', e.message);
  }
}

/**
 * Cek sensor ESP32 — notifikasi jika risiko memburuk ATAU membaik ke Aman.
 * Panggilan pertama per device hanya menyemai state, tidak memicu notifikasi.
 * @param {string} deviceId
 * @param {string} riskText   — 'Aman' | 'Waspada' | 'Siaga'
 * @param {number} percent    — water_level_percent
 */
export function checkSensorRisk(deviceId, riskText, percent) {
  const key = `sensor_${deviceId}`;
  const prev = lastRisk.get(key);
  lastRisk.set(key, riskText);

  if (prev === undefined || prev === riskText) return; // seed atau tidak berubah

  const prevOrder = RISK_ORDER[prev] ?? 0;
  const newOrder = RISK_ORDER[riskText] ?? 0;

  if (newOrder > prevOrder) {
    // Memburuk
    const emoji = riskText === 'Siaga' ? '🔴' : '🟡';
    sendAlert(
      `${emoji} ${riskText.toUpperCase()} — ${deviceId}`,
      `Ketinggian air ${percent.toFixed(1)}%. Status berubah dari ${prev} ke ${riskText}.`,
    );
  } else if (newOrder < prevOrder && riskText === 'Aman') {
    // Membaik ke Aman
    sendAlert(
      `✅ AMAN — ${deviceId}`,
      `Ketinggian air kembali normal (${percent.toFixed(1)}%). Status berubah dari ${prev} ke Aman.`,
    );
  }
}

/**
 * Cek node titik pantau — notifikasi jika risiko memburuk ATAU membaik ke AMAN.
 * Panggilan pertama per node hanya menyemai state, tidak memicu notifikasi.
 * @param {string} nodeId
 * @param {string} nodeName
 * @param {string} risk      — 'AMAN' | 'WASPADA' | 'BAHAYA'
 * @param {number} levelCm
 */
export function checkNodeRisk(nodeId, nodeName, risk, levelCm) {
  const key = `node_${nodeId}`;
  const prev = lastRisk.get(key);
  lastRisk.set(key, risk);

  if (prev === undefined || prev === risk) return; // seed atau tidak berubah

  const prevOrder = RISK_ORDER[prev] ?? 0;
  const newOrder = RISK_ORDER[risk] ?? 0;
  const levelText = levelCm > 0 ? ` (${(levelCm / 100).toFixed(2)} m)` : '';

  if (newOrder > prevOrder) {
    // Memburuk
    const emoji = risk === 'BAHAYA' ? '🔴' : '🟡';
    sendAlert(
      `${emoji} ${risk} — ${nodeName}`,
      `Status titik pantau berubah dari ${prev} ke ${risk}${levelText}.`,
    );
  } else if (newOrder < prevOrder && risk === 'AMAN') {
    // Membaik ke AMAN
    sendAlert(
      `✅ AMAN — ${nodeName}`,
      `Titik pantau kembali normal${levelText}. Status berubah dari ${prev} ke AMAN.`,
    );
  }
}

/**
 * Deteksi node yang baru ditambahkan atau dihapus dari jaringan.
 * Panggilan pertama hanya menyemai daftar, tidak memicu notifikasi.
 * @param {{ id: string, name: string }[]} nodes
 */
export function checkNodeListChanges(nodes) {
  const currentIds = new Map(nodes.map(n => [String(n.id), n.name]));

  if (!nodeListSeeded) {
    currentIds.forEach((name, id) => knownNodeIds.set(id, name));
    nodeListSeeded = true;
    return;
  }

  // Titik pantau baru
  currentIds.forEach((name, id) => {
    if (!knownNodeIds.has(id)) {
      sendAlert(
        '📍 Titik Pantau Baru',
        `Node "${name}" (${id}) telah ditambahkan ke jaringan pemantauan.`,
      );
      knownNodeIds.set(id, name);
    }
  });

  // Titik pantau dihapus
  knownNodeIds.forEach((name, id) => {
    if (!currentIds.has(id)) {
      sendAlert(
        '🗑️ Titik Pantau Dihapus',
        `Node "${name}" (${id}) telah dihapus dari jaringan pemantauan.`,
      );
      knownNodeIds.delete(id);
    }
  });
}

/** Reset semua riwayat risiko (misalnya saat logout atau restart manual) */
export function resetAlertState() {
  lastRisk.clear();
  knownNodeIds.clear();
  nodeListSeeded = false;
}
