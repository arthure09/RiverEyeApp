import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, RefreshControl, SafeAreaView, StatusBar } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { getLogs, getLocations } from '../config/apiClient';
import { riskFromLevel } from '../config/nodes';

const COLORS = {
  background: '#F8FAFC',
  cardBg: '#FFFFFF',
  textMain: '#0F172A',
  textMuted: '#64748B',
  border: '#F1F5F9',
  primary: '#0EA5E9',
  danger: '#EF4444',
};

const HistoryScreen = ({ route, navigation }) => {
  const [historyData, setHistoryData] = useState([]);
  const [locations, setLocations] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Menerima parameter jika dinavigasikan dari detail Node di Peta
  const { nodeId, nodeName } = route?.params || {};

  const fetchHistoryData = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    setError(null);
    try {
      const [logs, locs] = await Promise.all([getLogs(), getLocations()]);

      // Peta id -> objek lokasi (untuk nama & ambang risiko per-node)
      const locMap = {};
      (locs || []).forEach(loc => { locMap[loc.id] = loc; });
      setLocations(locMap);

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
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [nodeId]);

  useEffect(() => {
    fetchHistoryData();
  }, [fetchHistoryData]);

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
          <View style={[styles.badge, { backgroundColor: status.color + '15' }]}>
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
      <StatusBar barStyle="dark-content" />
      
      {/* Area Header dengan dukungan tombol Back jika difilter per Node */}
      <View style={styles.header}>
        {nodeId && (
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Icon name="arrow-back" size={24} color={COLORS.textMain} />
          </TouchableOpacity>
        )}
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>{nodeId ? 'Riwayat Titik' : 'Riwayat Data'}</Text>
          <View style={styles.subHeaderRow}>
            <Text style={styles.subHeader}>{nodeId ? (nodeName || `Node ${nodeId}`) : 'Log Sensor Real-time'}</Text>
            {!loading && historyData.length > 0 && (
              <View style={styles.countBadge}>
                <Text style={styles.countText}>{historyData.length} Data</Text>
              </View>
            )}
          </View>
        </View>
      </View>
      
      {/* Content Area */}
      {loading ? (
        <View style={styles.stateContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.stateText}>Sinkronisasi riwayat...</Text>
        </View>
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
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />
          }
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
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
    backgroundColor: COLORS.textMain,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6
  },
  countText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '800'
  },

  listContent: { paddingHorizontal: 24, paddingBottom: 32 },

  // Card Styles
  card: { 
    backgroundColor: COLORS.cardBg, 
    borderRadius: 20,
    padding: 20, 
    marginBottom: 16, 
    borderWidth: 0.5,
    borderColor: COLORS.border,
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03, 
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

  cardFooter: { paddingTop: 16, borderTopWidth: 0.5, borderTopColor: COLORS.border },
  timeText: { fontSize: 12, fontWeight: '600', color: COLORS.textMuted },

  stateContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  stateText: { marginTop: 16, color: COLORS.textMuted, fontSize: 15, fontWeight: '500', textAlign: 'center' },
  stateIcon: { fontSize: 48, marginBottom: 8 },
  retryButton: { marginTop: 24, backgroundColor: COLORS.textMain, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 12 },
  retryButtonText: { color: '#FFFFFF', fontWeight: 'bold' },
});

export default HistoryScreen;