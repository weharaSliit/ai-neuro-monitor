// ============================================================
// AdminUserListScreen.js
// Lists every registered account (GET /users -- already had no ownership
// check at all, see backend/physiological/app.py:117-124) so an admin can
// pick any user to inspect, independent of which account is actually
// logged into this phone.
// ============================================================
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ref, get } from 'firebase/database';
import { db } from '../../../firebase';
import ScreenBackground from '../../shared/ScreenBackground';
import Card from '../../shared/Card';
import StatusDot from '../../shared/StatusDot';
import Icon, { NAMES } from '../../shared/Icon';
import { COLORS } from '../../physiological/config/theme';
import api from '../../physiological/api/client';
import { useAuth } from '../../../context/AuthContext';

function CollapsibleSectionHeader({ title, subtitle, count, expanded, onToggle }) {
  return (
    <TouchableOpacity style={styles.sectionHeader} onPress={onToggle} activeOpacity={0.7}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.sectionTitle, { color: COLORS.light.text }]}>
          {title}{count != null ? ` (${count})` : ''}
        </Text>
        {subtitle ? (
          <Text style={[styles.sectionSubtitle, { color: COLORS.light.textMuted }]}>{subtitle}</Text>
        ) : null}
      </View>
      <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={COLORS.light.textMuted} />
    </TouchableOpacity>
  );
}

export default function AdminUserListScreen({ navigation }) {
  const { logout } = useAuth();
  const [users, setUsers] = useState(null);
  const [loading, setLoading] = useState(true);

  // Digital Phenotyping keeps its own pool of "users" -- each one a
  // randomly-generated on-device tracking id (see phenotyping/utils/
  // deviceIdentity.js), not the physiological/EEG login account above.
  // A phone can run the phenotyping sensor without ever registering a
  // Ring/EEG account, so this can't be folded into the list above --
  // it's read straight from Firebase phenotyping/users, separately.
  const [phenoUsers, setPhenoUsers] = useState(null);
  const [phenoLoading, setPhenoLoading] = useState(true);
  const [phenoExpanded, setPhenoExpanded] = useState(true);

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

  const loadPheno = useCallback(async () => {
    setPhenoLoading(true);
    try {
      const snap = await get(ref(db, 'phenotyping/users'));
      setPhenoUsers(snap.exists() ? snap.val() : {});
    } catch (e) {
      setPhenoUsers({});
    }
    setPhenoLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); loadPheno(); }, [load, loadPheno]));

  const entries = users ? Object.entries(users) : [];
  const phenoEntries = phenoUsers ? Object.entries(phenoUsers) : [];

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
            onPress={() => navigation.navigate('Physiological')}
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
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 0, paddingBottom: 40 }}>
          {entries.length === 0 ? (
            <Text style={{ color: COLORS.light.textMuted, textAlign: 'center', marginTop: 20, marginBottom: 8 }}>
              No registered users found.
            </Text>
          ) : (
            entries.map(([uid, record]) => (
              <Card key={uid} onPress={() => navigation.navigate('AdminUserDetail', { userId: uid, name: record?.name })}>
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
            ))
          )}

          <CollapsibleSectionHeader
            title="Digital Phenotyping"
            subtitle="Passive keystroke & interaction telemetry — tracked per device, independent of the accounts above"
            count={phenoLoading ? null : phenoEntries.length}
            expanded={phenoExpanded}
            onToggle={() => setPhenoExpanded((v) => !v)}
          />
          {phenoExpanded && (
            phenoLoading ? (
              <ActivityIndicator style={{ marginTop: 12 }} color={COLORS.brand} />
            ) : phenoEntries.length === 0 ? (
              <Text style={{ color: COLORS.light.textMuted, marginBottom: 8 }}>
                No digital phenotyping devices have reported data yet.
              </Text>
            ) : (
              phenoEntries.map(([deviceId, record]) => {
                const displayName = record?.display_name || record?.name || deviceId;
                const calibrated = !!record?.is_calibrated;
                return (
                  <Card
                    key={deviceId}
                    onPress={() => navigation.navigate('PhenotypingAnalysis', {
                      userId: deviceId,
                      userName: displayName,
                      mode: 'analysis',
                    })}
                  >
                    <View style={styles.row}>
                      <View style={[styles.avatar, { backgroundColor: COLORS.gsr + '20' }]}>
                        <Icon name={NAMES.phenotyping} size={22} color={COLORS.gsr} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.name, { color: COLORS.light.text }]}>{displayName}</Text>
                        <Text style={[styles.sub, { color: COLORS.light.textMuted }]}>
                          @{deviceId.slice(0, 12)}{deviceId.length > 12 ? '…' : ''}
                        </Text>
                      </View>
                      <View style={[styles.statusPill, { backgroundColor: calibrated ? COLORS.normalSoft : COLORS.brand + '20' }]}>
                        <StatusDot color={calibrated ? COLORS.normal : COLORS.brand} active size={7} />
                        <Text style={[styles.statusPillText, { color: calibrated ? COLORS.normalDark : COLORS.brand }]}>
                          {calibrated ? 'Calibrated' : 'Learning'}
                        </Text>
                      </View>
                      <Icon name={NAMES.chevronRight} size={20} color={COLORS.light.textMuted} />
                    </View>
                  </Card>
                );
              })
            )
          )}
        </ScrollView>
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
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginTop: 20, marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '900', letterSpacing: -0.2 },
  sectionSubtitle: { fontSize: 11.5, marginTop: 2, lineHeight: 15, maxWidth: 300 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, marginRight: 6 },
  statusPillText: { fontSize: 10, fontWeight: '800' },
});
