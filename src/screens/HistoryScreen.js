import React, { useState, useEffect, useCallback, useContext, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, RefreshControl, SafeAreaView, StatusBar, Platform } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { getLogs, getLocations, getReadings } from '../config/apiClient';
import { riskFromLevel, buildNodes } from '../config/nodes';
import { getRiskFromPercent } from '../config/api';

// Import Global Theme Context
import { ThemeContext } from '../context/ThemeContext';

// Palet warna premium - Light Mode
const LIGHT_COLORS = {
  background: '#F8FAFC',
  cardBg: '#FFFFFF',
  textMain: '#0F172A',
  textMuted: '#64748B',
  border: '#F1F5F9', // atau #E2E8F0
  primary: '#0EA5E9',
  danger: '#EF4444',
  shadow: '#64748B',
};

// Palet warna premium - Dark Mode
const DARK_COLORS = {
  background: '#0F172A', 
  cardBg: '#1E293B',    
  textMain: '#F8FAFC',   
  textMuted: '#94A3B8',  
  border: '#334155',     
  primary: '#38BDF8',    
  danger: '#F87171',     
  shadow: '#000000',     
};

const HistoryScreen = ({ route, navigation }) => {
  const [historyData, setHistoryData] = useState([]);
  const [statusNodes, setStatusNodes] = useState([]);
  const [locations, setLocations] = useState({});
  const [sensorData, setSensorData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Menerima parameter jika dinavigasikan dari detail Node di Peta atau dari Dashboard
  const { nodeId, nodeName, section } = route?.params || {};
  const [activeTab, setActiveTab] = useState(section === 'status' ? 'status' : 'log');

  // MENGAMBIL STATE DARI GLOBAL CONTEXT
  const themeContext = useContext(ThemeContext);
  const isDarkMode = themeContext?.isDarkMode || false;
  const themeColors = isDarkMode ? DARK_COLORS : LIGHT_COLORS;
  
  const styles = useMemo(() => getStyles(themeColors, isDarkMode), [themeColors, isDarkMode]);

  const fetchHistoryData = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    setError(null);
    try {
      const [logs, locs] = await Promise.all([getLogs(), getLocations()]);

      // Peta id -> objek lokasi (untuk nama & ambang risiko per-node)
      const locMap = {};
      (locs || []).forEach(loc => { locMap[loc.id] = loc; });
      setLocations(locMap);

      // Build status node untuk tab Status Titik Pantau
      const nodes = buildNodes(locs || [], logs || []);
      setStatusNodes(nodes.sort((a, b) => new Date(b.lastUpdated || 0) - new Date(a.lastUpdated || 0)));

      let result;
      if (nodeId) {
        // Filter per node: tampilkan semua log node tersebut
        result = (logs || [])
          .filter(log => String(log.location_id) === String(nodeId))
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      } else {
        // Tanpa filter: tampilkan 1 data terbaru per node
        const latestPerNode = {};
        (logs || []).forEach(log => {
          const existing = latestPerNode[log.location_id];
          if (!existing || new Date(log.timestamp) > new Date(existing.timestamp)) {
            latestPerNode[log.location_id] = log;
          }
        });
        result = Object.values(latestPerNode)
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      }
      setHistoryData(result);

      // Ambil riwayat sensor ESP32 secara terpisah agar tidak merusak tab lain jika gagal
      try {
        const readings = await getReadings({ limit: 100 });
        setSensorData((readings || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
      } catch (_) {}
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [nodeId]);

  useEffect(() => {
    fetchHistoryData();
  }, [fetchHistoryData]);

  // Update status bar appearance
  useEffect(() => {
    StatusBar.setBarStyle(isDarkMode ? 'light-content' : 'dark-content');
    if (Platform.OS === 'android') {
      StatusBar.setBackgroundColor(themeColors.background);
    }
  }, [isDarkMode, themeColors.background]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchHistoryData(true);
    setRefreshing(false);
  }, [fetchHistoryData]);

  const renderItem = ({ item }) => {
    const loc = locations[item.location_id];
    const status = riskFromLevel(item.water_level_cm, loc);
    const locationName = loc?.name || `Lokasi #${item.location_id}`;
    const timestamp = new Date(item.timestamp).toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.locationWrapper}>
            <Text style={styles.locationLabel}>TITIK PANTAU</Text>
            <Text style={styles.locationName}>📍 {locationName}</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: status.color + (isDarkMode ? '25' : '15') }]}>
            <View style={[styles.dot, { backgroundColor: status.color }]} />
            <Text style={[styles.badgeText, { color: status.color }]}>{status.text}</Text>
          </View>
        </View>

        <View style={styles.levelContainer}>
          <Text style={styles.levelLabel}>Ketinggian Air</Text>
          <View style={styles.levelValueRow}>
            <Text style={styles.levelMainValue}>{(item.water_level_cm / 100).toFixed(2)}</Text>
            <Text style={styles.levelUnit}>Meter</Text>
            <Text style={styles.levelSubValue}>({item.water_level_cm} cm)</Text>
          </View>
        </View>

        <View style={styles.cardFooter}>
          <Text style={styles.timeText}>🕒 {timestamp} WIB</Text>
        </View>
      </View>
    );
  };

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor={themeColors.background} />
        <View style={styles.stateContainer}>
          <Text style={styles.stateIcon}>📡</Text>
          <Text style={styles.stateText}>Gagal mengambil riwayat. Periksa koneksi.</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchHistoryData}>
            <Text style={styles.retryButtonText}>Coba Lagi</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor={themeColors.background} />
      
      {/* Area Header */}
      <View style={styles.header}>
        {(nodeId || section === 'status') && (
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Icon name="arrow-back" size={24} color={themeColors.textMain} />
          </TouchableOpacity>
        )}
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>{nodeId ? 'Riwayat Titik' : 'Riwayat Data'}</Text>
          <View style={styles.subHeaderRow}>
            <Text style={styles.subHeader}>
              {nodeId
                ? (nodeName || `Node ${nodeId}`)
                : activeTab === 'status'
                  ? 'Status Titik Pantau'
                  : activeTab === 'sensor'
                    ? 'Bacaan Sensor ESP32'
                    : 'Log Sensor Real-time'}
            </Text>
            {!loading && (activeTab === 'log' ? historyData.length : activeTab === 'sensor' ? sensorData.length : statusNodes.length) > 0 && (
              <View style={[styles.countBadge, { backgroundColor: isDarkMode ? themeColors.border : themeColors.textMain }]}>
                <Text style={[styles.countText, { color: isDarkMode ? themeColors.textMain : '#FFF' }]}>
                  {activeTab === 'log' ? historyData.length : activeTab === 'sensor' ? sensorData.length : statusNodes.length} Data
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Tab Switcher — hanya tampil jika bukan navigasi dari node spesifik */}
      {!nodeId && (
        <View style={styles.tabRow}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'status' && styles.tabActive]}
            onPress={() => setActiveTab('status')}
            activeOpacity={0.7}
          >
            <Icon name="radio-button-on" size={13} color={activeTab === 'status' ? themeColors.primary : themeColors.textMuted} />
            <Text style={[styles.tabText, activeTab === 'status' && { color: themeColors.primary }]}>Pantau</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'log' && styles.tabActive]}
            onPress={() => setActiveTab('log')}
            activeOpacity={0.7}
          >
            <Icon name="time-outline" size={13} color={activeTab === 'log' ? themeColors.primary : themeColors.textMuted} />
            <Text style={[styles.tabText, activeTab === 'log' && { color: themeColors.primary }]}>Log</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'sensor' && styles.tabActive]}
            onPress={() => setActiveTab('sensor')}
            activeOpacity={0.7}
          >
            <Icon name="hardware-chip-outline" size={13} color={activeTab === 'sensor' ? themeColors.primary : themeColors.textMuted} />
            <Text style={[styles.tabText, activeTab === 'sensor' && { color: themeColors.primary }]}>Sensor</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Content Area */}
      {loading ? (
        <View style={styles.stateContainer}>
          <ActivityIndicator size="large" color={themeColors.primary} />
          <Text style={styles.stateText}>Sinkronisasi riwayat...</Text>
        </View>
      ) : activeTab === 'status' && !nodeId ? (
        statusNodes.length === 0 ? (
          <View style={styles.stateContainer}>
            <Text style={styles.stateIcon}>📭</Text>
            <Text style={styles.stateText}>Belum ada data titik pantau tersedia.</Text>
          </View>
        ) : (
          <FlatList
            data={statusNodes}
            keyExtractor={item => item.id}
            renderItem={({ item: node }) => (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.locationWrapper}>
                    <Text style={styles.locationLabel}>TITIK PANTAU</Text>
                    <Text style={styles.locationName}>📍 {node.name}</Text>
                  </View>
                  <View style={[styles.badge, { backgroundColor: node.status.color + (isDarkMode ? '25' : '15') }]}>
                    <View style={[styles.dot, { backgroundColor: node.status.color }]} />
                    <Text style={[styles.badgeText, { color: node.status.color }]}>{node.status.risk}</Text>
                  </View>
                </View>

                <View style={styles.levelContainer}>
                  <Text style={styles.levelLabel}>{node.isBinary ? 'Status Jalan' : 'Ketinggian Air'}</Text>
                  {node.isBinary ? (
                    <Text style={[styles.levelMainValue, { color: node.status.color }]}>
                      {node.status.flood ? 'Banjir' : 'Kering'}
                    </Text>
                  ) : (
                    <View style={styles.levelValueRow}>
                      <Text style={styles.levelMainValue}>{(node.status.level_cm / 100).toFixed(2)}</Text>
                      <Text style={styles.levelUnit}>Meter</Text>
                      <Text style={styles.levelSubValue}>({node.status.level_cm} cm)</Text>
                    </View>
                  )}
                </View>

                <View style={styles.cardFooter}>
                  <Text style={styles.timeText}>
                    🕒 {node.lastUpdated
                      ? new Date(node.lastUpdated).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' WIB'
                      : 'Belum ada data'}
                  </Text>
                </View>
              </View>
            )}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[themeColors.primary]} tintColor={themeColors.primary} />
            }
          />
        )
      ) : activeTab === 'sensor' && !nodeId ? (
        sensorData.length === 0 ? (
          <View style={styles.stateContainer}>
            <Text style={styles.stateIcon}>📡</Text>
            <Text style={styles.stateText}>Belum ada data sensor ESP32 tersedia.</Text>
          </View>
        ) : (
          <FlatList
            data={sensorData}
            keyExtractor={item => String(item.id)}
            renderItem={({ item: reading }) => {
              const risk = getRiskFromPercent(reading.water_level_percent);
              const timestamp = new Date(reading.created_at).toLocaleString('id-ID', {
                day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
              });
              return (
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <View style={styles.locationWrapper}>
                      <Text style={styles.locationLabel}>PERANGKAT</Text>
                      <Text style={styles.locationName}>📡 {reading.device_id}</Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: risk.color + (isDarkMode ? '25' : '15') }]}>
                      <View style={[styles.dot, { backgroundColor: risk.color }]} />
                      <Text style={[styles.badgeText, { color: risk.color }]}>{risk.text.toUpperCase()}</Text>
                    </View>
                  </View>

                  <View style={styles.levelContainer}>
                    <Text style={styles.levelLabel}>Ketinggian Air</Text>
                    <View style={styles.levelValueRow}>
                      <Text style={styles.levelMainValue}>{reading.water_level_percent.toFixed(1)}</Text>
                      <Text style={styles.levelUnit}>%</Text>
                      <Text style={styles.levelSubValue}>(raw: {reading.water_level_raw})</Text>
                    </View>
                    <View style={[styles.progressBarBg, { backgroundColor: isDarkMode ? '#334155' : '#E2E8F0' }]}>
                      <View style={[styles.progressBarFill, { width: `${Math.min(reading.water_level_percent, 100)}%`, backgroundColor: risk.color }]} />
                    </View>
                  </View>

                  <View style={styles.cardFooter}>
                    <Text style={styles.timeText}>🕒 {timestamp} WIB</Text>
                    {reading.battery_voltage != null && (
                      <Text style={styles.timeText}>🔋 {reading.battery_voltage.toFixed(2)} V</Text>
                    )}
                  </View>
                </View>
              );
            }}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[themeColors.primary]} tintColor={themeColors.primary} />
            }
          />
        )
      ) : historyData.length === 0 ? (
        <View style={styles.stateContainer}>
          <Text style={styles.stateIcon}>📭</Text>
          <Text style={styles.stateText}>
            {nodeId ? `Belum ada riwayat untuk ${nodeName}.` : 'Belum ada data riwayat tersedia.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={historyData}
          keyExtractor={item => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[themeColors.primary]} tintColor={themeColors.primary} />
          }
        />
      )}
    </SafeAreaView>
  );
};

// Fungsi dinamis untuk membuat Style menyesuaikan Theme Colors
const getStyles = (COLORS, isDarkMode) => StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  
  // Header Styles
  header: { 
    paddingHorizontal: 24, 
    paddingVertical: 20, 
    backgroundColor: COLORS.background,
    flexDirection: 'row',
    alignItems: 'flex-start'
  },
  backButton: {
    marginRight: 16,
    marginTop: 6,
  },
  headerTitleContainer: {
    flex: 1,
  },
  headerTitle: { 
    fontSize: 32, 
    fontWeight: '900', 
    color: COLORS.textMain,
    letterSpacing: -1
  },
  subHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4
  },
  subHeader: { 
    fontSize: 15, 
    fontWeight: '600',
    color: COLORS.textMuted 
  },
  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6
  },
  countText: {
    fontSize: 10,
    fontWeight: '800'
  },

  tabRow: {
    flexDirection: 'row', marginHorizontal: 24, marginBottom: 16,
    backgroundColor: isDarkMode ? COLORS.cardBg : COLORS.border,
    borderRadius: 12, padding: 4,
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 8, borderRadius: 9,
  },
  tabActive: { backgroundColor: isDarkMode ? COLORS.background : COLORS.cardBg },
  tabText: { fontSize: 12, fontWeight: '700', color: COLORS.textMuted },

  listContent: { paddingHorizontal: 24, paddingBottom: 32 },

  // Card Styles
  card: { 
    backgroundColor: COLORS.cardBg, 
    borderRadius: 20,
    padding: 20, 
    marginBottom: 16, 
    borderWidth: isDarkMode ? 1 : 0.5,
    borderColor: COLORS.border,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: isDarkMode ? 0.2 : 0.03, 
    shadowRadius: 8,
    elevation: 2
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  locationWrapper: { flex: 1, marginRight: 8 },
  locationLabel: { fontSize: 10, fontWeight: '800', color: COLORS.textMuted, letterSpacing: 1, marginBottom: 4 },
  locationName: { fontSize: 15, fontWeight: '700', color: COLORS.textMain },
  
  badge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  badgeText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },

  levelContainer: { marginBottom: 20 },
  levelLabel: { fontSize: 12, fontWeight: '600', color: COLORS.textMuted, marginBottom: 4 },
  levelValueRow: { flexDirection: 'row', alignItems: 'baseline' },
  levelMainValue: { fontSize: 32, fontWeight: '900', color: COLORS.textMain, letterSpacing: -1 },
  levelUnit: { fontSize: 14, fontWeight: '700', color: COLORS.textMuted, marginLeft: 4 },
  levelSubValue: { fontSize: 13, fontWeight: '500', color: COLORS.textMuted, marginLeft: 10 },

  cardFooter: { paddingTop: 16, borderTopWidth: 0.5, borderTopColor: COLORS.border, flexDirection: 'row', justifyContent: 'space-between' },
  timeText: { fontSize: 12, fontWeight: '600', color: COLORS.textMuted },

  progressBarBg: { height: 5, borderRadius: 3, marginTop: 10, overflow: 'hidden' },
  progressBarFill: { height: 5, borderRadius: 3 },

  stateContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  stateText: { marginTop: 16, color: COLORS.textMuted, fontSize: 15, fontWeight: '500', textAlign: 'center' },
  stateIcon: { fontSize: 48, marginBottom: 8 },
  retryButton: { marginTop: 24, backgroundColor: isDarkMode ? COLORS.border : COLORS.textMain, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 12 },
  retryButtonText: { color: isDarkMode ? COLORS.textMain : '#FFFFFF', fontWeight: 'bold' },
});

export default HistoryScreen;