# CLAUDE.md — RiverEyeApp

## Project Overview

RiverEyeApp is a React Native mobile application for real-time river water level monitoring and flood risk prediction. It displays sensor data, flood predictions, CCTV streams, and sensor locations on a map. All UI text is in **Indonesian (Bahasa Indonesia)**.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React Native 0.84.1 / React 19.2.3 |
| Language | JavaScript (screens/config) + TypeScript (App.tsx, tests) |
| Navigation | @react-navigation/native 7 + @react-navigation/bottom-tabs 7 |
| Maps | react-native-maps 1.27.2 (PROVIDER_GOOGLE) |
| HTTP | axios 1.15.2 |
| Video | react-native-video 6.19.2 |
| Testing | Jest 29.6.3 |
| Linting | ESLint (@react-native config) + Prettier 2.8.8 |
| Build (Android) | SDK 36, Kotlin 2.1.20, NDK 27.0.12077973 |

## Common Commands

```bash
# Install dependencies
npm install

# iOS (Mac only)
cd ios && pod install && cd ..
npx react-native run-ios

# Android
npx react-native run-android

# Start Metro bundler
npx react-native start

# Lint
npx eslint src/

# Tests
npx jest
```

## Project Structure

```
RiverEyeApp/
├── App.tsx                  # Root component, bottom tab navigator
├── index.js                 # AppRegistry entry point
├── src/
│   ├── screens/
│   │   ├── DashboardScreen.js   # Home tab — live water level + map preview
│   │   ├── MapScreen.js         # Full-screen Google Maps with sensor markers
│   │   ├── CameraScreen.js      # Live CCTV video stream
│   │   └── HistoryScreen.js     # Paginated log history list
│   └── config/
│       ├── api.js               # Constants: BASE_URL, ENDPOINTS, risk helpers
│       └── apiClient.js         # Axios instance + typed fetch/post functions
├── android/
├── ios/
└── __tests__/App.test.tsx
```

## Architecture & Patterns

### State Management
- Local component state only (`useState`, `useEffect`, `useCallback`)
- No Redux, Context API, or Zustand — keep it that way unless complexity demands it
- `useCallback` wraps all fetch functions to prevent recreation on re-render
- `Promise.all()` for parallel API calls where multiple endpoints are needed

### Navigation
- `createBottomTabNavigator` in App.tsx — 4 tabs with emoji icons
- `headerShown: false` globally
- Tab bar: active `#2ECC71` (green), inactive `#7F8C8D` (grey)

### API Layer (`src/config/`)

**`api.js`** — pure constants, no side effects:
- `BASE_URL = 'http://100.71.62.7:3000'`
- `ENDPOINTS`: `locations`, `logs`, `predictions`
- `API_TIMEOUT = 10000` (10 s)
- `RISK_LABELS`: `{ low: 'Aman', medium: 'Waspada', high: 'Siaga' }`
- `getRiskFromLevel(cm)`: `>= 200` → high, `>= 150` → medium, `< 150` → low

**`apiClient.js`** — axios instance wrapping all HTTP calls:
- `getLocations()`, `getLogs()`, `getPredictions()` — GET, no auth
- `postLog(data)`, `postPrediction(data)` — POST, require `x-api-key` header (hardware / ML model submissions)
- `handleResponse(res)` validates `status === "success"`
- `handleError(err)` maps HTTP codes to Indonesian user messages

### Styling Conventions
- `StyleSheet.create()` at the bottom of every file
- Risk color palette: `#27AE60` (Aman/safe), `#F39C12` (Waspada/warning), `#E74C3C` (Siaga/danger)
- Pull-to-refresh: `RefreshControl` with `#3498DB`
- Loading spinners: `ActivityIndicator` inside a dedicated container

### Component Conventions
- Functional components with hooks only — no class components
- `StyleSheet` defined at the bottom of every file
- Error states show an Indonesian message + a retry button
- Empty states handled explicitly (e.g., empty FlatList in HistoryScreen)
- Date display uses `'id-ID'` locale

## Screens

| Tab | File | API Calls | Notes |
|---|---|---|---|
| Beranda (Home) | DashboardScreen.js | `/locations`, `/logs`, `/predictions` | Live water level + flood prediction + map preview + CCTV placeholder |
| Peta (Map) | MapScreen.js | `/locations` | Full-screen Google Maps, sensor markers |
| Kamera (Camera) | CameraScreen.js | none | react-native-video; currently uses placeholder MP4 URL — awaiting RTSP from hardware team |
| Riwayat (History) | HistoryScreen.js | `/logs`, `/locations` | FlatList sorted newest-first, color-coded badges |

## API Reference

Base URL: `http://100.71.62.7:3000`

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/api/locations` | none | All monitoring sensor locations |
| GET | `/api/logs` | none | All water level sensor logs |
| GET | `/api/predictions` | none | All flood predictions |
| POST | `/api/logs` | `x-api-key` | Submit sensor log (hardware) |
| POST | `/api/predictions` | `x-api-key` | Submit flood prediction (ML model) |

Risk level is computed **client-side** in `getRiskFromLevel()` because the backend does not return a `risk_label` field.

## Known Placeholders / In-Progress

- **CameraScreen**: Video source is a dummy MP4 (`https://www.w3schools.com/html/html5_video.asp` ref). Replace with actual RTSP URL when hardware team provides it.
- **DashboardScreen**: CCTV preview is a placeholder — connect to real stream once available.
- **Map default coordinates**: Falls back to Jakarta (`-6.2088, 106.8456`) if no locations are loaded.
- **TypeScript adoption**: `App.tsx` and tests use TS; screens are plain JS. Gradual migration is acceptable.

## Code Quality

- Run `npx eslint src/` before committing
- Prettier config: single quotes, no trailing commas in ES5+, avoid arrow-function parens
- Comments in source are in Indonesian — match this convention when adding new comments
- Do not add multi-line comment blocks; one short line only when the why is non-obvious
