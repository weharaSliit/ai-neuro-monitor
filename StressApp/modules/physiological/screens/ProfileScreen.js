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
import LineChart from '../../shared/LineChart';
import { useCalibrationSummary } from '../../shared/CalibrationGate';
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
// navCard (styles below) has no outer marginHorizontal -- its Card renders
// edge-to-edge, only its own `padding: 18` insets the content -- so the
// chart just needs to subtract that padding from either side, not a
// screen margin too.
const DRIFT_CHART_WIDTH = Dimensions.get('window').width - 2 * 18;

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

  // Calibration itself (personal thresholds + the Ring/EEG "Calibrate --
  // Calm Breathing" trigger) used to live inline on the Fusion page --
  // moved here since Profile is where account/device setup actually
  // belongs, and Fusion's own copy was pure duplication once this one
  // existed. Reused, not re-fetched, from the same GET /baseline/{userId}
  // + GET /calibration/status CalibrationBanner already calls elsewhere.
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

        {/* Stats row */}
        <View style={styles.statsRow}>
          <Card style={styles.statCard}>
            <Text style={[styles.statValue, { color: COLORS.brand }]}>{sessionCount}</Text>
            <Text style={[styles.statLabel, { color: muted }]}>Total Sessions</Text>
          </Card>
          <Card style={styles.statCard}>
            <Text style={[styles.statValue, { color: baseline?.exists ? COLORS.normal : COLORS.warning }]}>
              {baseline?.exists ? 'Calibrated' : 'Pending'}
            </Text>
            <Text style={[styles.statLabel, { color: muted }]}>Ring Baseline</Text>
          </Card>
        </View>

        {/* Personalized thresholds: only rendered once at least one side
            has actually separated Rest from Task (the onboarding maths+
            Stroop task below) -- a user who's only done resting-baseline
            calibration still sees nothing here rather than a premature
            "Standard" placeholder for a task they haven't run yet. */}
        {(personalEegPct != null || personalRingPct != null) && (
          <Card style={styles.navCard} accentColor={COLORS.brand}>
            <Text style={[styles.cardTitle, { color: text }]}>Your Personalized Thresholds</Text>
            <View style={styles.thresholdRow}>
              <Text style={[styles.cardSub, { color: muted }]}>EEG high-load</Text>
              <Text style={[styles.thresholdValue, { color: text }]}>
                {personalEegPct != null ? `${personalEegPct}%` : 'Standard'}
              </Text>
            </View>
            <View style={styles.thresholdRow}>
              <Text style={[styles.cardSub, { color: muted }]}>Ring stress</Text>
              <Text style={[styles.thresholdValue, { color: text }]}>
                {personalRingPct != null ? `${personalRingPct}%` : 'Standard'}
              </Text>
            </View>
          </Card>
        )}

        {/* Calibrate -- Calm Breathing: a plain breathe-in/breathe-out
            visual while real Ring+EEG resting calibration runs in the
            background. */}
        <Card style={styles.navCard} accentColor={COLORS.brand}>
          <Text style={[styles.cardTitle, { color: text, marginBottom: 10 }]}>Calibrate — Calm Breathing</Text>
          <CalibrateBreathingCard
            userId={userId}
            token={token}
            eegDb={db}
            onComplete={loadProfile}
          />
        </Card>

        {/* Retake Threshold Test: the maths+Stroop task that separates
            Rest from Task for the personal thresholds above -- normally
            run once during onboarding (AccountSetupScreen.js), kept here
            too so a returning user can try it back any time (e.g. their
            first run didn't separate cleanly enough to personalize). */}
        <Card onPress={() => navigation.navigate('ThresholdCalibration')} style={styles.navCard}>
          <View style={styles.cardHeaderRow}>
            <View style={styles.rowGap}>
              <View style={[styles.actionIconCircle, { backgroundColor: COLORS.brandSoft }]}>
                <Icon name={NAMES.calibration} size={18} color={COLORS.brand} />
              </View>
              <Text style={[styles.cardTitle, { color: text }]}>Threshold Test (Maths + Stroop)</Text>
            </View>
            <Icon name={NAMES.chevronRight} size={18} color={muted} />
          </View>
          <Text style={[styles.cardSub, { color: muted }]}>
            Retake the maths-quiz + color-word task anytime to re-personalize your thresholds.
          </Text>
        </Card>

        {/* Calibration drift -- weekly mean predicted-stress vs. the resting
            baseline captured at calibration time, so a shift shows up as a
            visual gap from the dashed line rather than a raw number. Weeks
            with too few predictions to be meaningful are dropped server-side
            (compute_baseline_drift_history() returns mean_prob_stress: null
            for those), not shown as zero. */}
        {baseline?.exists && Array.isArray(driftWeeks) && driftWeeks.some((w) => w.mean_prob_stress != null) && (
          <Card style={styles.navCard}>
            <Text style={[styles.cardTitle, { color: text }]}>Calibration Drift</Text>
            <Text style={[styles.cardSub, { color: muted, marginBottom: 10 }]}>
              {baseline?.drift?.drift_detected
                ? 'Your recent readings have shifted from your original calibration — recalibrating is recommended.'
                : 'How your recent readings compare to your original resting calibration, week by week.'}
            </Text>
            <LineChart
              points={driftWeeks
                .filter((w) => w.mean_prob_stress != null)
                .map((w) => ({ value: Math.round(w.mean_prob_stress * 100), date: w.week_start }))}
              width={DRIFT_CHART_WIDTH}
              height={140}
              color={COLORS.brand}
              maxValue={100}
              suffix="%"
              baselineValue={baseline?.drift?.original_resting_mean != null
                ? Math.round(baseline.drift.original_resting_mean * 100) : undefined}
              baselineLabel="Your original calibration"
              baselineColor={COLORS.normal}
            />
          </Card>
        )}

        {/* Quick Actions */}
        <Card style={styles.navCard}>
          <Text style={[styles.cardTitle, { color: text, marginBottom: 12 }]}>Self-Report & Check-In</Text>
          <TouchableOpacity onPress={() => navigation.navigate('PSS4')} activeOpacity={0.85}>
            <View style={[styles.actionTile, { backgroundColor: COLORS.normalSoft, borderColor: COLORS.normal + '30' }]}>
              <Icon name={NAMES.pss4} size={22} color={COLORS.normalDark} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.actionLabel, { color: COLORS.normalDark }]}>PSS-4 Stress Assessment</Text>
                <Text style={[styles.actionSub, { color: muted }]}>Answer 4 quick self-check questions</Text>
              </View>
              <Icon name={NAMES.chevronRight} size={16} color={COLORS.normalDark} />
            </View>
          </TouchableOpacity>
        </Card>

        {/* Relaxation Guide Card */}
        <Card onPress={() => navigation.navigate('RelaxationGuide')} style={styles.navCard}>
          <View style={styles.cardHeaderRow}>
            <View style={styles.rowGap}>
              <View style={[styles.actionIconCircle, { backgroundColor: '#10B98120' }]}>
                <Text style={{ fontSize: 18 }}>🧠</Text>
              </View>
              <Text style={[styles.cardTitle, { color: text }]}>Relaxation Guide</Text>
            </View>
            <Icon name={NAMES.chevronRight} size={18} color={muted} />
          </View>
          <Text style={[styles.cardSub, { color: muted }]}>
            Personalized AI relaxation techniques, games & guided breathing exercises.
          </Text>
        </Card>

        {/* Switch to Admin App without logging out */}
        <Card onPress={() => navigation.navigate('Admin')} style={styles.navCard}>
          <View style={styles.cardHeaderRow}>
            <View style={styles.rowGap}>
              <View style={[styles.actionIconCircle, { backgroundColor: COLORS.brandSoft }]}>
                <Icon name={NAMES.admin} size={18} color={COLORS.brand} />
              </View>
              <Text style={[styles.cardTitle, { color: text }]}>Clinical & Admin Suite</Text>
            </View>
            <Icon name={NAMES.chevronRight} size={18} color={muted} />
          </View>
          <Text style={[styles.cardSub, { color: muted }]}>
            Access raw sensor signals, multi-user logs, and relaxation research labs.
          </Text>
        </Card>

        <TouchableOpacity style={[styles.logoutBtn, { borderColor: COLORS.stress + '40', backgroundColor: '#FFFFFF' }]} onPress={logout}>
          <Icon name={NAMES.logout} size={18} color={COLORS.stress} />
          <Text style={[styles.logoutText, { color: COLORS.stress }]}>Sign Out of MindPulse</Text>
        </TouchableOpacity>

        <View style={{ height: 60 }} />
      </Animated.ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
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
  statCard: { flex: 1, alignItems: 'center', padding: 16, borderRadius: 20 },
  statValue: { fontSize: 22, fontWeight: '900' },
  statLabel: { fontSize: 11, marginTop: 3, fontWeight: '600' },
  navCard: { padding: 18, borderRadius: 22 },
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
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 20, marginTop: 12, paddingVertical: 14, borderRadius: 28, borderWidth: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 6, elevation: 1 },
  logoutText: { fontSize: 14, fontWeight: '800' },
});
