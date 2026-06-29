import React, { useState, useRef, useCallback, useEffect, useMemo, useContext } from 'react';
import {
  View, StyleSheet, Text, TextInput, TouchableOpacity, StatusBar,
  PermissionsAndroid, Platform, ActivityIndicator, Alert, ScrollView, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import Icon from 'react-native-vector-icons/Ionicons';
import { getLocations, getLogs } from '../config/apiClient';
import { buildNodes } from '../config/nodes';
import { computeFloodedRoads } from '../config/roads';
import { GOOGLE_MAPS_API_KEY } from '../config/secrets';

// Mengambil Global State Theme
import { ThemeContext } from '../context/ThemeContext';

// Palet warna premium (Ultra-Clean Slate & Sky UI) - Light Mode
const LIGHT_COLORS = {
  background: '#F8FAFC',
  cardBg: '#FFFFFF',
  textMain: '#0F172A',
  textMuted: '#64748B',
  border: '#E2E8F0',
  primary: '#0EA5E9',
  safe: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
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
  shadow: '#000000',     
};

const FALLBACK_LOCATION = { latitude: -7.2950, longitude: 112.7920 };

// Interval polling AJAX untuk refresh status titik pantau secara live (ms)
const POLL_INTERVAL = 15000;
const GOOGLE_DIRECTIONS_KEY = GOOGLE_MAPS_API_KEY;

// Batasi rekomendasi pencarian hanya di sekitar Surabaya
const SURABAYA_CENTER = { latitude: -7.2575, longitude: 112.7521 };
const SEARCH_RADIUS_M = 30000;
const SURABAYA_VIEWBOX = '112.40,-6.90,113.10,-7.60';

const decodePolyline = (encoded) => {
  const pts = [];
  let i = 0, lat = 0, lng = 0;
  while (i < encoded.length) {
    let shift = 0, b, result = 0;
    do { b = encoded.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    pts.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return pts;
};

// Hitung sudut arah perjalanan (bearing) dari titik A ke titik B (0° = Utara)
const bearingBetween = (lat1, lon1, lat2, lon2) => {
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
};

const haversine = (lat1, lon1, lat2, lon2) => {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// Cari titik pantau berstatus SIAGA atau WASPADA yang dilewati sebuah rute.
const findHazardsNearRoute = (coords, nodes) => {
  const THRESHOLD = 100; // sensor dalam radius 100 m dari titik rute dianggap berbahaya
  return nodes.filter(n =>
    (n.status.risk === 'BAHAYA' || n.status.risk === 'WASPADA') &&
    coords.some(pt =>
      haversine(pt.latitude, pt.longitude, n.coordinates.latitude, n.coordinates.longitude) < THRESHOLD
    )
  );
};

// Tingkat bahaya rute: 'bahaya' (ada siaga), 'waspada', atau 'safe'.
const routeLevelFrom = (hazards) => {
  if (hazards.some(n => n.status.risk === 'BAHAYA')) return 'bahaya';
  if (hazards.some(n => n.status.risk === 'WASPADA')) return 'waspada';
  return 'safe';
};

// Bangun objek rute seragam dari koordinat + info jarak/durasi.
const buildRoute = (coords, distance, duration, nodes) => {
  const hazards = findHazardsNearRoute(coords, nodes);
  const level = routeLevelFrom(hazards);
  return { coords, distance, duration, hazards, level, isSafe: level === 'safe' };
};

const formatDistance = (meters) =>
  meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;

const formatDuration = (seconds) => {
  const min = Math.round(seconds / 60);
  return min >= 60 ? `${Math.floor(min / 60)}j ${min % 60}m` : `${min} menit`;
};

const requestLocationPermission = async () => {
  if (Platform.OS !== 'android') return true;
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    {
      title: 'Izin Lokasi',
      message: 'RiverEye membutuhkan akses lokasi untuk menampilkan rute.',
      buttonPositive: 'Izinkan',
      buttonNegative: 'Tolak',
    },
  );
  return result === PermissionsAndroid.RESULTS.GRANTED;
};

const fetchPlaceSuggestions = async (text) => {
  const [gResult, nResult] = await Promise.allSettled([
    fetch(
      `https://maps.googleapis.com/maps/api/place/autocomplete/json` +
      `?input=${encodeURIComponent(text)}` +
      `&key=${GOOGLE_DIRECTIONS_KEY}` +
      `&language=id` +
      `&components=country:id` +
      `&location=${SURABAYA_CENTER.latitude},${SURABAYA_CENTER.longitude}` +
      `&radius=${SEARCH_RADIUS_M}` +
      `&strictbounds=true`,
    ).then(r => r.json()),
    fetch(
      `https://nominatim.openstreetmap.org/search` +
      `?q=${encodeURIComponent(text)}&format=json&limit=7&countrycodes=id&accept-language=id&addressdetails=1&dedupe=1` +
      `&viewbox=${SURABAYA_VIEWBOX}&bounded=1`,
      { headers: { 'User-Agent': 'RiverEyeApp/1.0' } },
    ).then(r => r.json()),
  ]);

  const combined = [];

  if (gResult.status === 'fulfilled' && gResult.value.status === 'OK' && gResult.value.predictions?.length) {
    combined.push(...gResult.value.predictions.slice(0, 4));
  }

  if (nResult.status === 'fulfilled' && Array.isArray(nResult.value)) {
    const googleTexts = combined.map(s => (s.structured_formatting?.main_text || '').toLowerCase());
    for (const item of nResult.value) {
      const mainText = item.display_name.split(', ')[0];
      const mainLower = mainText.toLowerCase();
      if (googleTexts.some(g => g.includes(mainLower) || mainLower.includes(g))) continue;
      combined.push({
        place_id: String(item.place_id),
        structured_formatting: {
          main_text: mainText,
          secondary_text: item.display_name.split(', ').slice(1, 3).join(', '),
        },
        _lat: parseFloat(item.lat),
        _lon: parseFloat(item.lon),
      });
    }
  }

  return combined.slice(0, 7);
};

const ROUTE_LABELS = ['Rute Utama', 'Alternatif 1', 'Alternatif 2'];

// Split polyline rute menjadi segmen sudah dilewati (abu-abu) dan belum (berwarna).
const splitRouteAtPosition = (coords, userPos) => {
  if (!userPos || coords.length < 2) return { passed: [], ahead: [...coords] };
  let minDist = Infinity;
  let splitIdx = 0;
  coords.forEach((pt, i) => {
    const d = haversine(userPos.latitude, userPos.longitude, pt.latitude, pt.longitude);
    if (d < minDist) { minDist = d; splitIdx = i; }
  });
  return {
    passed: splitIdx > 0 ? coords.slice(0, splitIdx + 1) : [],
    ahead: coords.slice(Math.max(0, splitIdx)),
  };
};

// Zoom adaptif berdasarkan jarak ke belokan berikutnya.
const calcNavZoom = (distToTurnM) => {
  if (distToTurnM < 60) return 19;
  if (distToTurnM < 200) return 18;
  if (distToTurnM < 600) return 17;
  return 16;
};

// Peta jenis manuver Google Directions ke Ionicons
const maneuverIcon = (maneuver = '') => {
  if (maneuver.includes('uturn')) return 'return-down-back';
  if (maneuver.includes('roundabout')) return 'refresh-circle-outline';
  if (maneuver.includes('left')) return 'arrow-back';
  if (maneuver.includes('right')) return 'arrow-forward';
  if (maneuver === 'merge') return 'git-merge-outline';
  if (maneuver === 'ferry') return 'boat-outline';
  return 'arrow-up';
};

const MapScreen = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const mapRef = useRef(null);
  const userLocationRef = useRef(null);
  const searchTimerRef = useRef(null);
  const originTimerRef = useRef(null);

  // MENGGUNAKAN GLOBAL THEME CONTEXT
  const { isDarkMode } = useContext(ThemeContext);
  const themeColors = isDarkMode ? DARK_COLORS : LIGHT_COLORS;
  
  const styles = useMemo(() => getStyles(themeColors, isDarkMode), [themeColors, isDarkMode]);
  const routeColors = useMemo(() => [themeColors.primary, themeColors.safe, '#8B5CF6'], [themeColors]);

  const [nodes, setNodes] = useState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [isRoutingMode, setIsRoutingMode] = useState(false);
  const [origin, setOrigin] = useState(null);
  const [destination, setDestination] = useState(null);

  const [allRoutes, setAllRoutes] = useState([]);
  const [activeRouteIdx, setActiveRouteIdx] = useState(0);
  const [showWarningCard, setShowWarningCard] = useState(false);
  const [allRoutesDangerous, setAllRoutesDangerous] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [navStepIdx, setNavStepIdx] = useState(0);
  const [navRemaining, setNavRemaining] = useState(null);
  const [navPosition, setNavPosition] = useState(null);
  const [navHeading, setNavHeading] = useState(0);
  const prevNavPositionRef = useRef(null);

  // Kamera navigasi third-person
  const [isCameraFollowing, setIsCameraFollowing] = useState(true);
  const isCameraFollowingRef = useRef(true);
  const navHeadingRef = useRef(0);

  // Route split: segmen dilewati (abu) vs di depan (berwarna)
  const [passedCoords, setPassedCoords] = useState([]);
  const [aheadCoords, setAheadCoords] = useState([]);

  // Dynamic re-routing
  const prevRouteHazardCountRef = useRef(0);
  const isReroutingRef = useRef(false);
  const destinationRef = useRef(null);

  // Sensor BAHAYA/WASPADA dalam radius 100 m dari posisi user
  const [nearbyHazards, setNearbyHazards] = useState([]);
  const nodesRef = useRef([]);
  const lastProximityCheckRef = useRef(0);

  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const [isLoadingRoute, setIsLoadingRoute] = useState(false);
  const [gpsFailed, setGpsFailed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [originQuery, setOriginQuery] = useState('');
  const [originSuggestions, setOriginSuggestions] = useState([]);
  const [isSearchingOrigin, setIsSearchingOrigin] = useState(false);

  // Ruas jalan banjir (>=2 titik siaga) + geometri jalan hasil snap Directions.
  const [floodRoadPaths, setFloodRoadPaths] = useState([]);
  const floodedRoads = useMemo(() => computeFloodedRoads(nodes), [nodes]);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { destinationRef.current = destination; }, [destination]);

  const dangerCount = nodes.filter(n => n.status.risk === 'BAHAYA' || n.status.risk === 'WASPADA').length;
  const activeRoute = allRoutes[activeRouteIdx] ?? null;

  // Warna & label menurut tingkat bahaya rute.
  const levelColor = useCallback((lvl) =>
    lvl === 'bahaya' ? themeColors.danger : lvl === 'waspada' ? themeColors.warning : themeColors.safe,
  [themeColors]);
  const levelLabel = (lvl) => (lvl === 'bahaya' ? 'Bahaya' : lvl === 'waspada' ? 'Waspada' : 'Aman');

  useEffect(() => {
    StatusBar.setBarStyle(isDarkMode ? 'light-content' : 'dark-content');
    if (Platform.OS === 'android') {
      // Untuk MapScreen, kita ingin status bar transparan agar peta terlihat penuh
      StatusBar.setBackgroundColor('transparent');
      StatusBar.setTranslucent(true);
    }
  }, [isDarkMode]);

  useEffect(() => {
    let active = true;
    // silent = true (polling) mempertahankan data lama jika request gagal
    const loadNodes = async (silent = false) => {
      try {
        const [locations, logs] = await Promise.all([getLocations(), getLogs()]);
        if (active) setNodes(buildNodes(locations || [], logs || []));
      } catch {
        if (active && !silent) setNodes([]);
      }
    };
    loadNodes();
    // Polling AJAX: refresh status titik pantau secara live tiap POLL_INTERVAL
    const timer = setInterval(() => loadNodes(true), POLL_INTERVAL);
    return () => { active = false; clearInterval(timer); };
  }, []);

  // Snap tiap ruas jalan banjir ke geometri jalan asli (fallback: garis lurus antar titik).
  useEffect(() => {
    let active = true;
    (async () => {
      if (!floodedRoads.length) { setFloodRoadPaths([]); return; }
      const results = await Promise.all(floodedRoads.map(async (road) => {
        const fallback = { key: road.key, name: road.name, coords: road.path, nodes: road.nodes };
        try {
          const pts = road.path;
          const start = pts[0];
          const end = pts[pts.length - 1];
          const mid = pts.slice(1, -1);
          const waypoints = mid.length ? `&waypoints=${mid.map(p => `${p.latitude},${p.longitude}`).join('|')}` : '';
          const res = await fetch(
            `https://maps.googleapis.com/maps/api/directions/json` +
            `?origin=${start.latitude},${start.longitude}` +
            `&destination=${end.latitude},${end.longitude}` +
            waypoints +
            `&key=${GOOGLE_DIRECTIONS_KEY}`,
          );
          const data = await res.json();
          if (data.status === 'OK' && data.routes?.length) {
            return { ...fallback, coords: decodePolyline(data.routes[0].overview_polyline.points) };
          }
        } catch { }
        return fallback;
      }));
      if (active) setFloodRoadPaths(results);
    })();
    return () => { active = false; };
  }, [floodedRoads]);

  const handleUserLocationChange = useCallback((event) => {
    const { coordinate } = event.nativeEvent;
    if (!coordinate) return;
    userLocationRef.current = { latitude: coordinate.latitude, longitude: coordinate.longitude };

    // Cek proximity sensor bahaya — throttle 5 detik agar tidak boros render
    const now = Date.now();
    if (now - lastProximityCheckRef.current < 5000) return;
    lastProximityCheckRef.current = now;

    const nearby = nodesRef.current.filter(n =>
      (n.status.risk === 'BAHAYA' || n.status.risk === 'WASPADA') &&
      haversine(coordinate.latitude, coordinate.longitude, n.coordinates.latitude, n.coordinates.longitude) < 100
    );
    setNearbyHazards(nearby);
  }, []);

  // Tracking posisi, heading, kamera third-person, dan langkah navigasi setiap 3 detik
  useEffect(() => {
    if (!isNavigating || !activeRoute) return;
    const tick = () => {
      const loc = userLocationRef.current;
      if (!loc) return;

      // Hitung heading dari posisi sebelumnya (hanya jika bergerak >5m, hindari noise GPS)
      let currentHeading = navHeadingRef.current;
      if (prevNavPositionRef.current) {
        const prev = prevNavPositionRef.current;
        const moved = haversine(prev.latitude, prev.longitude, loc.latitude, loc.longitude);
        if (moved > 5) {
          currentHeading = bearingBetween(prev.latitude, prev.longitude, loc.latitude, loc.longitude);
          navHeadingRef.current = currentHeading;
          setNavHeading(currentHeading);
        }
      }
      prevNavPositionRef.current = loc;
      setNavPosition({ ...loc });

      // Hitung jarak ke belokan berikutnya untuk adaptive zoom
      const step = activeRoute.steps?.[navStepIdx];
      const distToTurn = step
        ? haversine(loc.latitude, loc.longitude, step.endLat, step.endLng)
        : Infinity;
      const zoom = calcNavZoom(distToTurn);

      // Kamera third-person: pitch 55°, berotasi mengikuti heading, zoom adaptif
      if (isCameraFollowingRef.current) {
        mapRef.current?.animateCamera({
          center: { latitude: loc.latitude, longitude: loc.longitude },
          pitch: 55,
          heading: currentHeading,
          zoom,
          altitude: zoom === 19 ? 80 : zoom === 18 ? 150 : zoom === 17 ? 300 : 600,
        }, { duration: 1000 });
      }

      // Split rute: bagian sudah dilewati (abu) vs belum (berwarna)
      if (activeRoute.coords?.length) {
        const { passed, ahead } = splitRouteAtPosition(activeRoute.coords, loc);
        setPassedCoords(passed);
        setAheadCoords(ahead);
      }

      // Majukan langkah jika sudah dekat titik akhir langkah saat ini (<40 m)
      if (step) {
        if (distToTurn < 40 && navStepIdx < (activeRoute.steps?.length ?? 0) - 1) {
          setNavStepIdx(prev => prev + 1);
          console.log(`[nav] Maju ke langkah ${navStepIdx + 1}: ${activeRoute.steps[navStepIdx + 1]?.instruction}`);
        }
      }

      // Update sisa jarak ke tujuan
      const dest = activeRoute.coords[activeRoute.coords.length - 1];
      if (dest) {
        const rem = haversine(loc.latitude, loc.longitude, dest.latitude, dest.longitude);
        setNavRemaining({ distance: formatDistance(rem) });
      }
    };
    tick();
    const interval = setInterval(tick, 3000);
    return () => clearInterval(interval);
  }, [isNavigating, activeRoute, navStepIdx]);

  const waitForUserLocation = useCallback((timeoutMs = 12000) =>
    new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        if (userLocationRef.current) { resolve(userLocationRef.current); return; }
        if (Date.now() - start >= timeoutMs) { resolve(null); return; }
        setTimeout(tick, 300);
      };
      tick();
    }), []);

  const resetRouteState = useCallback(() => {
    setAllRoutes([]);
    setActiveRouteIdx(0);
    setShowWarningCard(false);
    setAllRoutesDangerous(false);
    setDestination(null);
    setIsNavigating(false);
    setNavStepIdx(0);
    setNavRemaining(null);
  }, []);

  const startNavigation = useCallback(() => {
    setIsNavigating(true);
    setNavStepIdx(0);
    setNavRemaining(null);
    setIsCameraFollowing(true);
    isCameraFollowingRef.current = true;
    navHeadingRef.current = 0;
    setPassedCoords([]);
    setAheadCoords(activeRoute?.coords ?? []);
    // Seed jumlah hazard BAHAYA saat rute dimulai agar re-routing hanya terpicu saat ada yang baru
    prevRouteHazardCountRef.current = activeRoute
      ? findHazardsNearRoute(activeRoute.coords, nodesRef.current).filter(n => n.status.risk === 'BAHAYA').length
      : 0;
    console.log(`[nav] Navigasi dimulai — ${activeRoute?.steps?.length ?? 0} langkah, hazard awal: ${prevRouteHazardCountRef.current}`);
    const loc = userLocationRef.current;
    if (loc) {
      mapRef.current?.animateCamera({
        center: { latitude: loc.latitude, longitude: loc.longitude },
        pitch: 55, heading: 0, zoom: 17, altitude: 300,
      }, { duration: 800 });
    }
  }, [activeRoute]);

  const stopNavigation = useCallback(() => {
    setIsNavigating(false);
    setNavStepIdx(0);
    setNavRemaining(null);
    setNavPosition(null);
    setNavHeading(0);
    setIsCameraFollowing(true);
    isCameraFollowingRef.current = true;
    navHeadingRef.current = 0;
    setPassedCoords([]);
    setAheadCoords([]);
    prevNavPositionRef.current = null;
    prevRouteHazardCountRef.current = 0;
    isReroutingRef.current = false;
    // Kembalikan kamera ke top-down setelah navigasi selesai
    mapRef.current?.animateCamera({ pitch: 0, heading: 0 }, { duration: 600 });
  }, []);

  const activateRouting = useCallback(async () => {
    setIsRoutingMode(true);
    resetRouteState();
    setSearchQuery('');
    setSuggestions([]);
    setOriginQuery('');
    setOriginSuggestions([]);
    setIsLoadingLocation(true);
    setSelectedNode(null);

    setGpsFailed(false);
    const granted = await requestLocationPermission();
    const loc = granted ? await waitForUserLocation() : null;
    if (loc) {
      setOrigin(loc);
      setOriginQuery('Lokasi GPS Anda');
    } else {
      setOrigin(FALLBACK_LOCATION);
      setOriginQuery('Lokasi default — ketik lokasi awal');
      setGpsFailed(true);
    }
    setIsLoadingLocation(false);
  }, [resetRouteState, waitForUserLocation]);

  // Fetch rute dari Google Directions (+ fallback OSRM), filter & sort.
  // Dipakai oleh selectSuggestion dan rerouteToDestination.
  const fetchAndFilterRoutes = useCallback(async (originCoord, destCoord) => {
    let parsed = null;

    try {
      const gRes = await fetch(
        `https://maps.googleapis.com/maps/api/directions/json` +
        `?origin=${originCoord.latitude},${originCoord.longitude}` +
        `&destination=${destCoord.latitude},${destCoord.longitude}` +
        `&alternatives=true&key=${GOOGLE_DIRECTIONS_KEY}`,
      );
      const gData = await gRes.json();
      if (gData.status === 'OK' && gData.routes?.length) {
        parsed = gData.routes.slice(0, 3).map(r => {
          const coords = r.legs.flatMap(leg =>
            leg.steps.flatMap(step => decodePolyline(step.polyline.points))
          );
          const leg = r.legs[0];
          const steps = r.legs.flatMap(l =>
            l.steps.map(s => ({
              instruction: s.html_instructions.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
              distance: formatDistance(s.distance.value),
              maneuver: s.maneuver || 'straight',
              endLat: s.end_location.lat,
              endLng: s.end_location.lng,
            }))
          );
          return { ...buildRoute(coords, formatDistance(leg.distance.value), formatDuration(leg.duration.value), nodesRef.current), steps };
        });
        console.log(`[routing] Google Directions: ${parsed.length} rute ditemukan`);
      }
    } catch (e) {
      console.warn('[routing] Google Directions gagal, coba OSRM:', e.message);
    }

    if (!parsed) {
      const oRes = await fetch(
        `https://router.project-osrm.org/route/v1/driving/` +
        `${originCoord.longitude},${originCoord.latitude};${destCoord.longitude},${destCoord.latitude}` +
        `?overview=full&geometries=polyline&alternatives=2`,
      );
      const oData = await oRes.json();
      if (oData.code !== 'Ok' || !oData.routes?.length) throw new Error(`OSRM: ${oData.code}`);
      parsed = oData.routes.slice(0, 3).map(r => {
        const coords = decodePolyline(r.geometry);
        return buildRoute(coords, formatDistance(r.distance), formatDuration(r.duration), nodesRef.current);
      });
      console.log(`[routing] OSRM fallback: ${parsed.length} rute ditemukan`);
    }

    // Log keputusan per rute
    parsed.forEach((r, i) => {
      const hazardNames = r.hazards.map(h => `${h.name}(${h.status.risk})`).join(', ');
      console.log(`[routing] Rute ${i + 1}: level=${r.level}, ${r.distance}, ${r.duration}${hazardNames ? `, hazard: ${hazardNames}` : ', bersih'}`);
    });

    // Hard-exclude BAHAYA — titik siaga tidak pernah dimasukkan kecuali tidak ada jalan lain
    const ruteAman = parsed.filter(r => r.level !== 'bahaya');
    const semuaBahaya = ruteAman.length === 0;

    if (semuaBahaya) {
      console.warn('[routing] FALLBACK: semua rute melewati titik BAHAYA — menampilkan semua dengan peringatan keras');
    } else {
      const dihindari = parsed.length - ruteAman.length;
      if (dihindari > 0) console.log(`[routing] ${dihindari} rute dihapus karena melewati BAHAYA`);
    }

    // Sort: aman > waspada > bahaya (WASPADA diberi bobot lebih tinggi tapi tetap dipakai jika tidak ada alternatif)
    const ORDER = { safe: 0, waspada: 1, bahaya: 2 };
    const ruteFinal = (semuaBahaya ? parsed : ruteAman)
      .sort((a, b) => (ORDER[a.level] ?? 0) - (ORDER[b.level] ?? 0));

    console.log(`[routing] Rute final: ${ruteFinal.length} pilihan — pilihan terbaik: ${ruteFinal[0]?.level}`);
    return { routes: ruteFinal, semuaBahaya };
  }, []);

  const cancelRouting = useCallback(() => {
    setIsRoutingMode(false);
    resetRouteState();
    setOrigin(null);
    setOriginQuery('');
    setOriginSuggestions([]);
    setSearchQuery('');
    setSuggestions([]);
    clearTimeout(searchTimerRef.current);
    clearTimeout(originTimerRef.current);
  }, [resetRouteState]);

  const searchPlaces = useCallback(async (text) => {
    if (text.length < 3) { setSuggestions([]); return; }
    setIsSearching(true);
    try {
      setSuggestions(await fetchPlaceSuggestions(text));
    } catch {
      setSuggestions([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const handleSearchChange = useCallback((text) => {
    setSearchQuery(text);
    resetRouteState();
    clearTimeout(searchTimerRef.current);
    if (text.length >= 3) {
      searchTimerRef.current = setTimeout(() => searchPlaces(text), 500);
    } else {
      setSuggestions([]);
    }
  }, [searchPlaces, resetRouteState]);

  const selectSuggestion = useCallback(async (suggestion) => {
    if (!origin) {
      Alert.alert('Lokasi Awal', 'Silakan tentukan lokasi awal terlebih dahulu.');
      return;
    }
    setSuggestions([]);
    const mainText = suggestion.structured_formatting?.main_text || suggestion.description;
    setSearchQuery(mainText);
    setIsLoadingRoute(true);
    resetRouteState();

    try {
      let destCoord;
      if (suggestion._lat !== undefined) {
        destCoord = { latitude: suggestion._lat, longitude: suggestion._lon };
      } else {
        const detailRes = await fetch(
          `https://maps.googleapis.com/maps/api/place/details/json` +
          `?place_id=${suggestion.place_id}&fields=geometry&key=${GOOGLE_DIRECTIONS_KEY}`,
        );
        const detailData = await detailRes.json();
        if (detailData.status !== 'OK') throw new Error(detailData.status);
        const { lat, lng } = detailData.result.geometry.location;
        destCoord = { latitude: lat, longitude: lng };
      }
      setDestination({ name: mainText, coordinates: destCoord });

      console.log(`[routing] Menghitung rute: ${origin.latitude.toFixed(5)},${origin.longitude.toFixed(5)} → ${destCoord.latitude.toFixed(5)},${destCoord.longitude.toFixed(5)}`);
      const { routes: ruteFinal, semuaBahaya } = await fetchAndFilterRoutes(origin, destCoord);

      setAllRoutesDangerous(semuaBahaya);
      setAllRoutes(ruteFinal);
      setActiveRouteIdx(0);
      setShowWarningCard(true);

      mapRef.current?.fitToCoordinates(ruteFinal[0].coords, {
        edgePadding: { top: 260, right: 40, bottom: 200, left: 40 },
        animated: true,
      });
    } catch {
      Alert.alert('Gagal', 'Tidak dapat menghitung rute. Periksa koneksi internet.');
      setDestination(null);
      setSearchQuery('');
    } finally {
      setIsLoadingRoute(false);
    }
  }, [origin, resetRouteState, fetchAndFilterRoutes]);

  // Re-routing dari posisi saat ini ke tujuan yang sama (dipanggil saat sensor berubah)
  const rerouteToDestination = useCallback(async (originCoord, dest) => {
    if (isReroutingRef.current || !dest) return;
    isReroutingRef.current = true;
    console.log('[routing] Memulai kalkulasi ulang rute dari posisi saat ini...');
    stopNavigation();
    setIsLoadingRoute(true);
    setDestination(dest);
    setSearchQuery(dest.name);

    try {
      const { routes: ruteFinal, semuaBahaya } = await fetchAndFilterRoutes(originCoord, dest.coordinates);
      setAllRoutesDangerous(semuaBahaya);
      setAllRoutes(ruteFinal);
      setActiveRouteIdx(0);
      setShowWarningCard(true);
      mapRef.current?.fitToCoordinates(ruteFinal[0].coords, {
        edgePadding: { top: 260, right: 40, bottom: 200, left: 40 },
        animated: true,
      });
      console.log(`[routing] Rute ulang selesai — ${ruteFinal.length} pilihan, level terbaik: ${ruteFinal[0]?.level}`);
    } catch (e) {
      console.error('[routing] Kalkulasi ulang gagal:', e.message);
      Alert.alert('Re-routing Gagal', 'Tidak dapat menghitung rute alternatif. Coba cari rute ulang secara manual.');
    } finally {
      setIsLoadingRoute(false);
      isReroutingRef.current = false;
    }
  }, [stopNavigation, fetchAndFilterRoutes]);

  // Dynamic re-routing: pantau perubahan sensor saat navigasi aktif
  useEffect(() => {
    if (!isNavigating || !activeRoute) return;

    const bahayaHazards = findHazardsNearRoute(activeRoute.coords, nodes)
      .filter(n => n.status.risk === 'BAHAYA');
    const count = bahayaHazards.length;

    if (count > prevRouteHazardCountRef.current) {
      const newNames = bahayaHazards.map(n => n.name).join(', ');
      console.warn(`[routing] ⚠️ Bahaya BARU pada rute aktif (${count} titik): ${newNames} — memicu re-routing`);
      prevRouteHazardCountRef.current = count;

      const loc = userLocationRef.current;
      const dest = destinationRef.current;

      Alert.alert(
        '⚠️ Bahaya Terdeteksi di Rute',
        `Sensor mendeteksi titik BAHAYA baru:\n${newNames}\n\nMenghitung ulang rute yang aman...`,
        [{
          text: 'OK',
          onPress: () => {
            if (loc && dest) rerouteToDestination(loc, dest);
          },
        }],
      );
    } else {
      prevRouteHazardCountRef.current = count;
    }
  }, [nodes, isNavigating, activeRoute, rerouteToDestination]);

  const searchOriginPlaces = useCallback(async (text) => {
    if (text.length < 3) { setOriginSuggestions([]); return; }
    setIsSearchingOrigin(true);
    try {
      setOriginSuggestions(await fetchPlaceSuggestions(text));
    } catch {
      setOriginSuggestions([]);
    } finally {
      setIsSearchingOrigin(false);
    }
  }, []);

  const handleOriginChange = useCallback((text) => {
    setOriginQuery(text);
    setOrigin(null);
    resetRouteState();
    clearTimeout(originTimerRef.current);
    if (text.length >= 3) {
      originTimerRef.current = setTimeout(() => searchOriginPlaces(text), 500);
    } else {
      setOriginSuggestions([]);
    }
  }, [searchOriginPlaces, resetRouteState]);

  const selectOriginSuggestion = useCallback(async (suggestion) => {
    setOriginSuggestions([]);
    const mainText = suggestion.structured_formatting?.main_text || suggestion.description;
    setOriginQuery(mainText);
    setIsLoadingLocation(true);
    try {
      let coords;
      if (suggestion._lat !== undefined) {
        coords = { latitude: suggestion._lat, longitude: suggestion._lon };
      } else {
        const detailRes = await fetch(
          `https://maps.googleapis.com/maps/api/place/details/json` +
          `?place_id=${suggestion.place_id}&fields=geometry&key=${GOOGLE_DIRECTIONS_KEY}`,
        );
        const detailData = await detailRes.json();
        if (detailData.status !== 'OK') throw new Error(detailData.status);
        const { lat, lng } = detailData.result.geometry.location;
        coords = { latitude: lat, longitude: lng };
      }
      setOrigin(coords);
    } catch {
      Alert.alert('Gagal', 'Tidak dapat mengambil koordinat lokasi awal.');
      setOriginQuery('');
    } finally {
      setIsLoadingLocation(false);
    }
  }, []);

  const retriggerGPS = useCallback(async () => {
    setIsLoadingLocation(true);
    setOrigin(null);
    setOriginQuery('');
    setOriginSuggestions([]);
    resetRouteState();
    setGpsFailed(false);
    const granted = await requestLocationPermission();
    const loc = granted ? await waitForUserLocation() : null;
    if (loc) {
      setOrigin(loc);
      setOriginQuery('Lokasi GPS Anda');
    } else {
      setOrigin(FALLBACK_LOCATION);
      setOriginQuery('Lokasi default — ketik lokasi awal');
      setGpsFailed(true);
    }
    setIsLoadingLocation(false);
  }, [resetRouteState, waitForUserLocation]);

  const enableLocation = useCallback(async () => {
    if (Platform.OS !== 'android') { retriggerGPS(); return; }
    const status = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      {
        title: 'Izin Lokasi',
        message: 'RiverEye membutuhkan akses lokasi untuk menampilkan rute.',
        buttonPositive: 'Izinkan',
        buttonNegative: 'Tolak',
      },
    );
    if (status === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
      Alert.alert(
        'Izin Lokasi Diblokir',
        'Buka Pengaturan untuk mengizinkan akses lokasi aplikasi.',
        [
          { text: 'Batal', style: 'cancel' },
          { text: 'Buka Pengaturan', onPress: () => Linking.openSettings() },
        ],
      );
      return;
    }
    if (status !== PermissionsAndroid.RESULTS.GRANTED) return;
    retriggerGPS();
  }, [retriggerGPS]);

  const openDeviceLocationSettings = useCallback(() => {
    Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS').catch(() => Linking.openSettings());
  }, []);

  const handleSelectRoute = useCallback((idx) => {
    setActiveRouteIdx(idx);
    if (allRoutes[idx]) {
      mapRef.current?.fitToCoordinates(allRoutes[idx].coords, {
        edgePadding: { top: 260, right: 40, bottom: 200, left: 40 },
        animated: true,
      });
    }
  }, [allRoutes]);

  const openInGoogleMaps = useCallback(() => {
    if (!origin || !destination) return;
    const url =
      `https://www.google.com/maps/dir/?api=1` +
      `&origin=${origin.latitude},${origin.longitude}` +
      `&destination=${destination.coordinates.latitude},${destination.coordinates.longitude}` +
      `&travelmode=driving`;
    Linking.openURL(url).catch(() =>
      Alert.alert('Gagal', 'Tidak dapat membuka Google Maps.'),
    );
  }, [origin, destination]);

  const handleMarkerPress = (node) => {
    if (isRoutingMode) return;
    setSelectedNode(node);
    mapRef.current?.animateToRegion({
      ...node.coordinates,
      latitude: node.coordinates.latitude - 0.005,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    }, 500);
  };

  const handleOpenCCTV = (node) => navigation.navigate('Kamera', { nodeId: node.id, nodeName: node.name, cctvUrl: node.cctvUrl });
  const handleOpenHistory = (node) => navigation.navigate('Riwayat', { nodeId: node.id, nodeName: node.name });

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={{ latitude: -7.2800, longitude: 112.7950, latitudeDelta: 0.04, longitudeDelta: 0.04 }}
        customMapStyle={isDarkMode ? mapDarkStyle : mapLightStyle}
        showsUserLocation
        showsMyLocationButton={false}
        onUserLocationChange={handleUserLocationChange}
        onPress={() => { if (!isRoutingMode) setSelectedNode(null); }}
        onPanDrag={() => {
          if (isNavigating && isCameraFollowingRef.current) {
            isCameraFollowingRef.current = false;
            setIsCameraFollowing(false);
          }
        }}
      >
        {/* Overlay merah untuk ruas jalan banjir (>=2 titik siaga) */}
        {floodRoadPaths.map((road) => {
          const mid = road.coords[Math.floor(road.coords.length / 2)];
          return (
            <React.Fragment key={`flood-${road.key}`}>
              <Polyline coordinates={road.coords} strokeColor="rgba(239,68,68,0.45)" strokeWidth={14} lineCap="round" />
              <Polyline coordinates={road.coords} strokeColor="#EF4444" strokeWidth={5} lineCap="round" />
              {mid && (
                <Marker coordinate={mid} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
                  <View style={styles.floodTag}>
                    <Icon name="warning" size={11} color="#FFFFFF" />
                    <Text style={styles.floodTagText}>JALAN BANJIR</Text>
                  </View>
                </Marker>
              )}
            </React.Fragment>
          );
        })}

        {nodes.map((node) => (
          <Marker
            key={node.id}
            coordinate={node.coordinates}
            onPress={(e) => { e.stopPropagation(); handleMarkerPress(node); }}
          >
            <View style={[styles.customMarker, { backgroundColor: node.status.color + '33', borderColor: node.status.color + '66' }]}>
              {/* Alat kecil (sensor biner) ditandai kotak, sensor air ditandai bulat */}
              <View style={[styles.markerInner, node.isBinary && styles.markerInnerBinary, { backgroundColor: node.status.color }]} />
            </View>
          </Marker>
        ))}

        {origin && (
          <Marker coordinate={origin} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.originMarker}>
              <View style={styles.originDot} />
            </View>
          </Marker>
        )}

        {/* Panah navigasi — bergerak & berotasi mengikuti arah perjalanan */}
        {isNavigating && navPosition && (
          <Marker
            coordinate={navPosition}
            anchor={{ x: 0.5, y: 0.5 }}
            rotation={navHeading}
            flat
            tracksViewChanges
          >
            <View style={styles.navArrowOuter}>
              <View style={styles.navArrowCircle}>
                <Icon name="navigate" size={20} color="#FFFFFF" />
              </View>
            </View>
          </Marker>
        )}

        {destination && (
          <Marker coordinate={destination.coordinates} anchor={{ x: 0.5, y: 1 }}>
            <View style={styles.destMarkerWrapper}>
              <View style={[styles.destMarker, { backgroundColor: themeColors.primary }]}>
                <Icon name="location" size={18} color="#FFFFFF" />
              </View>
            </View>
          </Marker>
        )}

        {/* Rute alternatif (tidak aktif) */}
        {allRoutes.map((route, idx) => idx !== activeRouteIdx && (
          <Polyline
            key={`route-${idx}`}
            coordinates={route.coords}
            strokeColor={route.isSafe ? routeColors[idx] + 'AA' : levelColor(route.level) + '88'}
            strokeWidth={3}
            lineDashPattern={route.isSafe ? undefined : [10, 6]}
          />
        ))}

        {/* Rute aktif — split: sudah dilewati (abu) + belum (berwarna tebal) */}
        {activeRoute && !isNavigating && (
          <Polyline
            key="route-active"
            coordinates={activeRoute.coords}
            strokeColor={activeRoute.isSafe ? routeColors[activeRouteIdx] : levelColor(activeRoute.level)}
            strokeWidth={5}
            lineDashPattern={activeRoute.isSafe ? undefined : [10, 6]}
          />
        )}
        {activeRoute && isNavigating && passedCoords.length > 1 && (
          <Polyline
            key="route-passed"
            coordinates={passedCoords}
            strokeColor="rgba(150,150,150,0.55)"
            strokeWidth={5}
          />
        )}
        {activeRoute && isNavigating && aheadCoords.length > 1 && (
          <Polyline
            key="route-ahead"
            coordinates={aheadCoords}
            strokeColor={activeRoute.isSafe ? routeColors[activeRouteIdx] : levelColor(activeRoute.level)}
            strokeWidth={7}
            lineDashPattern={activeRoute.isSafe ? undefined : [10, 6]}
          />
        )}

        {/* Marker hazard di sepanjang rute aktif saat navigasi */}
        {isNavigating && activeRoute?.hazards?.map(node => (
          <Marker
            key={`hazard-nav-${node.id}`}
            coordinate={node.coordinates}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
          >
            <View style={[
              styles.hazardNavMarker,
              { backgroundColor: node.status.risk === 'BAHAYA' ? themeColors.danger : themeColors.warning },
            ]}>
              <Icon name="warning" size={12} color="#FFFFFF" />
            </View>
          </Marker>
        ))}
      </MapView>

      {/* Navigation Instruction Card — tampil saat navigasi aktif */}
      {isNavigating && (
        <View style={[styles.navInstructionCard, { paddingTop: insets.top + 12 }]}>
          <View style={styles.navInstructionInner}>
            <View style={[styles.navIconCircle, { backgroundColor: themeColors.primary }]}>
              <Icon name={maneuverIcon(activeRoute?.steps?.[navStepIdx]?.maneuver)} size={24} color="#FFFFFF" />
            </View>
            <View style={styles.navInstructionText}>
              <Text style={styles.navInstruction} numberOfLines={2}>
                {activeRoute?.steps?.[navStepIdx]?.instruction || 'Ikuti rute yang ditampilkan'}
              </Text>
              <Text style={styles.navStepDist}>
                {activeRoute?.steps?.[navStepIdx]?.distance || ''}
                {activeRoute?.steps?.[navStepIdx + 1]
                  ? `  ·  Lalu: ${activeRoute.steps[navStepIdx + 1].instruction}`
                  : ''}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Panel Routing Atas — sembunyi saat navigasi */}
      {!isNavigating && <View style={[styles.headerWrapper, { paddingTop: insets.top }]} pointerEvents="box-none">
        <View style={styles.routingCard}>
          <View style={styles.routingHeader}>
            <Text style={styles.routingTitle}>Smart Routing Bencana</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              {/* Tombol Theme Toggle DIHAPUS DARI SINI KARENA PINDAH KE DASHBOARD */}
              {!isRoutingMode ? (
                <TouchableOpacity style={styles.routeToggleBtn} onPress={activateRouting}>
                  <Text style={styles.routeToggleText}>Cari Rute Aman</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={[styles.routeToggleBtn, styles.routeToggleCancel]} onPress={cancelRouting}>
                  <Text style={[styles.routeToggleText, { color: '#FFF' }]}>Batalkan</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {isRoutingMode && (
            <View style={styles.routeInputContainer}>
              <View style={styles.routeInputRow}>
                <View style={styles.originDotSmall} />
                <TextInput
                  style={styles.destTextInput}
                  placeholder={isLoadingLocation ? 'Memuat lokasi GPS...' : 'Ketik lokasi awal...'}
                  placeholderTextColor={themeColors.textMuted}
                  value={originQuery}
                  onChangeText={handleOriginChange}
                  editable={!isLoadingLocation}
                  returnKeyType="search"
                />
                {isLoadingLocation
                  ? <ActivityIndicator size="small" color={themeColors.primary} style={{ marginLeft: 8 }} />
                  : isSearchingOrigin
                    ? <ActivityIndicator size="small" color={themeColors.textMuted} style={{ marginLeft: 8 }} />
                    : (
                      <TouchableOpacity onPress={retriggerGPS} style={styles.gpsChip}>
                        <Icon name="locate" size={11} color={themeColors.primary} />
                        <Text style={styles.gpsChipText}>GPS</Text>
                      </TouchableOpacity>
                    )
                }
              </View>

              {originSuggestions.length > 0 && (
                <View style={styles.suggestionBox}>
                  {originSuggestions.slice(0, 7).map((item, idx) => {
                    const main = item.structured_formatting?.main_text || item.description;
                    const sub = item.structured_formatting?.secondary_text || '';
                    return (
                      <TouchableOpacity
                        key={item.place_id ?? idx}
                        style={[styles.suggestionItem, idx === Math.min(originSuggestions.length, 7) - 1 && { borderBottomWidth: 0 }]}
                        onPress={() => selectOriginSuggestion(item)}
                        activeOpacity={0.7}
                      >
                        <View style={styles.suggestionMainRow}>
                          <Icon name={item._lat !== undefined ? 'location-outline' : 'search-outline'} size={13} color={themeColors.textMuted} />
                          <Text style={styles.suggestionMain} numberOfLines={1}>{main}</Text>
                        </View>
                        <Text style={styles.suggestionSub} numberOfLines={1}>
                          {sub}{item._lat === undefined ? '  · Google Maps' : ''}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {gpsFailed && !isLoadingLocation && (
                <View style={styles.gpsBanner}>
                  <View style={styles.gpsBannerTextRow}>
                    <Icon name="warning-outline" size={14} color={themeColors.textMain} />
                    <Text style={styles.gpsBannerText}>Lokasi GPS tidak aktif atau ditolak.</Text>
                  </View>
                  <View style={styles.gpsBannerActions}>
                    <TouchableOpacity style={styles.gpsBannerBtn} onPress={enableLocation} activeOpacity={0.8}>
                      <Text style={styles.gpsBannerBtnText}>Izinkan Lokasi</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.gpsBannerBtn, styles.gpsBannerBtnAlt]} onPress={openDeviceLocationSettings} activeOpacity={0.8}>
                      <Text style={[styles.gpsBannerBtnText, styles.gpsBannerBtnTextAlt]}>Nyalakan GPS</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              <View style={styles.routeConnector} />

              <View style={styles.routeInputRow}>
                <Icon name="location" size={16} color={themeColors.danger} style={styles.destDot} />
                <TextInput
                  style={styles.destTextInput}
                  placeholder="Ketik tujuan..."
                  placeholderTextColor={themeColors.textMuted}
                  value={searchQuery}
                  onChangeText={handleSearchChange}
                  editable={!isLoadingLocation && !isLoadingRoute}
                  returnKeyType="search"
                />
                {(isSearching || isLoadingRoute) && (
                  <ActivityIndicator size="small" color={themeColors.primary} style={{ marginLeft: 8 }} />
                )}
              </View>

              {suggestions.length > 0 && (
                <View style={styles.suggestionBox}>
                  {suggestions.slice(0, 7).map((item, idx) => {
                    const main = item.structured_formatting?.main_text || item.description;
                    const sub = item.structured_formatting?.secondary_text || '';
                    return (
                      <TouchableOpacity
                        key={item.place_id ?? idx}
                        style={[styles.suggestionItem, idx === Math.min(suggestions.length, 7) - 1 && { borderBottomWidth: 0 }]}
                        onPress={() => selectSuggestion(item)}
                        activeOpacity={0.7}
                      >
                        <View style={styles.suggestionMainRow}>
                          <Icon name={item._lat !== undefined ? 'location-outline' : 'search-outline'} size={13} color={themeColors.textMuted} />
                          <Text style={styles.suggestionMain} numberOfLines={1}>{main}</Text>
                        </View>
                        <Text style={styles.suggestionSub} numberOfLines={1}>
                          {sub}{item._lat === undefined ? '  · Google Maps' : ''}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {activeRoute && !isLoadingRoute && (
                <>
                  <View style={[styles.routeInfoRow, { borderTopColor: activeRoute.isSafe ? themeColors.border : levelColor(activeRoute.level) + '40' }]}>
                    <Icon name={activeRoute.isSafe ? 'checkmark-circle' : 'warning'} size={15} color={levelColor(activeRoute.level)} />
                    <Text style={[styles.routeInfoText, { color: levelColor(activeRoute.level) }]}>
                      {ROUTE_LABELS[activeRouteIdx]} · {activeRoute.distance} · {activeRoute.duration}
                    </Text>
                  </View>
                  <TouchableOpacity style={styles.startNavBtn} onPress={startNavigation} activeOpacity={0.8}>
                    <Icon name="navigate" size={14} color="#FFFFFF" />
                    <Text style={styles.startNavBtnText}>Mulai Navigasi</Text>
                  </TouchableOpacity>
                </>
              )}
              {!activeRoute && !isLoadingRoute && !isLoadingLocation && suggestions.length === 0 && !destination && (
                <View style={styles.avoidRow}>
                  <Icon name="warning" size={12} color={themeColors.warning} />
                  <Text style={styles.avoidText}>Menghindari {dangerCount} titik rawan banjir</Text>
                </View>
              )}

              {/* Daftar ruas jalan yang otomatis diblokir dari rute karena banjir */}
              {floodedRoads.length > 0 && (
                <View style={styles.blockedRoadsBanner}>
                  <View style={styles.blockedRoadsHeader}>
                    <Icon name="close-circle" size={13} color={themeColors.danger} />
                    <Text style={styles.blockedRoadsTitle}>Jalan Diblokir Otomatis</Text>
                  </View>
                  {floodedRoads.map(road => (
                    <View key={road.key} style={styles.blockedRoadRow}>
                      <View style={[styles.blockedRoadDot, { backgroundColor: themeColors.danger }]} />
                      <Text style={styles.blockedRoadName} numberOfLines={1}>{road.name}</Text>
                      <Text style={[styles.blockedRoadCount, { color: themeColors.danger }]}>
                        {road.nodes.length} sensor
                      </Text>
                    </View>
                  ))}
                  <Text style={[styles.blockedRoadsNote, { color: themeColors.textMuted }]}>
                    Rute akan menghindari jalan-jalan di atas secara otomatis.
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>
      </View>}

      {/* Navigation Bottom Bar — tampil saat navigasi aktif */}
      {isNavigating && (
        <View style={[styles.navBottomBar, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.navBottomLeft}>
            <Text style={styles.navRemDist}>{navRemaining?.distance || activeRoute?.distance}</Text>
            <Text style={styles.navRemTime}>{activeRoute?.duration}</Text>
            {destination?.name ? (
              <Text style={styles.navDestName} numberOfLines={1}>
                <Icon name="location" size={11} color={themeColors.textMuted} /> {destination.name}
              </Text>
            ) : null}
          </View>
          <TouchableOpacity style={styles.navStopBtn} onPress={stopNavigation} activeOpacity={0.8}>
            <Icon name="stop-circle" size={20} color="#FFFFFF" />
            <Text style={styles.navStopText}>Berhenti</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Tombol Recenter — muncul saat user menggeser peta manual saat navigasi */}
      {isNavigating && !isCameraFollowing && (
        <TouchableOpacity
          style={[styles.recenterBtn, { bottom: insets.bottom + 110 }]}
          onPress={() => {
            isCameraFollowingRef.current = true;
            setIsCameraFollowing(true);
            const loc = userLocationRef.current;
            if (loc) {
              mapRef.current?.animateCamera({
                center: { latitude: loc.latitude, longitude: loc.longitude },
                pitch: 55,
                heading: navHeadingRef.current,
                zoom: 17,
                altitude: 300,
              }, { duration: 600 });
            }
          }}
          activeOpacity={0.85}
        >
          <Icon name="navigate" size={18} color={themeColors.primary} />
        </TouchableOpacity>
      )}

      {/* Floating Route Card — tampil saat rute tersedia dan tidak sedang navigasi */}
      {showWarningCard && allRoutes.length > 0 && !isNavigating && (
        <View style={[styles.warningCard, allRoutes[0].isSafe && { borderColor: themeColors.border }]}>
          <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
            <View style={styles.warningCardHeader}>
              <View style={styles.warningTitleRow}>
                <View style={[styles.warningIconBg, allRoutes[0].isSafe && { backgroundColor: themeColors.safe + '15' }]}>
                  <Icon
                    name={allRoutes[0].isSafe ? 'checkmark-circle' : 'warning'}
                    size={16}
                    color={allRoutes[0].isSafe ? themeColors.safe : themeColors.warning}
                  />
                </View>
                <View>
                  <Text style={styles.warningTitle}>
                    {allRoutes[0].isSafe ? 'Pilihan Rute' : 'Peringatan Rute'}
                  </Text>
                  <Text style={styles.warningSubtitle}>
                    {allRoutes[0].isSafe
                      ? `${allRoutes.length} rute aman ditemukan`
                      : 'Rute utama melewati titik siaga / waspada'}
                  </Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setShowWarningCard(false)} style={styles.warningCloseBtn}>
                <Icon name="close" size={13} color={themeColors.textMuted} />
              </TouchableOpacity>
            </View>

            {!allRoutes[0].isSafe && (
              <>
                <View style={styles.warningDivider} />
                {allRoutes[0].hazards.map(node => (
                  <View key={node.id} style={styles.warningNodeRow}>
                    <View style={[styles.warningDot, { backgroundColor: node.status.color }]} />
                    <Text style={styles.warningNodeName}>{node.name}</Text>
                    <Text style={[styles.warningNodeLevel, { color: node.status.color }]}>
                      {node.isBinary ? (node.status.flood ? 'Banjir' : 'Kering') : `${node.status.level_cm} cm`}
                    </Text>
                  </View>
                ))}
              </>
            )}

            {allRoutesDangerous && (
              <View style={[styles.dangerBanner, { backgroundColor: themeColors.danger + '15', borderColor: themeColors.danger + '40' }]}>
                <Icon name="alert-circle" size={14} color={themeColors.danger} />
                <Text style={[styles.dangerBannerText, { color: themeColors.danger }]}>
                  Semua rute melewati titik BAHAYA. Hindari perjalanan jika memungkinkan.
                </Text>
              </View>
            )}

            <View style={styles.warningDivider} />
            <Text style={styles.altSectionTitle}>{allRoutes.length} Pilihan Rute</Text>

            {allRoutes.map((route, idx) => {
              const isActive = idx === activeRouteIdx;
              const lineColor = route.isSafe ? routeColors[idx] : levelColor(route.level);
              return (
                <TouchableOpacity
                  key={idx}
                  style={[styles.altRouteCard, isActive && { borderColor: lineColor, borderWidth: 2 }]}
                  onPress={() => handleSelectRoute(idx)}
                  activeOpacity={0.75}
                >
                  <View style={[styles.altRouteStrip, { backgroundColor: lineColor }]} />

                  <View style={styles.altRouteBody}>
                    <View style={styles.altRouteTop}>
                      <View style={styles.altRouteLabelRow}>
                        <Text style={styles.altRouteLabel}>{ROUTE_LABELS[idx]}</Text>
                        {route.isSafe && (
                          <View style={styles.recommendedBadge}>
                            <Text style={styles.recommendedText}>Disarankan</Text>
                          </View>
                        )}
                      </View>
                      <View style={[styles.altSafeBadge, { backgroundColor: levelColor(route.level) + '15' }]}>
                        <Icon name={route.isSafe ? 'checkmark-circle' : 'warning'} size={11} color={levelColor(route.level)} />
                        <Text style={[styles.altSafeBadgeText, { color: levelColor(route.level) }]}>
                          {levelLabel(route.level)}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.altRouteDetail}>{route.distance} · {route.duration}</Text>
                    {!route.isSafe && (
                      <Text style={styles.altRouteDanger} numberOfLines={1}>
                        Dekat: {route.hazards.map(n => n.name).join(', ')}
                      </Text>
                    )}
                  </View>

                  {isActive && <View style={[styles.altActiveIndicator, { backgroundColor: lineColor }]} />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Proximity Alert Card — muncul ketika user berada <100 m dari sensor bahaya */}
      {nearbyHazards.length > 0 && !isNavigating && !selectedNode && !showWarningCard && (
        <View style={[styles.proximityCard, { bottom: insets.bottom + 24 }]}>
          <View style={styles.proximityHeader}>
            <View style={[styles.proximityIconBg, { backgroundColor: themeColors.danger + '20' }]}>
              <Icon name="alert-circle" size={16} color={themeColors.danger} />
            </View>
            <View style={styles.proximityTextArea}>
              <Text style={[styles.proximityTitle, { color: themeColors.textMain }]}>
                Titik Rawan Terdekat
              </Text>
              <Text style={[styles.proximitySubtitle, { color: themeColors.textMuted }]}>
                {nearbyHazards.length} sensor dalam radius 100 m
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setNearbyHazards([])}
              style={[styles.proximityClose, { backgroundColor: themeColors.border }]}
            >
              <Icon name="close" size={13} color={themeColors.textMuted} />
            </TouchableOpacity>
          </View>

          {nearbyHazards.slice(0, 3).map(node => (
            <View key={node.id} style={[styles.proximityNodeRow, { borderTopColor: themeColors.border }]}>
              <View style={[styles.proximityDot, { backgroundColor: node.status.color }]} />
              <Text style={[styles.proximityNodeName, { color: themeColors.textMain }]} numberOfLines={1}>
                {node.name}
              </Text>
              <View style={[styles.proximityBadge, { backgroundColor: node.status.color + '20' }]}>
                <Text style={[styles.proximityBadgeText, { color: node.status.color }]}>
                  {node.status.risk}
                </Text>
              </View>
            </View>
          ))}

          <View style={[styles.proximityFooter, { borderTopColor: themeColors.border }]}>
            <Icon name="warning-outline" size={11} color={themeColors.warning} />
            <Text style={[styles.proximityFooterText, { color: themeColors.textMuted }]}>
              Hindari jalan di sekitar lokasi ini
            </Text>
          </View>
        </View>
      )}

      {/* Bottom Sheet Detail Node */}
      {selectedNode && !isRoutingMode && (
        <View style={styles.bottomSheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View>
              <Text style={styles.nodeName}>{selectedNode.name}</Text>
              <Text style={styles.nodeId}>Node ID: {selectedNode.id}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: selectedNode.status.color + '1A' }]}>
              <View style={[styles.dot, { backgroundColor: selectedNode.status.color }]} />
              <Text style={[styles.badgeText, { color: selectedNode.status.color }]}>{selectedNode.status.risk}</Text>
            </View>
          </View>
          <View style={styles.sheetBody}>
            <View style={styles.dataBlock}>
              {selectedNode.isBinary ? (
                <>
                  <Text style={styles.dataLabel}>Status Jalan</Text>
                  <Text style={[styles.dataValue, { color: selectedNode.status.color }]}>
                    {selectedNode.status.flood ? 'Banjir' : 'Kering'}
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.dataLabel}>Ketinggian Air</Text>
                  <Text style={styles.dataValue}>
                    {(selectedNode.status.level_cm / 100).toFixed(2)}{' '}
                    <Text style={styles.dataUnit}>Meter</Text>
                  </Text>
                </>
              )}
            </View>
            <View style={styles.dataBlock}>
              <Text style={styles.dataLabel}>Perangkat Keras</Text>
              <View style={styles.hardwareRow}>
                {selectedNode.hardware.has_sensor && (
                  <View style={styles.hwChip}>
                    <Icon name={selectedNode.isBinary ? 'hardware-chip' : 'water'} size={12} color={themeColors.textMuted} />
                    <Text style={styles.hwChipText}>{selectedNode.isBinary ? 'Alat Kecil' : 'Sensor Aktif'}</Text>
                  </View>
                )}
                {selectedNode.hardware.has_camera && (
                  <View style={styles.hwChip}>
                    <Icon name="videocam" size={12} color={themeColors.textMuted} />
                    <Text style={styles.hwChipText}>CCTV Aktif</Text>
                  </View>
                )}
              </View>
            </View>
          </View>
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.secondaryButton} activeOpacity={0.8} onPress={() => handleOpenHistory(selectedNode)}>
              <View style={styles.btnContent}>
                <Icon name="stats-chart" size={15} color={themeColors.primary} />
                <Text style={styles.secondaryButtonText}>Riwayat</Text>
              </View>
            </TouchableOpacity>
            {selectedNode.hardware.has_camera ? (
              <TouchableOpacity style={styles.primaryButton} activeOpacity={0.8} onPress={() => handleOpenCCTV(selectedNode)}>
                <View style={styles.btnContent}>
                  <Icon name="videocam" size={15} color="#FFFFFF" />
                  <Text style={styles.primaryButtonText}>Live CCTV</Text>
                </View>
              </TouchableOpacity>
            ) : (
              <View style={styles.disabledButton}>
                <View style={styles.btnContent}>
                  <Icon name="videocam-off" size={15} color={themeColors.textMuted} />
                  <Text style={styles.disabledButtonText}>CCTV Off</Text>
                </View>
              </View>
            )}
          </View>
        </View>
      )}
    </View>
  );
};

// Fungsi Dinamis untuk membuat Style menyesuaikan Theme Colors
const getStyles = (COLORS, isDarkMode) => StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  map: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },

  customMarker: {
    width: 36, height: 36, borderRadius: 18,
    justifyContent: 'center', alignItems: 'center', borderWidth: 1.5,
  },
  markerInner: { width: 16, height: 16, borderRadius: 8, borderWidth: 2.5, borderColor: '#FFFFFF' },
  markerInnerBinary: { borderRadius: 3 },

  floodTag: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#EF4444', paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 8, borderWidth: 1.5, borderColor: '#FFFFFF',
  },
  floodTagText: { color: '#FFFFFF', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },

  originMarker: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: COLORS.primary + '30',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: COLORS.primary,
  },
  originDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.primary },

  destMarkerWrapper: { alignItems: 'center' },
  destMarker: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },

  headerWrapper: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  routingCard: {
    marginHorizontal: 20, marginTop: 16, padding: 16,
    backgroundColor: COLORS.cardBg, borderRadius: 20,
    shadowColor: COLORS.shadow, shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1, shadowRadius: 12, elevation: 5,
  },
  routingHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  routingTitle: { fontSize: 16, fontWeight: '800', color: COLORS.textMain },
  routeToggleBtn: { backgroundColor: COLORS.border, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  routeToggleCancel: { backgroundColor: COLORS.danger },
  routeToggleText: { fontSize: 12, fontWeight: '700', color: COLORS.textMain },

  routeInputContainer: { marginTop: 16, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 14 },
  routeInputRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 4 },
  originDotSmall: {
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: COLORS.primary, marginRight: 12, borderWidth: 2, borderColor: COLORS.primary + '40',
  },
  destDot: { marginRight: 10 },
  routeConnector: { width: 2, height: 16, backgroundColor: COLORS.border, marginLeft: 5, marginVertical: 2 },
  routeInputText: { flex: 1, fontSize: 14, fontWeight: '600', color: COLORS.textMain },
  gpsChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.primary + '15',
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 8, marginLeft: 6,
  },
  gpsChipText: { fontSize: 11, fontWeight: '700', color: COLORS.primary },

  gpsBanner: {
    marginTop: 10, padding: 10, borderRadius: 12,
    backgroundColor: COLORS.warning + '12',
    borderWidth: 1, borderColor: COLORS.warning + '33',
  },
  gpsBannerTextRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  gpsBannerText: { fontSize: 12, fontWeight: '700', color: COLORS.textMain },
  gpsBannerActions: { flexDirection: 'row', gap: 8 },
  gpsBannerBtn: {
    flex: 1, paddingVertical: 8, borderRadius: 10,
    backgroundColor: COLORS.primary, alignItems: 'center',
  },
  gpsBannerBtnAlt: { backgroundColor: COLORS.primary + '15' },
  gpsBannerBtnText: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },
  gpsBannerBtnTextAlt: { color: COLORS.primary },
  destTextInput: { flex: 1, fontSize: 14, fontWeight: '600', color: COLORS.textMain, paddingVertical: 4 },

  suggestionBox: { marginTop: 8, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 4 },
  suggestionItem: {
    paddingVertical: 10, paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border,
  },
  suggestionMainRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  suggestionMain: { flex: 1, fontSize: 13, fontWeight: '700', color: COLORS.textMain },
  suggestionSub: { fontSize: 11, color: COLORS.textMuted, marginTop: 1 },

  avoidRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10 },
  avoidText: { fontSize: 11, fontWeight: '700', color: COLORS.warning },
  routeInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, paddingTop: 10, borderTopWidth: 1 },
  routeInfoText: { fontSize: 13, fontWeight: '700' },
  // Panah navigasi yang bergerak di peta
  navArrowOuter: {
    width: 52, height: 52,
    justifyContent: 'center', alignItems: 'center',
    borderRadius: 26,
    backgroundColor: COLORS.primary + '30',
  },
  navArrowCircle: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: COLORS.primary,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3, shadowRadius: 4, elevation: 6,
    borderWidth: 2, borderColor: '#FFFFFF',
  },

  startNavBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, marginTop: 8, paddingVertical: 11, borderRadius: 12,
    backgroundColor: COLORS.primary,
  },
  startNavBtnText: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },

  // Navigation instruction card (atas peta)
  navInstructionCard: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
    backgroundColor: COLORS.cardBg,
    paddingHorizontal: 20, paddingBottom: 16,
    shadowColor: COLORS.shadow, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15, shadowRadius: 12, elevation: 10,
  },
  navInstructionInner: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  navIconCircle: {
    width: 52, height: 52, borderRadius: 26,
    justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  navInstructionText: { flex: 1 },
  navInstruction: { fontSize: 16, fontWeight: '800', color: COLORS.textMain, lineHeight: 22 },
  navStepDist: { fontSize: 12, fontWeight: '600', color: COLORS.textMuted, marginTop: 3 },

  // Navigation bottom bar
  navBottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20,
    backgroundColor: COLORS.cardBg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingTop: 16,
    shadowColor: COLORS.shadow, shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1, shadowRadius: 12, elevation: 10,
  },
  navBottomLeft: { flex: 1, marginRight: 16 },
  navRemDist: { fontSize: 28, fontWeight: '900', color: COLORS.textMain, letterSpacing: -1 },
  navRemTime: { fontSize: 14, fontWeight: '600', color: COLORS.textMuted },
  navDestName: { fontSize: 12, fontWeight: '600', color: COLORS.textMuted, marginTop: 2 },
  navStopBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.danger, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 16,
  },
  navStopText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },

  // Warning Card
  warningCard: {
    position: 'absolute', bottom: 28, left: 20, right: 20,
    maxHeight: '38%',
    backgroundColor: COLORS.cardBg, borderRadius: 18, padding: 12,
    shadowColor: COLORS.shadow, shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12, shadowRadius: 16, elevation: 12, zIndex: 30,
    borderWidth: 1.5, borderColor: COLORS.warning + '40',
  },
  warningCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  warningTitleRow: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  warningIconBg: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: COLORS.warning + '15',
    justifyContent: 'center', alignItems: 'center', marginRight: 10,
  },
  warningTitle: { fontSize: 13, fontWeight: '800', color: COLORS.textMain },
  warningSubtitle: { fontSize: 10, color: COLORS.textMuted, fontWeight: '500' },
  warningCloseBtn: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: COLORS.border, justifyContent: 'center', alignItems: 'center', marginLeft: 8,
  },
  warningDivider: { height: 1, backgroundColor: COLORS.border, marginVertical: 8 },
  dangerBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    padding: 8, borderRadius: 8, borderWidth: 1, marginTop: 4,
  },
  dangerBannerText: { flex: 1, fontSize: 11, fontWeight: '700', lineHeight: 15 },
  warningNodeRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 4, paddingHorizontal: 8,
    backgroundColor: COLORS.danger + '08', borderRadius: 8, marginBottom: 4,
  },
  warningDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.danger, marginRight: 8 },
  warningNodeName: { flex: 1, fontSize: 12, fontWeight: '700', color: COLORS.textMain },
  warningNodeLevel: { fontSize: 11, fontWeight: '600', color: COLORS.danger },

  // Alternatif rute
  altSectionTitle: { fontSize: 10, fontWeight: '800', color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  altRouteCard: {
    flexDirection: 'row', alignItems: 'stretch',
    borderRadius: 10, marginBottom: 5,
    backgroundColor: COLORS.background,
    borderWidth: 1.5, borderColor: COLORS.border,
    overflow: 'hidden',
  },
  altRouteStrip: { width: 4 },
  altRouteBody: { flex: 1, paddingVertical: 7, paddingHorizontal: 10 },
  altRouteTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  altRouteLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1 },
  altRouteLabel: { fontSize: 12, fontWeight: '800', color: COLORS.textMain },
  recommendedBadge: { backgroundColor: COLORS.safe + '20', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5 },
  recommendedText: { fontSize: 9, fontWeight: '800', color: COLORS.safe },
  altSafeBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  altSafeBadgeText: { fontSize: 10, fontWeight: '700' },
  altRouteDetail: { fontSize: 11, fontWeight: '600', color: COLORS.textMuted },
  altRouteDanger: { fontSize: 10, color: COLORS.warning, fontWeight: '600', marginTop: 1 },
  altActiveIndicator: { width: 4, borderRadius: 0 },

  // Tombol recenter kamera navigasi
  recenterBtn: {
    position: 'absolute', right: 20, zIndex: 25,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18, shadowRadius: 8, elevation: 8,
    borderWidth: 1.5, borderColor: COLORS.primary + '30',
  },

  // Marker hazard di rute saat navigasi aktif
  hazardNavMarker: {
    width: 26, height: 26, borderRadius: 13,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: '#FFFFFF',
  },

  // Blocked roads banner (di dalam routing panel)
  blockedRoadsBanner: {
    marginTop: 10, padding: 10, borderRadius: 12,
    backgroundColor: COLORS.danger + '0D',
    borderWidth: 1, borderColor: COLORS.danger + '30',
  },
  blockedRoadsHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  blockedRoadsTitle: { fontSize: 11, fontWeight: '800', color: COLORS.danger, textTransform: 'uppercase', letterSpacing: 0.5 },
  blockedRoadRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 4, paddingHorizontal: 6,
    backgroundColor: COLORS.danger + '08', borderRadius: 8, marginBottom: 4,
  },
  blockedRoadDot: { width: 6, height: 6, borderRadius: 3, marginRight: 8 },
  blockedRoadName: { flex: 1, fontSize: 12, fontWeight: '700', color: COLORS.textMain },
  blockedRoadCount: { fontSize: 10, fontWeight: '700' },
  blockedRoadsNote: { fontSize: 10, fontWeight: '500', marginTop: 4, fontStyle: 'italic' },

  // Proximity alert card (floating bottom)
  proximityCard: {
    position: 'absolute', left: 20, right: 20, zIndex: 25,
    backgroundColor: COLORS.cardBg, borderRadius: 18, padding: 14,
    shadowColor: COLORS.shadow, shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14, shadowRadius: 16, elevation: 12,
    borderWidth: 1.5, borderColor: COLORS.danger + '40',
  },
  proximityHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  proximityIconBg: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  proximityTextArea: { flex: 1 },
  proximityTitle: { fontSize: 13, fontWeight: '800' },
  proximitySubtitle: { fontSize: 11, fontWeight: '500', marginTop: 1 },
  proximityClose: { width: 24, height: 24, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginLeft: 8 },
  proximityNodeRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth,
  },
  proximityDot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  proximityNodeName: { flex: 1, fontSize: 13, fontWeight: '700' },
  proximityBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  proximityBadgeText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  proximityFooter: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingTop: 8, marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth,
  },
  proximityFooterText: { fontSize: 11, fontWeight: '600' },

  // Bottom Sheet
  bottomSheet: {
    position: 'absolute', bottom: 32, left: 20, right: 20,
    backgroundColor: COLORS.cardBg, borderRadius: 24, padding: 24,
    shadowColor: COLORS.shadow, shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15, shadowRadius: 20, elevation: 10, zIndex: 20,
  },
  sheetHandle: { width: 40, height: 4, backgroundColor: COLORS.border, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  nodeName: { fontSize: 20, fontWeight: '800', color: COLORS.textMain, marginBottom: 2 },
  nodeId: { fontSize: 12, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 1 },

  badge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  badgeText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },

  sheetBody: {
    flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24,
    borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 16,
  },
  dataBlock: { flex: 1 },
  dataLabel: { fontSize: 12, fontWeight: '600', color: COLORS.textMuted, marginBottom: 4 },
  dataValue: { fontSize: 28, fontWeight: '900', color: COLORS.textMain, letterSpacing: -1 },
  dataUnit: { fontSize: 14, fontWeight: '600', color: COLORS.textMuted },

  hardwareRow: { flexDirection: 'column', gap: 6, marginTop: 4 },
  hwChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: isDarkMode ? COLORS.border : COLORS.background, paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 6, alignSelf: 'flex-start',
  },
  hwChipText: { fontSize: 12, fontWeight: '700', color: COLORS.textMuted },

  actionRow: { flexDirection: 'row', gap: 12 },
  btnContent: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  primaryButton: { flex: 1, backgroundColor: COLORS.primary, paddingVertical: 14, borderRadius: 16, alignItems: 'center' },
  primaryButtonText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  secondaryButton: { flex: 1, backgroundColor: COLORS.primary + '15', paddingVertical: 14, borderRadius: 16, alignItems: 'center' },
  secondaryButtonText: { color: COLORS.primary, fontSize: 14, fontWeight: '700' },
  disabledButton: { flex: 1, backgroundColor: COLORS.border, paddingVertical: 14, borderRadius: 16, alignItems: 'center' },
  disabledButtonText: { color: COLORS.textMuted, fontSize: 14, fontWeight: '700' },
});

const mapLightStyle = [
  { featureType: 'poi', elementType: 'labels.text', stylers: [{ visibility: 'off' }] },
];

// Google Maps Dark Theme Style Json
const mapDarkStyle = [
  { "featureType": "poi", "elementType": "labels.text", "stylers": [{ "visibility": "off" }] },
  { "elementType": "geometry", "stylers": [{ "color": "#212121" }] },
  { "elementType": "labels.icon", "stylers": [{ "visibility": "off" }] },
  { "elementType": "labels.text.fill", "stylers": [{ "color": "#757575" }] },
  { "elementType": "labels.text.stroke", "stylers": [{ "color": "#212121" }] },
  { "featureType": "administrative", "elementType": "geometry", "stylers": [{ "color": "#757575" }] },
  { "featureType": "administrative.country", "elementType": "labels.text.fill", "stylers": [{ "color": "#9e9e9e" }] },
  { "featureType": "administrative.land_parcel", "stylers": [{ "visibility": "off" }] },
  { "featureType": "administrative.locality", "elementType": "labels.text.fill", "stylers": [{ "color": "#bdbdbd" }] },
  { "featureType": "poi", "elementType": "labels.text.fill", "stylers": [{ "color": "#757575" }] },
  { "featureType": "poi.park", "elementType": "geometry", "stylers": [{ "color": "#181818" }] },
  { "featureType": "poi.park", "elementType": "labels.text.fill", "stylers": [{ "color": "#616161" }] },
  { "featureType": "poi.park", "elementType": "labels.text.stroke", "stylers": [{ "color": "#1b1b1b" }] },
  { "featureType": "road", "elementType": "geometry.fill", "stylers": [{ "color": "#2c2c2c" }] },
  { "featureType": "road", "elementType": "labels.text.fill", "stylers": [{ "color": "#8a8a8a" }] },
  { "featureType": "road.arterial", "elementType": "geometry", "stylers": [{ "color": "#373737" }] },
  { "featureType": "road.highway", "elementType": "geometry", "stylers": [{ "color": "#3c3c3c" }] },
  { "featureType": "road.highway.controlled_access", "elementType": "geometry", "stylers": [{ "color": "#4e4e4e" }] },
  { "featureType": "road.local", "elementType": "labels.text.fill", "stylers": [{ "color": "#616161" }] },
  { "featureType": "transit", "elementType": "labels.text.fill", "stylers": [{ "color": "#757575" }] },
  { "featureType": "water", "elementType": "geometry", "stylers": [{ "color": "#000000" }] },
  { "featureType": "water", "elementType": "labels.text.fill", "stylers": [{ "color": "#3d3d3d" }] }
];

export default MapScreen;