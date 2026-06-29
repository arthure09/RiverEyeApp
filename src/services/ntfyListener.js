import notifee, { AndroidImportance, AndroidVisibility } from '@notifee/react-native';
import { NTFY_URL, NTFY_TOPIC } from '../config/ntfy';

const CHANNEL_ID = 'rivereye_flood';
const RECONNECT_DELAY_MS = 6000;

let ws = null;
let shouldReconnect = true;
let reconnectTimer = null;

// Buat channel Android satu kali (idempoten)
async function ensureChannel() {
  await notifee.createChannel({
    id: CHANNEL_ID,
    name: 'Peringatan Banjir',
    importance: AndroidImportance.HIGH,
    visibility: AndroidVisibility.PUBLIC,
    vibration: true,
    sound: 'default',
  });
}

async function showNotification(title, body) {
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
}

// Gunakan WebSocket bawaan React Native — tidak butuh library tambahan.
// ntfy mendukung endpoint /ws untuk streaming pesan secara real-time.
function connect() {
  if (!shouldReconnect) return;
  clearTimeout(reconnectTimer);

  const wsUrl = NTFY_URL.replace(/^https?/, (p) => (p === 'https' ? 'wss' : 'ws'));
  ws = new WebSocket(`${wsUrl}/${NTFY_TOPIC}/ws`);

  ws.onopen = () => {
    console.log('[ntfy] Terhubung ke', `${NTFY_URL}/${NTFY_TOPIC}`);
  };

  ws.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      // ntfy mengirim event 'open' saat koneksi, dan 'message' saat ada notifikasi masuk
      if (data.event !== 'message') return;
      await showNotification(data.title || 'RiverEye Alert', data.message || '');
    } catch {
      // abaikan pesan yang tidak bisa di-parse
    }
  };

  ws.onclose = () => {
    console.log('[ntfy] Koneksi terputus. Reconnect dalam', RECONNECT_DELAY_MS / 1000, 'detik...');
    if (shouldReconnect) reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
  };

  ws.onerror = (e) => {
    console.warn('[ntfy] WebSocket error:', e.message);
    ws.close();
  };
}

// Idempoten — tidak membuat koneksi baru jika sudah OPEN atau CONNECTING
export function startNtfyListener() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  shouldReconnect = true;
  connect();
}

export function stopNtfyListener() {
  shouldReconnect = false;
  clearTimeout(reconnectTimer);
  if (ws) {
    ws.onclose = null; // cegah auto-reconnect saat sengaja dihentikan
    ws.close();
    ws = null;
  }
}
