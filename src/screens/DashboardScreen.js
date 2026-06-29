import React, { useState, useEffect, useCallback, useContext } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView, ActivityIndicator, TouchableOpacity, RefreshControl, Image, StatusBar, Platform } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import Icon from 'react-native-vector-icons/Ionicons';
import axios from 'axios'; 

// Import fungsi API dan pemroses Node sesungguhnya dari Backend
import { getLocations, getLogs, getReadings } from '../config/apiClient';
import { buildNodes } from '../config/nodes';
import { getRiskFromPercent } from '../config/api';
import useWaterLevelWS from '../hooks/useWaterLevelWS';
import { checkSensorRisk, checkNodeRisk, checkNodeListChanges } from '../services/alertNotifier';

// Import Global Theme Context
import { ThemeContext } from '../context/ThemeContext';

// Visualisasi animasi tinggi sungai
import RiverLevelVisual from '../components/RiverLevelVisual';

// Palet warna premium (Ultra-Clean Slate & Sky UI) - Light Mode
const LIGHT_COLORS = {
  background: '#F8FAFC',
  cardBg: '#FFFFFF',
  textMain: '#0F172A',
  textMuted: '#64748B',
  border: '#F1F5F9',
  primary: '#0EA5E9',
  safe: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  twitter: '#1DA1F2',
  shadow: '#0F172A',
};

// Palet warna premium - Dark Mode
const DARK_COLORS = {
  background: '#0F172A', 
  cardBg: '#1E293B',    
  textMain: '#F8FAFC',   
  textMuted: '#94A3B8',  
  border: '#334155',     
  primary: '#38BDF8',    
  safe: '#34D399',       
  warning: '#FBBF24',    
  danger: '#F87171',     
  twitter: '#1DA1F2',    
  shadow: '#000000',     
};

const FALLBACK_REGION = { latitude: -7.2800, longitude: 112.7950 };

// Interval polling AJAX untuk refresh data titik pantau secara live (ms)
const POLL_INTERVAL = 15000;

// Fungsi untuk menghitung waktu relatif secara dinamis (menggantikan data statis dari DB)
const getRelativeTime = (timestamp) => {
  if (!timestamp) return 'Now';
  const seconds = Math.floor((new Date() - new Date(timestamp)) / 1000);
  
  if (seconds < 60) return Math.floor(seconds) + "s";
  let interval = seconds / 60;
  if (interval < 60) return Math.floor(interval) + "m";
  interval = seconds / 3600;
  if (interval < 24) return Math.floor(interval) + "h";
  interval = seconds / 86400;
  return Math.floor(interval) + "d";
};

const DashboardScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [nodes, setNodes] = useState([]);

  // Sensor ESP32 (water.serverlucas.my.id) — data terbaru per device
  const [latestReadings, setLatestReadings] = useState({});
  const [loadingSensor, setLoadingSensor] = useState(true);
  const { latestReading, isConnected } = useWaterLevelWS();

  // Flag agar notifikasi tidak muncul saat pertama kali data dimuat
  const nodeSeeded = React.useRef(false);
  const sensorSeeded = React.useRef(false);

  // State khusus untuk Twitter Feeds
  const [tweets, setTweets] = useState([]);
  const [loadingTweets, setLoadingTweets] = useState(false);

  // MENGAMBIL STATE DARI GLOBAL CONTEXT
  const themeContext = useContext(ThemeContext);
  const isDarkMode = themeContext?.isDarkMode || false;
  const toggleTheme = themeContext?.toggleTheme || (() => {});
  
  // Definisikan themeColors agar tidak error saat dipanggil
  const themeColors = isDarkMode ? DARK_COLORS : LIGHT_COLORS;

  // Update status bar appearance
  useEffect(() => {
    StatusBar.setBarStyle(isDarkMode ? 'light-content' : 'dark-content');
    if (Platform.OS === 'android') {
      StatusBar.setBackgroundColor(themeColors.background);
    }
  }, [isDarkMode, themeColors.background]);


  // 1. Fetch Data Utama (Sensor Node dari Backend Arthur)
  // silent = true dipakai polling otomatis agar tidak memunculkan loading spinner
  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // Mengambil lokasi dan log terbaru dari API
      const [locations, logs] = await Promise.all([getLocations(), getLogs()]);

      // Memproses data mentah menjadi bentuk Node menggunakan fungsi buildNodes
      const processedNodes = buildNodes(locations || [], logs || []);
      setNodes(processedNodes);

      // Deteksi node baru / dihapus (panggilan pertama hanya menyemai, tidak notifikasi)
      checkNodeListChanges(processedNodes);

      if (!nodeSeeded.current) {
        // Load pertama: seed state risiko tanpa notifikasi
        processedNodes.forEach(n => checkNodeRisk(n.id, n.name, n.status.risk, n.status.level_cm));
        nodeSeeded.current = true;
      } else {
        // Polling berikutnya: notifikasi jika ada node yang memburuk
        processedNodes.forEach(n => checkNodeRisk(n.id, n.name, n.status.risk, n.status.level_cm));
      }
    } catch (error) {
      console.error("Gagal menyinkronkan data node:", error);
      // Polling silent: pertahankan data lama agar UI tidak berkedip kosong
      if (!silent) setNodes([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // 2. Fetch data sensor awal dari REST, lalu update realtime via WebSocket
  const fetchSensorData = useCallback(async () => {
    try {
      const readings = await getReadings({ limit: 100 });
      const byDevice = {};
      (readings || []).forEach(r => {
        const prev = byDevice[r.device_id];
        if (!prev || new Date(r.created_at) > new Date(prev.created_at)) {
          byDevice[r.device_id] = r;
        }
      });
      setLatestReadings(byDevice);

      if (!sensorSeeded.current) {
        // Load pertama: seed state risiko sensor tanpa notifikasi
        Object.values(byDevice).forEach(r => {
          const risk = getRiskFromPercent(r.water_level_percent);
          checkSensorRisk(r.device_id, risk.text, r.water_level_percent);
        });
        sensorSeeded.current = true;
      }
    } catch (e) {
      console.error('Gagal mengambil data sensor:', e);
    } finally {
      setLoadingSensor(false);
    }
  }, []);

  // WebSocket update: sinkronkan pembacaan terbaru + cek peringatan
  useEffect(() => {
    if (!latestReading) return;
    setLatestReadings(prev => ({ ...prev, [latestReading.device_id]: latestReading }));
    const risk = getRiskFromPercent(latestReading.water_level_percent);
    checkSensorRisk(latestReading.device_id, risk.text, latestReading.water_level_percent);
  }, [latestReading]);

  // 3. Fetch Data Twitter (otomatis dipanggil saat aplikasi dibuka)
  const fetchTweets = useCallback(async () => {
    setLoadingTweets(true);
    try {
      const response = await axios.get('http://100.71.62.7:5678/webhook/get-live-tweets');

      if (response.data && Array.isArray(response.data)) {
        const dynamicTweets = response.data.map(tweet => ({
          ...tweet,
          time: tweet.tweet_timestamp ? getRelativeTime(tweet.tweet_timestamp) : tweet.time,
        }));
        setTweets(dynamicTweets);
      } else {
        setTweets([]);
      }
    } catch (error) {
      console.log("Error mengambil tweets dari n8n:", error);
      setTweets([
        { id: 'err-1', username: 'Sistem', handle: '@RiverEye', text: 'Gagal mengambil laporan warga terbaru. Coba lagi nanti.', time: 'Now' },
      ]);
    } finally {
      setLoadingTweets(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    fetchSensorData();
    fetchTweets();
    const timer = setInterval(() => fetchData(true), POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [fetchData, fetchSensorData, fetchTweets]);

  // Pull to refresh: perbarui node pantau + sensor ESP32
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchData(), fetchSensorData()]);
    setRefreshing(false);
  }, [fetchData, fetchSensorData]);

  // Statistik Jaringan
  const totalNodes = nodes.length;
  const dangerNodes = nodes.filter(n => n.status.risk === 'BAHAYA' || n.status.risk === 'WASPADA').length;
  const safeNodes = totalNodes - dangerNodes;

  // Node paling kritis (air tertinggi) untuk divisualisasikan — hanya sensor ketinggian, bukan alat kecil biner
  const featuredNode = nodes
    .filter(n => !n.isBinary)
    .reduce((top, n) => (!top || n.status.level_cm > top.status.level_cm ? n : top), null);

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: themeColors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={themeColors.primary} />
          <Text style={[styles.loadingText, { color: themeColors.textMuted }]}>Menyinkronkan Jaringan...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Helper function for dynamic styles
  const getDynamicStyles = (colors) => ({
    cardBg: { backgroundColor: colors.cardBg },
    textMain: { color: colors.textMain },
    textMuted: { color: colors.textMuted },
    borderColor: { borderColor: colors.border },
    shadowColor: { shadowColor: colors.shadow },
    summaryDivider: { backgroundColor: colors.border },
    dangerText: { color: colors.danger },
    safeText: { color: colors.safe },
    primaryText: { color: colors.primary },
    twitterBorder: { borderColor: colors.twitter + (isDarkMode ? '40' : '20') }, 
    twitterShadow: { shadowColor: colors.twitter },
    nodeIconBg: (color) => ({ backgroundColor: color + (isDarkMode ? '25' : '15') }), 
    nodePillBg: (color) => ({ backgroundColor: color + (isDarkMode ? '25' : '15') }), 
    hardwareBadgeBg: { backgroundColor: isDarkMode ? colors.border : colors.background },
  });

  const dynamicStyles = getDynamicStyles(themeColors);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: themeColors.background }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[themeColors.primary]} tintColor={themeColors.primary} />
        }
      >
        
        {/* Header */}
        <View style={[styles.header, { justifyContent: 'space-between' }]}>
          <View style={styles.brandContainer}>
            <View style={styles.logoWrapper}>
              <Image 
                source={require('../assets/logo.png')} 
                style={styles.logo}
                resizeMode="cover" 
              />
            </View>
            <View style={styles.brandTextContainer}>
              <Text style={[styles.headerTitle, dynamicStyles.textMain]}>RiverEye</Text>
              <Text style={[styles.subHeader, dynamicStyles.textMuted]}>Network Overview</Text>
            </View>
          </View>
          {/* Tombol Theme Toggle menggunakan fungsi dari Global Context */}
          <TouchableOpacity onPress={toggleTheme} style={styles.themeButton}>
            <Icon
              name={isDarkMode ? 'sunny' : 'moon'}
              size={24}
              color={themeColors.textMain}
            />
          </TouchableOpacity>
        </View>

        {/* Unified Summary Panel */}
        <View style={[styles.summaryPanel, dynamicStyles.cardBg, dynamicStyles.shadowColor]}>
          <View style={styles.summaryCol}>
            <Text style={[styles.summaryValue, dynamicStyles.textMain]}>{totalNodes}</Text>
            <Text style={[styles.summaryLabel, dynamicStyles.textMuted]}>Total Node</Text>
          </View>
          <View style={[styles.summaryDivider, dynamicStyles.summaryDivider]} />
          <View style={styles.summaryCol}>
            <Text style={[styles.summaryValue, dynamicStyles.dangerText]}>{dangerNodes}</Text>
            <Text style={[styles.summaryLabel, dynamicStyles.textMuted]}>Perhatian</Text>
          </View>
          <View style={[styles.summaryDivider, dynamicStyles.summaryDivider]} />
          <View style={styles.summaryCol}>
            <Text style={[styles.summaryValue, dynamicStyles.safeText]}>{safeNodes}</Text>
            <Text style={[styles.summaryLabel, dynamicStyles.textMuted]}>Aman</Text>
          </View>
        </View>

        {/* --- SECTION: Pembacaan Sensor ESP32 (Realtime) --- */}
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleRow}>
            <Text style={[styles.sectionTitle, dynamicStyles.textMain]}>Pembacaan Sensor</Text>
            <View style={[styles.liveBadge, { backgroundColor: (isConnected ? themeColors.safe : themeColors.danger) + '20' }]}>
              <View style={[styles.pulseDot, { backgroundColor: isConnected ? themeColors.safe : themeColors.danger }]} />
              <Text style={[styles.liveBadgeText, { color: isConnected ? themeColors.safe : themeColors.danger }]}>
                {isConnected ? 'LIVE' : 'OFFLINE'}
              </Text>
            </View>
          </View>
        </View>

        {loadingSensor ? (
          <ActivityIndicator color={themeColors.primary} style={{ marginBottom: 24 }} />
        ) : Object.keys(latestReadings).length === 0 ? (
          <View style={[styles.emptyTweetContainer, dynamicStyles.cardBg, dynamicStyles.borderColor]}>
            <Icon name="water-outline" size={32} color={themeColors.border} />
            <Text style={[styles.emptyTweetText, dynamicStyles.textMuted]}>Belum ada data sensor tersedia.</Text>
          </View>
        ) : (
          Object.values(latestReadings).map(reading => {
            const risk = getRiskFromPercent(reading.water_level_percent);
            return (
              <View key={reading.device_id} style={[styles.sensorCard, dynamicStyles.cardBg, dynamicStyles.shadowColor]}>
                <View style={styles.sensorCardTop}>
                  <View style={styles.nodeWidgetLeft}>
                    <View style={[styles.iconContainer, { backgroundColor: risk.color + (isDarkMode ? '25' : '15') }]}>
                      <Icon name="hardware-chip-outline" size={18} color={risk.color} />
                    </View>
                    <View style={styles.nodeTitleArea}>
                      <Text style={[styles.nodeName, dynamicStyles.textMain]}>{reading.device_id}</Text>
                      <Text style={[styles.nodeId, dynamicStyles.textMuted]}>
                        {new Date(reading.created_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </View>
                  </View>
                  <View style={[styles.statusPill, { backgroundColor: risk.color + (isDarkMode ? '25' : '15') }]}>
                    <View style={[styles.statusDot, { backgroundColor: risk.color }]} />
                    <Text style={[styles.statusText, { color: risk.color }]}>{risk.text.toUpperCase()}</Text>
                  </View>
                </View>

                <View style={styles.sensorLevelRow}>
                  <Text style={[styles.metricValue, dynamicStyles.textMain]}>
                    {reading.water_level_percent.toFixed(1)}
                  </Text>
                  <Text style={[styles.metricUnit, dynamicStyles.textMuted]}>%</Text>
                </View>

                <View style={[styles.progressBarBg, { backgroundColor: themeColors.border }]}>
                  <View
                    style={[
                      styles.progressBarFill,
                      { width: `${Math.min(reading.water_level_percent, 100)}%`, backgroundColor: risk.color },
                    ]}
                  />
                </View>

                {reading.battery_voltage != null && (
                  <View style={styles.sensorMetaRow}>
                    <Icon name="battery-half-outline" size={12} color={themeColors.textMuted} />
                    <Text style={[styles.sensorMetaText, dynamicStyles.textMuted]}>
                      {reading.battery_voltage.toFixed(2)} V
                    </Text>
                  </View>
                )}
              </View>
            );
          })
        )}

        {/* --- SECTION: Twitter Live Feeds (Manual Fetch) --- */}
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleRow}>
            <Text style={[styles.sectionTitle, dynamicStyles.textMain]}>Laporan Warga</Text>
          </View>
          
          {/* Tombol Refresh Khusus Tweet */}
          <TouchableOpacity 
            onPress={fetchTweets} 
            disabled={loadingTweets}
            style={[styles.refreshIconBtn, { backgroundColor: themeColors.twitter + '20' }, loadingTweets && styles.refreshIconBtnDisabled]}
          >
            {loadingTweets ? (
              <ActivityIndicator size="small" color={themeColors.twitter} />
            ) : (
              <>
                <Icon name="sync" size={16} color={themeColors.twitter} style={styles.syncIcon} />
                <Text style={[styles.refreshText, { color: themeColors.twitter }]}>Muat Terbaru</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Konten Laporan Warga */}
        {tweets.length === 0 && !loadingTweets ? (
          // Empty State jika pengguna belum menekan tombol refresh
          <View style={[styles.emptyTweetContainer, dynamicStyles.cardBg, dynamicStyles.borderColor]}>
            <Icon name="logo-twitter" size={32} color={themeColors.border} />
            <Text style={[styles.emptyTweetText, dynamicStyles.textMuted]}>Ketuk "Muat Terbaru" untuk menarik laporan Twitter warga sekitar lokasi secara real-time via n8n.</Text>
          </View>
        ) : (
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.twitterScrollContainer}
            decelerationRate="fast"
            snapToInterval={280 + 16}
          >
            {tweets.map((tweet) => (
              <View key={tweet.id} style={[styles.tweetCard, dynamicStyles.cardBg, dynamicStyles.twitterBorder, dynamicStyles.twitterShadow]}>
                <View style={styles.tweetHeader}>
                  <View>
                    <Text style={[styles.tweetUsername, dynamicStyles.textMain]} numberOfLines={1}>{tweet.username}</Text>
                    <Text style={[styles.tweetHandle, dynamicStyles.textMuted]}>{tweet.handle}</Text>
                  </View>
                  <Text style={[styles.tweetTime, dynamicStyles.textMuted]}>{tweet.time}</Text>
                </View>
                <Text style={[styles.tweetText, dynamicStyles.textMain]} numberOfLines={4}>{tweet.text}</Text>
              </View>
            ))}
          </ScrollView>
        )}

        {/* --- SECTION: Visualisasi Tinggi Sungai (Animasi) Arthur --- */}
        {featuredNode && (
          <RiverLevelVisual node={featuredNode} themeColors={themeColors} isDarkMode={isDarkMode} />
        )}

        {/* Section: Titik Pantau */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, dynamicStyles.textMain]}>Status Titik Pantau</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Peta')} style={styles.linkButton}>
            <Text style={[styles.linkText, dynamicStyles.primaryText]}>Lihat Semua</Text>
            <Icon name="chevron-forward" size={14} color={themeColors.primary} />
          </TouchableOpacity>
        </View>

        <View style={styles.nodesContainer}>
          {nodes.length === 0 && !loading && (
            <View style={{ alignItems: 'center', marginVertical: 20 }}>
              <Text style={{ color: themeColors.textMuted, fontSize: 14 }}>Belum ada data titik pantau.</Text>
            </View>
          )}

          {nodes.map((node) => (
            <TouchableOpacity 
              key={node.id} 
              style={[styles.nodeWidget, dynamicStyles.cardBg, dynamicStyles.shadowColor]} 
              activeOpacity={0.7}
              onPress={() => navigation.navigate('Peta')} 
            >
              <View style={styles.nodeWidgetTop}>
                <View style={styles.nodeWidgetLeft}>
                  <View style={[styles.iconContainer, dynamicStyles.nodeIconBg(node.status.color)]}>
                    <Icon name="location" size={18} color={node.status.color} />
                  </View>
                  <View style={styles.nodeTitleArea}>
                    <Text style={[styles.nodeName, dynamicStyles.textMain]}>{node.name}</Text>
                    <Text style={[styles.nodeId, dynamicStyles.textMuted]}>{node.id}</Text>
                  </View>
                </View>
                <View style={[styles.statusPill, dynamicStyles.nodePillBg(node.status.color)]}>
                  <View style={[styles.statusDot, { backgroundColor: node.status.color }]} />
                  <Text style={[styles.statusText, { color: node.status.color }]}>{node.status.risk}</Text>
                </View>
              </View>

              <View style={[styles.nodeWidgetBottom, { borderTopColor: themeColors.border }]}>
                <View style={styles.metricArea}>
                  {node.isBinary ? (
                    <Text style={[styles.metricValue, { color: node.status.color }]}>{node.status.flood ? 'Banjir' : 'Kering'}</Text>
                  ) : (
                    <>
                      <Text style={[styles.metricValue, dynamicStyles.textMain]}>{(node.status.level_cm / 100).toFixed(2)}</Text>
                      <Text style={[styles.metricUnit, dynamicStyles.textMuted]}>Meter</Text>
                    </>
                  )}
                </View>

                <View style={styles.hardwareGroup}>
                  {node.hardware.has_sensor && (
                    <View style={[styles.hardwareBadge, dynamicStyles.hardwareBadgeBg]}>
                      <Icon name={node.isBinary ? 'hardware-chip-outline' : 'water-outline'} size={12} color={themeColors.textMuted} />
                      <Text style={[styles.hardwareText, dynamicStyles.textMuted]}>{node.isBinary ? 'Alat Kecil' : 'Sensor'}</Text>
                    </View>
                  )}
                  {node.hardware.has_camera && (
                    <View style={[styles.hardwareBadge, dynamicStyles.hardwareBadgeBg]}>
                      <Icon name="videocam-outline" size={12} color={themeColors.textMuted} />
                      <Text style={[styles.hardwareText, dynamicStyles.textMuted]}>CCTV</Text>
                    </View>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Peta Jaringan */}
        <View style={[styles.sectionHeader, { marginTop: 8 }]}>
          <Text style={[styles.sectionTitle, dynamicStyles.textMain]}>Peta Jaringan</Text>
        </View>
        <TouchableOpacity 
          style={[styles.mapWidget, { backgroundColor: themeColors.border }, dynamicStyles.shadowColor]} 
          activeOpacity={0.9}
          onPress={() => navigation.navigate('Peta')}
        >
          <MapView
            provider={PROVIDER_GOOGLE}
            style={styles.map}
            initialRegion={{
              latitude: nodes[0]?.coordinates.latitude ?? FALLBACK_REGION.latitude,
              longitude: nodes[0]?.coordinates.longitude ?? FALLBACK_REGION.longitude,
              latitudeDelta: 0.05,
              longitudeDelta: 0.05,
            }}
            scrollEnabled={false}
            zoomEnabled={false}
            pitchEnabled={false}
            rotateEnabled={false}
            customMapStyle={isDarkMode ? mapDarkStyle : []} 
          >
            {nodes.map((loc) => (
              <Marker
                key={loc.id}
                coordinate={loc.coordinates}
                pinColor={loc.status.color} 
              />
            ))}
          </MapView>
          <View style={styles.mapOverlay}>
            <View style={[styles.mapOverlayButton, dynamicStyles.cardBg]}>
              <Text style={[styles.mapOverlayText, dynamicStyles.primaryText]}>Buka Navigasi Peta</Text>
              <Icon name="arrow-forward" size={16} color={themeColors.primary} />
            </View>
          </View>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 24, paddingBottom: 40 },
  
  header: { marginBottom: 32, marginTop: 8, flexDirection: 'row', alignItems: 'center' },
  brandContainer: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  logoWrapper: { width: 64, height: 64, marginRight: 16, justifyContent: 'center', alignItems: 'center' },
  logo: { width: '100%', height: '100%' },
  brandTextContainer: { justifyContent: 'center', flex: 1 },
  headerTitle: { fontSize: 32, fontWeight: '900', letterSpacing: -0.5 },
  subHeader: { fontSize: 14, fontWeight: '600', marginTop: 2, letterSpacing: 0.5 },
  themeButton: { padding: 8 },

  summaryPanel: { flexDirection: 'row', borderRadius: 24, paddingVertical: 20, paddingHorizontal: 16, marginBottom: 36, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.03, shadowRadius: 16, elevation: 2 },
  summaryCol: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  summaryDivider: { width: 1, marginVertical: 4 },
  summaryValue: { fontSize: 26, fontWeight: '800', marginBottom: 4 },
  summaryLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },

  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center' },
  sectionTitle: { fontSize: 18, fontWeight: '800' },
  liveBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginLeft: 10 },
  pulseDot: { width: 6, height: 6, borderRadius: 3, marginRight: 4 },
  liveBadgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  
  linkButton: { flexDirection: 'row', alignItems: 'center' },
  linkText: { fontSize: 13, fontWeight: '600', marginRight: 4 },

  refreshIconBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  refreshIconBtnDisabled: { opacity: 0.5 },
  syncIcon: { marginRight: 4 },
  refreshText: { fontSize: 12, fontWeight: '700' },

  emptyTweetContainer: { borderRadius: 20, padding: 24, alignItems: 'center', marginBottom: 24, borderWidth: 1, borderStyle: 'dashed' },
  emptyTweetText: { fontSize: 13, textAlign: 'center', marginTop: 12, lineHeight: 20 },
  twitterScrollContainer: { paddingBottom: 24 },
  tweetCard: { width: 280, borderRadius: 20, padding: 16, marginRight: 16, borderWidth: 1, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 12, elevation: 2 },
  tweetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  tweetUsername: { fontSize: 14, fontWeight: '700', maxWidth: 180 },
  tweetHandle: { fontSize: 12, marginTop: 2 },
  tweetTime: { fontSize: 12, fontWeight: '500' },
  tweetText: { fontSize: 13, lineHeight: 20 },

  nodesContainer: { marginBottom: 24 },
  nodeWidget: { borderRadius: 20, padding: 16, marginBottom: 16, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.02, shadowRadius: 12, elevation: 1 },
  nodeWidgetTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  nodeWidgetLeft: { flexDirection: 'row', alignItems: 'center' },
  iconContainer: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  nodeTitleArea: { justifyContent: 'center' },
  nodeName: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  nodeId: { fontSize: 11, fontWeight: '500' },
  statusPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  statusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  statusText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  nodeWidgetBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', borderTopWidth: 1, paddingTop: 16 },
  metricArea: { flexDirection: 'row', alignItems: 'baseline' },
  metricValue: { fontSize: 28, fontWeight: '800', letterSpacing: -1 },
  metricUnit: { fontSize: 13, fontWeight: '600', marginLeft: 6 },
  hardwareGroup: { flexDirection: 'row', gap: 6 },
  hardwareBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6 },
  hardwareText: { fontSize: 10, fontWeight: '600', marginLeft: 4 },

  mapWidget: { height: 200, borderRadius: 24, overflow: 'hidden', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.04, shadowRadius: 16, elevation: 2 },
  map: { flex: 1 },
  mapOverlay: { position: 'absolute', bottom: 16, left: 0, right: 0, alignItems: 'center' },
  mapOverlayButton: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 4 },
  mapOverlayText: { fontSize: 13, fontWeight: '700', marginRight: 6 },

  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 16, fontWeight: '500', fontSize: 14 },

  sensorCard: { borderRadius: 20, padding: 16, marginBottom: 16, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.02, shadowRadius: 12, elevation: 1 },
  sensorCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sensorLevelRow: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 10 },
  progressBarBg: { height: 6, borderRadius: 3, marginBottom: 10, overflow: 'hidden' },
  progressBarFill: { height: 6, borderRadius: 3 },
  sensorMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sensorMetaText: { fontSize: 11, fontWeight: '600' },
});

// Google Maps Dark Theme Style Json
const mapDarkStyle = [
  {
    "elementType": "geometry",
    "stylers": [
      {
        "color": "#212121"
      }
    ]
  },
  {
    "elementType": "labels.icon",
    "stylers": [
      {
        "visibility": "off"
      }
    ]
  },
  {
    "elementType": "labels.text.fill",
    "stylers": [
      {
        "color": "#757575"
      }
    ]
  },
  {
    "elementType": "labels.text.stroke",
    "stylers": [
      {
        "color": "#212121"
      }
    ]
  },
  {
    "featureType": "administrative",
    "elementType": "geometry",
    "stylers": [
      {
        "color": "#757575"
      }
    ]
  },
  {
    "featureType": "administrative.country",
    "elementType": "labels.text.fill",
    "stylers": [
      {
        "color": "#9e9e9e"
      }
    ]
  },
  {
    "featureType": "administrative.land_parcel",
    "stylers": [
      {
        "visibility": "off"
      }
    ]
  },
  {
    "featureType": "administrative.locality",
    "elementType": "labels.text.fill",
    "stylers": [
      {
        "color": "#bdbdbd"
      }
    ]
  },
  {
    "featureType": "poi",
    "elementType": "labels.text.fill",
    "stylers": [
      {
        "color": "#757575"
      }
    ]
  },
  {
    "featureType": "poi.park",
    "elementType": "geometry",
    "stylers": [
      {
        "color": "#181818"
      }
    ]
  },
  {
    "featureType": "poi.park",
    "elementType": "labels.text.fill",
    "stylers": [
      {
        "color": "#616161"
      }
    ]
  },
  {
    "featureType": "poi.park",
    "elementType": "labels.text.stroke",
    "stylers": [
      {
        "color": "#1b1b1b"
      }
    ]
  },
  {
    "featureType": "road",
    "elementType": "geometry.fill",
    "stylers": [
      {
        "color": "#2c2c2c"
      }
    ]
  },
  {
    "featureType": "road",
    "elementType": "labels.text.fill",
    "stylers": [
      {
        "color": "#8a8a8a"
      }
    ]
  },
  {
    "featureType": "road.arterial",
    "elementType": "geometry",
    "stylers": [
      {
        "color": "#373737"
      }
    ]
  },
  {
    "featureType": "road.highway",
    "elementType": "geometry",
    "stylers": [
      {
        "color": "#3c3c3c"
      }
    ]
  },
  {
    "featureType": "road.highway.controlled_access",
    "elementType": "geometry",
    "stylers": [
      {
        "color": "#4e4e4e"
      }
    ]
  },
  {
    "featureType": "road.local",
    "elementType": "labels.text.fill",
    "stylers": [
      {
        "color": "#616161"
      }
    ]
  },
  {
    "featureType": "transit",
    "elementType": "labels.text.fill",
    "stylers": [
      {
        "color": "#757575"
      }
    ]
  },
  {
    "featureType": "water",
    "elementType": "geometry",
    "stylers": [
      {
        "color": "#000000"
      }
    ]
  },
  {
    "featureType": "water",
    "elementType": "labels.text.fill",
    "stylers": [
      {
        "color": "#3d3d3d"
      }
    ]
  }
];

export default DashboardScreen;