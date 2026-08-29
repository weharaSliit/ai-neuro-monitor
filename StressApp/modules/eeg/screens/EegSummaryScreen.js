// ============================================================
// EegSummaryScreen.js
// Consumer-facing EEG detail: connection + current reading + real signal-
// quality score, calibration freshness, and a session-distribution/recent-
// activity history built straight from Firebase (there's no EEG history
// REST route -- psychological/{userId}/{sessionId} already accumulates one
// child per session, the same pattern fusion_en/{userId}/... uses). No raw
// µV charts or the 29-feature bipolar grid -- that detail lives in Admin.
// ============================================================
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, Dimensions } from 'react-native';
import { ref, onValue, off, get } from 'firebase/database';
import { db } from '../firebase';
import ScreenBackground from '../../shared/ScreenBackground';
import Card from '../../shared/Card';
import StatusDot from '../../shared/StatusDot';
import Icon, { NAMES } from '../../shared/Icon';
import MoodBadge from '../../shared/MoodBadge';
import LineChart from '../../shared/LineChart';
import { useTheme } from '../../physiological/config/ThemeContext';
import { COLORS } from '../../physiological/config/theme';
import { useAuth } from '../../../context/AuthContext';
import { TASK_STATE_LABELS, EEG_TREND_LABELS } from '../config/config';

// 5 relative band powers (the standard δ/θ/α/β/γ breakdown) + the 3 features
// with the largest |coefficient| in the trained model's own logistic
// regression (features are standardized before that step, so coefficient
// magnitude is directly comparable across features) that AREN'T already one
// of the 5 band powers -- ptp (amplitude), theta_beta_ratio (cross-band
// ratio), spectral_entropy (signal complexity). Checked directly against
// backend/psychological/models/sam40_t7t8_state_model.joblib's
// logisticregression.coef_, not guessed.
const FEATURE_TREND_CONFIG = [
    { key: 'delta_rel_power', label: 'δ Delta', color: '#64748b' },
    { key: 'theta_rel_power', label: 'θ Theta', color: '#7c3aed' },
    { key: 'alpha_rel_power', label: 'α Alpha', color: '#2563eb' },
    { key: 'beta_rel_power', label: 'β Beta', color: '#16a34a' },
    { key: 'gamma_rel_power', label: 'γ Gamma', color: '#ea580c' },
    { key: 'ptp', label: 'Peak-to-peak amplitude', color: '#db2777' },
    { key: 'theta_beta_ratio', label: 'θ/β ratio', color: '#d97706' },
    { key: 'spectral_entropy', label: 'Spectral entropy', color: '#0d9488' },
];
const TREND_CHART_WIDTH = Dimensions.get('window').width - 2 * 20 - 2 * 18 - 20;
const TREND_CHART_HEIGHT = 70;

function sortedWindows(windowsObj) {
    if (!windowsObj) return [];
    const keys = Object.keys(windowsObj).filter((k) => /^\d+$/.test(k));
    keys.sort((a, b) => Number(a) - Number(b));
    return keys.map((k) => windowsObj[k]);
}

// high_load_alert is the persistence-gated flag (compute_states(), sam40/
// decision.py -- P >= high_load_p for >= high_load_persistence_blocks
// CONSECUTIVE blocks), not the noisy raw per-block task_state_label
// (single-block, threshold 0.5). Deliberately using the gated flag here:
// "Relaxed" should be the stable default state, not something that flickers
// with every block's raw score.
function currentStateLabel(latest) {
  if (!latest || latest.skipped) return null;
  return latest.high_load_alert ? 'High Load' : 'Relaxed';
}

function latestWindow(windowsObj) {
  if (!windowsObj) return null;
  const keys = Object.keys(windowsObj).filter((k) => /^\d+$/.test(k));
  if (keys.length === 0) return null;
  keys.sort((a, b) => Number(a) - Number(b));
  return windowsObj[keys[keys.length - 1]];
}

function DistBar({ label, value, total, color, muted }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <View style={styles.distRow}>
      <View style={[styles.distBarBg, { backgroundColor: muted + '30' }]}>
        <View style={[styles.distBarFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <Text style={[styles.distVal, { color }]}>{value} ({pct.toFixed(0)}%)</Text>
    </View>
  );
}

export default function EegSummaryScreen() {
  const { theme, COLORS } = useTheme();
  const { user } = useAuth();
  const userId = user?.userId;

  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [hasSession, setHasSession] = useState(false);
  const [sessionWindows, setSessionWindows] = useState(null);
  const [recentSessions, setRecentSessions] = useState([]);
  const [sessionDist, setSessionDist] = useState({ normal: 0, stress: 0 });

  useEffect(() => {
    if (!userId) return;
    const pRef = ref(db, 'psychological/current_session_id');
    const h = onValue(pRef, (snap) => {
      const sid = snap.val();
      setCurrentSessionId(sid || null);
      setHasSession(!!sid);
    });
    return () => off(pRef, 'value', h);
  }, [userId]);

  useEffect(() => {
    if (!userId || !currentSessionId) {
      setSessionWindows(null);
      return;
    }
    const sRef = ref(db, `psychological/${userId}/${currentSessionId}`);
    const h = onValue(sRef, (snap) => setSessionWindows(snap.val()));
    return () => off(sRef, 'value', h);
  }, [userId, currentSessionId]);

  const latest = latestWindow(sessionWindows);

  // Per-feature time series across this session's blocks (~25s cadence,
  // see BLOCK_SEC in realtime/pipeline.py) -- sessionWindows already holds
  // the full session, not just the latest block, from the listener above.
  const windowsList = sortedWindows(sessionWindows);
  const featureSeries = FEATURE_TREND_CONFIG.map(({ key, label, color }) => {
    const points = windowsList
      .filter((w) => !w.skipped && w.features_eeg?.bipolar?.[key] != null)
      .map((w) => ({ value: w.features_eeg.bipolar[key], date: new Date(w.timestamp_end * 1000) }));
    return { key, label, color, points, last: points[points.length - 1]?.value };
  });
  const hasFeatureTrends = featureSeries.some((s) => s.points.length > 1);

  useEffect(() => {
    if (!userId) return;
    const userRef = ref(db, `psychological/${userId}`);
    get(userRef).then((snap) => {
      const all = snap.val() || {};
      const sids = Object.keys(all);
      let nNorm = 0;
      let nStress = 0;
      const recents = [];
      sids.forEach((sid) => {
        const sObj = all[sid];
        if (!sObj || typeof sObj !== 'object') return;
        const keys = Object.keys(sObj).filter((k) => /^\d+$/.test(k));
        if (!keys.length) return;
        keys.sort((a, b) => Number(a) - Number(b));
        const lastW = sObj[keys[keys.length - 1]];
        if (lastW?.task_state_label === 1) nStress++;
        else if (lastW?.task_state_label === 0) nNorm++;
        recents.push({
          sid,
          label: lastW?.task_state_label,
          windowCount: keys.length,
        });
      });
      setSessionDist({ normal: nNorm, stress: nStress });
      setRecentSessions(recents.slice(-5).reverse());
    }).catch(() => {});
  }, [userId, hasSession]);

  const t = theme;
  const qualityScore = latest?.eeg_quality_score;
  const qualityTrusted = latest?.eeg_quality_flag;
  const stateLabel = currentStateLabel(latest);

  return (
    <ScreenBackground>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Device Status */}
        <Card accentColor={hasSession ? COLORS.normal : COLORS.warning} elevated style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={styles.rowGap}>
              <Icon name={NAMES.device} size={18} color={hasSession ? COLORS.normal : COLORS.warning} />
              <Text style={[styles.cardTitle, { color: t.text, marginBottom: 0 }]}>Headband Telemetry</Text>
            </View>
            <View style={[styles.statusPill, { backgroundColor: hasSession ? COLORS.normalSoft : COLORS.warningSoft }]}>
              <StatusDot color={hasSession ? COLORS.normal : COLORS.warning} active={hasSession} size={8} />
              <Text style={[styles.statusPillText, { color: hasSession ? COLORS.normalDark : COLORS.warningDark }]}>
                {hasSession ? 'Streaming' : 'Standby'}
              </Text>
            </View>
          </View>
          <Text style={[styles.cardSub, { color: t.textMuted, marginTop: 10 }]}>
            {hasSession ? 'EEG headband actively streaming neural channels (wearable02)' : 'Put on the headband to begin measuring mental workload'}
          </Text>
        </Card>

        {/* Current State: Relaxed / High Load, gated on high_load_alert (not
            the noisy raw per-block label) -- plus which way it's trending. */}
        {hasSession && stateLabel && (
          <Card accentColor={latest.high_load_alert ? COLORS.stress : COLORS.normal} elevated style={styles.card}>
            <Text style={[styles.cardTitle, { color: t.text, marginBottom: 8 }]}>Current State</Text>
            <View style={styles.readingRow}>
              <MoodBadge stressed={!!latest.high_load_alert} color={latest.high_load_alert ? COLORS.stress : COLORS.normal} size={40} />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={[styles.stateLabel, { color: latest.high_load_alert ? COLORS.stress : COLORS.normal }]}>
                  {stateLabel}
                </Text>
                {latest.task_state_score != null && (
                  <Text style={[styles.readingSub, { color: t.textMuted }]}>
                    {(latest.task_state_score * 100).toFixed(0)}% cognitive load
                    {latest.task_state_trend ? ` · ${EEG_TREND_LABELS[latest.task_state_trend] || latest.task_state_trend}` : ''}
                  </Text>
                )}
              </View>
            </View>
          </Card>
        )}

        {/* Current State & Quality */}
        {hasSession && qualityScore !== undefined && qualityScore !== null && (
          <Card accentColor={qualityTrusted ? COLORS.normal : COLORS.warning} elevated style={styles.card}>
            <Text style={[styles.cardTitle, { color: t.text, marginBottom: 8 }]}>Electrode Contact Quality</Text>
            <View style={[styles.qualityBox, { backgroundColor: qualityTrusted ? COLORS.normalSoft : COLORS.warningSoft }]}>
              <Icon name={NAMES.signal} size={18} color={qualityTrusted ? COLORS.normalDark : COLORS.warningDark} />
              <Text style={[styles.qualityText, { color: qualityTrusted ? COLORS.normalDark : COLORS.warningDark }]}>
                Electrode Contact Quality: {qualityScore.toFixed(0)}% · {qualityTrusted ? 'Optimal Signal' : 'Adjust Placement'}
              </Text>
            </View>
          </Card>
        )}

        {/* Feature Trends: how the extracted signal features are moving
            block-to-block (~25s cadence) across this live session. */}
        {hasSession && hasFeatureTrends && (
          <Card style={styles.card}>
            <Text style={[styles.cardTitle, { color: t.text, marginBottom: 2 }]}>Feature Trends</Text>
            <Text style={[styles.cardSub, { color: t.textMuted, marginBottom: 10 }]}>
              Extracted EEG features over this session, updated every block
            </Text>
            {featureSeries.map(({ key, label, color, points, last }, i) => (
              <View key={key} style={[styles.trendBlock, i === featureSeries.length - 1 ? null : { marginBottom: 14 }]}>
                <View style={styles.trendHeaderRow}>
                  <Text style={[styles.trendLabel, { color: t.textSub }]}>{label}</Text>
                  <Text style={[styles.trendValue, { color: t.text }]}>
                    {last !== undefined ? last.toFixed(key.includes('rel_power') ? 3 : 2) : '—'}
                  </Text>
                </View>
                {points.length > 1 ? (
                  <LineChart
                    points={points}
                    color={color}
                    width={TREND_CHART_WIDTH}
                    height={TREND_CHART_HEIGHT}
                    hideValues
                  />
                ) : (
                  <Text style={[styles.waiting, { color: t.textMuted, paddingVertical: 4 }]}>
                    Collecting more blocks…
                  </Text>
                )}
              </View>
            ))}
          </Card>
        )}

        {/* Session Distribution */}
        {(sessionDist.normal + sessionDist.stress) > 0 && (
          <Card style={styles.card}>
            <Text style={[styles.cardTitle, { color: t.text, marginBottom: 6 }]}>Session Distribution</Text>
            <DistBar label="Low Load" value={sessionDist.normal} total={sessionDist.normal + sessionDist.stress} color={COLORS.normal} muted={t.textMuted} />
            <DistBar label="High Load" value={sessionDist.stress} total={sessionDist.normal + sessionDist.stress} color={COLORS.stress} muted={t.textMuted} />
          </Card>
        )}

        {/* Recent Sessions */}
        {recentSessions.length > 0 && (
          <Card style={styles.card}>
            <Text style={[styles.cardTitle, { color: t.text, marginBottom: 6 }]}>Recent Sessions</Text>
            {recentSessions.map((s, i) => {
              const color = s.label === 1 ? COLORS.stress : COLORS.normal;
              return (
                <View key={s.sid} style={[styles.activityRow, i === recentSessions.length - 1 && { borderBottomWidth: 0 }, { borderBottomColor: t.border }]}>
                  <MoodBadge stressed={s.label === 1} color={color} size={36} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[styles.activityLabel, { color: t.text }]}>{TASK_STATE_LABELS[s.label]}</Text>
                    <Text style={[styles.activitySub, { color: t.textMuted }]}>{s.windowCount} windows captured</Text>
                  </View>
                  <View style={[styles.windowBadge, { backgroundColor: color + '15' }]}>
                    <Text style={[styles.windowBadgeText, { color }]}>{s.label === 1 ? 'High' : 'Low'}</Text>
                  </View>
                </View>
              );
            })}
          </Card>
        )}
      </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  headerIconCircle: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '900', letterSpacing: -0.2 },
  subtitle: { fontSize: 12, marginTop: 2 },
  card: { marginHorizontal: 20, marginVertical: 8, padding: 18, borderRadius: 22 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '800' },
  cardSub: { fontSize: 12 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusPillText: { fontSize: 11, fontWeight: '800' },
  stateLabel: { fontSize: 19, fontWeight: '900', letterSpacing: -0.2 },
  readingSub: { fontSize: 12, marginTop: 2 },
  waitingBlock: { paddingVertical: 10 },
  readingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  qualityBox: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 14, marginTop: 14 },
  qualityText: { fontSize: 12, fontWeight: '700' },
  waiting: { fontSize: 12, textAlign: 'center' },
  trendBlock: {},
  trendHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 },
  trendLabel: { fontSize: 12, fontWeight: '700' },
  trendValue: { fontSize: 12, fontWeight: '800' },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  distBarBg: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  distBarFill: { height: 8, borderRadius: 4 },
  distVal: { fontSize: 12, fontWeight: '800', minWidth: 60, textAlign: 'right' },
  distValue: { width: 22, fontSize: 13, fontWeight: '800', textAlign: 'right' },
  distLabel: { width: 65, fontSize: 11, fontWeight: '600' },
  activityRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1 },
  activityLabel: { fontSize: 13, fontWeight: '700' },
  activitySub: { fontSize: 11, marginTop: 1 },
  windowBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  windowBadgeText: { fontSize: 11, fontWeight: '700' },
});

