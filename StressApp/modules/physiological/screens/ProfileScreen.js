import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../config/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import api from '../api/client';
import EmaSummaryCard from './EmaSummaryCard';

export default function ProfileScreen({ navigation }) {
  const { theme, COLORS } = useTheme();
  const { user, logout } = useAuth();
  const userId = user?.userId;

  const [baseline,     setBaseline]     = useState(null);
  const [sessionCount, setSessionCount] = useState(0);
  const [loading,       setLoading]     = useState(true);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const bg     = theme.bg;
  const card   = theme.card;
  const border = theme.border;
  const text   = theme.text;
  const muted  = theme.textMuted;

  const loadProfile = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [b, h] = await Promise.all([
        api.get(`/baseline/${userId}`),
        api.get(`/history/${userId}`),
      ]);
      setBaseline(b.data);
      setSessionCount(Object.keys(h.data?.sessions || {}).length);
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start();
    } catch (e) {
      console.log('Profile load error:', e.message);
    }
    setLoading(false);
  };

  useEffect(() => { loadProfile(); }, [userId]);
  useFocusEffect(useCallback(() => { loadProfile(); }, [userId]));

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
      <Animated.ScrollView style={{ opacity: fadeAnim }} showsVerticalScrollIndicator={false}>

        {/* Identity header */}
        <View style={styles.header}>
          <View style={[styles.avatarCircle, { backgroundColor: COLORS.brand + '20', borderColor: COLORS.brand + '50' }]}>
            <Text style={styles.avatarEmoji}>👤</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.name, { color: text }]}>{user?.name || userId}</Text>
            <View style={[styles.userBadge, { backgroundColor: COLORS.brand + '15', borderColor: COLORS.brand + '40' }]}>
              <Text style={[styles.userBadgeText, { color: COLORS.brandLight }]}>@{userId}</Text>
            </View>
          </View>
        </View>

        {/* Back to Home */}
        <TouchableOpacity
          activeOpacity={0.8}
          style={styles.backRow}
          onPress={() => navigation.navigate('Home')}
        >
          <Text style={[styles.backText, { color: COLORS.brand }]}>← Back to Home</Text>
        </TouchableOpacity>

        {/* Stats row */}
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: card, borderColor: border }]}>
            <Text style={[styles.statValue, { color: COLORS.brand }]}>{sessionCount}</Text>
            <Text style={[styles.statLabel, { color: muted }]}>Sessions</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: card, borderColor: border }]}>
            <Text style={[styles.statValue, { color: baseline?.exists ? COLORS.normal : COLORS.warning }]}>
              {baseline?.exists ? 'Set' : 'None'}
            </Text>
            <Text style={[styles.statLabel, { color: muted }]}>Calibration</Text>
          </View>
        </View>

        {/* Calibration */}
        <TouchableOpacity
          activeOpacity={0.8}
          style={[styles.card, { backgroundColor: card, borderColor: border }]}
          onPress={() => navigation.navigate('Calibration')}
        >
          <View style={styles.cardHeaderRow}>
            <Text style={[styles.cardTitle, { color: text }]}>🎯 Calibration</Text>
            <Text style={[styles.chevron, { color: muted }]}>→</Text>
          </View>
          <Text style={[styles.cardSub, { color: muted }]}>
            {baseline?.exists
              ? 'Baseline is set. Tap to view details or recalibrate.'
              : 'No personal baseline yet — tap to calibrate the ring.'}
          </Text>
        </TouchableOpacity>

        {/* Back to Relaxation Guide -- the primary app experience; this
            Physiological area is a supporting/sensor module reached from it */}
        <TouchableOpacity
          activeOpacity={0.8}
          style={[styles.card, { backgroundColor: card, borderColor: border }]}
          onPress={() => navigation.navigate('Relaxation')}
        >
          <View style={styles.cardHeaderRow}>
            <Text style={[styles.cardTitle, { color: text }]}>🧘 Relaxation Guide</Text>
            <Text style={[styles.chevron, { color: muted }]}>→</Text>
          </View>
          <Text style={[styles.cardSub, { color: muted }]}>
            Back to your personalized stress relief dashboard.
          </Text>
        </TouchableOpacity>

        {/* EMA summary */}
        <EmaSummaryCard navigation={navigation} />

        <TouchableOpacity
          style={[styles.logoutBtn, { borderColor: COLORS.stress + '50' }]}
          onPress={logout}
        >
          <Text style={[styles.logoutText, { color: COLORS.stress }]}>Log Out</Text>
        </TouchableOpacity>

        <View style={{ height: 80 }} />
      </Animated.ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:              { flex: 1 },
  header:            { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  avatarCircle:      { width: 60, height: 60, borderRadius: 30, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  avatarEmoji:       { fontSize: 26 },
  name:              { fontSize: 22, fontWeight: '900' },
  userBadge:         { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, marginTop: 4 },
  userBadgeText:     { fontSize: 11, fontWeight: '700' },
  statsRow:          { flexDirection: 'row', gap: 10, marginHorizontal: 20, marginBottom: 16 },
  statCard:          { flex: 1, borderRadius: 16, borderWidth: 1, padding: 14, alignItems: 'center' },
  statValue:         { fontSize: 20, fontWeight: '900' },
  statLabel:         { fontSize: 11, marginTop: 3 },
  card:              { marginHorizontal: 20, marginBottom: 16, padding: 18, borderRadius: 20, borderWidth: 1 },
  cardHeaderRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle:         { fontSize: 16, fontWeight: '800' },
  chevron:           { fontSize: 16, fontWeight: '700' },
  cardSub:           { fontSize: 12, marginTop: 4 },
  logoutBtn:         { marginHorizontal: 20, padding: 14, borderRadius: 14, alignItems: 'center', borderWidth: 1 },
  logoutText:        { fontSize: 14, fontWeight: '700' },
  backRow:           { marginHorizontal: 20, marginBottom: 4, alignSelf: 'flex-start' },
  backText:          { fontSize: 13, fontWeight: '700' },
});
