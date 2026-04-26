import React, { useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import Video from 'react-native-video';

const CameraScreen = () => {
  const [isBuffering, setIsBuffering] = useState(true);

  // Link MP4 Google untuk testing (Nanti diganti RTSP dari Tamim)
  const streamUrl = "https://www.w3schools.com/html/mov_bbb.mp4"; 

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerText}>Live CCTV Stream 🎥</Text>
        <Text style={styles.subText}>Area Papan Duga ITS</Text>
      </View>

      <View style={styles.videoContainer}>
        {isBuffering && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#3498DB" />
            <Text style={styles.loadingText}>Memuat Siaran...</Text>
          </View>
        )}
        
        <Video
          source={{ uri: streamUrl }}
          style={StyleSheet.absoluteFill} // Perintah sakti agar video memenuhi container
          resizeMode="contain"
          onReadyForDisplay={() => setIsBuffering(false)}
          onError={(e) => {
            console.log("Error Video:", e);
            setIsBuffering(false);
          }}
          controls={true} // Menampilkan tombol play/pause bawaan Android
          repeat={true}
        />
      </View>
      
      <View style={styles.infoBox}>
        <Text style={styles.infoText}>Menunggu link RTSP dari tim Hardware.</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  header: { padding: 16, backgroundColor: '#1A1A1A' },
  headerText: { fontSize: 18, fontWeight: 'bold', color: '#FFFFFF' },
  subText: { fontSize: 12, color: '#BDC3C7', marginTop: 4 },
  videoContainer: { width: '100%', height: 250, backgroundColor: '#2C3E50', justifyContent: 'center' },
  loadingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', zIndex: 1 },
  loadingText: { color: '#FFFFFF', marginTop: 10 },
  infoBox: { padding: 20, alignItems: 'center' },
  infoText: { color: '#E74C3C', textAlign: 'center' }
});

export default CameraScreen;