// ============================================================
// EegSummaryScreen.js
// Consumer-facing EEG detail: connection + current reading + real signal-
// quality score, calibration freshness, and a session-distribution/recent-
// activity history built straight from Firebase (there's no EEG history
// REST route -- psychological/{userId}/{sessionId} already accumulates one
// child per session, the same pattern fusion_en/{userId}/... uses). No raw
// µV charts or the 29-feature bipolar grid -- that detail lives in Admin.
// ============================================================
import { getContentWidth } from '../../shared/theme/layout';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, Dimensions } from 'react-native';
import { ref, onValue, off, get } from 'firebase/database';
import { db } from '../firebase';
import ScreenBackground from '../../shared/ScreenBackground';
import Card from '../../shared/Card';
import StatusDot from '../../shared/StatusDot';
import Icon, { NAMES } from '../../shared/Icon';
import Badge from '../../shared/Badge';
import BalanceRing from '../../shared/BalanceRing';
import { levelOf, LEVEL_COLOR, MIND_WORDS, DEFAULT_EEG_THRESHOLD } from '../../shared/levels';
import { TYPE, SPACE, RADIUS } from '../../shared/theme/tokens';
import LineChart from '../../shared/LineChart';
import { useCalibrationSummary } from '../../shared/CalibrationGate';
import { eegClient } from '../../shared/eegApiClient';
import { useTheme } from '../../physiological/config/ThemeContext';
import { COLORS } from '../../physiological/config/theme';
import { useAuth } from '../../../context/AuthContext';
import { useDeviceStatus } from '../../shared/CalibrationGate';
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
const TREND_CHART_WIDTH = Math.max(260, getContentWidth() - 2 * 20 - 2 * 18);
const TREND_CHART_HEIGHT = 70;
// A "session" is one login-to-logout span, not "how far back Feature
// Trends should remember" -- see RingSummaryScreen.js's identical
// constant/reasoning. Backfills this many PRIOR sessions' own blocks
// alongside the live current-session listener.
const RECENT_SESSIONS_FOR_CHART = 4;

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

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

// Clamps a feature-trend series to its own p5-p95 range (+10% padding) before
// charting -- same fix as AdminEegLiveScreen.js's waveform chart, applied
// here too. Without it, gifted-charts auto-scales the y-axis to the raw
// data's own min/max with no protection against outliers -- one anomalous
// block (e.g. a motion/drift artifact -- see pipeline.py's
// DELTA_POWER_IMPLAUSIBLE_SD investigation this session, which found
// affected features can run 2-3 orders of magnitude off) dominates the
// whole axis and flattens every other, genuinely-informative block into an
// indistinguishable line along the bottom.
function clampOutliers(points) {
  if (!points || points.length < 2) return points;
  const values = points.map((p) => p.value);
  const sorted = [...values].sort((a, b) => a - b);
  let lo = percentile(sorted, 0.05);
  let hi = percentile(sorted, 0.95);
  if (hi <= lo) {
    const pad = Math.abs(lo) * 0.1 || 1;
    lo -= pad;
    hi += pad;
  }
  const pad = (hi - lo) * 0.1;
  const clampLo = lo - pad;
  const clampHi = hi + pad;
  return points.map((p) => ({ ...p, value: Math.min(clampHi, Math.max(clampLo, p.value)) }));
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
  const { user, token } = useAuth();
  const userId = user?.userId;

  // eegOnline/eegSessionId: shared with AccountSetupScreen.js/
  // CalibrateBreathingCard.js/FusionSessionScreen.js's device-status row --
  // was previously a SEPARATE, dead local implementation here keyed off the
  // old live_raw field, which the backend stopped writing entirely once EEG
  // liveness moved to the latest per-block record's own timestamp (see
  // useDeviceStatus()'s own docstring). That field never updating meant
  // hasSession here was permanently stuck false, silently hiding every card
  // on this screen (Current State/Quality/Feature Trends all gate on it)
  // regardless of whether real data existed. useDeviceStatus() also already
  // covers the calibration-in-progress liveness signal this session added.
  const { eegOnline: hasSession, eegSessionId: currentSessionId } = useDeviceStatus(userId, db);
  const { eeg: eegCalibration } = useCalibrationSummary(userId, token);

  const [sessionWindows, setSessionWindows] = useState(null);
  const [recentSessions, setRecentSessions] = useState([]);
  const [sessionDist, setSessionDist] = useState({ normal: 0, stress: 0 });
  const [driftWeeks, setDriftWeeks] = useState(null);
  const [historicalWindowsList, setHistoricalWindowsList] = useState([]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    eegClient.get(`/calibration/${userId}/drift-history`, { headers })
      .then((res) => { if (!cancelled) setDriftWeeks(res.data?.weeks || null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [userId, token]);

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
  // Merged with historicalWindowsList (the prior few sessions, backfilled
  // below) and re-sorted by real timestamp -- window_idx alone would
  // clash across sessions since it's each session's own local counter
  // restarting from 0, not a global ordering.
  const windowsList = useMemo(() => {
    const merged = [...sortedWindows(sessionWindows), ...historicalWindowsList];
    merged.sort((a, b) => (a.timestamp_end ?? 0) - (b.timestamp_end ?? 0));
    return merged;
  }, [sessionWindows, historicalWindowsList]);
  const featureSeries = FEATURE_TREND_CONFIG.map(({ key, label, color }) => {
    const points = windowsList
      .filter((w) => !w.skipped && w.features_eeg?.bipolar?.[key] != null)
      .map((w) => ({ value: w.features_eeg.bipolar[key], date: new Date(w.timestamp_end * 1000) }));
    // last (the numeric readout above each chart) stays the TRUE value --
    // only the plotted line itself gets outlier-clamped.
    return { key, label, color, points: clampOutliers(points), last: points[points.length - 1]?.value };
  });
  const hasFeatureTrends = featureSeries.some((s) => s.points.length > 1);

  useEffect(() => {
    if (!userId) return;
    const userRef = ref(db, `psychological/${userId}`);
    get(userRef).then((snap) => {
      const all = snap.val() || {};
      // Session ids are ISO timestamps (AuthContext.js), lexicographically
      // sortable -- Object.keys() on Firebase's JSON response isn't
      // guaranteed chronological, so sort explicitly rather than trust
      // insertion order.
      const sids = Object.keys(all).sort();
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

      // Backfill for Feature Trends: the PRIOR few sessions' own blocks
      // (excluding the current live one, already covered by the
      // sessionWindows listener) -- reuses this same already-fetched
      // `all` rather than a second Firebase read, so logging out and
      // back in doesn't reset the chart to empty.
      const priorSids = sids.filter((sid) => sid !== currentSessionId).slice(-RECENT_SESSIONS_FOR_CHART);
      setHistoricalWindowsList(priorSids.flatMap((sid) => sortedWindows(all[sid])));
    }).catch(() => {});
  }, [userId, hasSession, currentSessionId]);

  const score = latest && !latest.skipped ? latest.task_state_score : null;
  const thr = latest?.effective_high_load_p ?? eegCalibration?.personal_high_load_p ?? DEFAULT_EEG_THRESHOLD;
  // "High" only when the backend's persistence-gated high_load_alert says
  // so -- a single noisy block over the limit reads as "Focused", not
  // "Overloaded" (same reasoning as currentStateLabel above).
  let level = levelOf(score, thr);
  if (level === 'high' && !latest?.high_load_alert) level = 'moderate';
  if (latest?.high_load_alert) level = 'high';
  const levelColor = level ? LEVEL_COLOR[level] : COLORS.eeg;
  const qualityScore = latest?.eeg_quality_score;
  const goodContact = latest?.eeg_quality_flag;

  const loadSeries = useMemo(() => windowsList
    .filter((w) => !w.skipped && w.task_state_score != null && w.timestamp_end)
    .map((w) => ({ value: Math.round(w.task_state_score * 100), date: new Date(w.timestamp_end * 1000) }))
    .slice(-120), [windowsList]);

  // Relative band powers already sum to ~1 -- shown as one friendly bar.
  const bands = BANDS.map((b) => ({ ...b, v: latest?.features_eeg?.bipolar?.[b.key] }))
    .filter((b) => b.v != null && b.v > 0);
  const bandTotal = bands.reduce((s, b) => s + b.v, 0);
  const topBand = bands.length ? bands.reduce((a, b) => (b.v > a.v ? b : a)) : null;
  const totalSessions = sessionDist.normal + sessionDist.stress;

  return (
    <ScreenBackground edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.connRow}>
          <Badge label={hasSession ? 'Headband streaming' : 'Headband offline'}
            color={hasSession ? COLORS.normal : COLORS.light.textMuted} size="sm" />
          {hasSession && qualityScore != null && (
            <Badge label={goodContact ? 'Good contact' : 'Adjust headband for better contact'}
              color={goodContact ? COLORS.normal : COLORS.warning} size="sm" />
          )}
        </View>

        <Card style={styles.block}>
          <View style={styles.heroRow}>
            <BalanceRing
              title="Mental load"
              value={score != null ? score * 100 : null}
              word={level ? MIND_WORDS[level] : ''}
              color={levelColor}
              size={124}
              stroke={12}
            />
            <View style={styles.heroText}>
              <Text style={styles.heroWord}>{level ? MIND_WORDS[level] : (hasSession ? 'Reading…' : 'Waiting')}</Text>
              <Text style={styles.heroLine}>
                {level === 'high' ? 'Your mind has been working hard for a while. A short break will help.'
                  : level === 'moderate' ? 'You’re focused — your mind is busy but coping.'
                  : level === 'low' ? 'Your mind is calm and rested.'
                  : hasSession ? 'The first reading takes about 25 seconds.' : 'Put on the headband to see your mental load.'}
              </Text>
            </View>
          </View>
        </Card>

        {bands.length >= 3 && bandTotal > 0 && (
          <Card style={styles.block}>
            <Text style={styles.blockTitle}>Your brainwaves now</Text>
            <Text style={styles.blockSub}>
              Mostly <Text style={{ fontWeight: '800', color: topBand.color }}>{topBand.name.toLowerCase()}</Text> — {topBand.meaning}
            </Text>
            <View style={styles.bandBar}>
              {bands.map((b) => (
                <View key={b.key} style={{ flex: b.v / bandTotal, backgroundColor: b.color }} />
              ))}
            </View>
            <View style={styles.bandLegend}>
              {bands.map((b) => (
                <View key={b.key} style={styles.bandItem}>
                  <View style={[styles.bandSwatch, { backgroundColor: b.color }]} />
                  <Text style={styles.bandName}>{b.name}</Text>
                  <Text style={styles.bandPct}>{Math.round((b.v / bandTotal) * 100)}%</Text>
                </View>
              ))}
            </View>
          </Card>
        )}

        {loadSeries.length > 1 && (
          <Card style={styles.block}>
            <Text style={styles.blockTitle}>Mental load over time</Text>
            <Text style={styles.blockSub}>Higher means a busier mind · dashed line is your limit</Text>
            <View style={{ marginTop: SPACE.md }}>
              <LineChart
                points={loadSeries}
                color={levelColor}
                width={TREND_CHART_WIDTH}
                height={150}
                maxValue={100}
                hideValues
                baselineValue={Math.round(thr * 100)}
                baselineLabel="Your limit"
                colorZones
              />
            </View>
          </Card>
        )}

        {eegCalibration?.drift?.checked && eegCalibration.drift.drift_detected && (
          <View style={[styles.banner, { backgroundColor: COLORS.warningSoft, borderColor: COLORS.warning + '40' }]}>
            <Icon name="tune-variant" size={18} color={COLORS.warningDark} />
            <Text style={[styles.bannerText, { color: COLORS.warningDark }]}>
              Your readings have shifted lately — recalibrating from your Profile keeps them accurate.
            </Text>
          </View>
        )}

        {recentSessions.length > 0 && (
          <Card style={styles.block}>
            <Text style={styles.blockTitle}>Recent sessions</Text>
            <View style={styles.timeline}>
              {[...recentSessions].reverse().map((s) => {
                const busy = s.label === 1;
                const c = busy ? COLORS.stress : COLORS.normal;
                return (
                  <View key={s.sid} style={styles.tlItem}>
                    <View style={[styles.tlDot, { backgroundColor: c + '22', borderColor: c }]}>
                      <Icon name={busy ? 'brain' : 'leaf'} size={16} color={c} />
                    </View>
                    <Text style={styles.tlTime}>{busy ? 'Busy' : 'Calm'}</Text>
                  </View>
                );
              })}
            </View>
            {totalSessions > 0 && (
              <Text style={styles.sessionLine}>
                Across your sessions: <Text style={{ color: COLORS.normalDark, fontWeight: '800' }}>{sessionDist.normal} calm</Text>
                {' · '}<Text style={{ color: COLORS.stressDark, fontWeight: '800' }}>{sessionDist.stress} high-load</Text>
              </Text>
            )}
          </Card>
        )}
      </ScrollView>
    </ScreenBackground>
  );
}

// Friendly names for the 5 relative band powers.
const BANDS = [
  { key: 'delta_rel_power', name: 'Deep rest',  color: '#94A3B8', meaning: 'very slow waves, typical of deep relaxation or drowsiness.' },
  { key: 'theta_rel_power', name: 'Daydream',   color: '#A78BFA', meaning: 'slow waves linked to drifting thoughts and light rest.' },
  { key: 'alpha_rel_power', name: 'Relaxed',    color: '#5E935A', meaning: 'calm, awake and relaxed.' },
  { key: 'beta_rel_power',  name: 'Focused',    color: '#E8A238', meaning: 'active thinking and concentration.' },
  { key: 'gamma_rel_power', name: 'Intense',    color: '#E56B4E', meaning: 'fast waves seen during heavy mental effort.' },
];

const styles = StyleSheet.create({
  scroll: { paddingTop: SPACE.lg, paddingBottom: SPACE.xxxl },
  connRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, marginHorizontal: SPACE.xl, marginBottom: SPACE.md },
  block: { marginHorizontal: SPACE.xl, marginBottom: SPACE.md, borderRadius: RADIUS.xl },
  blockTitle: { ...TYPE.title, color: COLORS.light.text },
  blockSub: { fontSize: 12, color: COLORS.light.textMuted, marginTop: 4, lineHeight: 17 },

  heroRow: { flexDirection: 'row', alignItems: 'center' },
  heroText: { flex: 1.3, paddingLeft: SPACE.md },
  heroWord: { fontSize: 26, fontWeight: '800', color: COLORS.light.text, letterSpacing: -0.5 },
  heroLine: { ...TYPE.body, color: COLORS.light.textSub, marginTop: 4 },

  bandBar: { flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', marginTop: SPACE.md },
  bandLegend: { flexDirection: 'row', flexWrap: 'wrap', marginTop: SPACE.md, rowGap: SPACE.sm },
  bandItem: { width: '33%', flexDirection: 'row', alignItems: 'center', gap: 5 },
  bandSwatch: { width: 10, height: 10, borderRadius: 5 },
  bandName: { fontSize: 12, fontWeight: '600', color: COLORS.light.textSub },
  bandPct: { fontSize: 12, fontWeight: '800', color: COLORS.light.text },

  banner: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm,
    marginHorizontal: SPACE.xl, marginBottom: SPACE.md, padding: 14, borderRadius: RADIUS.md, borderWidth: 1,
  },
  bannerText: { flex: 1, fontSize: 13, fontWeight: '700', lineHeight: 18 },

  timeline: { flexDirection: 'row', justifyContent: 'space-between', marginTop: SPACE.md },
  tlItem: { alignItems: 'center', flex: 1 },
  tlDot: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  tlTime: { fontSize: 10, fontWeight: '600', color: COLORS.light.textMuted, marginTop: 4 },
  sessionLine: { fontSize: 12, color: COLORS.light.textSub, marginTop: SPACE.md },
});
