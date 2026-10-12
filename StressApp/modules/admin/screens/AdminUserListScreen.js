// ============================================================
// AdminUserListScreen.js
// Admin home: KPI strip + per-component tabs. Lists every registered
// account (GET /users -- no ownership check, see backend/physiological/
// app.py) so an admin can inspect any user independent of who's logged
// into this phone. Refreshes itself every 25s while focused, plus
// pull-to-refresh; "Live now" comes from the same Firebase pointer the
// devices write (fusion_en_sessions/current_user_id), so it's push-based.
// ============================================================
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, TextInput,
} from 'react-native';
import axios from 'axios';
import { useFocusEffect } from '@react-navigation/native';
import { ref, onValue, off } from 'firebase/database';
import { db } from '../../../firebase';
import ScreenBackground from '../../shared/ScreenBackground';
import Card from '../../shared/Card';
import Badge from '../../shared/Badge';
import StatusDot from '../../shared/StatusDot';
import Icon, { NAMES } from '../../shared/Icon';
import { COLORS } from '../../physiological/config/theme';
import { TYPE, SPACE, RADIUS, ELEVATION } from '../../shared/theme/tokens';
import api from '../../physiological/api/client';
import { API_BASE, DEVICE_ID } from '../../physiological/config/config';
import { useAuth } from '../../../context/AuthContext';
import PhenotypingAdminHub from './PhenotypingAdminHub';

const LIST_REFRESH_MS = 25000;
const DEVICE_POLL_MS = 10000;

function joinedAgo(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  const d = Math.floor(ms / 86400000);
  if (d < 1) return 'joined today';
  if (d < 30) return `joined ${d}d ago`;
  return `joined ${new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}`;
}

const TABS = [
  { id: 'hrv', label: 'Ring HRV/GSR', icon: NAMES.my, tint: COLORS.hrv },
  { id: 'eeg', label: 'EEG', icon: NAMES.eeg, tint: COLORS.warning },
  { id: 'phenotyping', label: 'Phenotyping', icon: NAMES.phenotyping, tint: COLORS.gsr },
  { id: 'relaxation', label: 'Relaxation', icon: NAMES.intervention, tint: COLORS.secondary },
  { id: 'overall', label: 'Fusion', icon: NAMES.overview, tint: COLORS.brand },
];

function Kpi({ icon, tint, value, label }) {
  return (
    <View style={styles.kpi}>
      <View style={styles.kpiTop}>
        <View style={[styles.kpiIcon, { backgroundColor: tint + '1A' }]}>
          <Icon name={icon} size={16} color={tint} />
        </View>
        <Text style={styles.kpiValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{value}</Text>
      </View>
      <Text style={styles.kpiLabel} numberOfLines={2}>{label}</Text>
    </View>
  );
}

function ComponentBanner({ icon, tint, title, subtitle, actionLabel, onAction }) {
  return (
    <Card style={styles.banner} accentColor={tint}>
      <View style={styles.row}>
        <View style={[styles.avatar, { backgroundColor: tint + '1A' }]}>
          <Icon name={icon} size={22} color={tint} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerTitle}>{title}</Text>
          <Text style={styles.bannerSub}>{subtitle}</Text>
        </View>
      </View>
      {actionLabel ? (
        <TouchableOpacity style={[styles.bannerBtn, { backgroundColor: tint }]} onPress={onAction} activeOpacity={0.85}>
          <Text style={styles.bannerBtnText}>{actionLabel}</Text>
          <Icon name="arrow-right" size={16} color="#FFFFFF" />
        </TouchableOpacity>
      ) : null}
    </Card>
  );
}

function UserListRow({ uid, record, tint, subtitle, isLive, onPress }) {
  const letter = (record?.name || uid || '?').trim().charAt(0).toUpperCase();
  return (
    <Card style={styles.userCard} onPress={onPress}>
      <View style={styles.row}>
        <View style={[styles.avatar, { backgroundColor: tint + '1A' }]}>
          <Text style={[styles.avatarLetter, { color: tint }]}>{letter}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>{record?.name || uid}</Text>
            {isLive ? <Badge label="Live" color={COLORS.normal} size="sm" /> : null}
          </View>
          <Text style={styles.sub} numberOfLines={1}>@{uid} · {subtitle}</Text>
        </View>
        <Icon name={NAMES.chevronRight} size={20} color={COLORS.light.textMuted} />
      </View>
    </Card>
  );
}

const DEFAULT_VISIBLE_USERS = 10;

export default function AdminUserListScreen({ navigation }) {
  const { logout } = useAuth();
  const [showPhoneHub, setShowPhoneHub] = useState(false);
  const [users, setUsers] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [liveUserId, setLiveUserId] = useState(null);
  const [search, setSearch] = useState('');
  const [expandedUsers, setExpandedUsers] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await api.get('/users');
      setUsers(res.data?.users || {});
    } catch {
      setUsers((prev) => prev || {});
    } finally {
      inFlight.current = false;
    }
  }, []);

  useFocusEffect(useCallback(() => {
    load();
    const timer = setInterval(load, LIST_REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]));

  useEffect(() => {
    const pointer = ref(db, 'fusion_en_sessions/current_user_id');
    const h = onValue(pointer, (snap) => setLiveUserId(snap.val() || null));
    return () => off(pointer, 'value', h);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const entries = users ? Object.entries(users) : [];
  // Live user first, then NEWEST accounts -- a just-registered user with
  // 0 sessions used to sink to the bottom of a long list and look missing.
  const q = search.trim().toLowerCase();
  const sorted = entries
    .filter(([uid, r]) => !q || `${uid} ${r?.name || ''}`.toLowerCase().includes(q))
    .sort(([a, ra], [b, rb]) => {
      if (a === liveUserId) return -1;
      if (b === liveUserId) return 1;
      return (new Date(rb?.created_at || 0).getTime() || 0) - (new Date(ra?.created_at || 0).getTime() || 0);
    });
  const totalSessions = entries.reduce((s, [, r]) => s + (r?.session_count ?? 0), 0);
  const refresh = <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.brand} />;

  // Phone research hub (teammate's module) still reachable, just not as a tab.
  if (showPhoneHub) {
    return (
      <ScreenBackground>
        <TouchableOpacity style={styles.hubBack} onPress={() => setShowPhoneHub(false)}>
          <Icon name={NAMES.back} size={20} color="#0F172A" />
          <Text style={[styles.hubBackText, { color: '#0F172A' }]}>All users</Text>
        </TouchableOpacity>
        <View style={styles.body}><PhenotypingAdminHub navigation={navigation} /></View>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} refreshControl={refresh}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>MindPulse</Text>
            <Text style={styles.title}>Clinical dashboard</Text>
          </View>
          <TouchableOpacity style={[styles.headerBtn, { backgroundColor: COLORS.brandSoft }]}
            onPress={() => navigation.navigate('Physiological')} accessibilityLabel="Switch to user app">
            <Icon name="swap-horizontal" size={18} color={COLORS.brand} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.headerBtn, { backgroundColor: COLORS.stressSoft }]}
            onPress={logout} accessibilityLabel="Log out">
            <Icon name={NAMES.logout} size={18} color={COLORS.stress} />
          </TouchableOpacity>
        </View>

        {/* KPI strip -- same four numbers as the website */}
        <View style={styles.kpiRow}>
          <Kpi icon="account-group-outline" tint={COLORS.brand} value={users ? entries.length : '—'} label="Users" />
          <Kpi icon="access-point" tint={liveUserId ? COLORS.normal : COLORS.light.textMuted}
            value={liveUserId ? '1' : '0'} label={liveUserId ? `Live: ${users?.[liveUserId]?.name || liveUserId}` : 'Live now'} />
          <Kpi icon="history" tint={COLORS.warning} value={users ? totalSessions : '—'} label="Sessions" />
        </View>

        <View style={styles.body}>
          <TextInput style={styles.search} placeholder="Search users…" placeholderTextColor={COLORS.light.textMuted}
            value={search} onChangeText={setSearch} autoCapitalize="none" autoCorrect={false} />

          {/* List Title Row with User Count & Expand/Compact Toggle */}
          <View style={styles.listHeaderRow}>
            <View style={styles.listHeaderLeft}>
              <Text style={styles.listTitle}>Users · live first, then newest</Text>
              {sorted.length > 0 ? (
                <View style={styles.userCountBadge}>
                  <Text style={styles.userCountBadgeText}>{sorted.length}</Text>
                </View>
              ) : null}
            </View>
            {sorted.length > DEFAULT_VISIBLE_USERS ? (
              <TouchableOpacity
                style={styles.expandToggleBtn}
                onPress={() => setExpandedUsers((prev) => !prev)}
                activeOpacity={0.7}
              >
                <Text style={styles.expandToggleBtnText}>
                  {expandedUsers ? 'Compact (10)' : `View all (${sorted.length})`}
                </Text>
                <Icon
                  name={expandedUsers ? 'chevron-up' : 'chevron-down'}
                  size={14}
                  color={COLORS.brand}
                />
              </TouchableOpacity>
            ) : null}
          </View>

          {users === null ? (
            <ActivityIndicator style={{ marginTop: SPACE.xxl }} color={COLORS.brand} />
          ) : sorted.length === 0 ? (
            <Card><Text style={styles.empty}>{q ? 'No users match your search.' : 'No registered users yet.'}</Text></Card>
          ) : !expandedUsers && sorted.length > DEFAULT_VISIBLE_USERS ? (
            /* Scrollable box displaying 10 default items with inner scrolling */
            <View style={styles.userListScrollBox}>
              <ScrollView
                nestedScrollEnabled={true}
                showsVerticalScrollIndicator={true}
                style={styles.userListScroll}
                contentContainerStyle={styles.userListScrollContent}
              >
                {sorted.map(([uid, record]) => (
                  <UserListRow
                    key={uid}
                    uid={uid}
                    record={record}
                    tint={COLORS.brand}
                    subtitle={[`${record?.session_count ?? 0} sessions`, joinedAgo(record?.created_at)].filter(Boolean).join(' · ')}
                    isLive={uid === liveUserId}
                    onPress={() => navigation.navigate('AdminUserDetail', { userId: uid, name: record?.name, initialTab: 'Fusion' })}
                  />
                ))}
              </ScrollView>
            </View>
          ) : (
            <View style={styles.userListDirect}>
              {sorted.map(([uid, record]) => (
                <UserListRow
                  key={uid}
                  uid={uid}
                  record={record}
                  tint={COLORS.brand}
                  subtitle={[`${record?.session_count ?? 0} sessions`, joinedAgo(record?.created_at)].filter(Boolean).join(' · ')}
                  isLive={uid === liveUserId}
                  onPress={() => navigation.navigate('AdminUserDetail', { userId: uid, name: record?.name, initialTab: 'Fusion' })}
                />
              ))}
            </View>
          )}

          {/* MORE TOOLS - 3 CARDS IN ONE SINGLE LINE, ENLARGED & HIGHLIGHTED */}
          <View style={styles.moreToolsHeaderRow}>
            <Text style={styles.listTitle}>More tools</Text>
            <View style={styles.toolsCountBadge}>
              <Text style={styles.toolsCountBadgeText}>3 Modules</Text>
            </View>
          </View>

          <View style={styles.toolsRow}>
            {/* Tool 1: Live EEG Stream */}
            <TouchableOpacity
              style={[styles.tool, styles.toolEeg]}
              activeOpacity={0.82}
              onPress={() => navigation.navigate('AdminEegLive', liveUserId ? { userId: liveUserId } : undefined)}
            >
              <View style={[styles.toolIconWrap, { backgroundColor: COLORS.warning + '1A' }]}>
                <Icon name={NAMES.eeg} size={20} color={COLORS.warning} />
              </View>
              <View style={styles.toolTextCol}>
                <View style={styles.toolTitleRow}>
                  <Text style={styles.toolText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
                    Live EEG stream
                  </Text>
                  {liveUserId ? <StatusDot color={COLORS.normal} size={7} /> : null}
                </View>
              </View>
            </TouchableOpacity>

            {/* Tool 2: Phone Research Hub */}
            <TouchableOpacity
              style={[styles.tool, styles.toolPheno]}
              activeOpacity={0.82}
              onPress={() => setShowPhoneHub(true)}
            >
              <View style={[styles.toolIconWrap, { backgroundColor: '#0284C71A' }]}>
                <Icon name={NAMES.phenotyping} size={20} color="#0284C7" />
              </View>
              <View style={styles.toolTextCol}>
                <Text style={styles.toolText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
                  Phone research hub
                </Text>
              </View>
            </TouchableOpacity>

            {/* Tool 3: Relaxation Suite */}
            <TouchableOpacity
              style={[styles.tool, styles.toolRelax]}
              activeOpacity={0.82}
              onPress={() => navigation.navigate('AdminRelaxation')}
            >
              <View style={[styles.toolIconWrap, { backgroundColor: COLORS.secondary + '1A' }]}>
                <Icon name={NAMES.intervention} size={20} color={COLORS.secondary} />
              </View>
              <View style={styles.toolTextCol}>
                <Text style={styles.toolText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
                  Relaxation suite
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm,
    paddingHorizontal: SPACE.xl, paddingTop: SPACE.lg, paddingBottom: SPACE.md,
  },
  eyebrow: { ...TYPE.micro, color: COLORS.brand },
  title: { ...TYPE.display, color: COLORS.light.text, marginTop: 2 },
  headerBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },

  kpiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, paddingHorizontal: SPACE.xl, marginBottom: SPACE.md },
  kpi: {
    flexGrow: 1, flexBasis: 96, minWidth: 0, padding: SPACE.md, borderRadius: RADIUS.lg,
    backgroundColor: COLORS.light.card, borderWidth: 1, borderColor: COLORS.light.border,
  },
  kpiTop: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, marginBottom: 4 },
  kpiIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  kpiValue: { flexShrink: 1, fontSize: 20, fontWeight: '800', color: COLORS.light.text, letterSpacing: -0.4 },
  kpiLabel: { ...TYPE.caption, color: COLORS.light.textMuted, marginTop: 1 },

  // User list scrollable box for > 10 items
  userListScrollBox: {
    maxHeight: 640,
    borderRadius: RADIUS.lg,
    borderWidth: 1.5,
    borderColor: COLORS.light.border,
    backgroundColor: '#FAF8F4',
    padding: 8,
    marginBottom: SPACE.xs,
    overflow: 'hidden',
  },
  userListScroll: {
    maxHeight: 590,
  },
  userListScrollContent: { paddingBottom: 4 },
  userListDirect: { marginBottom: SPACE.xs },
  listHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: SPACE.sm,
  },
  listHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  userCountBadge: {
    backgroundColor: COLORS.brandSoft, paddingHorizontal: 7, paddingVertical: 2, borderRadius: RADIUS.pill,
  },
  userCountBadgeText: { fontSize: 10, fontWeight: '800', color: COLORS.brand },
  expandToggleBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.light.card, borderWidth: 1, borderColor: COLORS.light.border,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.pill,
  },
  expandToggleBtnText: { fontSize: 11, fontWeight: '700', color: COLORS.brand },

  // More tools - 3 cards in ONE line, enlarged & highlighted
  moreToolsHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: SPACE.xl, marginBottom: SPACE.sm,
  },
  toolsCountBadge: {
    backgroundColor: COLORS.brandSoft, paddingHorizontal: 8, paddingVertical: 2.5, borderRadius: RADIUS.pill,
  },
  toolsCountBadgeText: { fontSize: 10, fontWeight: '800', color: COLORS.brand, letterSpacing: 0.3 },
  toolsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
  },
  tool: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 10, paddingVertical: 14,
    borderRadius: RADIUS.lg, backgroundColor: '#FFFFFF',
    borderWidth: 2, borderColor: COLORS.light.border,
    shadowColor: '#1E293B',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  toolEeg: {
    borderColor: COLORS.warning,
    backgroundColor: '#FFFFFF',
  },
  toolPheno: {
    borderColor: '#0284C7',
    backgroundColor: '#FFFFFF',
  },
  toolRelax: {
    borderColor: COLORS.secondary,
    backgroundColor: '#FFFFFF',
  },
  toolIconWrap: {
    width: 34, height: 34, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  toolTextCol: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  toolTitleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  toolText: {
    fontSize: 13, fontWeight: '800', color: COLORS.light.text, letterSpacing: -0.2,
  },

  hubBack: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: SPACE.xl, paddingTop: SPACE.lg, paddingBottom: SPACE.sm },
  hubBackText: { color: COLORS.brand, fontWeight: '700' },
  tabStrip: {
    marginHorizontal: SPACE.xl, marginBottom: SPACE.md, padding: 4, gap: 4,
    backgroundColor: COLORS.light.pillBg, borderRadius: RADIUS.pill,
  },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADIUS.pill,
  },
  tabOn: {
    backgroundColor: COLORS.light.card,
    shadowColor: '#1E293B', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  search: {
    height: 44, borderRadius: RADIUS.md, borderWidth: 1.5, borderColor: COLORS.light.border,
    backgroundColor: '#FDFCF9', paddingHorizontal: 14, fontSize: 14, color: COLORS.light.text, marginBottom: SPACE.md,
  },
  avatarLetter: { fontSize: 17, fontWeight: '900' },
  tabLabel: { fontSize: 12, fontWeight: '700', color: COLORS.light.textSub },

  body: { flex: 1, paddingHorizontal: SPACE.xl },
  scroll: { paddingBottom: SPACE.xxxl },

  banner: { marginBottom: SPACE.lg },
  bannerTitle: { ...TYPE.title, color: COLORS.light.text },
  bannerSub: { fontSize: 12, color: COLORS.light.textMuted, marginTop: 2, lineHeight: 17 },
  bannerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: SPACE.md, paddingVertical: 11, borderRadius: RADIUS.md,
  },
  bannerBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },

  listTitle: { ...TYPE.micro, color: COLORS.light.textMuted },
  userCard: { marginBottom: SPACE.sm, padding: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 15, fontWeight: '800', color: COLORS.light.text, flexShrink: 1 },
  sub: { fontSize: 12, color: COLORS.light.textMuted, marginTop: 2 },
  empty: { color: COLORS.light.textMuted, textAlign: 'center' },
});
