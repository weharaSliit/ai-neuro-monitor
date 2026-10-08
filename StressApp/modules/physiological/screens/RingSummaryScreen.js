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
import { getContentWidth } from '../../shared/theme/layout';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import axios from 'axios';
import ScreenBackground from '../../shared/ScreenBackground';
import Card from '../../shared/Card';
import StatusDot from '../../shared/StatusDot';
import Icon, { NAMES } from '../../shared/Icon';
import Badge from '../../shared/Badge';
import BalanceRing from '../../shared/BalanceRing';
import LineChart from '../../shared/LineChart';
import { levelOf, LEVEL_COLOR, BODY_WORDS, DEFAULT_RING_THRESHOLD } from '../../shared/levels';
import { TYPE, SPACE, RADIUS } from '../../shared/theme/tokens';
import { useCalibrationSummary } from '../../shared/CalibrationGate';
import { useTheme } from '../config/ThemeContext';
import { COLORS } from '../config/theme';
import { useAuth } from '../../../context/AuthContext';
import { API_BASE, DEVICE_ID, STRESS_DECISION_THRESHOLD_PERCENT } from '../config/config';
import api from '../api/client';

const POLL_INTERVAL_MS = 5000;
// Screen gutter (SPACE.xl) + Card padding (18) on each side.
const TREND_CHART_WIDTH = Math.max(260, getContentWidth() - 2 * 20 - 2 * 18);
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

  const [chartTab, setChartTab] = useState('stress');

  const connected = status === 'online';
  const bodyP = latest?.prob_stress ?? null;
  const bodyThr = ring?.personal_stress_threshold ?? DEFAULT_RING_THRESHOLD;
  const level = latest?.trending_toward_stress && levelOf(bodyP, bodyThr) === 'low'
    ? 'moderate' : levelOf(bodyP, bodyThr);
  const levelColor = level ? LEVEL_COLOR[level] : COLORS.hrv;
  const lastMs = latest?.timestamp ? new Date(latest.timestamp).getTime() : null;
  const isFresh = lastMs != null && Date.now() - lastMs < 3 * 60 * 1000;

  const hr = latest?.features?.MeanHR;
  const scl = latest?.features?.SCL_mean;
  const driftFlag = ring?.drift?.checked && ring.drift.drift_detected;

  const series = {
    stress: { points: trend, color: levelColor, unit: '', title: 'Stress', sub: 'Higher means more stress · dashed line is your limit' },
    heart:  { points: heartRateTrend, color: COLORS.hrv, unit: ' bpm', title: 'Heart', sub: 'Average heart rate per minute' },
    skin:   { points: gsrTrend, color: COLORS.gsr, unit: ' µS', title: 'Skin', sub: 'Skin response — rises with tension or excitement' },
  };
  const active = series[chartTab];
  const totalSessions = sessionDist.normal + sessionDist.stress;

  return (
    <ScreenBackground edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Connection */}
        <View style={styles.connRow}>
          <Badge label={connected ? 'Ring connected' : 'Ring offline'} color={connected ? COLORS.normal : COLORS.light.textMuted} size="sm" />
          {connected && fingerDetected === false && (
            <Badge label="Adjust ring — no finger contact" color={COLORS.warning} size="sm" />
          )}
        </View>

        {neverCalibrated ? (
          <Card style={styles.block}>
            <Text style={styles.blockTitle}>Let's get to know you first</Text>
            <Text style={styles.blockSub}>
              A 2-minute calm calibration teaches the ring what "relaxed" looks like for you. Readings appear after that.
            </Text>
            <TouchableOpacity onPress={() => navigation.navigate('Profile')} activeOpacity={0.85} style={styles.cta}>
              <Text style={styles.ctaText}>Calibrate now</Text>
              <Icon name="arrow-right" size={16} color="#FFFFFF" />
            </TouchableOpacity>
          </Card>
        ) : (
          <>
            {/* Hero ring */}
            <Card style={styles.block}>
              <View style={styles.heroRow}>
                <BalanceRing
                  title="Body stress"
                  value={bodyP != null ? bodyP * 100 : null}
                  word={level ? BODY_WORDS[level] : ''}
                  color={levelColor}
                  size={124}
                  stroke={12}
                />
                <View style={styles.heroText}>
                  <Text style={styles.heroWord}>{level ? BODY_WORDS[level] : 'Waiting'}</Text>
                  <Text style={styles.heroLine}>
                    {level === 'high' ? 'Your body is showing signs of stress.'
                      : level === 'moderate' ? 'A little more active than your usual.'
                      : level === 'low' ? 'Your body is relaxed.'
                      : 'Wear the ring for a minute to get a reading.'}
                  </Text>
                  <Text style={styles.heroWhen}>
                    {lastMs ? (isFresh ? 'Updated just now' : `Last reading ${new Date(lastMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`) : ''}
                  </Text>
                </View>
              </View>
            </Card>

            {/* Two simple numbers */}
            <View style={styles.statRow}>
              <View style={[styles.stat, { backgroundColor: COLORS.hrv + '12', borderColor: COLORS.hrv + '26' }]}>
                <Icon name="heart-pulse" size={20} color={COLORS.hrv} />
                <Text style={styles.statValue}>{hr != null ? Math.round(hr) : '—'}<Text style={styles.statUnit}> bpm</Text></Text>
                <Text style={styles.statLabel}>Heart rate</Text>
              </View>
              <View style={{ width: SPACE.md }} />
              <View style={[styles.stat, { backgroundColor: COLORS.gsr + '12', borderColor: COLORS.gsr + '26' }]}>
                <Icon name="water-outline" size={20} color={COLORS.gsr} />
                <Text style={styles.statValue}>{scl != null ? scl.toFixed(1) : '—'}<Text style={styles.statUnit}> µS</Text></Text>
                <Text style={styles.statLabel}>Skin response</Text>
              </View>
            </View>

            {driftFlag && (
              <TouchableOpacity activeOpacity={0.85} onPress={() => navigation.navigate('Profile')}
                style={[styles.banner, { backgroundColor: COLORS.warningSoft, borderColor: COLORS.warning + '40' }]}>
                <Icon name="tune-variant" size={18} color={COLORS.warningDark} />
                <Text style={[styles.bannerText, { color: COLORS.warningDark }]}>
                  Your readings have shifted lately — a quick recalibration keeps them accurate.
                </Text>
                <Icon name={NAMES.chevronRight} size={18} color={COLORS.warningDark} />
              </TouchableOpacity>
            )}

            {/* One chart, three views */}
            {(trend.length > 1 || heartRateTrend.length > 1 || gsrTrend.length > 1) && (
              <Card style={styles.block}>
                <View style={styles.segment}>
                  {Object.entries(series).map(([key, s]) => (
                    <TouchableOpacity key={key} onPress={() => setChartTab(key)} activeOpacity={0.8}
                      style={[styles.segItem, chartTab === key && styles.segItemOn]}>
                      <Text style={[styles.segText, chartTab === key && styles.segTextOn]}>{s.title}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.blockSub}>{active.sub}</Text>
                <View style={{ marginTop: SPACE.md }}>
                  {active.points.length > 1 ? (
                    // key={chartTab}: each tab is its own chart, so switching
                    // opens fresh on the newest readings with no stale pop-up.
                    chartTab === 'stress' ? (
                      <LineChart key="stress" points={active.points} color={active.color} width={TREND_CHART_WIDTH} height={170}
                        maxValue={100} suffix="%" baselineValue={effectiveThresholdPct} baselineLabel="Your limit" colorZones />
                    ) : (
                      <LineChart key={chartTab} points={active.points} color={active.color} width={TREND_CHART_WIDTH} height={170} suffix={active.unit} />
                    )
                  ) : (
                    <Text style={styles.empty}>Not enough readings yet.</Text>
                  )}
                </View>
              </Card>
            )}

          </>
        )}
      </ScrollView>
    </ScreenBackground>
  );
}

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
  heroWhen: { fontSize: 11, fontWeight: '600', color: COLORS.light.textMuted, marginTop: SPACE.sm },

  statRow: { flexDirection: 'row', marginHorizontal: SPACE.xl, marginBottom: SPACE.md },
  stat: { flex: 1, padding: SPACE.lg, borderRadius: RADIUS.xl, borderWidth: 1 },
  statValue: { fontSize: 26, fontWeight: '800', color: COLORS.light.text, marginTop: SPACE.sm, letterSpacing: -0.5 },
  statUnit: { fontSize: 13, fontWeight: '600', color: COLORS.light.textMuted },
  statLabel: { ...TYPE.caption, color: COLORS.light.textMuted, marginTop: 2 },

  banner: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm,
    marginHorizontal: SPACE.xl, marginBottom: SPACE.md, padding: 14, borderRadius: RADIUS.md, borderWidth: 1,
  },
  bannerText: { flex: 1, fontSize: 13, fontWeight: '700', lineHeight: 18 },

  segment: { flexDirection: 'row', backgroundColor: COLORS.light.pillBg, borderRadius: RADIUS.pill, padding: 3 },
  segItem: { flex: 1, paddingVertical: 8, borderRadius: RADIUS.pill, alignItems: 'center' },
  segItemOn: { backgroundColor: COLORS.light.card, shadowColor: '#1E293B', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  segText: { fontSize: 13, fontWeight: '700', color: COLORS.light.textMuted },
  segTextOn: { color: COLORS.light.text },
  empty: { fontSize: 13, color: COLORS.light.textMuted, textAlign: 'center', paddingVertical: SPACE.xl },

  timeline: { flexDirection: 'row', justifyContent: 'space-between', marginTop: SPACE.md },
  tlItem: { alignItems: 'center', flex: 1 },
  tlDot: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  tlTime: { fontSize: 10, fontWeight: '600', color: COLORS.light.textMuted, marginTop: 4 },
  sessionLine: { fontSize: 12, color: COLORS.light.textSub, marginTop: SPACE.md },

  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: SPACE.md, paddingVertical: 13, borderRadius: RADIUS.md, backgroundColor: COLORS.brand,
  },
  ctaText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
});
