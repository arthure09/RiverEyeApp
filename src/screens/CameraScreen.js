import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, SafeAreaView, StatusBar, TouchableOpacity } from 'react-native';
import Video from 'react-native-video';
import Icon from 'react-native-vector-icons/Ionicons';
import { getLocations } from '../config/apiClient';

const COLORS = {
  background: '#F8FAFC',
  cardBg: '#FFFFFF',
  textMain: '#0F172A',
  textMuted: '#64748B',
  border: '#E2E8F0',
  primary: '#0EA5E9',
  danger: '#EF4444',
};

// Stream cadangan jika node belum punya cctv_url dari backend
const PLACEHOLDER_STREAM = 'https://www.w3schools.com/html/mov_bbb.mp4';

// Pilih node berkamera acak (selain yang sedang aktif)
const pickRandom = (list, exclude) => {
  const pool = exclude ? list.filter(n => n.id !== exclude) : list;
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
};

const CameraScreen = ({ route, navigation }) => {
  const { nodeId: paramNodeId, nodeName: paramNodeName, cctvUrl: paramCctvUrl } = route?.params || {};
  const fromMap = Boolean(paramNodeId);

  const [cameraNodes, setCameraNodes] = useState([]);
  const [activeNode, setActiveNode] = useState(() =>
    fromMap ? { id: paramNodeId, name: paramNodeName, cctvUrl: paramCctvUrl } : null
  );
  const [isBuffering, setIsBuffering] = useState(true);
  const [videoError, setVideoError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(Date.now());

  // Ambil daftar node berkamera dari backend (mode jelajah / ganti kamera)
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const locations = await getLocations();
        const cams = (locations || [])
          .filter(l => l.has_camera)
          .map(l => ({ id: String(l.id), name: l.name, cctvUrl: l.cctv_url || null }));
        if (!active) return;
        setCameraNodes(cams);
        if (!fromMap) setActiveNode(prev => prev || pickRandom(cams));
      } catch {
        // biarkan daftar kosong
      }
    })();
    return () => { active = false; };
  }, [fromMap]);

  // Saat navigasi dari Peta dengan nodeId baru, sinkronkan activeNode
  useEffect(() => {
    if (fromMap) {
      setActiveNode({ id: paramNodeId, name: paramNodeName, cctvUrl: paramCctvUrl });
      setVideoError(false);
      setIsBuffering(true);
      setRefreshKey(Date.now());
    }
  }, [paramNodeId, paramNodeName, paramCctvUrl, fromMap]);

  const handleSwitchCamera = useCallback(() => {
    const next = pickRandom(cameraNodes, activeNode?.id);
    if (!next) return;
    setActiveNode(next);
    setVideoError(false);
    setIsBuffering(true);
    setRefreshKey(Date.now());
  }, [cameraNodes, activeNode]);

  const handleRefresh = useCallback(() => {
    setVideoError(false);
    setIsBuffering(true);
    setRefreshKey(Date.now());
  }, []);

  // Belum ada kamera (data backend kosong / node tanpa CCTV)
  if (!activeNode) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {fromMap && (
              <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                <Icon name="arrow-back" size={24} color={COLORS.textMain} />
              </TouchableOpacity>
            )}
            <Text style={styles.headerTitle}>Live Monitoring</Text>
          </View>
        </View>
        <View style={styles.emptyWrap}>
          <Text style={styles.errorIcon}>📷</Text>
          <Text style={styles.errorText}>Belum ada kamera CCTV yang tersedia.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {fromMap && (
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
              <Icon name="arrow-back" size={24} color={COLORS.textMain} />
            </TouchableOpacity>
          )}
          <View>
            <Text style={styles.headerTitle}>Live Monitoring</Text>
            <Text style={styles.subHeader}>{activeNode.name}</Text>
          </View>
        </View>
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      </View>

      {/* Video Player */}
      <View style={styles.videoWrapper}>
        <View style={styles.videoCard}>
          {isBuffering && !videoError && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color={COLORS.primary} />
              <Text style={styles.loadingText}>Menghubungkan siaran...</Text>
            </View>
          )}

          {videoError ? (
            <View style={styles.errorOverlay}>
              <Text style={styles.errorIcon}>📵</Text>
              <Text style={styles.errorText}>Kamera offline atau koneksi terputus.</Text>
            </View>
          ) : (
            <Video
              key={refreshKey}
              source={{ uri: activeNode.cctvUrl || PLACEHOLDER_STREAM }}
              style={styles.videoPlayer}
              resizeMode="cover"
              onReadyForDisplay={() => setIsBuffering(false)}
              onLoadStart={() => setIsBuffering(true)}
              onLoad={() => setIsBuffering(false)}
              onError={() => { setIsBuffering(false); setVideoError(true); }}
              controls={false}
              repeat={true}
              muted={true}
            />
          )}

          <View style={styles.videoOverlayInfo}>
            <Text style={styles.overlayText}>{activeNode.id} | HD 1080p</Text>
          </View>
        </View>
      </View>

      {/* Info & Aksi */}
      <View style={styles.infoSection}>
        <View style={styles.statusCard}>
          <Text style={styles.statusLabel}>Status Perangkat</Text>
          <View style={styles.statusRow}>
            <View style={styles.statusIndicator}>
              <View style={[styles.statusDot, { backgroundColor: videoError ? COLORS.danger : '#10B981' }]} />
              <Text style={styles.statusValue}>{videoError ? 'Offline' : 'Online'}</Text>
            </View>
            <Text style={styles.latencyText}>Latency: 120ms</Text>
          </View>
        </View>

        <View style={styles.descriptionBox}>
          <Text style={styles.descriptionTitle}>Informasi Jaringan:</Text>
          <Text style={styles.descriptionText}>
            Siaran langsung dari modul kamera pada {activeNode.name}. Stream dikirimkan melalui jaringan privat Tailscale.
          </Text>
        </View>

        <View style={styles.actionRow}>
          {/* Tombol ganti kamera hanya muncul jika tidak dinavigasikan dari Peta */}
          {!fromMap && (
            <TouchableOpacity style={styles.secondaryButton} onPress={handleSwitchCamera}>
              <Text style={styles.secondaryButtonText}>Ganti Kamera</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.refreshButton, !fromMap && styles.refreshButtonFlex]}
            onPress={handleRefresh}
          >
            <Text style={styles.refreshButtonText}>Refresh Stream</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    paddingHorizontal: 24,
    paddingVertical: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  backButton: { marginRight: 16, padding: 4 },
  headerTitle: { fontSize: 24, fontWeight: '900', color: COLORS.textMain, letterSpacing: -1 },
  subHeader: { fontSize: 14, color: COLORS.textMuted, fontWeight: '600' },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.danger + '15',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.danger, marginRight: 6 },
  liveText: { color: COLORS.danger, fontSize: 12, fontWeight: '800' },

  videoWrapper: { paddingHorizontal: 24, marginBottom: 24 },
  videoCard: {
    width: '100%',
    height: 240,
    backgroundColor: '#0F172A',
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 10,
  },
  videoPlayer: { flex: 1 },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  loadingText: { color: '#FFFFFF', marginTop: 12, fontWeight: '600', fontSize: 14 },
  emptyWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  errorOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  errorIcon: { fontSize: 48, marginBottom: 12 },
  errorText: { color: COLORS.textMuted, textAlign: 'center', fontWeight: '500' },
  videoOverlayInfo: {
    position: 'absolute',
    top: 16,
    left: 16,
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  overlayText: { color: '#FFF', fontSize: 10, fontWeight: 'bold' },

  infoSection: { paddingHorizontal: 24 },
  statusCard: {
    backgroundColor: COLORS.cardBg,
    padding: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 16,
  },
  statusLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textMuted,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusIndicator: { flexDirection: 'row', alignItems: 'center' },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  statusValue: { fontSize: 18, fontWeight: '800', color: COLORS.textMain },
  latencyText: { fontSize: 13, color: COLORS.textMuted, fontWeight: '500' },
  descriptionBox: {
    padding: 16,
    backgroundColor: COLORS.primary + '0A',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.primary + '20',
    marginBottom: 16,
  },
  descriptionTitle: { fontSize: 14, fontWeight: '700', color: COLORS.primary, marginBottom: 4 },
  descriptionText: { fontSize: 13, color: COLORS.textMuted, lineHeight: 18 },

  actionRow: { flexDirection: 'row', gap: 12 },
  secondaryButton: {
    flex: 1,
    backgroundColor: COLORS.primary + '15',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  secondaryButtonText: { color: COLORS.primary, fontWeight: '700', fontSize: 15 },
  refreshButton: {
    flex: 1,
    backgroundColor: COLORS.textMain,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  refreshButtonFlex: { flex: 1 },
  refreshButtonText: { color: '#FFF', fontWeight: '700', fontSize: 15 },
});

export default CameraScreen;
