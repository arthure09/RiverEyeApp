/**
 * Konfigurasi API terpusat untuk RiverEyeApp
 * Semua endpoint dan base URL didefinisikan di sini
 */

export const BASE_URL = 'http://100.71.62.7:3000';

export const ENDPOINTS = {
  // Lokasi monitoring sungai
  LOCATIONS: '/api/locations',

  // Log sensor ketinggian air
  LOGS: '/api/logs',

  // Prediksi banjir
  PREDICTIONS: '/api/predictions',
};

// API sensor ESP32 (Lucas — water.serverlucas.my.id)
export const SENSOR_BASE_URL = 'https://water.serverlucas.my.id';
export const WS_URL = 'wss://water.serverlucas.my.id/ws';
export const SENSOR_ENDPOINTS = {
  READINGS: '/api/readings',
};

// Timeout default (ms)
export const API_TIMEOUT = 10000;

// Risk label mapping ke Bahasa Indonesia
export const RISK_LABELS = {
  low: { text: 'Aman', color: '#27AE60' },
  sedang: { text: 'Sedang', color: '#F1C40F' },
  medium: { text: 'Waspada', color: '#F39C12' },
  high: { text: 'Siaga', color: '#E74C3C' },
};

/**
 * Menentukan level risiko berdasarkan ketinggian air (cm)
 * Karena backend tidak menyimpan risk_label, kita hitung di client
 * @param {number} levelCm - Ketinggian air dalam cm
 * @returns {{ text: string, color: string }}
 */
export const getRiskFromLevel = (levelCm) => {
  if (levelCm >= 200) return RISK_LABELS.high;
  if (levelCm >= 150) return RISK_LABELS.medium;
  if (levelCm >= 100) return RISK_LABELS.sedang;
  return RISK_LABELS.low;
};

/**
 * Menentukan level risiko berdasarkan persentase ketinggian air (0–100)
 * Dipakai untuk data sensor ESP32 dari water.serverlucas.my.id
 * @param {number} percent - Persentase ketinggian (water_level_percent)
 * @returns {{ text: string, color: string }}
 */
export const getRiskFromPercent = (percent) => {
  const p = Number(percent);
  if (p >= 75) return RISK_LABELS.high;
  if (p >= 50) return RISK_LABELS.medium;
  if (p >= 25) return RISK_LABELS.sedang;
  return RISK_LABELS.low;
};

