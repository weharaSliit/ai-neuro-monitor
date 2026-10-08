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

import PhenotypingAdminHub from './PhenotypingAdminHub';

const COMPONENT_TABS = [
  { id: 'hrv', label: 'Physiological HRV', emoji: '💍' },
  { id: 'eeg', label: 'Physiological EEG', emoji: '🧠' },
  { id: 'phenotyping', label: 'Digital Phenotyping', emoji: '📱' },
  { id: 'relaxation', label: 'Relaxation Guide', emoji: '🧘' },
  { id: 'overall', label: 'Multimodal Fusion', emoji: '🌐' },
];

export default function AdminUserListScreen({ navigation }) {
  const { logout } = useAuth();
  const [activeComponentTab, setActiveComponentTab] = useState('phenotyping');
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
          <Text style={[styles.title, { color: COLORS.light.text }]}>Clinical &amp; Admin Suite</Text>
          <Text style={[styles.subtitle, { color: COLORS.light.textMuted }]}>
            Multi-modal research biometrics &amp; telemetry hub
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.switchModeBtn}
            onPress={() => navigation.navigate('Physiological')}
            activeOpacity={0.8}
            accessibilityLabel="Switch to User Mode"
          >
            <Icon name="swap-horizontal" size={18} color={COLORS.brand} />
          </TouchableOpacity>
          <TouchableOpacity onPress={logout} style={styles.logoutIconBtn} accessibilityLabel="Log Out">
            <Icon name={NAMES.logout} size={18} color={COLORS.stress} />
          </TouchableOpacity>
        </View>
      </View>

      {/* 5-Component Top Tabs Strip */}
      <View style={{ marginBottom: 12 }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20 }}
          style={styles.compTabStrip}
        >
          {COMPONENT_TABS.map((tab) => {
            const isActive = activeComponentTab === tab.id;
            return (
              <TouchableOpacity
                key={tab.id}
                style={[styles.compTabItem, isActive && styles.compTabItemActive]}
                onPress={() => setActiveComponentTab(tab.id)}
                activeOpacity={0.75}
              >
                <Text style={{ fontSize: 14 }}>{tab.emoji}</Text>
                <Text style={[styles.compTabLabel, isActive && styles.compTabLabelActive]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Content Area for Selected Component */}
      <View style={{ flex: 1, paddingHorizontal: 20 }}>
        {activeComponentTab === 'phenotyping' && (
          <PhenotypingAdminHub navigation={navigation} />
        )}

        {activeComponentTab === 'hrv' && (
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
            <Card style={styles.bannerCard} accentColor={COLORS.brand}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ fontSize: 24 }}>💍</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.bannerTitle}>Physiological HRV &amp; Smart Ring</Text>
                  <Text style={styles.bannerSub}>Autonomic nervous system telemetry &amp; PPG stress indices</Text>
                </View>
              </View>
            </Card>

            <Text style={styles.sectionTitle}>Registered Physiological Users ({entries.length})</Text>
            {loading ? (
              <ActivityIndicator style={{ marginTop: 24 }} color={COLORS.brand} />
            ) : entries.length === 0 ? (
              <Card><Text style={{ color: COLORS.light.textMuted, textAlign: 'center' }}>No registered users found.</Text></Card>
            ) : (
              entries.map(([uid, record]) => (
                <Card key={uid} style={{ marginBottom: 10 }} onPress={() => navigation.navigate('AdminUserDetail', { userId: uid, name: record?.name })}>
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
          </ScrollView>
        )}

        {activeComponentTab === 'eeg' && (
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
            <Card style={styles.bannerCard} accentColor="#8B5CF6">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ fontSize: 24 }}>🧠</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.bannerTitle}>Physiological EEG Cognitive Monitoring</Text>
                  <Text style={styles.bannerSub}>Real-time brainwave bands (Alpha, Beta, Theta) &amp; cognitive load</Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.actionBannerBtn}
                onPress={() => navigation.navigate('AdminEegLive')}
                activeOpacity={0.85}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '900' }}>
                  Open Real-Time Live EEG Stream →
                </Text>
              </TouchableOpacity>
            </Card>

            <Text style={styles.sectionTitle}>EEG Users &amp; Sessions</Text>
            {loading ? (
              <ActivityIndicator style={{ marginTop: 24 }} color={COLORS.brand} />
            ) : entries.length === 0 ? (
              <Card><Text style={{ color: COLORS.light.textMuted, textAlign: 'center' }}>No EEG user sessions available.</Text></Card>
            ) : (
              entries.map(([uid, record]) => (
                <Card key={uid} style={{ marginBottom: 10 }} onPress={() => navigation.navigate('AdminUserDetail', { userId: uid, name: record?.name })}>
                  <View style={styles.row}>
                    <View style={[styles.avatar, { backgroundColor: '#8B5CF620' }]}>
                      <Icon name={NAMES.eeg} size={22} color="#8B5CF6" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.name, { color: COLORS.light.text }]}>{record?.name || uid}</Text>
                      <Text style={[styles.sub, { color: COLORS.light.textMuted }]}>
                        @{uid} · EEG telemetry &amp; baseline calibration
                      </Text>
                    </View>
                    <Icon name={NAMES.chevronRight} size={20} color={COLORS.light.textMuted} />
                  </View>
                </Card>
              ))
            )}
          </ScrollView>
        )}

        {activeComponentTab === 'relaxation' && (
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
            <Card style={styles.bannerCard} accentColor="#06B6D4">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ fontSize: 24 }}>🧘</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.bannerTitle}>Neuroadaptive Relaxation Interventions</Text>
                  <Text style={styles.bannerSub}>AI music generation, guided breathing, and biofeedback recovery</Text>
                </View>
              </View>
              <TouchableOpacity
                style={[styles.actionBannerBtn, { backgroundColor: '#06B6D4' }]}
                onPress={() => navigation.navigate('AdminRelaxation')}
                activeOpacity={0.85}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '900' }}>
                  Open Relaxation Guide Suite →
                </Text>
              </TouchableOpacity>
            </Card>

            <Card style={{ marginBottom: 12 }}>
              <Text style={{ fontSize: 14, fontWeight: '800', color: COLORS.light.text, marginBottom: 4 }}>
                Intervention Pipelines
              </Text>
              <Text style={{ fontSize: 11.5, color: COLORS.light.textMuted, lineHeight: 17 }}>
                Includes Cognitive Distraction Mini-Games, 4-7-8 Guided Breathing, Binaural Audio Sessions, and Post-Stress HRV Recovery Analytics.
              </Text>
            </Card>
          </ScrollView>
        )}

        {activeComponentTab === 'overall' && (
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
            <Card style={styles.bannerCard} accentColor="#F59E0B">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ fontSize: 24 }}>🌐</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.bannerTitle}>Multimodal Fusion Overall System</Text>
                  <Text style={styles.bannerSub}>Cross-modal synchronization: EEG + Smart Ring + Digital Phenotyping</Text>
                </View>
              </View>
              <TouchableOpacity
                style={[styles.actionBannerBtn, { backgroundColor: '#F59E0B' }]}
                onPress={() => navigation.navigate('AdminFusion')}
                activeOpacity={0.85}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '900' }}>
                  Open Multimodal Fusion Live Engine →
                </Text>
              </TouchableOpacity>
            </Card>

            <Card style={{ marginBottom: 12 }}>
              <Text style={{ fontSize: 14, fontWeight: '800', color: COLORS.light.text, marginBottom: 4 }}>
                Tri-Modal Real-Time Integration
              </Text>
              <Text style={{ fontSize: 11.5, color: COLORS.light.textMuted, lineHeight: 17 }}>
                Fuses Central Nervous System (EEG cognitive load) + Autonomic Nervous System (Ring HRV/EDA) + Behavioral Phone Phenotyping into a unified stress index.
              </Text>
            </Card>
          </ScrollView>
        )}
      </View>
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
  compTabStrip: { flexDirection: 'row' },
  compTabItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    marginRight: 8,
  },
  compTabItemActive: { backgroundColor: COLORS.brand },
  compTabLabel: { fontSize: 12, fontWeight: '750', color: COLORS.light.textMuted },
  compTabLabelActive: { color: '#FFFFFF' },
  bannerCard: { marginBottom: 12 },
  bannerTitle: { fontSize: 15, fontWeight: '900', color: COLORS.light.text },
  bannerSub: { fontSize: 11, color: COLORS.light.textMuted, marginTop: 2 },
  actionBannerBtn: {
    backgroundColor: '#8B5CF6',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
});
