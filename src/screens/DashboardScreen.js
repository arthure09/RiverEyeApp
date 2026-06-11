import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView, ActivityIndicator, TouchableOpacity, RefreshControl } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { getLocations, getLogs } from '../config/apiClient';
import { buildNodes } from '../config/nodes';

// Palet warna premium (Ultra-Clean Slate & Sky UI)
const COLORS = {
  background: '#F8FAFC', 
  cardBg: '#FFFFFF',
  textMain: '#0F172A',   
  textMuted: '#64748B',  
  border: '#F1F5F9',     
  primary: '#0EA5E9',
  safe: '#10B981',     // Emerald
  warning: '#F59E0B',  // Amber
  danger: '#EF4444',   // Red
};

// Lokasi default peta jika belum ada node (Surabaya)
const FALLBACK_REGION = { latitude: -7.2575, longitude: 112.7521 };

const DashboardScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [nodes, setNodes] = useState([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [locations, logs] = await Promise.all([getLocations(), getLogs()]);
      setNodes(buildNodes(locations || [], logs || []));
    } catch {
      setNodes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  // Menghitung statistik jaringan
  const totalNodes = nodes.length;
  const dangerNodes = nodes.filter(n => n.status.risk === 'BAHAYA' || n.status.risk === 'WASPADA').length;
  const safeNodes = totalNodes - dangerNodes;

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Menyinkronkan Jaringan Node...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />
        }
      >
        
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>RiverEye Network</Text>
          <Text style={styles.subHeader}>Sistem Manajemen Bencana Cerdas</Text>
        </View>

        {/* NETWORK OVERVIEW (Summary Cards) */}
        <View style={styles.summaryRow}>
          <View style={[styles.summaryCard, { backgroundColor: COLORS.primary + '10' }]}>
            <Text style={[styles.summaryValue, { color: COLORS.primary }]}>{totalNodes}</Text>
            <Text style={styles.summaryLabel}>Total Node</Text>
          </View>
          <View style={[styles.summaryCard, { backgroundColor: COLORS.danger + '10' }]}>
            <Text style={[styles.summaryValue, { color: COLORS.danger }]}>{dangerNodes}</Text>
            <Text style={styles.summaryLabel}>Perhatian</Text>
          </View>
          <View style={[styles.summaryCard, { backgroundColor: COLORS.safe + '10' }]}>
            <Text style={[styles.summaryValue, { color: COLORS.safe }]}>{safeNodes}</Text>
            <Text style={styles.summaryLabel}>Aman</Text>
          </View>
        </View>

        {/* PRIORITY NODES (Daftar Node Kritis) */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Status Titik Pantau</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Peta')}>
            <Text style={styles.linkText}>Lihat Peta →</Text>
          </TouchableOpacity>
        </View>

        {nodes.map((node) => (
          <TouchableOpacity 
            key={node.id} 
            style={[styles.nodeCard, { borderColor: node.status.color + '30', borderWidth: 1 }]}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('Peta')} // Sementara arahkan ke peta
          >
            <View style={styles.nodeHeader}>
              <View>
                <Text style={styles.nodeName}>{node.name}</Text>
                <Text style={styles.nodeId}>ID: {node.id}</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: node.status.color + '15' }]}>
                <View style={[styles.dot, { backgroundColor: node.status.color }]} />
                <Text style={[styles.badgeText, { color: node.status.color }]}>{node.status.risk}</Text>
              </View>
            </View>

            <View style={styles.nodeFooter}>
              <Text style={styles.nodeLevel}>{(node.status.level_cm / 100).toFixed(2)} <Text style={styles.unit}>Meter</Text></Text>
              
              {/* Indikator Hardware Tambahan (Modular) */}
              <View style={styles.hardwareRow}>
                {node.hardware.has_sensor && <Text style={styles.hardwareIcon}>💧 Sensor</Text>}
                {node.hardware.has_camera && <Text style={styles.hardwareIcon}>📹 CCTV</Text>}
              </View>
            </View>
          </TouchableOpacity>
        ))}

        {/* Card: Peta Jaringan Keseluruhan */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Peta Jaringan</Text>
        </View>
        <TouchableOpacity 
          style={styles.card} 
          activeOpacity={0.7}
          onPress={() => navigation.navigate('Peta')}
        >
          <View style={styles.mediaBox} pointerEvents="none">
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
            >
              {nodes.map((loc) => (
                <Marker
                  key={loc.id}
                  coordinate={loc.coordinates}
                  pinColor={loc.status.color} // Warna pin sesuai status bahaya
                />
              ))}
            </MapView>
          </View>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scrollContent: { padding: 24, paddingBottom: 40 },
  
  header: { marginBottom: 24, marginTop: 8 },
  headerTitle: { fontSize: 32, fontWeight: '900', color: COLORS.textMain, letterSpacing: -1 },
  subHeader: { fontSize: 15, fontWeight: '600', color: COLORS.textMuted, marginTop: 4 },

  // Summary Cards
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 32 },
  summaryCard: { flex: 1, padding: 16, borderRadius: 20, alignItems: 'center', marginHorizontal: 4 },
  summaryValue: { fontSize: 28, fontWeight: '900', marginBottom: 4 },
  summaryLabel: { fontSize: 12, fontWeight: '700', color: COLORS.textMuted, textTransform: 'uppercase' },

  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16, paddingHorizontal: 4 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: COLORS.textMain },
  linkText: { fontSize: 13, color: COLORS.primary, fontWeight: '700', marginBottom: 2 },

  // Node Cards
  nodeCard: { 
    backgroundColor: COLORS.cardBg, 
    borderRadius: 20, 
    padding: 20, 
    marginBottom: 16,
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03,
    shadowRadius: 10,
    elevation: 2,
  },
  nodeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  nodeName: { fontSize: 16, fontWeight: '700', color: COLORS.textMain, marginBottom: 2 },
  nodeId: { fontSize: 11, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 0.5 },
  
  badge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  badgeText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },

  nodeFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border, paddingTop: 16 },
  nodeLevel: { fontSize: 24, fontWeight: '900', color: COLORS.textMain, letterSpacing: -1 },
  unit: { fontSize: 14, fontWeight: '600', color: COLORS.textMuted },
  
  hardwareRow: { flexDirection: 'row' },
  hardwareIcon: { fontSize: 11, fontWeight: '700', color: COLORS.textMuted, backgroundColor: COLORS.background, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, marginLeft: 8, overflow: 'hidden' },

  // General Card
  card: { backgroundColor: COLORS.cardBg, borderRadius: 24, padding: 8, marginBottom: 24 },
  mediaBox: { height: 180, backgroundColor: '#F1F5F9', borderRadius: 20, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  map: { flex: 1, width: '100%' },

  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 16, color: COLORS.textMuted, fontWeight: '500', fontSize: 15 },
});

export default DashboardScreen;