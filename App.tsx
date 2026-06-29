import React, { useContext, useEffect } from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Icon from 'react-native-vector-icons/Ionicons';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import notifee, { EventType } from '@notifee/react-native';
import { startNtfyListener, stopNtfyListener } from './src/services/ntfyListener';

// Import Screens
import DashboardScreen from './src/screens/DashboardScreen';
import MapScreen from './src/screens/MapScreen';
import CameraScreen from './src/screens/CameraScreen';
import HistoryScreen from './src/screens/HistoryScreen';

// Import Theme Context
import { ThemeProvider, ThemeContext } from './src/context/ThemeContext';

// 1. Definisikan tipe untuk parameter navigasi
type RootTabParamList = {
  Beranda: undefined;
  Peta: undefined;
  Kamera: undefined;
  Riwayat: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

// Ref navigasi global — dipakai handler notifikasi di luar komponen React
export const navigationRef = createNavigationContainerRef<RootTabParamList>();

// 2. Palet warna dinamis untuk Tab Bar
const LIGHT_COLORS = {
  primary: '#0EA5E9',    // Sky 500 (Aktif)
  inactive: '#94A3B8',   // Slate 400 (Tidak Aktif)
  background: '#FFFFFF', // Putih bersih
  shadow: '#0F172A',
};

const DARK_COLORS = {
  primary: '#38BDF8',    // Sky 400 (Aktif, lebih terang di dark mode)
  inactive: '#64748B',   // Slate 500 (Tidak Aktif)
  background: '#1E293B', // Slate 800 (Gelap elegan)
  shadow: '#000000',
};

// 3. Komponen Navigator yang dibungkus agar bisa membaca ThemeContext
function MainNavigator() {
  const themeContext = useContext(ThemeContext);
  
  // Mencegah crash jika ThemeContext belum termuat sempurna
  const isDarkMode = themeContext?.isDarkMode || false; 
  const themeColors = isDarkMode ? DARK_COLORS : LIGHT_COLORS;

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false, 
        
        tabBarIcon: ({ focused, color }) => {
          let iconName = 'help-outline'; 

          if (route.name === 'Beranda') {
            iconName = focused ? 'home' : 'home-outline';
          } else if (route.name === 'Peta') {
            iconName = focused ? 'map' : 'map-outline';
          } else if (route.name === 'Kamera') {
            iconName = focused ? 'videocam' : 'videocam-outline';
          } else if (route.name === 'Riwayat') {
            iconName = focused ? 'bar-chart' : 'bar-chart-outline';
          }

          return <Icon name={iconName} size={focused ? 26 : 24} color={color} />;
        },
        
        tabBarActiveTintColor: themeColors.primary,
        tabBarInactiveTintColor: themeColors.inactive,
        tabBarStyle: {
          backgroundColor: themeColors.background,
          borderTopWidth: 0, 
          elevation: 15, 
          shadowColor: themeColors.shadow, 
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: isDarkMode ? 0.3 : 0.05, 
          shadowRadius: 12,
          height: 85, 
          paddingBottom: 24, 
          paddingTop: 12,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '700',
          marginTop: 4,
        },
        tabBarItemStyle: {
          borderRadius: 10,
        }
      })}
    >
      <Tab.Screen name="Beranda" component={DashboardScreen} />
      <Tab.Screen name="Peta" component={MapScreen} />
      <Tab.Screen name="Kamera" component={CameraScreen} />
      <Tab.Screen name="Riwayat" component={HistoryScreen} />
    </Tab.Navigator>
  );
}

// 4. Komponen App Utama yang membungkus seluruh aplikasi dengan Provider
export default function App() {
  useEffect(() => {
    // Minta izin notifikasi dan mulai listener ntfy saat app dibuka
    notifee.requestPermission();
    startNtfyListener();

    // Buka tab Beranda saat notifikasi diklik dan app sedang foreground
    const unsubForeground = notifee.onForegroundEvent(({ type }) => {
      if (type === EventType.PRESS && navigationRef.isReady()) {
        navigationRef.navigate('Beranda');
      }
    });

    // Reconnect WebSocket setelah app kembali ke foreground dari background
    const appStateSub = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        startNtfyListener(); // idempoten — tidak membuat koneksi baru jika sudah terhubung
      }
    });

    return () => {
      stopNtfyListener();
      unsubForeground();
      appStateSub.remove();
    };
  }, []);

  return (
    <SafeAreaProvider style={{ flex: 1 }}>
      <ThemeProvider>
        <NavigationContainer ref={navigationRef}>
          <MainNavigator />
        </NavigationContainer>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}