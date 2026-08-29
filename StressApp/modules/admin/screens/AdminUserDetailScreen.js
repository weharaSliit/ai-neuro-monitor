// ============================================================
// AdminUserDetailScreen.js
// Full raw/technical detail for ONE selected user (route param `userId`),
// independent of whichever account is actually logged into this phone --
// driven by the new /admin/... routes (backend/physiological/app.py,
// backend/psychological/app.py), which take user_id explicitly and skip
// the ownership check the user-facing routes enforce. Read-only.
// ============================================================
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Dimensions } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import axios from 'axios';
import { ref, onValue, off } from 'firebase/database';
import { db } from '../../../firebase';
import ScreenBackground from '../../shared/ScreenBackground';
import Card from '../../shared/Card';
import Button from '../../shared/Button';
import StatusDot from '../../shared/StatusDot';
import Icon, { NAMES } from '../../shared/Icon';
import MoodBadge from '../../shared/MoodBadge';
import LineChart from '../../shared/LineChart';
import { COLORS } from '../../physiological/config/theme';
import { API_BASE, DEVICE_ID, STRESS_DECISION_THRESHOLD_PERCENT } from '../../physiological/config/config';
import api from '../../physiological/api/client';
import { useAuth } from '../../../context/AuthContext';

const TREND_CHART_WIDTH = Dimensions.get('window').width - 2 * 20 - 2 * 18;
const RING_POLL_MS = 5000; // same cadence the old Ringscreen.js used

// Same Render-hosted, cold-start-tolerant pattern already used for EEG's
// calibration check in modules/shared/CalibrationGate.js.
const EEG_API_BASE = 'https://mindpulse-eeg.onrender.com';
const eegClient = axios.create({ baseURL: EEG_API_BASE, timeout: 45000 });

// History/baseline/EMA/EEG-calibration all auto-refresh on this interval
// while the screen is open, not just once on focus -- so new sessions/
// recalibrations the selected user does while you're watching actually
// show up without navigating away and back.
const REFRESH_MS = 8000;

function latestWindow(windowsObj) {
    if (!windowsObj) return null;
    const keys = Object.keys(windowsObj).filter((k) => /^\d+$/.test(k));
    if (keys.length === 0) return null;
    keys.sort((a, b) => Number(a) - Number(b));
    return windowsObj[keys[keys.length - 1]];
}

const TABS = ['Ring', 'EEG', 'Phenotyping', 'Relaxation'];

function Row({ label, value, muted, text }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: muted }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: text }]}>{value}</Text>
    </View>
  );
}

function DistBar({ label, value, total, color, muted }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <View style={styles.distRow}>
      <View style={[styles.distBarBg, { backgroundColor: COLORS.light.border }]}>
        <View style={[styles.distBarFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <Text style={[styles.distValue, { color }]}>{value}</Text>
      <Text style={[styles.distLabel, { color: muted }]}>{label}</Text>
    </View>
  );
}

// Every raw feature extract_features.py computes per window (FEATURE_COLS,
// backend/physiological/extract_features.py) -- Admin is the one place all
// 23 get charted; the user-facing Ring screen deliberately shows only
// MeanHR/SCL_mean, the two a non-technical user recognizes.
const RING_FEATURE_CHARTS = [
  { key: 'AVNN', label: 'AVNN (mean RR interval)', unit: ' ms', color: COLORS.hrv },
  { key: 'MeanHR', label: 'Mean Heart Rate', unit: ' bpm', color: COLORS.hrv },
  { key: 'SDHR', label: 'Heart Rate Std Dev (SDHR)', unit: ' bpm', color: COLORS.hrv },
  { key: 'pNN20', label: 'pNN20', unit: '', color: COLORS.hrv },
  { key: 'SD1', label: 'Short-term HRV (SD1)', unit: ' ms', color: COLORS.hrv },
  { key: 'SCL_mean', label: 'Skin Conductance Level (SCL)', unit: ' µS', color: COLORS.gsr },
  { key: 'SCL_slope', label: 'SCL Slope', unit: '', color: COLORS.gsr },
  { key: 'EDA_mean', label: 'EDA Mean', unit: ' µS', color: COLORS.gsr },
  { key: 'EDA_slope', label: 'EDA Slope', unit: '', color: COLORS.gsr },
  { key: 'EDA_std', label: 'EDA Std Dev', unit: ' µS', color: COLORS.gsr },
  { key: 'SCR_count', label: 'SCR Count', unit: '', color: COLORS.gsr },
  { key: 'SCR_amp_mean', label: 'SCR Amplitude (mean)', unit: ' µS', color: COLORS.gsr },
  { key: 'SCR_width_mean', label: 'SCR Width (mean)', unit: ' s', color: COLORS.gsr },
  { key: 'EDA_q10', label: 'EDA 10th Percentile', unit: ' µS', color: COLORS.gsr },
  { key: 'EDA_q75', label: 'EDA 75th Percentile', unit: ' µS', color: COLORS.gsr },
  { key: 'EDA_q90', label: 'EDA 90th Percentile', unit: ' µS', color: COLORS.gsr },
  { key: 'EDA_range', label: 'EDA Range', unit: ' µS', color: COLORS.gsr },
  { key: 'deriv1_std', label: '1st Derivative Std Dev', unit: '', color: COLORS.acc },
  { key: 'deriv2_mean', label: '2nd Derivative Mean', unit: '', color: COLORS.acc },
  { key: 'wavelet_d1_energy', label: 'Wavelet D1 Energy', unit: '', color: COLORS.acc },
  { key: 'wavelet_d3_energy', label: 'Wavelet D3 Energy', unit: '', color: COLORS.acc },
  { key: 'ACC_mean', label: 'Accelerometer Mean', unit: ' g', color: COLORS.acc },
  { key: 'ACC_std', label: 'Accelerometer Std Dev', unit: ' g', color: COLORS.acc },
];

function FeatureTrendChart({ chartWindows, featureKey, label, unit, color, muted, text }) {
  const points = [...chartWindows]
    .reverse()
    .filter((w) => w.timestamp && w.features?.[featureKey] !== undefined && w.features?.[featureKey] !== null)
    .map((w) => ({ value: Number(w.features[featureKey].toFixed(3)), date: new Date(w.timestamp) }));

  if (points.length < 2) return null;

  return (
    <Card>
      <Text style={[styles.cardTitle, { color: text, marginBottom: 4 }]}>{label}</Text>
      <Text style={{ color: muted, marginBottom: 12, fontSize: 11 }}>Per telemetry window</Text>
      <LineChart points={points} color={color} width={TREND_CHART_WIDTH} height={110} suffix={unit} />
    </Card>
  );
}

// Genuinely live (Firebase push, see the subscription in the screen below)
// -- not a poll. `field` picks which modality's contribution to show
// (prob_hrv_gsr for Ring, prob_eeg for EEG); both live in the same merged
// fusion_en window record.
function LiveNowCard({ userId, isLive, liveWindow, field, label, color, muted, text }) {
  const prob = liveWindow?.[field];
  const reporting = prob !== undefined && prob !== null;
  return (
    <Card accentColor={isLive && reporting ? color : muted} elevated>
      <View style={styles.rowBetween}>
        <Text style={[styles.cardTitle, { color: text }]}>Live Now</Text>
        <StatusDot color={isLive && reporting ? color : muted} active={isLive && reporting} size={10} />
      </View>
      {!isLive ? (
        <Text style={{ color: muted, marginTop: 8 }}>
          {userId} isn't the currently active session — only one ring and one
          EEG headset exist, so live data only ever shows for whoever is
          actually wearing the device right now.
        </Text>
      ) : !reporting ? (
        <Text style={{ color: muted, marginTop: 8 }}>
          Active session, waiting for a {label.toLowerCase()} reading…
        </Text>
      ) : (
        <Text style={[styles.liveValue, { color, marginTop: 8 }]}>
          {(prob * 100).toFixed(0)}% {label} stress probability
        </Text>
      )}
    </Card>
  );
}

export default function AdminUserDetailScreen({ route, navigation }) {
  const { userId, name } = route.params;
  const { token } = useAuth();
  const [tab, setTab] = useState('Ring');
  const [loading, setLoading] = useState(true);
  const [baseline, setBaseline] = useState(null);
  const [history, setHistory] = useState(null);
  const [emaHistory, setEmaHistory] = useState(null);
  const [eegCalib, setEegCalib] = useState(null);

  // Live-now state -- there's only one physical ring and one physical EEG
  // headset, so genuinely live data can only ever exist for whichever ONE
  // user is currently the active session (see AuthContext.js's
  // CURRENT_SESSION_ID_ROOTS flat pointer). If the selected user isn't
  // that one, there's nothing live to show for them -- that's the real
  // hardware constraint, not a gap in this screen.
  const [activeUserId, setActiveUserId] = useState(null);
  const [liveWindow, setLiveWindow] = useState(null);
  const isLiveForThisUser = activeUserId === userId;

  // Ring device status + recent-window feed + trend -- restored exactly as
  // the old (deleted) Ringscreen.js showed it, just via /admin/history/...
  // instead of the owner-only route, and polled independent of the
  // 8s history refresh below so it keeps the same 5s cadence it always had.
  const [deviceStatus, setDeviceStatus] = useState('offline');
  const [ringFeed, setRingFeed] = useState([]);
  const [ringChart, setRingChart] = useState([]);

  // EEG's own connected/not status -- there's no device-status REST route
  // for it (unlike the ring's /devices/<id>/status), so "connected" is read
  // the same way FusionSessionScreen.js reads it for the logged-in user:
  // whether the global psychological/current_session_id pointer has a
  // value at all right now.
  const [eegSessionActive, setEegSessionActive] = useState(false);

  // Normal-vs-Stress distribution across this user's sessions, majority-
  // voted from each session's own window predictions -- same derivation
  // the old (deleted) HistoryScreen.js used, since most ring sessions never
  // get a PSS-4 self-report attached to trust a stored label from.
  const [sessionDist, setSessionDist] = useState({ normal: 0, stress: 0 });

  const load = useCallback(async () => {
    const [b, h, e, eeg] = await Promise.all([
      api.get(`/admin/baseline/${userId}`).then((r) => r.data).catch(() => null),
      api.get(`/admin/history/${userId}`).then((r) => r.data).catch(() => null),
      api.get(`/admin/ema/history/${userId}`).then((r) => r.data).catch(() => null),
      eegClient.get(`/admin/calibration/${userId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }).then((r) => r.data).catch(() => null),
    ]);
    setBaseline(b);
    setHistory(h);
    setEmaHistory(e);
    setEegCalib(eeg);
    setLoading(false);
  }, [userId, token]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]));

  const pollRing = useCallback(async () => {
    try {
      const s = await axios.get(`${API_BASE}/devices/${DEVICE_ID}/status`);
      setDeviceStatus(s.data?.status || 'offline');
    } catch {
      setDeviceStatus('offline');
    }
    try {
      const h = await api.get(`/admin/history/${userId}`);
      const sessionIds = Object.keys(h.data?.sessions || {});
      const latestId = sessionIds[sessionIds.length - 1];
      if (!latestId) { setRingFeed([]); setRingChart([]); return; }
      const s2 = await api.get(`/admin/history/${userId}/${latestId}`);
      const predictions = Object.values(s2.data?.predictions || {})
        .sort((a, b) => (b.window_idx ?? 0) - (a.window_idx ?? 0));
      setRingFeed(predictions.slice(0, 5));
      setRingChart(predictions.slice(0, 20));
    } catch {
      // leave last-known feed showing on a transient failure
    }
  }, [userId]);

  useFocusEffect(useCallback(() => {
    pollRing();
    const timer = setInterval(pollRing, RING_POLL_MS);
    return () => clearInterval(timer);
  }, [pollRing]));

  // Genuine live subscription (Firebase push, not polling) -- same pattern
  // Overview/FusionSessionScreen.js uses for the logged-in user, here
  // watching whichever user the flat current_user_id pointer says is
  // actually active right now. fusion_en/{userId}/{sessionId} already
  // carries BOTH modalities merged into one record (prob_eeg from EEG's
  // write, prob_hrv_gsr from Ring's), so one subscription covers both the
  // Ring and EEG "Live Now" cards below.
  useEffect(() => {
    const pointerRef = ref(db, 'fusion_en_sessions/current_user_id');
    const sessionPointerRef = ref(db, 'fusion_en_sessions/current_session_id');
    let dataRef = null;
    let dataHandler = null;
    let activeUid = null;
    let activeSid = null;

    const trySubscribe = () => {
      if (dataRef) { off(dataRef, 'value', dataHandler); dataRef = null; }
      setLiveWindow(null);
      if (activeUid !== userId || !activeSid) return;
      dataRef = ref(db, `fusion_en/${activeUid}/${activeSid}`);
      dataHandler = onValue(dataRef, (snap) => setLiveWindow(latestWindow(snap.val())));
    };

    const uidHandler = onValue(pointerRef, (snap) => {
      activeUid = snap.val();
      setActiveUserId(activeUid);
      trySubscribe();
    });
    const sidHandler = onValue(sessionPointerRef, (snap) => {
      activeSid = snap.val();
      trySubscribe();
    });

    return () => {
      off(pointerRef, 'value', uidHandler);
      off(sessionPointerRef, 'value', sidHandler);
      if (dataRef) off(dataRef, 'value', dataHandler);
    };
  }, [userId]);

  useEffect(() => {
    const eegPointerRef = ref(db, 'psychological/current_session_id');
    const eegHandler = onValue(eegPointerRef, (snap) => setEegSessionActive(!!snap.val()));
    return () => off(eegPointerRef, 'value', eegHandler);
  }, []);

  // Recomputed whenever the session count changes (new session appears) --
  // per-session predictions aren't included in /admin/history/<userId>
  // itself, so this fetches each session's window detail the same way the
  // old HistoryScreen.js did, just against the admin route.
  useEffect(() => {
    const sessionIds = history?.sessions ? Object.keys(history.sessions) : [];
    if (sessionIds.length === 0) { setSessionDist({ normal: 0, stress: 0 }); return; }
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(sessionIds.map(async (sid) => {
        try {
          const s = await api.get(`/admin/history/${userId}/${sid}`);
          const preds = Object.values(s.data?.predictions || {});
          if (preds.length === 0) return null;
          const stressCount = preds.filter((p) => p.label === 'Stress').length;
          return stressCount > preds.length / 2 ? 'Stress' : 'Normal';
        } catch {
          return null;
        }
      }));
      if (cancelled) return;
      const dist = entries.reduce((acc, label) => {
        if (label === 'Stress') acc.stress++;
        else if (label === 'Normal') acc.normal++;
        return acc;
      }, { normal: 0, stress: 0 });
      setSessionDist(dist);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when the session count actually changes
  }, [userId, history?.sessions ? Object.keys(history.sessions).length : 0]);

  const text  = COLORS.light.text;
  const muted = COLORS.light.textMuted;
  const sessions = history?.sessions ? Object.entries(history.sessions) : [];
  const pss4 = history?.pss4 ? Object.entries(history.pss4) : [];
  const emaEntries = emaHistory?.ema_history ? Object.values(emaHistory.ema_history) : [];

  const ringConnected = deviceStatus === 'online';
  const ringLatest = ringFeed[0];
  const ringTrendColor = ringLatest?.label === 'Stress' ? COLORS.stress : COLORS.normal;
  const ringTrend = [...ringChart]
    .reverse()
    .filter((w) => w.timestamp && w.prob_stress !== undefined && w.prob_stress !== null)
    .map((w) => ({ value: Math.round(w.prob_stress * 100), date: new Date(w.timestamp) }));

  // Session baseline -- mean of the earliest readings currently loaded for
  // this session (ringTrend is oldest-first), same derivation the user app
  // used to show on its own Ring chart before that moved here per request
  // (deviation/baseline detail belongs in Admin, not the user-facing app).
  const ringSessionBaseline = ringTrend.length >= 3
    ? Math.round(ringTrend.slice(0, 3).reduce((sum, p) => sum + p.value, 0) / 3)
    : null;

  return (
    <ScreenBackground edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backRow}>
          <Icon name={NAMES.back} size={20} color={COLORS.brand} />
          <Text style={{ color: COLORS.brand, fontWeight: '700' }}>All Users</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: text }]}>{name || userId}</Text>
        <Text style={[styles.subtitle, { color: muted }]}>@{userId}</Text>
      </View>

      <View style={styles.tabRow}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tabBtn, tab === t && { backgroundColor: COLORS.brand }]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, { color: tab === t ? '#FFFFFF' : muted }]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={COLORS.brand} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 12 }}>
          {tab === 'Ring' && (
            <>
              {/* Restored exactly as the old Ringscreen.js showed it --
                  device connection status, the last 5 windows as a live
                  feed, and the trend chart -- not a condensed summary. */}
              <Card accentColor={ringConnected ? COLORS.normal : COLORS.stress} elevated>
                <View style={styles.rowBetween}>
                  <View style={styles.rowGap}>
                    <Icon name={NAMES.device} size={18} color={ringConnected ? COLORS.normal : COLORS.stress} />
                    <Text style={[styles.cardTitle, { color: text, marginBottom: 0 }]}>Device Status</Text>
                  </View>
                  <StatusDot color={ringConnected ? COLORS.normal : COLORS.stress} active={ringConnected} size={10} />
                </View>
                <Text style={[styles.liveValue, { color: ringConnected ? COLORS.normal : COLORS.stress, marginTop: 8, fontSize: 16 }]}>
                  {ringConnected ? 'Connected' : 'Offline'}
                </Text>
                <Text style={{ color: muted, marginTop: 4, fontSize: 12 }}>
                  {ringConnected ? `Streaming from ${DEVICE_ID}` : `Waiting for ${DEVICE_ID}`}
                </Text>
              </Card>

              <Card>
                <View style={styles.rowBetween}>
                  <Text style={[styles.cardTitle, { color: text, marginBottom: 0 }]}>Live Activity</Text>
                  {ringFeed.length > 0 && <StatusDot color={COLORS.brand} active={ringConnected} />}
                </View>
                {ringFeed.length === 0 ? (
                  <Text style={{ color: muted, marginTop: 8 }}>No windows recorded yet for this user.</Text>
                ) : (
                  ringFeed.map((w, i) => {
                    const color = w.label === 'Stress' ? COLORS.stress : COLORS.normal;
                    const confidence = Math.max(w.prob_normal ?? 0, w.prob_stress ?? 0);
                    return (
                      <View key={i} style={[styles.row, styles.rowWithBadge, { borderBottomColor: COLORS.light.border, borderBottomWidth: 1 }]}>
                        <MoodBadge stressed={w.label === 'Stress'} color={color} size={32} />
                        <View style={{ flex: 1, marginLeft: 10 }}>
                          <Text style={[styles.rowLabel, { color: text, fontWeight: '600' }]}>
                            Window {w.window_idx ?? '—'} · <Text style={{ color }}>{w.label || '—'}</Text>
                          </Text>
                          <Text style={{ color: muted, fontSize: 11, marginTop: 2 }}>
                            {w.timestamp ? new Date(w.timestamp).toLocaleTimeString() : ''}
                            {' · '}{Math.round(confidence * 100)}% confidence
                          </Text>
                        </View>
                      </View>
                    );
                  })
                )}
              </Card>

              {ringTrend.length > 1 && (
                <Card>
                  <View style={styles.rowBetween}>
                    <Text style={[styles.cardTitle, { color: text, marginBottom: 0 }]}>Live Stress Trend</Text>
                    <StatusDot color={ringTrendColor} active={ringConnected} />
                  </View>
                  <Text style={{ color: muted, marginTop: 4, marginBottom: 12, fontSize: 11 }}>
                    P(stress) across the most recent windows (%)
                  </Text>
                  <LineChart
                    points={ringTrend}
                    color={ringTrendColor}
                    width={TREND_CHART_WIDTH}
                    height={130}
                    maxValue={100}
                    suffix="%"
                    baselineValue={STRESS_DECISION_THRESHOLD_PERCENT}
                    baselineLabel="Stress level"
                    baseline2Value={ringSessionBaseline}
                    baseline2Label="Session start"
                  />
                </Card>
              )}

              {ringChart.length > 1 && (
                <>
                  <Text style={[styles.sectionLabel, { color: muted }]}>
                    Raw Feature Trends ({RING_FEATURE_CHARTS.length})
                  </Text>
                  {RING_FEATURE_CHARTS.map((f) => (
                    <FeatureTrendChart
                      key={f.key}
                      chartWindows={ringChart}
                      featureKey={f.key}
                      label={f.label}
                      unit={f.unit}
                      color={f.color}
                      muted={muted}
                      text={text}
                    />
                  ))}
                </>
              )}

              {(sessionDist.normal + sessionDist.stress) > 0 && (
                <Card>
                  <Text style={[styles.cardTitle, { color: text }]}>Session Distribution</Text>
                  <DistBar label="Normal" value={sessionDist.normal} total={sessionDist.normal + sessionDist.stress} color={COLORS.normal} muted={muted} />
                  <DistBar label="Stress" value={sessionDist.stress} total={sessionDist.normal + sessionDist.stress} color={COLORS.stress} muted={muted} />
                </Card>
              )}

              <Card>
                <Text style={[styles.cardTitle, { color: text }]}>Baseline</Text>
                {baseline?.exists ? (
                  <>
                    <Row label="Updated" value={baseline.updated_at ? new Date(baseline.updated_at).toLocaleString() : '—'} muted={muted} text={text} />
                    <Row label="Age" value={baseline.age_days != null ? `${baseline.age_days.toFixed(1)} days` : '—'} muted={muted} text={text} />
                    <Row label="Soft-stale (>7d)" value={baseline.is_stale_soft ? 'Yes' : 'No'} muted={muted} text={text} />
                    <Row label="Hard-stale (>30d)" value={baseline.is_stale_hard ? 'Yes' : 'No'} muted={muted} text={text} />
                    {baseline.baseline && Object.entries(baseline.baseline).map(([feat, v]) => (
                      <Row key={feat} label={feat} value={`mean ${v.mean?.toFixed(3)} · std ${v.std?.toFixed(3)}`} muted={muted} text={text} />
                    ))}
                  </>
                ) : (
                  <Text style={{ color: muted }}>No baseline on file.</Text>
                )}
              </Card>

              <Card>
                <Text style={[styles.cardTitle, { color: text }]}>Continuous Stress Adaptation — Learning ({emaEntries.length})</Text>
                {emaEntries.length === 0 ? (
                  <Text style={{ color: muted }}>No recalibration-driven updates yet.</Text>
                ) : (
                  emaEntries.slice(-5).reverse().map((e, i) => (
                    <View key={i} style={[styles.row, { borderBottomColor: COLORS.light.border, borderBottomWidth: 1 }]}>
                      <Text style={[styles.rowLabel, { color: muted }]}>
                        {e.timestamp ? new Date(e.timestamp).toLocaleString() : 'Recent'}
                      </Text>
                      <Text style={[styles.rowValue, { color: text }]}>α={e.alpha}</Text>
                    </View>
                  ))
                )}
              </Card>

              <Card>
                <Text style={[styles.cardTitle, { color: text }]}>PSS-4 History ({pss4.length})</Text>
                {pss4.slice(-5).reverse().map(([sid, d]) => (
                  <Row key={sid} label={d.timestamp ? new Date(d.timestamp).toLocaleDateString() : sid} value={`${d.score}/16`} muted={muted} text={text} />
                ))}
              </Card>

              <Card>
                <Text style={[styles.cardTitle, { color: text }]}>Sessions ({sessions.length})</Text>
                {sessions.slice(-10).reverse().map(([sid, d]) => (
                  <TouchableOpacity
                    key={sid}
                    style={[styles.row, { borderBottomColor: COLORS.light.border, borderBottomWidth: 1 }]}
                    onPress={() => navigation.navigate('AdminSessionDetail', { userId, sessionId: sid })}
                  >
                    <Text style={[styles.rowLabel, { color: muted }]}>
                      {d.start_time ? new Date(d.start_time).toLocaleString() : sid}
                    </Text>
                    <Text style={[styles.rowValue, { color: text }]}>{d.window_count ?? 0} windows →</Text>
                  </TouchableOpacity>
                ))}
              </Card>
            </>
          )}

          {tab === 'EEG' && (
            <>
              <Card accentColor={eegSessionActive ? COLORS.normal : COLORS.stress} elevated>
                <View style={styles.rowBetween}>
                  <View style={styles.rowGap}>
                    <Icon name={NAMES.eeg} size={18} color={eegSessionActive ? COLORS.normal : COLORS.stress} />
                    <Text style={[styles.cardTitle, { color: text, marginBottom: 0 }]}>Device Status</Text>
                  </View>
                  <StatusDot color={eegSessionActive ? COLORS.normal : COLORS.stress} active={eegSessionActive} size={10} />
                </View>
                <Text style={[styles.liveValue, { color: eegSessionActive ? COLORS.normal : COLORS.stress, marginTop: 8, fontSize: 16 }]}>
                  {eegSessionActive ? 'Connected' : 'Offline'}
                </Text>
                <Text style={{ color: muted, marginTop: 4, fontSize: 12 }}>
                  {eegSessionActive ? 'EEG headband streaming (wearable02)' : 'Waiting for the EEG headband'}
                </Text>
              </Card>

              <LiveNowCard userId={userId} isLive={isLiveForThisUser} liveWindow={liveWindow}
                field="prob_eeg" label="EEG" color={COLORS.warning} muted={muted} text={text} />

              <Card>
                <View style={styles.rowBetween}>
                  <Text style={[styles.cardTitle, { color: text, marginBottom: 0 }]}>Live Raw Signal</Text>
                  <Icon name={NAMES.chevronRight} size={18} color={muted} />
                </View>
                <Text style={{ color: muted, marginTop: 6, marginBottom: 14 }}>
                  Full raw µV channel charts and the 29-feature bipolar grid
                  -- restored exactly as the old EegSessionScreen.js showed
                  it, watching this user's session live.
                </Text>
                <Button
                  label="Watch Live Signal →"
                  onPress={() => navigation.navigate('AdminEegLive', { userId })}
                  variant="secondary"
                />
              </Card>

            <Card>
              <Text style={[styles.cardTitle, { color: text }]}>Calibration Profile</Text>
              {eegCalib?.exists ? (
                <>
                  <Row label="Calibrated" value={eegCalib.calibrated_at ? new Date(eegCalib.calibrated_at * 1000).toLocaleString() : '—'} muted={muted} text={text} />
                  <Row label="Age" value={eegCalib.age_days != null ? `${eegCalib.age_days.toFixed(1)} days` : '—'} muted={muted} text={text} />
                  <Row label="Soft-stale (>7d)" value={eegCalib.is_stale_soft ? 'Yes' : 'No'} muted={muted} text={text} />
                  <Row label="Hard-stale (>30d)" value={eegCalib.is_stale_hard ? 'Yes' : 'No'} muted={muted} text={text} />
                </>
              ) : (
                <Text style={{ color: muted }}>No EEG calibration profile on file.</Text>
              )}
            </Card>
            </>
          )}

          {tab === 'Phenotyping' && (
            <Card>
              <Text style={[styles.cardTitle, { color: text }]}>Behavioral Analysis</Text>
              <Text style={{ color: muted, marginBottom: 14 }}>
                Z-score deviations, idiographic baseline table, and weekly
                stress pattern -- the same deep-dive that used to be a user-
                facing "Analysis" quick action. Note: like Relaxation below,
                this screen currently reads whichever account is logged in
                via useAuth() (your own admin login), not {userId}'s data --
                a real per-user "view as" mode is a follow-up, not built in
                this pass.
              </Text>
              <TouchableOpacity
                style={[styles.openBtn, { backgroundColor: COLORS.gsr }]}
                onPress={() => navigation.navigate('PhenotypingAnalysis')}
              >
                <Text style={{ color: '#FFFFFF', fontWeight: '800' }}>Open Analysis →</Text>
              </TouchableOpacity>
            </Card>
          )}

          {tab === 'Relaxation' && (
            <Card>
              <Text style={[styles.cardTitle, { color: text }]}>Relaxation Guide</Text>
              <Text style={{ color: muted, marginBottom: 14 }}>
                Opens the Relaxation Guide module. Note: its identity comes
                from your own admin login (AuthContext), not from {userId} --
                so this shows your own relaxation data, not theirs. A real
                "view as this user" mode for Relaxation is a follow-up.
              </Text>
              <TouchableOpacity
                style={[styles.openBtn, { backgroundColor: COLORS.secondary }]}
                onPress={() => navigation.navigate('AdminRelaxation')}
              >
                <Text style={{ color: '#FFFFFF', fontWeight: '800' }}>Open Relaxation Guide →</Text>
              </TouchableOpacity>
            </Card>
          )}
        </ScrollView>
      )}
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  header: { padding: 20, paddingBottom: 8 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 10 },
  title: { fontSize: 22, fontWeight: '900' },
  subtitle: { fontSize: 12, marginTop: 2 },
  tabRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, marginTop: 8 },
  tabBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, backgroundColor: COLORS.light.cardHover },
  tabText: { fontSize: 12, fontWeight: '700' },
  cardTitle: { fontSize: 15, fontWeight: '800', marginBottom: 10 },
  sectionLabel: { fontSize: 12, fontWeight: '800', marginTop: 4, marginBottom: 4, marginLeft: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveValue: { fontSize: 18, fontWeight: '900' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  rowWithBadge: { alignItems: 'center', paddingVertical: 8 },
  rowLabel: { fontSize: 12, flex: 1 },
  rowValue: { fontSize: 12, fontWeight: '700' },
  note: { fontSize: 11, marginTop: 12, lineHeight: 16 },
  openBtn: { padding: 14, borderRadius: 14, alignItems: 'center' },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  distBarBg: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  distBarFill: { height: 8, borderRadius: 4 },
  distValue: { width: 24, fontSize: 13, fontWeight: '800', textAlign: 'right' },
  distLabel: { width: 60, fontSize: 11 },
});
