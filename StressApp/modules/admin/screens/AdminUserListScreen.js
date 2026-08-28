// ============================================================
// AdminUserListScreen.js
// Lists every registered account (GET /users -- already had no ownership
// check at all, see backend/physiological/app.py:117-124) so an admin can
// pick any user to inspect, independent of which account is actually
// logged into this phone.
// ============================================================
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import ScreenBackground from '../../shared/ScreenBackground';
import Card from '../../shared/Card';
import Icon, { NAMES } from '../../shared/Icon';
import { COLORS } from '../../physiological/config/theme';
import api from '../../physiological/api/client';
import { useAuth } from '../../../context/AuthContext';

export default function AdminUserListScreen({ navigation }) {
  const { logout } = useAuth();
  const [users, setUsers] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/users');
      setUsers(res.data?.users || {});
    } catch (e) {
      setUsers({});
    }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const entries = users ? Object.entries(users) : [];

  return (
    <ScreenBackground>
      <View style={styles.header}>
        <View>
          <Text style={[styles.title, { color: COLORS.light.text }]}>Clinical & Admin Suite</Text>
          <Text style={[styles.subtitle, { color: COLORS.light.textMuted }]}>
            Select a registered user to inspect full biometric telemetry
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.switchModeBtn}
            onPress={() => navigation.navigate('CalibrationGate')}
            activeOpacity={0.8}
          >
            <Icon name="swap-horizontal" size={18} color={COLORS.brand} />
          </TouchableOpacity>
          <TouchableOpacity onPress={logout} style={styles.logoutIconBtn}>
            <Icon name={NAMES.logout} size={18} color={COLORS.stress} />
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={COLORS.brand} />
      ) : (
        <FlatList
          contentContainerStyle={{ padding: 20, paddingTop: 0 }}
          data={entries}
          keyExtractor={([uid]) => uid}
          renderItem={({ item: [uid, record] }) => (
            <Card onPress={() => navigation.navigate('AdminUserDetail', { userId: uid, name: record?.name })}>
              <View style={styles.row}>
                <View style={[styles.avatar, { backgroundColor: COLORS.brand + '20' }]}>
                  <Icon name={NAMES.profile} size={22} color={COLORS.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color: COLORS.light.text }]}>{record?.name || uid}</Text>
                  <Text style={[styles.sub, { color: COLORS.light.textMuted }]}>
                    @{uid} · {record?.session_count ?? 0} sessions
                  </Text>
                </View>
                <Icon name={NAMES.chevronRight} size={20} color={COLORS.light.textMuted} />
              </View>
            </Card>
          )}
          ListEmptyComponent={
            <Text style={{ color: COLORS.light.textMuted, textAlign: 'center', marginTop: 40 }}>
              No registered users found.
            </Text>
          }
        />
      )}
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 20, paddingBottom: 12 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  switchModeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.brandSoft, alignItems: 'center', justifyContent: 'center' },
  logoutIconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.stressSoft, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '900', letterSpacing: -0.3 },
  subtitle: { fontSize: 12, marginTop: 4, maxWidth: 240 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 15, fontWeight: '800' },
  sub: { fontSize: 12, marginTop: 2 },
});
