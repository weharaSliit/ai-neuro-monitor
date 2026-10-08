// ============================================================
// RingSummaryScreen.js
// Consumer-facing detail for the ring: connection + current Normal/Stress
// reading, baseline/calibration status with a direct "Calibrate" call to
// action, a session-distribution bar, and the live trend -- a scrollable,
// tappable, zone-colored chart (see LineChart.js's colorZones) against the
// one shared Stress threshold line: green below it, red (dashed) at/above
// it, plus a weekly Calibration Drift chart against the original resting
// calibration. The raw AVNN/SCL feature numbers and the manual "Stop
// Watching" control still stay Admin-app only (modules/admin/) -- just not
// the drift/deviation view, which the user explicitly asked to see here.
// ============================================================
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import axios from 'axios';
import ScreenBackground from '../../shared/ScreenBackground';
import Card from '../../shared/Card';
import StatusDot from '../../shared/StatusDot';
import Icon, { NAMES } from '../../shared/Icon';
import MoodBadge from '../../shared/MoodBadge';
import LineChart from '../../shared/LineChart';
import { useCalibrationSummary } from '../../shared/CalibrationGate';
import { useTheme } from '../config/ThemeContext';
import { COLORS } from '../config/theme';
import { useAuth } from '../../../context/AuthContext';
import { API_BASE, DEVICE_ID, STRESS_DECISION_THRESHOLD_PERCENT } from '../config/config';
import api from '../api/client';

const POLL_INTERVAL_MS = 5000;
const TREND_CHART_WIDTH = Math.max(260, Dimensions.get('window').width - 80);
// A "session" is one login-to-logout span (AuthContext.js), not "how far
// back the trend chart should remember" -- without this, logging out and
// back in reset the chart to empty even though the earlier data is still
// sitting in Firebase. This backfills the PRIOR few sessions once (see
// the historicalWindows effect below, keyed off sessionCount so it only
// re-runs when a new session actually starts, not on every 5s poll) and
// merges them with the live-polled current session.
const RECENT_SESSIONS_FOR_CHART = 4;
const CHART_POINTS_MAX = 40;

function DistBar({ label, value, total, color, muted }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <View style={styles.distRow}>
      <View style={[styles.distBarBg, { backgroundColor: muted + '30' }]}>
        <View style={[styles.distBarFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <Text style={[styles.distValue, { color }]}>{value}</Text>
      <Text style={[styles.distLabel, { color: muted }]}>{label}</Text>
    </View>
  );
}

export default function RingSummaryScreen({ navigation }) {
  const { COLORS, theme } = useTheme();
  const { user, token } = useAuth();
  const userId = user?.userId;

  // A never-calibrated user still gets predictions from the backend --
  // app.py:331-336 falls back to predict_raw(), the population-only
  // model, when load_baseline() returns None -- but those aren't
  // personalized and shouldn't be shown as if they were. Gate the
  // prediction-dependent cards below on ring.exists; an already-
  // calibrated user sees everything exactly as before, instantly, no
  // added delay -- this only hides output for someone who's never
  // calibrated at all.
  const { loading: calibLoading, ring } = useCalibrationSummary(userId, token);
  const neverCalibrated = !calibLoading && ring?.ok && !ring.exists;

  // The chart's dashed reference line has to match whatever line app.py's
  // /predict actually decided Normal/Stress against (app.py:383-387) --
  // once this user has a personal_stress_threshold (from the onboarding
  // maths-quiz task), that's what's really being used, not the fixed
  // population STRESS_DECISION_THRESHOLD_PERCENT below. Drawing the old
  // fixed line regardless made points that were correctly labeled Stress
  // by their own (lower) personal threshold visually sit under a "Normal
  // zone" reference line that no longer matched the real decision boundary.
  const personalRingPct = ring?.personal_stress_threshold != null
    ? Math.round(ring.personal_stress_threshold * 100) : null;
  const effectiveThresholdPct = personalRingPct != null ? personalRingPct : STRESS_DECISION_THRESHOLD_PERCENT;

  const [status, setStatus] = useState('offline');
  const [fingerDetected, setFingerDetected] = useState(null);
  const [latest, setLatest] = useState(null);
  const [chartWindows, setChartWindows] = useState([]);
  const [recent, setRecent] = useState([]);
  const [sessionDist, setSessionDist] = useState({ normal: 0, stress: 0 });
  const [sessionCount, setSessionCount] = useState(0);
  const [driftWeeks, setDriftWeeks] = useState(null);
  const [historicalWindows, setHistoricalWindows] = useState([]);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    api.get(`/baseline/${userId}/drift-history`)
      .then((res) => { if (!cancelled) setDriftWeeks(res.data?.weeks || null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [userId]);

  const poll = useCallback(async () => {
    try {
      const s = await axios.get(`${API_BASE}/devices/${DEVICE_ID}/status`);
      setStatus(s.data?.status || 'offline');
      // finger_detected is written by the bridge from the live sensor
      // payload every ~5s (backend/physiological/mqtt_bridge.py's
      // on_message) -- undefined (not false) means this device has never
      // reported it, e.g. still on an older firmware build.
      setFingerDetected(
        s.data?.finger_detected === undefined ? null : !!s.data.finger_detected
      );
    } catch {
      setStatus('offline');
    }
    if (!userId) return;
    try {
      const h = await api.get(`/history/${userId}`);
      const sessionIds = Object.keys(h.data?.sessions || {});
      setSessionCount(sessionIds.length);
      const latestId = sessionIds[sessionIds.length - 1];
      if (!latestId) { setLatest(null); setChartWindows([]); setRecent([]); return; }
      const s2 = await api.get(`/history/${userId}/${latestId}`);
      const predictions = Object.values(s2.data?.predictions || {})
        .sort((a, b) => (b.window_idx ?? 0) - (a.window_idx ?? 0));
      setLatest(predictions[0] || null);
      setChartWindows(predictions.slice(0, 20));
      setRecent(predictions.slice(0, 5));
    } catch {
      // leave last-known values showing on a transient failure
    }
  }, [userId]);

  useEffect(() => {
    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(intervalRef.current);
  }, [poll]);

  // Normal-vs-Stress distribution across sessions, majority-voted from each
  // session's own predictions -- same derivation Admin uses.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const h = await api.get(`/history/${userId}`);
        const sessionIds = Object.keys(h.data?.sessions || {});
        const entries = await Promise.all(sessionIds.map(async (sid) => {
          try {
            const s = await api.get(`/history/${userId}/${sid}`);
            const preds = Object.values(s.data?.predictions || {});
            if (preds.length === 0) return null;
            const stressCount = preds.filter((p) => p.label === 'Stress').length;
            return stressCount > preds.length / 2 ? 'Stress' : 'Normal';
          } catch { return null; }
        }));
        if (cancelled) return;
        setSessionDist(entries.reduce((acc, l) => {
          if (l === 'Stress') acc.stress++;
          else if (l === 'Normal') acc.normal++;
          return acc;
        }, { normal: 0, stress: 0 }));
      } catch {
        // leave last-known distribution showing
      }
    })();
    return () => { cancelled = true; };
    // Only re-run when the session count actually changes, not on every 5s
    // poll tick -- avoids hammering /history/<userId>/<sid> for every
    // session on every single poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, sessionCount]);

  // Backfills the trend charts with the PRIOR few sessions' own
  // predictions, so logging out and back in doesn't reset the chart to
  // empty -- the current/latest session is already covered by the live
  // 5s poll above (chartWindows); this only needs to run when a new
  // session actually starts (sessionCount changes), same efficient
  // pattern the Session Distribution effect above already uses.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const h = await api.get(`/history/${userId}`);
        const sessionIds = Object.keys(h.data?.sessions || {});
        const priorSessionIds = sessionIds.slice(0, -1).slice(-RECENT_SESSIONS_FOR_CHART);
        const results = await Promise.all(
          priorSessionIds.map((sid) => api.get(`/history/${userId}/${sid}`).catch(() => null))
        );
        if (cancelled) return;
        const preds = results
          .filter(Boolean)
          .flatMap((s) => Object.values(s.data?.predictions || {}));
        setHistoricalWindows(preds);
      } catch {
        // leave last-known historical backfill showing
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, sessionCount]);

  // Merges the live current-session poll with the prior-sessions backfill
  // into one chronological series, most-recent-first, capped so the chart
  // doesn't grow unbounded across many logins. De-duped by timestamp +
  // window_idx as a guard (the two sources shouldn't overlap since prior
  // sessions explicitly excludes the current one, but a session rotating
  // mid-fetch is possible).
  const combinedWindows = useMemo(() => {
    const merged = [...chartWindows, ...historicalWindows];
    const seen = new Set();
    const deduped = merged.filter((w) => {
      const key = `${w.timestamp}_${w.window_idx}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    deduped.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return deduped.slice(0, CHART_POINTS_MAX);
  }, [chartWindows, historicalWindows]);

  const trend = useMemo(() => {
    return [...combinedWindows]
      .reverse()
      .filter((w) => w.timestamp && w.prob_stress !== undefined && w.prob_stress !== null)
      .map((w) => ({ value: Math.round(w.prob_stress * 100), date: new Date(w.timestamp) }));
  }, [combinedWindows]);

  // Raw heart-rate/GSR trends -- same `features` object already fetched per
  // window (backend/physiological/firebase_service.py::save_prediction()),
  // just not previously read here. Kept to the two features a non-technical
  // user actually recognizes (bpm, skin conductance) rather than the full
  // AVNN/SDHR/pNN20/etc set Admin shows -- that fuller feature-level detail
  // stays Admin-only, per this screen's original design (see file header).
  const heartRateTrend = useMemo(() => {
    return [...combinedWindows]
      .reverse()
      .filter((w) => w.timestamp && w.features?.MeanHR)
      .map((w) => ({ value: Math.round(w.features.MeanHR), date: new Date(w.timestamp) }));
  }, [combinedWindows]);

  const gsrTrend = useMemo(() => {
    return [...combinedWindows]
      .reverse()
      .filter((w) => w.timestamp && w.features?.SCL_mean !== undefined && w.features?.SCL_mean !== null)
      .map((w) => ({ value: Number(w.features.SCL_mean.toFixed(2)), date: new Date(w.timestamp) }));
  }, [combinedWindows]);

  const t = theme;
  const connected = status === 'online';
  const statusColor = connected ? COLORS.normal : COLORS.stress;
  const stateColor = latest?.label === 'Stress'
    ? COLORS.stress
    : latest?.trending_toward_stress ? COLORS.warning : COLORS.normal;

  return (
    <ScreenBackground>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Device Status Card */}
        <Card accentColor={statusColor} elevated style={styles.statusCard}>
          <View style={styles.rowBetween}>
            <View style={styles.rowGap}>
              <Icon name={NAMES.device} size={18} color={statusColor} />
              <Text style={[styles.cardTitle, { color: t.text, marginBottom: 0 }]}>Hardware Status</Text>
            </View>
            <View style={[styles.statusPill, { backgroundColor: connected ? COLORS.normalSoft : COLORS.stressSoft }]}>
              <StatusDot color={statusColor} active={connected} size={8} />
              <Text style={[styles.statusPillText, { color: connected ? COLORS.normalDark : COLORS.stressDark }]}>
                {connected ? 'Connected' : 'Offline'}
              </Text>
            </View>
          </View>
          <Text style={[styles.cardSub, { color: t.textMuted, marginTop: 10 }]}>
            {connected
              ? `Streaming live biometric data packets from sensor ID: ${DEVICE_ID}`
              : `Put on the smart ring to begin continuous streaming (${DEVICE_ID})`}
          </Text>
          {/* Live finger-contact feedback -- the single biggest cause of
              "insufficient data" windows is the pulse sensor not actually
              touching skin; this surfaces that immediately instead of only
              being discoverable after the fact in server logs. */}
          {connected && fingerDetected !== null && (
            <View style={[styles.contactBanner, { backgroundColor: fingerDetected ? COLORS.normalSoft : COLORS.warningSoft }]}>
              <Icon
                name={fingerDetected ? 'check-circle-outline' : 'alert-circle-outline'}
                size={16}
                color={fingerDetected ? COLORS.normalDark : COLORS.warningDark}
              />
              <Text style={[styles.contactBannerText, { color: fingerDetected ? COLORS.normalDark : COLORS.warningDark }]}>
                {fingerDetected ? 'Good finger contact' : 'No finger detected — adjust the ring for a clean reading'}
              </Text>
            </View>
          )}
        </Card>

        {/* Never-calibrated -- predictions exist server-side (the raw,
            non-personalized fallback model) but aren't shown as if they
            were trustworthy. Everything below this point is skipped
            entirely in that case. */}
        {neverCalibrated ? (
          <Card accentColor={COLORS.warning} elevated style={styles.readingCard}>
            <Text style={[styles.cardTitle, { color: t.text, marginBottom: 4 }]}>Calibrate to see predictions</Text>
            <Text style={[styles.cardSub, { color: t.textMuted, marginBottom: 14 }]}>
              Your Ring hasn't been calibrated yet. Predictions before that would use a generic model with no personal baseline, so they're hidden until you calibrate.
            </Text>
            <TouchableOpacity
              onPress={() => navigation.navigate('Physiological', { screen: 'Fusion' })}
              activeOpacity={0.85}
              style={[styles.calibrateCta, { backgroundColor: COLORS.brandSoft, borderColor: COLORS.brand + '30' }]}
            >
              <Text style={{ color: COLORS.brandDark, fontWeight: '800' }}>Calibrate now →</Text>
            </TouchableOpacity>
          </Card>
        ) : (
        <>
        {/* Live Session Trend Chart */}
        {trend.length > 1 && (
          <Card accentColor={stateColor} elevated style={styles.readingCard}>
            <Text style={[styles.cardTitle, { color: t.text, marginBottom: 4 }]}>Live HRV & EDA Stress Curve</Text>
            <Text style={[styles.cardSub, { color: t.textMuted, marginBottom: 12 }]}>
              Continuous telemetry windows with stress decision boundary
            </Text>
            <LineChart
              points={trend}
              color={stateColor}
              width={TREND_CHART_WIDTH}
              height={145}
              maxValue={100}
              hideValues
              baselineValue={effectiveThresholdPct}
              baselineLabel={personalRingPct != null ? 'Your stress threshold' : 'Stress threshold'}
              colorZones
            />
          </Card>
        )}

        {/* Calibration Drift -- weekly mean predicted-stress vs. the
            resting baseline captured at calibration time (see
            compute_baseline_drift_history(), backend/physiological/
            firebase_service.py). Weeks with too few predictions to be
            meaningful are dropped server-side (mean_prob_stress: null),
            not shown as zero. */}
        {Array.isArray(driftWeeks) && driftWeeks.some((w) => w.mean_prob_stress != null) && (
          <Card accentColor={COLORS.brand} elevated style={styles.readingCard}>
            <Text style={[styles.cardTitle, { color: t.text, marginBottom: 4 }]}>Calibration Drift</Text>
            <Text style={[styles.cardSub, { color: t.textMuted, marginBottom: 12 }]}>
              {ring?.drift?.checked && ring.drift.drift_detected
                ? 'Your recent readings have shifted from your original calibration — recalibrating is recommended.'
                : 'How your recent readings compare to your original resting calibration, week by week.'}
            </Text>
            <LineChart
              points={driftWeeks
                .filter((w) => w.mean_prob_stress != null)
                .map((w) => ({ value: Math.round(w.mean_prob_stress * 100), date: w.week_start }))}
              width={TREND_CHART_WIDTH}
              height={140}
              color={COLORS.brand}
              maxValue={100}
              suffix="%"
              baselineValue={ring?.drift?.original_resting_mean != null
                ? Math.round(ring.drift.original_resting_mean * 100) : undefined}
              baselineLabel="Your original calibration"
              baselineColor={COLORS.normal}
            />
          </Card>
        )}

        {/* Heart Rate Trend */}
        {heartRateTrend.length > 1 && (
          <Card accentColor={COLORS.hrv} elevated style={styles.readingCard}>
            <Text style={[styles.cardTitle, { color: t.text, marginBottom: 4 }]}>Heart Rate</Text>
            <Text style={[styles.cardSub, { color: t.textMuted, marginBottom: 12 }]}>
              Beats per minute, per telemetry window
            </Text>
            <LineChart
              points={heartRateTrend}
              color={COLORS.hrv}
              width={TREND_CHART_WIDTH}
              height={120}
              suffix=" bpm"
            />
          </Card>
        )}

        {/* GSR / Skin Conductance Trend */}
        {gsrTrend.length > 1 && (
          <Card accentColor={COLORS.gsr} elevated style={styles.readingCard}>
            <Text style={[styles.cardTitle, { color: t.text, marginBottom: 4 }]}>Skin Conductance (GSR)</Text>
            <Text style={[styles.cardSub, { color: t.textMuted, marginBottom: 12 }]}>
              Electrodermal activity level, per telemetry window
            </Text>
            <LineChart
              points={gsrTrend}
              color={COLORS.gsr}
              width={TREND_CHART_WIDTH}
              height={120}
              suffix=" µS"
            />
          </Card>
        )}

        {/* Session Distribution */}
        {(sessionDist.normal + sessionDist.stress) > 0 && (
          <Card style={styles.historyCard}>
            <Text style={[styles.cardTitle, { color: t.text, marginBottom: 6 }]}>Session Distribution</Text>
            <DistBar label="Normal" value={sessionDist.normal} total={sessionDist.normal + sessionDist.stress} color={COLORS.normal} muted={t.textMuted} />
            <DistBar label="Stress" value={sessionDist.stress} total={sessionDist.normal + sessionDist.stress} color={COLORS.stress} muted={t.textMuted} />
          </Card>
        )}

        {/* Recent Windows */}
        {recent.length > 0 && (
          <Card style={styles.historyCard}>
            <Text style={[styles.cardTitle, { color: t.text, marginBottom: 6 }]}>Recent Readings</Text>
            {recent.map((w, i) => {
              const color = w.label === 'Stress' ? COLORS.stress : COLORS.normal;
              return (
                <View key={i} style={[styles.activityRow, i === recent.length - 1 && { borderBottomWidth: 0 }, { borderBottomColor: t.border }]}>
                  <MoodBadge stressed={w.label === 'Stress'} color={color} size={36} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[styles.activityLabel, { color: t.text }]}>
                      {w.label === 'Stress' ? 'Elevated Load' : 'Normal State'}
                    </Text>
                    <Text style={[styles.activitySub, { color: t.textMuted }]}>
                      {w.timestamp ? new Date(w.timestamp).toLocaleTimeString() : ''}
                    </Text>
                  </View>
                  <View style={[styles.windowBadge, { backgroundColor: color + '15' }]}>
                    <Text style={[styles.windowBadgeText, { color }]}>{w.label}</Text>
                  </View>
                </View>
              );
            })}
          </Card>
        )}
        </>
        )}
      </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  headerIconCircle: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '900', letterSpacing: -0.2 },
  subtitle: { fontSize: 12, marginTop: 2 },
  statusCard: { marginHorizontal: 20, marginBottom: 14, padding: 18, borderRadius: 22 },
  readingCard: { marginHorizontal: 20, marginBottom: 14, padding: 20, borderRadius: 24 },
  historyCard: { marginHorizontal: 20, marginBottom: 14, padding: 18, borderRadius: 22 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '800' },
  cardSub: { fontSize: 12 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusPillText: { fontSize: 11, fontWeight: '800' },
  contactBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, padding: 10, marginTop: 10 },
  contactBannerText: { fontSize: 12, fontWeight: '700', flex: 1 },
  calibrateCta: { padding: 14, borderRadius: 14, alignItems: 'center', borderWidth: 1 },
  stateLabel: { fontSize: 19, fontWeight: '900', letterSpacing: -0.2 },
  readingSub: { fontSize: 12, marginTop: 2 },
  waitingBlock: { paddingVertical: 10 },
  hint: { fontSize: 12 },
  readingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  distBarBg: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  distBarFill: { height: 8, borderRadius: 4 },
  distValue: { width: 22, fontSize: 13, fontWeight: '800', textAlign: 'right' },
  distLabel: { minWidth: 55, fontSize: 11, fontWeight: '600' },
  activityRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1 },
  activityLabel: { fontSize: 13, fontWeight: '700' },
  activitySub: { fontSize: 11, marginTop: 1 },
  windowBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  windowBadgeText: { fontSize: 11, fontWeight: '700' },
});
