import { getContentWidth } from '../../shared/theme/layout';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated, Alert, ActivityIndicator, Dimensions
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { ref as dbRef, set as dbSet, onValue, off } from 'firebase/database';
import { db } from '../../../firebase';
import ScreenBackground from '../../shared/ScreenBackground';
import Card from '../../shared/Card';
import Icon, { NAMES } from '../../shared/Icon';
import { CalibrationBanner, useCalibrationSummary } from '../../shared/CalibrationGate';
import CalibrateBreathingCard from '../../shared/CalibrateBreathingCard';
import { useTheme } from '../config/ThemeContext';
import { COLORS } from '../config/theme';
import { useAuth } from '../../../context/AuthContext';
import api from '../api/client';

// Avatar stored as a compressed base64 image directly in the Realtime
// Database (users/{userId}/avatar_base64) rather than Firebase Storage --
// this project has no storageBucket configured anywhere and Storage may
// not even be enabled for it, which I can't verify from here. RTDB is
// already used for everything else in this app and is confirmed working,
// so a small (resized + compressed) image as a data URI avoids depending
// on an unverified external service for a feature this central.
const AVATAR_SIZE = 96;
// navCard now has its own marginHorizontal (20, see styles below) on top
// of its `padding: 18` -- both insets have to come off the screen width
// or the chart overflows the card's own edges.
const DRIFT_CHART_WIDTH = getContentWidth() - 2 * 20 - 2 * 18;

// Deliberately lean -- this used to also fold in a full History section
// (raw baseline numbers, session distribution, PSS-4 score list, recent
// sessions) per the earlier redesign pass. Per the User-App/Admin-App
// split, all of that moved to the Admin app (modules/admin/), which any
// registered account can reach via this screen's "Clinical & Admin Suite"
// card below if they want the raw detail -- this screen only keeps what a
// real user actually needs day to day.
function AvatarPicker({ userId, avatarUri, uploading, onPick, accentColor }) {
  return (
    <TouchableOpacity onPress={onPick} activeOpacity={0.85} style={styles.avatarWrap}>
      <View style={[styles.avatarCircle, { backgroundColor: accentColor + '20', borderColor: accentColor + '50' }]}>
        {uploading ? (
          <ActivityIndicator color={accentColor} />
        ) : avatarUri ? (
          <Animated.Image source={{ uri: avatarUri }} style={styles.avatarImage} />
        ) : (
          <Icon name={NAMES.profile} size={40} color={accentColor} />
        )}
      </View>
      <View style={[styles.cameraBadge, { backgroundColor: accentColor }]}>
        <Icon name={NAMES.camera} size={13} color="#FFFFFF" />
      </View>
    </TouchableOpacity>
  );
}

export default function ProfileScreen({ navigation }) {
  const { theme, COLORS } = useTheme();
  const { user, token, logout } = useAuth();
  const userId = user?.userId;

  // Calibration itself (personal thresholds, the Ring/EEG "Calibrate --
  // Calm Breathing" trigger, and the staleness/drift CalibrationBanner
  // below) used to live inline on the Fusion page -- moved here since
  // Profile is where account/device setup actually belongs, and Fusion's
  // own copies were pure duplication once these existed here. Reused,
  // not re-fetched, from the same GET /baseline/{userId} + GET
  // /calibration/status CalibrationBanner (below) also calls.
  const { ring: ringCalibration, eeg: eegCalibration } = useCalibrationSummary(userId, token);
  const personalEegPct = eegCalibration?.personal_high_load_p != null
    ? Math.round(eegCalibration.personal_high_load_p * 100) : null;
  const personalRingPct = ringCalibration?.personal_stress_threshold != null
    ? Math.round(ringCalibration.personal_stress_threshold * 100) : null;

  const [baseline,     setBaseline]     = useState(null);
  const [sessionCount, setSessionCount] = useState(0);
  const [avatarUri,    setAvatarUri]    = useState(null);
  const [uploading,    setUploading]    = useState(false);
  const [driftWeeks,   setDriftWeeks]   = useState(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [calibrateOpen, setCalibrateOpen] = useState(false);

  const text   = theme.text;
  const muted  = theme.textMuted;

  const loadProfile = async () => {
    if (!userId) return;
    try {
      const [b, h, d] = await Promise.all([
        api.get(`/baseline/${userId}`),
        api.get(`/history/${userId}`),
        api.get(`/baseline/${userId}/drift-history`).catch(() => null),
      ]);
      setBaseline(b.data);
      setSessionCount(Object.keys(h.data?.sessions || {}).length);
      setDriftWeeks(d?.data?.weeks || null);
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start();
    } catch (e) {
      console.log('Profile load error:', e.message);
    }
  };

  useEffect(() => { loadProfile(); }, [userId]);
  useFocusEffect(useCallback(() => { loadProfile(); }, [userId]));

  useEffect(() => {
    if (!userId) return;
    const ref = dbRef(db, `users/${userId}/avatar_base64`);
    const handler = onValue(ref, (snap) => setAvatarUri(snap.val() || null));
    return () => off(ref, 'value', handler);
  }, [userId]);

  const pickAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to set a profile picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.4,   // keep the base64 payload small for an RTDB write
      base64: true,
    });
    if (result.canceled || !result.assets?.[0]?.base64) return;

    const dataUri = `data:image/jpeg;base64,${result.assets[0].base64}`;
    // ~1.4x base64 overhead -- warn rather than silently fail on a huge photo.
    if (dataUri.length > 700_000) {
      Alert.alert('Photo too large', 'Please pick a smaller image or allow more compression.');
      return;
    }
    setUploading(true);
    try {
      await dbSet(dbRef(db, `users/${userId}/avatar_base64`), dataUri);
      setAvatarUri(dataUri);
    } catch (e) {
      Alert.alert('Upload failed', e.message);
    }
    setUploading(false);
  };

  // Same three steps as the website's Calibrate page (web/src/pages/SetupPage.jsx).
  const baselineDone = !!ringCalibration?.exists || !!eegCalibration?.exists || !!baseline?.exists;
  const personalised = personalEegPct != null && personalRingPct != null;
  const showBreathing = calibrateOpen || !baselineDone;

  return (
    <ScreenBackground>
      <Animated.ScrollView style={{ opacity: fadeAnim }} showsVerticalScrollIndicator={false}>

        <TouchableOpacity
          activeOpacity={0.8}
          style={styles.backRow}
          onPress={() => navigation.goBack()}
        >
          <Icon name={NAMES.back} size={20} color={COLORS.brand} />
          <Text style={[styles.backText, { color: COLORS.brand }]}>Back</Text>
        </TouchableOpacity>

        {/* Identity header */}
        <View style={styles.header}>
          <AvatarPicker userId={userId} avatarUri={avatarUri} uploading={uploading} onPick={pickAvatar} accentColor={COLORS.brand} />
          <View style={{ flex: 1, marginLeft: 6 }}>
            <Text style={[styles.name, { color: text }]}>{user?.name || userId}</Text>
            <View style={[styles.userBadge, { backgroundColor: COLORS.brandSoft, borderColor: COLORS.brand + '30' }]}>
              <Text style={[styles.userBadgeText, { color: COLORS.brandDark }]}>@{userId}</Text>
            </View>
          </View>
        </View>

        <Text style={[styles.sectionHeading, { color: muted }]}>Calibrate</Text>
        {/* Staleness/drift warning (points at the steps below). */}
        <CalibrationBanner userId={userId} token={token} db={db} />

        {/* Step 2 -- calm-breathing baseline */}
        <Step n={1} title="Calm-breathing calibration" done={baselineDone}>
          {showBreathing ? (
            <>
              <CalibrateBreathingCard
                userId={userId}
                token={token}
                eegDb={db}
                onComplete={() => { setCalibrateOpen(false); loadProfile(); }}
              />
              {baselineDone && (
                <TouchableOpacity onPress={() => setCalibrateOpen(false)} style={styles.linkBtn}>
                  <Text style={[styles.linkBtnText, { color: muted }]}>Cancel</Text>
                </TouchableOpacity>
              )}
            </>
          ) : (
            <View style={styles.stepActionRow}>
              <Text style={[styles.cardSub, { color: muted, flex: 1, marginTop: 0 }]}>Your calm baseline is saved.</Text>
              <PillButton icon="refresh" label="Recalibrate" onPress={() => setCalibrateOpen(true)} />
            </View>
          )}
        </Step>

        {/* Step 3 -- personal limit test (maths + Stroop) */}
        <Step n={2} title="Personal limit test (≈ 8 min)" done={personalised}>
          {(personalEegPct != null || personalRingPct != null) ? (
            <View style={styles.limitsRow}>
              <View style={[styles.limitBox, { backgroundColor: COLORS.warning + '14' }]}>
                <Text style={[styles.limitLabel, { color: muted }]}>MIND (HEADBAND)</Text>
                <Text style={[styles.limitValue, { color: COLORS.warningDark }]}>{personalEegPct != null ? `${personalEegPct}%` : 'Standard'}</Text>
              </View>
              <View style={[styles.limitBox, { backgroundColor: COLORS.hrv + '14' }]}>
                <Text style={[styles.limitLabel, { color: muted }]}>BODY (RING)</Text>
                <Text style={[styles.limitValue, { color: COLORS.normalDark }]}>{personalRingPct != null ? `${personalRingPct}%` : 'Standard'}</Text>
              </View>
            </View>
          ) : (
            <Text style={[styles.cardSub, { color: muted, marginTop: 0 }]}>
              {baselineDone
                ? 'A short maths + colour-word task that finds where YOUR stress starts.'
                : 'Unlocks after step 1 — it needs your calm baseline to compare against.'}
            </Text>
          )}
          {baselineDone && (
            <View style={[styles.stepActionRow, { justifyContent: 'flex-end', marginTop: 12 }]}>
              <PillButton icon="clipboard-text-outline" label={personalised ? 'Take test again' : 'Start the test'}
                onPress={() => navigation.navigate('ThresholdCalibration')} />
            </View>
          )}
        </Step>

        {/* Clinical view + sign out */}
        <Text style={[styles.sectionHeading, { color: muted }]}>Account</Text>
        <TouchableOpacity style={styles.clinicalBtn} activeOpacity={0.88} onPress={() => navigation.navigate('Admin')}>
          <View style={styles.clinicalIcon}>
            <Icon name={NAMES.admin} size={20} color="#FFFFFF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.clinicalTitle}>Clinical view</Text>
            <Text style={styles.clinicalSub}>Full sensor detail for researchers and clinicians</Text>
          </View>
          <Icon name={NAMES.chevronRight} size={22} color="#FFFFFF" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.logoutBtn} activeOpacity={0.85} onPress={logout}>
          <Icon name={NAMES.logout} size={18} color={COLORS.stressDark} />
          <Text style={styles.logoutText}>Sign out</Text>
        </TouchableOpacity>

        <View style={{ height: 60 }} />
      </Animated.ScrollView>
    </ScreenBackground>
  );
}

// Numbered step card -- same look as the website's Calibrate steps.
function Step({ n, title, done, children }) {
  return (
    <Card style={styles.stepCard}>
      <View style={styles.stepHead}>
        <View style={[styles.stepNum, done && { backgroundColor: COLORS.normalSoft }]}>
          <Text style={[styles.stepNumText, done && { color: COLORS.normalDark }]}>{done ? '✓' : n}</Text>
        </View>
        <Text style={styles.stepTitle}>{title}</Text>
        {done ? (
          <View style={styles.donePill}><Text style={styles.donePillText}>Done</Text></View>
        ) : null}
      </View>
      {children}
    </Card>
  );
}

function DeviceStatus({ icon, tint, name, online, detail }) {
  return (
    <View style={styles.deviceChip}>
      <View style={[styles.deviceIcon, { backgroundColor: tint + '1C' }]}>
        <Icon name={icon} size={18} color={tint} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.deviceName}>{name}</Text>
        <Text style={styles.deviceDetail} numberOfLines={1}>{detail}</Text>
      </View>
      <View style={[styles.liveDot, { backgroundColor: online ? COLORS.normal : COLORS.light.border }]} />
    </View>
  );
}

function PillButton({ icon, label, onPress }) {
  return (
    <TouchableOpacity style={styles.pillBtn} activeOpacity={0.85} onPress={onPress}>
      <Icon name={icon} size={16} color="#FFFFFF" />
      <Text style={styles.pillBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  stepCard: { marginHorizontal: 20, marginBottom: 12, padding: 18 },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  stepNum: { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.brandSoft, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { fontSize: 13, fontWeight: '900', color: COLORS.brandDark },
  stepTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: COLORS.light.text },
  donePill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: COLORS.normalSoft },
  donePillText: { fontSize: 11, fontWeight: '800', color: COLORS.normalDark },
  deviceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  deviceChip: {
    flexGrow: 1, flexBasis: 140, flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: 14, borderWidth: 1, borderColor: COLORS.light.borderSoft, backgroundColor: '#FDFCF9',
  },
  deviceIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  deviceName: { fontSize: 14, fontWeight: '800', color: COLORS.light.text },
  deviceDetail: { fontSize: 11, fontWeight: '600', color: COLORS.light.textMuted, marginTop: 1 },
  liveDot: { width: 10, height: 10, borderRadius: 5 },
  stepActionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  pillBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.brand,
    paddingHorizontal: 18, paddingVertical: 11, borderRadius: 24,
    shadowColor: COLORS.brandDark, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.22, shadowRadius: 8, elevation: 3,
  },
  pillBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  linkBtn: { alignSelf: 'center', paddingVertical: 8, marginTop: 4 },
  linkBtnText: { fontSize: 13, fontWeight: '700' },
  limitsRow: { flexDirection: 'row', gap: 10 },
  limitBox: { flex: 1, borderRadius: 14, padding: 14 },
  limitLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  limitValue: { fontSize: 24, fontWeight: '900', marginTop: 2, letterSpacing: -0.4 },
  clinicalBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: 20, marginBottom: 12,
    padding: 16, borderRadius: 22, backgroundColor: COLORS.brand,
    shadowColor: COLORS.brandDark, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.25, shadowRadius: 16, elevation: 5,
  },
  clinicalIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  clinicalTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  clinicalSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '600', marginTop: 2 },
  backRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginTop: 12, marginBottom: 6 },
  backText: { fontSize: 13, fontWeight: '700', marginLeft: 2 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14 },
  avatarWrap: { position: 'relative' },
  avatarCircle: { width: 72, height: 72, borderRadius: 36, borderWidth: 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImage: { width: '100%', height: '100%' },
  cameraBadge: { position: 'absolute', bottom: -2, right: -2, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF' },
  name: { fontSize: 22, fontWeight: '900', letterSpacing: -0.2 },
  userBadge: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, marginTop: 4 },
  userBadgeText: { fontSize: 11, fontWeight: '800' },
  statsRow: { flexDirection: 'row', gap: 10, marginHorizontal: 20, marginBottom: 4 },
  statCard: { flex: 1, alignItems: 'center', padding: 16 },
  statValue: { fontSize: 18, fontWeight: '900' },
  statLabel: { fontSize: 11, marginTop: 3, fontWeight: '600' },
  navCard: { marginHorizontal: 20, marginBottom: 12, padding: 18 },
  sectionHeading: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', marginHorizontal: 24, marginTop: 18, marginBottom: 8 },
  driftPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  driftPillText: { fontSize: 11, fontWeight: '800' },
  thresholdRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  thresholdValue: { fontSize: 14, fontWeight: '900' },
  actionIconCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle: { fontSize: 15, fontWeight: '800' },
  cardSub: { fontSize: 12, marginTop: 6, lineHeight: 17 },
  actionTile: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, borderWidth: 1, padding: 14 },
  actionLabel: { fontSize: 13, fontWeight: '800' },
  actionSub: { fontSize: 11, marginTop: 2 },
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: 20, marginTop: 4, paddingVertical: 15, borderRadius: 22,
    backgroundColor: COLORS.stressSoft, borderWidth: 1, borderColor: COLORS.stress + '33',
  },
  logoutText: { fontSize: 15, fontWeight: '800', color: COLORS.stressDark },
});
