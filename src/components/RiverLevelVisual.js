import React, { useRef, useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';

// Jarak antar puncak gelombang. Lingkaran saling tumpang agar permukaan mulus.
const WAVE_SIZE = 30;
const WAVE_STEP = WAVE_SIZE / 2;
const RULER_W = 34;

// Deretan lingkaran yang saling tumpang -> permukaan air bergelombang yang mengalir.
const WaveRow = ({ width, color, anim, opacity, top }) => {
  const count = Math.ceil(width / WAVE_STEP) + 4;
  const circles = useMemo(() => Array.from({ length: count }), [count]);
  return (
    <Animated.View
      style={[
        styles.waveRow,
        { top, width: (count + 2) * WAVE_STEP, opacity, transform: [{ translateX: anim }] },
      ]}
    >
      {circles.map((_, i) => (
        <View
          key={i}
          style={{
            width: WAVE_SIZE,
            height: WAVE_SIZE,
            borderRadius: WAVE_SIZE / 2,
            marginLeft: -WAVE_STEP,
            backgroundColor: color,
          }}
        />
      ))}
    </Animated.View>
  );
};

// Gelembung yang naik perlahan lalu memudar, untuk kesan air hidup.
const Bubble = ({ delay, x, size, riseHeight }) => {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(t, {
        toValue: 1,
        duration: 3800 + delay,
        delay,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [t, delay]);
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, -riseHeight] });
  const opacity = t.interpolate({ inputRange: [0, 0.15, 0.8, 1], outputRange: [0, 0.5, 0.5, 0] });
  return (
    <Animated.View
      style={[styles.bubble, { left: x, width: size, height: size, borderRadius: size / 2, opacity, transform: [{ translateY }] }]}
    />
  );
};

// Garis putus-putus untuk menandai ambang batas.
const DashedLine = ({ color }) => {
  const segs = useMemo(() => Array.from({ length: 40 }), []);
  return (
    <View style={styles.dashWrap}>
      {segs.map((_, i) => (
        <View key={i} style={[styles.dashSeg, { backgroundColor: color }]} />
      ))}
    </View>
  );
};

// Visualisasi modern: tangki air yang terisi sesuai ketinggian sungai.
const RiverLevelVisual = ({ node, themeColors, isDarkMode }) => {
  const [box, setBox] = useState({ w: 0, h: 0 });

  const surfaceY = useRef(new Animated.Value(0)).current;
  const waveBack = useRef(new Animated.Value(0)).current;
  const waveFront = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;

  const level = Number(node?.status?.level_cm ?? 0);
  const mediumCm = Number(node?.status?.medium_cm ?? 150);
  const highCm = Number(node?.status?.high_cm ?? 200);
  const statusColor = node?.status?.color ?? themeColors.primary;

  const waterBody = '#1E63E0';
  const waveBackColor = '#1746B8';
  const waveFrontColor = '#38BDF8';
  const shineColor = '#BAE6FD';

  // Skala maksimum + ruang headroom di atas ambang siaga.
  const maxCm = Math.max(highCm * 1.35, level * 1.15, 250);
  const fraction = Math.min(Math.max(level / maxCm, 0.04), 1);
  const pct = Math.round(fraction * 100);
  const yFor = (cm) => (1 - Math.min(cm / maxCm, 1)) * box.h;

  // Tanda meter pada penggaris (0,1,2,...).
  const ticks = useMemo(() => {
    const out = [];
    for (let m = 0; m * 100 <= maxCm; m++) out.push(m);
    return out;
  }, [maxCm]);

  // Animasikan permukaan air saat data berubah.
  useEffect(() => {
    if (!box.h) return;
    Animated.timing(surfaceY, {
      toValue: box.h * (1 - fraction),
      duration: 1600,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [fraction, box.h, surfaceY]);

  // Loop gelombang (dua lapis berlawanan arah) + denyut kilau permukaan.
  useEffect(() => {
    const mk = (val, duration, to) =>
      Animated.loop(Animated.timing(val, { toValue: to, duration, easing: Easing.linear, useNativeDriver: true }));
    const a = mk(waveBack, 4600, WAVE_STEP);
    const b = mk(waveFront, 2800, -WAVE_STEP);
    const g = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    a.start();
    b.start();
    g.start();
    return () => {
      a.stop();
      b.stop();
      g.stop();
    };
  }, [waveBack, waveFront, glow]);

  const tankW = box.w - RULER_W;
  const shineOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.85] });

  return (
    <View style={[styles.card, { backgroundColor: themeColors.cardBg, shadowColor: themeColors.shadow }]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={[styles.title, { color: themeColors.textMain }]}>Ketinggian Air</Text>
          <Text style={[styles.nodeName, { color: themeColors.textMuted }]} numberOfLines={1}>
            {node?.name ?? 'Tidak ada data'}
          </Text>
        </View>
        <View style={styles.headerRight}>
          <Text style={[styles.levelValue, { color: statusColor }]}>
            {(level / 100).toFixed(2)}
            <Text style={[styles.levelUnit, { color: themeColors.textMuted }]}> m</Text>
          </Text>
          <View style={[styles.riskPill, { backgroundColor: statusColor + (isDarkMode ? '25' : '15') }]}>
            <View style={[styles.riskDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.riskText, { color: statusColor }]}>{node?.status?.risk ?? '—'}</Text>
          </View>
        </View>
      </View>

      <View
        style={styles.viz}
        onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      >
        {/* Latar gelap + sheen halus di atas */}
        <View style={styles.bgTop} />

        {box.h > 0 && (
          <>
            {/* Penggaris meter di kiri */}
            <View style={styles.ruler}>
              {ticks.map((m) => (
                <View key={m} style={[styles.tick, { top: yFor(m * 100) - 6 }]}>
                  <Text style={styles.tickLabel}>{m}m</Text>
                  <View style={styles.tickMark} />
                </View>
              ))}
            </View>

            {/* Tangki air */}
            <View style={[styles.tank, { left: RULER_W }]}>
              <Animated.View style={[styles.water, { height: box.h, backgroundColor: waterBody, transform: [{ translateY: surfaceY }] }]}>
                <WaveRow width={tankW} color={waveBackColor} anim={waveBack} opacity={0.55} top={-WAVE_SIZE / 2 - 4} />
                <WaveRow width={tankW} color={waterBody} anim={waveFront} opacity={1} top={-WAVE_SIZE / 2} />
                <Animated.View style={[styles.shine, { backgroundColor: shineColor, opacity: shineOpacity }]} />
                <Animated.View style={[styles.crest, { backgroundColor: waveFrontColor }]} />
                <View style={styles.depthShade} />

                <Bubble delay={0} x={tankW * 0.18} size={6} riseHeight={box.h * 0.6} />
                <Bubble delay={800} x={tankW * 0.42} size={4} riseHeight={box.h * 0.72} />
                <Bubble delay={1600} x={tankW * 0.62} size={7} riseHeight={box.h * 0.52} />
                <Bubble delay={2400} x={tankW * 0.82} size={5} riseHeight={box.h * 0.66} />
              </Animated.View>

              {/* Penanda nilai yang menempel di permukaan air */}
              <Animated.View style={[styles.surfaceTag, { transform: [{ translateY: surfaceY }] }]}>
                <View style={[styles.tagPill, { backgroundColor: statusColor }]}>
                  <Text style={styles.tagText}>{(level / 100).toFixed(2)} m</Text>
                </View>
              </Animated.View>

              {/* Garis ambang Waspada & Siaga */}
              <View style={[styles.thresholdRow, { top: yFor(mediumCm) }]} pointerEvents="none">
                <DashedLine color="#F59E0B" />
                <View style={[styles.thLabel, { backgroundColor: '#F59E0B' }]}>
                  <Text style={styles.thText}>WASPADA</Text>
                </View>
              </View>
              <View style={[styles.thresholdRow, { top: yFor(highCm) }]} pointerEvents="none">
                <DashedLine color="#EF4444" />
                <View style={[styles.thLabel, { backgroundColor: '#EF4444' }]}>
                  <Text style={styles.thText}>SIAGA</Text>
                </View>
              </View>
            </View>

            {/* Persentase kapasitas di pojok */}
            <View style={styles.pctBadge}>
              <Text style={styles.pctValue}>{pct}%</Text>
              <Text style={styles.pctLabel}>kapasitas</Text>
            </View>
          </>
        )}
      </View>

      <Text style={[styles.caption, { color: themeColors.textMuted }]}>
        Animasi real-time ketinggian air terhadap ambang Waspada & Siaga.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    padding: 16,
    marginBottom: 24,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 2,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  headerLeft: { flex: 1, paddingRight: 12 },
  title: { fontSize: 16, fontWeight: '800' },
  nodeName: { fontSize: 12, fontWeight: '500', marginTop: 2 },
  headerRight: { alignItems: 'flex-end' },
  levelValue: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  levelUnit: { fontSize: 13, fontWeight: '600' },
  riskPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginTop: 4 },
  riskDot: { width: 5, height: 5, borderRadius: 3, marginRight: 5 },
  riskText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },

  viz: { height: 220, borderRadius: 18, overflow: 'hidden', position: 'relative', backgroundColor: '#0A1424' },
  bgTop: { position: 'absolute', top: 0, left: 0, right: 0, height: '50%', backgroundColor: '#FFFFFF', opacity: 0.03 },

  ruler: { position: 'absolute', top: 0, left: 0, bottom: 0, width: RULER_W },
  tick: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center' },
  tickLabel: { color: '#64748B', fontSize: 9, fontWeight: '700', width: 22, textAlign: 'right', marginRight: 3 },
  tickMark: { flex: 1, height: 1, backgroundColor: '#FFFFFF', opacity: 0.08 },

  tank: { position: 'absolute', top: 0, right: 0, bottom: 0, overflow: 'hidden' },
  water: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  waveRow: { position: 'absolute', left: 0, flexDirection: 'row' },
  shine: { position: 'absolute', top: 2, left: 0, right: 0, height: 2 },
  crest: { position: 'absolute', top: 0, left: 0, right: 0, height: 1, opacity: 0.9 },
  depthShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%', backgroundColor: '#000000', opacity: 0.16 },
  bubble: { position: 'absolute', bottom: 6, backgroundColor: '#DBEAFE' },

  surfaceTag: { position: 'absolute', top: 0, right: 8 },
  tagPill: { marginTop: -12, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 3 },
  tagText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },

  thresholdRow: { position: 'absolute', left: 0, right: 0, height: 16, justifyContent: 'center' },
  dashWrap: { flexDirection: 'row', overflow: 'hidden', paddingRight: 70 },
  dashSeg: { width: 6, height: 2, marginRight: 4, borderRadius: 1, opacity: 0.85 },
  thLabel: { position: 'absolute', right: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  thText: { color: '#FFFFFF', fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },

  pctBadge: { position: 'absolute', top: 12, left: RULER_W + 10, backgroundColor: '#00000035', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, alignItems: 'flex-start' },
  pctValue: { color: '#FFFFFF', fontSize: 20, fontWeight: '900', letterSpacing: -0.5 },
  pctLabel: { color: '#CBD5E1', fontSize: 9, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: -2 },

  caption: { fontSize: 11, marginTop: 12, lineHeight: 16 },
});

export default RiverLevelVisual;
