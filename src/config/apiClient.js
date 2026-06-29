/**
 * API Client terpusat menggunakan Axios
 * - Base URL sudah di-set
 * - Timeout 10 detik
 * - Error handling yang baik
 * - Header Content-Type: application/json
 */

import axios from 'axios';
import { BASE_URL, SENSOR_BASE_URL, API_TIMEOUT, ENDPOINTS, SENSOR_ENDPOINTS } from './api';

// Buat instance axios dengan konfigurasi default
const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: API_TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Helper untuk memproses response API
 * Memastikan field "status" === "success" sebelum mengembalikan data
 */
const handleResponse = (response) => {
  const { data } = response;
  if (data.status === 'success') {
    return data.data;
  }
  // Jika status bukan "success", lempar error dengan pesan dari server
  throw new Error(data.message || 'Terjadi kesalahan pada server.');
};

/**
 * Helper untuk menangani error dengan pesan user-friendly
 */
const handleError = (error) => {
  // Jika error bukan dari axios (misalnya dari handleResponse), langsung re-throw
  if (!error.response && !error.request && !error.code) {
    throw error;
  }

  if (error.response) {
    // Server merespon dengan status code di luar 2xx
    const serverMessage = error.response.data?.message;
    const statusCode = error.response.status;

    switch (statusCode) {
      case 400:
        throw new Error(serverMessage || 'Permintaan tidak valid.');
      case 401:
        throw new Error('Akses ditolak. API key tidak valid.');
      case 403:
        throw new Error('Anda tidak memiliki izin untuk akses ini.');
      case 404:
        throw new Error('Data tidak ditemukan.');
      case 500:
        throw new Error('Terjadi kesalahan pada server. Silakan coba lagi nanti.');
      default:
        throw new Error(serverMessage || `Kesalahan server (kode: ${statusCode}).`);
    }
  } else if (error.code === 'ECONNABORTED') {
    // Timeout
    throw new Error('Koneksi ke server terlalu lama. Periksa jaringan Anda.');
  } else if (error.request) {
    // Request dibuat tapi tidak ada response (network error)
    throw new Error('Tidak dapat terhubung ke server. Periksa koneksi internet Anda.');
  } else {
    // Error lainnya
    throw new Error(error.message || 'Terjadi kesalahan yang tidak diketahui.');
  }
};

// ============================================================
//  Fungsi-fungsi API (GET endpoints — tanpa auth)
// ============================================================

/**
 * Mengambil semua lokasi monitoring sungai
 * @returns {Promise<Array>} Daftar lokasi
 */
export const getLocations = async () => {
  try {
    const response = await apiClient.get(ENDPOINTS.LOCATIONS);
    return handleResponse(response);
  } catch (error) {
    handleError(error);
  }
};

/**
 * Mengambil semua log sensor ketinggian air
 * @returns {Promise<Array>} Daftar log sensor
 */
export const getLogs = async () => {
  try {
    const response = await apiClient.get(ENDPOINTS.LOGS);
    return handleResponse(response);
  } catch (error) {
    handleError(error);
  }
};

/**
 * Mengambil semua prediksi banjir
 * @returns {Promise<Array>} Daftar prediksi
 */
export const getPredictions = async () => {
  try {
    const response = await apiClient.get(ENDPOINTS.PREDICTIONS);
    return handleResponse(response);
  } catch (error) {
    handleError(error);
  }
};

// ============================================================
//  Fungsi-fungsi API (POST endpoints — perlu x-api-key)
// ============================================================

/**
 * Mengirim data log sensor baru
 * @param {Object} logData - { location_id, water_level_cm }
 * @param {string} apiKey - API key hardware
 * @returns {Promise<Object>} Data log yang baru dibuat
 */
export const postLog = async (logData, apiKey) => {
  try {
    const response = await apiClient.post(ENDPOINTS.LOGS, logData, {
      headers: { 'x-api-key': apiKey },
    });
    return handleResponse(response);
  } catch (error) {
    handleError(error);
  }
};

/**
 * Mengirim prediksi baru dari ML model
 * @param {Object} predictionData - { location_id, predicted_level_cm, prediction_for_time }
 * @param {string} apiKey - API key ML
 * @returns {Promise<Object>} Data prediksi yang baru dibuat
 */
export const postPrediction = async (predictionData, apiKey) => {
  try {
    const response = await apiClient.post(ENDPOINTS.PREDICTIONS, predictionData, {
      headers: { 'x-api-key': apiKey },
    });
    return handleResponse(response);
  } catch (error) {
    handleError(error);
  }
};

// ============================================================
//  Sensor client — water.serverlucas.my.id (Lucas)
// ============================================================

const sensorClient = axios.create({
  baseURL: SENSOR_BASE_URL,
  timeout: API_TIMEOUT,
  headers: { 'Content-Type': 'application/json' },
});

/**
 * Mengambil riwayat pembacaan sensor ESP32
 * @param {Object} [opts]
 * @param {string} [opts.deviceId] - Filter per node
 * @param {number} [opts.limit=50]   - Jumlah maksimal data
 * @returns {Promise<Array>}
 */
export const getReadings = async ({ deviceId, limit = 50 } = {}) => {
  try {
    const params = { limit };
    if (deviceId) params.device_id = deviceId;
    const response = await sensorClient.get(SENSOR_ENDPOINTS.READINGS, { params });
    return response.data?.data ?? [];
  } catch (error) {
    handleError(error);
  }
};

export default apiClient;
