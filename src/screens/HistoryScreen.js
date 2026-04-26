import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import axios from 'axios';

const HistoryScreen = () => {
  const [historyData, setHistoryData] = useState([]);
  const [loading, setLoading] = useState(true);

  // Fungsi tiruan untuk memanggil API
  const fetchHistoryData = async () => {
    try {
      // NANTI: axios.get('http://api-arthur-nanti.com/history')
      // SEKARANG: Kita buat jeda waktu 1.5 detik seolah-olah sedang download data
      setTimeout(() => {
        const dummyData = [
          { id: '1', time: '10:00 WIB', level: '1.2 m', status: 'Aman' },
          { id: '2', time: '09:30 WIB', level: '1.2 m', status: 'Aman' },
          { id: '3', time: '09:00 WIB', level: '1.3 m', status: 'Aman' },
          { id: '4', time: '08:30 WIB', level: '1.8 m', status: 'Waspada' },
          { id: '5', time: '08:00 WIB', level: '2.1 m', status: 'Siaga' },
        ];
        setHistoryData(dummyData);
        setLoading(false);
      }, 1500);
    } catch (error) {
      console.error("Gagal mengambil data:", error);
      setLoading(false);
    }
  };

  // useEffect akan otomatis menjalankan fungsi fetch saat halaman dibuka
  useEffect(() => {
    fetchHistoryData();
  }, []);

  // Desain untuk setiap baris data
  const renderItem = ({ item }) => (
    <View style={styles.card}>
      <Text style={styles.timeText}>Waktu: {item.time}</Text>
      <Text style={styles.levelText}>Ketinggian: {item.level}</Text>
      <Text style={[
        styles.statusText, 
        { color: item.status === 'Aman' ? '#27AE60' : (item.status === 'Waspada' ? '#F39C12' : '#E74C3C') }
      ]}>
        Status: {item.status}
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerText}>Riwayat Ketinggian Air 📊</Text>
      </View>
      
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3498DB" />
          <Text style={styles.loadingText}>Mengambil data dari server...</Text>
        </View>
      ) : (
        <FlatList
          data={historyData}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContainer}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  header: { padding: 16, backgroundColor: '#FFFFFF', elevation: 2 },
  headerText: { fontSize: 18, fontWeight: 'bold', color: '#2C3E50' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 10, color: '#7F8C8D' },
  listContainer: { padding: 16 },
  card: { backgroundColor: '#FFFFFF', padding: 16, marginBottom: 10, borderRadius: 8, elevation: 1 },
  timeText: { fontSize: 14, color: '#7F8C8D', marginBottom: 4 },
  levelText: { fontSize: 16, fontWeight: 'bold', color: '#2C3E50', marginBottom: 4 },
  statusText: { fontSize: 14, fontWeight: 'bold' }
});

export default HistoryScreen;