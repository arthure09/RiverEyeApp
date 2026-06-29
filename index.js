/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import notifee, { EventType } from '@notifee/react-native';

// Wajib didaftarkan di entry point agar notifee tidak throw saat app di-background/killed.
// Ketuk notifikasi saat app killed → OS membuka app dari awal, tidak perlu navigasi manual.
notifee.onBackgroundEvent(async ({ type }) => {
  if (type === EventType.PRESS) {
    // App akan dibuka ke layar utama secara otomatis oleh OS
  }
});

AppRegistry.registerComponent(appName, () => App);
