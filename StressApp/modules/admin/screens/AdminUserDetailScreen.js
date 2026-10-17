// ============================================================
// AdminUserDetailScreen.js
// Full raw/technical detail for ONE selected user (route param `userId`),
// independent of whichever account is actually logged into this phone --
// driven by the new /admin/... routes (backend/physiological/app.py,
// backend/psychological/app.py), which take user_id explicitly and skip
// the ownership check the user-facing routes enforce. Read-only.
// ============================================================
import { getContentWidth } from '../../shared/theme/layout';
import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Dimensions } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import axios from 'axios';
import { ref, onValue, off, get, query, orderByKey, limitToLast } from 'firebase/database';
import Svg, { Path as SvgPath, Line as SvgLine, Circle as SvgCircle, G as SvgG, Text as SvgText, Rect as SvgRect } from 'react-native-svg';
import { db } from '../../../firebase';
import ScreenBackground from '../../shared/ScreenBackground';
import Card from '../../shared/Card';
import Button from '../../shared/Button';
import StatusDot from '../../shared/StatusDot';
import Icon, { NAMES } from '../../shared/Icon';
import MoodBadge from '../../shared/MoodBadge';
import LineChart from '../../shared/LineChart';
import { fusionKeyToMs } from '../../shared/levels';
import Dropdown from '../../shared/Dropdown';
import { COLORS } from '../../physiological/config/theme';
import { API_BASE, DEVICE_ID, STRESS_DECISION_THRESHOLD_PERCENT } from '../../physiological/config/config';
import api from '../../physiological/api/client';
import { useAuth } from '../../../context/AuthContext';

const TREND_CHART_WIDTH = Math.max(260, getContentWidth() - 80);
const RING_POLL_MS = 5000; // same cadence the old Ringscreen.js used
// Same cross-session backfill reasoning as RingSummaryScreen.js/
// EegSummaryScreen.js/AdminEegLiveScreen.js -- a session is one
// login-to-logout span, not "how far back the admin trend chart should
// remember", so pollRing() below merges this many of the user's most
// recent sessions instead of only their latest one.
const RECENT_SESSIONS_FOR_CHART = 4;
const CHART_POINTS_MAX = 80;

// Same Render-hosted, cold-start-tolerant pattern already used for EEG's
// calibration check in modules/shared/CalibrationGate.js.
const EEG_API_BASE = 'https://mindpulse-eeg.onrender.com';
const eegClient = axios.create({ baseURL: EEG_API_BASE, timeout: 45000 });

// History/baseline/EMA/EEG-calibration all auto-refresh on this interval
// while the screen is open, not just once on focus -- so new sessions/
// recalibrations the selected user does while you're watching actually
// show up without navigating away and back.
const SLOW_REFRESH_MS = 45000;

function parseTimestamp(ts, fallbackMinutesAgo = 0) {
    if (!ts) return new Date(Date.now() - fallbackMinutesAgo * 60000);
    if (ts instanceof Date) return ts;
    if (typeof ts === 'number') {
        return new Date(ts < 10000000000 ? ts * 1000 : ts);
    }
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? new Date(Date.now() - fallbackMinutesAgo * 60000) : d;
}

function latestWindow(windowsObj) {
    if (!windowsObj) return null;
    const keys = Object.keys(windowsObj).filter((k) => /^\d+$/.test(k));
    if (keys.length === 0) return null;
    keys.sort((a, b) => Number(a) - Number(b));
    return windowsObj[keys[keys.length - 1]];
}

// Same tabs as the website's clinical view (web/src/pages/AdminDashboard.jsx).
const TABS = ['Fusion', 'Ring', 'EEG', 'Phone', 'Relax'];
const EEG_POLL_MS = 15000;
const EEG_FEATURES = [
  { key: 'delta_rel_power', label: 'δ Delta', color: '#64748b' },
  { key: 'theta_rel_power', label: 'θ Theta', color: '#7c3aed' },
  { key: 'alpha_rel_power', label: 'α Alpha', color: '#2563eb' },
  { key: 'beta_rel_power', label: 'β Beta', color: '#16a34a' },
  { key: 'gamma_rel_power', label: 'γ Gamma', color: '#ea580c' },
  { key: 'ptp', label: 'Peak-to-peak', color: '#db2777' },
  { key: 'theta_beta_ratio', label: 'θ/β ratio', color: '#d97706' },
  { key: 'spectral_entropy', label: 'Spectral entropy', color: '#0d9488' },
];
const numericKeys = (obj) => Object.keys(obj || {}).filter((k) => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b));

function Row({ label, value, muted, text }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: muted }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: text }]}>{value}</Text>
    </View>
  );
}

// -- Raw processed signal preview (GSR wave, IBI sequence) --------------
// Backend sends only PROCESSED, size-bounded arrays -- never raw sensor
// data (see extract_features.py::_downsample_wave()/_cap_ibi_sequence(),
// firebase_service.py::save_prediction()'s docstring). Same percentile-
// clamp approach AdminEegLiveScreen.js's chartRange() uses for its
// bipolar waveform, so one stray spike doesn't blow out the whole y-axis.
function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

function waveRange(values) {
  if (!values || values.length === 0) return { min: 0, max: 1 };
  const sorted = [...values].sort((a, b) => a - b);
  let lo = percentile(sorted, 0.05);
  let hi = percentile(sorted, 0.95);
  if (hi <= lo) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.12;
  return { min: lo - pad, max: hi + pad };
}

function RawWaveformChart({ title, hint, lastValue, unit, values, color, width, height = 150, t }) {
  const points = useMemo(() => {
    if (!values || values.length < 2) return [];
    // Same p5-p95 clamp as before, so one spike can't flatten the line.
    const { min, max } = waveRange(values);
    return values.map((v) => ({ value: Math.min(max, Math.max(min, v)) }));
  }, [values]);
  if (points.length < 2) {
    return (
      <View style={{ marginBottom: 16 }}>
        <Text style={[styles.signalTitle, { color: t.textSub }]}>{title}</Text>
        <Text style={{ color: t.textMuted, fontSize: 12, paddingVertical: 10 }}>
          Waiting for a window with this data — only new sessions carry it.
        </Text>
      </View>
    );
  }
  const { min, max } = waveRange(values);
  return (
    <View style={{ marginBottom: 16 }}>
      <View style={styles.signalHeaderRow}>
        <Text style={[styles.signalTitle, { color: t.textSub }]}>{title}</Text>
        <Text style={[styles.signalValue, { color: t.text }]}>
          {lastValue != null ? `${lastValue.toFixed(1)}${unit}` : '—'}
        </Text>
      </View>
      <Text style={{ color: t.textMuted, fontSize: 10, marginBottom: 6 }}>{hint}</Text>
      {/* Shared chart: pinned axis, swipe when dense, tap a point for its value. */}
      <LineChart points={points} color={color} width={width} height={height} suffix={unit} minGap={4} />
      <Text style={{ color: t.textMuted, fontSize: 10, marginTop: 4 }}>
        This window's range: {min.toFixed(1)} – {max.toFixed(1)}{unit}
      </Text>
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

const PHENO_FEATURES = [
  { key: 'avg_dwell', label: 'Key Hold Time (Dwell Time)', unit: ' ms', baseline: 135, color: '#6366F1', icon: '⏱️' },
  { key: 'avg_flight', label: 'Key Pause Time (Flight Time)', unit: ' ms', baseline: 215, color: '#8B5CF6', icon: '⏳' },
  { key: 'scroll_velocity', label: 'Touch Scroll Speed', unit: ' px/s', baseline: 450, color: '#F59E0B', icon: '👆' },
  { key: 'tilt_angle', label: 'Device Tilt Angle', unit: ' °', baseline: 59, color: '#06B6D4', icon: '📱' },
  { key: 'cpm', label: 'Typing Pace (Speed)', unit: ' cpm', baseline: 42, color: '#10B981', icon: '⌨️' },
];

const FeatureTrendChart = React.memo(function FeatureTrendChart({ chartWindows, featureKey, label, unit, color, muted, text, picker }) {
  const points = useMemo(() => [...chartWindows]
    .reverse()
    .filter((w) => w.features?.[featureKey] !== undefined && w.features?.[featureKey] !== null)
    .map((w, i) => ({
      value: Number(w.features[featureKey].toFixed(3)),
      date: parseTimestamp(w.timestamp || w.timestamp_end, chartWindows.length - 1 - i),
    })), [chartWindows, featureKey]);

  return (
    <Card>
      <View style={styles.rowBetween}>
        <Text style={[styles.cardTitle, { color: text, marginBottom: 0 }]}>{label}</Text>
        {picker}
      </View>
      <Text style={{ color: muted, marginTop: 4, marginBottom: 12, fontSize: 11 }}>Per telemetry window · last few sessions</Text>
      {points.length < 2
        ? <Text style={{ color: muted, fontSize: 12 }}>Not enough windows with this feature yet.</Text>
        : <LineChart key={featureKey} points={points} color={color} width={TREND_CHART_WIDTH} height={170} suffix={unit} />}
    </Card>
  );
});

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
  const { userId, name, initialTab } = route?.params || {};
  const { token } = useAuth();
  const [tab, setTab] = useState(initialTab || 'Fusion');
  const [ringFeature, setRingFeature] = useState('MeanHR');
  const [phenoFeature, setPhenoFeature] = useState('avg_dwell');
  const [eegFeature, setEegFeature] = useState('alpha_rel_power');
  const [eegBlocks, setEegBlocks] = useState([]);
  const [fusionWindows, setFusionWindows] = useState({});
  const [showRoadmap, setShowRoadmap] = useState(true);
  const [showValidation, setShowValidation] = useState(true);
  const [showEma, setShowEma] = useState(true);
  const [showFeedback, setShowFeedback] = useState(true);
  const [showAllEmaDays, setShowAllEmaDays] = useState(false);

  // EEG blocks for THIS user -- last few sessions (psychological/{uid}),
  // only while the EEG tab is open.
  useEffect(() => {
    if (!userId || tab !== 'EEG') return undefined;
    let cancelled = false;
    const load = () => get(query(ref(db, `psychological/${userId}`), orderByKey(), limitToLast(RECENT_SESSIONS_FOR_CHART + 1)))
      .then((snap) => {
        if (cancelled) return;
        const all = snap.val() || {};
        const blocks = Object.keys(all).sort()
          .flatMap((sid) => (all[sid] && typeof all[sid] === 'object' ? numericKeys(all[sid]).map((k) => all[sid][k]) : []))
          .filter((b) => b && !b.skipped && b.timestamp_end)
          .sort((a, b) => a.timestamp_end - b.timestamp_end)
          .slice(-160);
        setEegBlocks(blocks);
      })
      .catch(() => {});
    load();
    const id = setInterval(load, EEG_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [userId, tab]);

  // Fusion windows for THIS user -- last few sessions (fusion_en/{uid}).
  useEffect(() => {
    if (!userId || tab !== 'Fusion') return undefined;
    let cancelled = false;
    const load = () => get(query(ref(db, `fusion_en/${userId}`), orderByKey(), limitToLast(RECENT_SESSIONS_FOR_CHART + 1)))
      .then((snap) => {
        if (cancelled) return;
        const all = snap.val() || {};
        const merged = {};
        Object.keys(all).sort().forEach((sid) => { if (all[sid] && typeof all[sid] === 'object') Object.assign(merged, all[sid]); });
        setFusionWindows(merged);
      })
      .catch(() => {});
    load();
    const id = setInterval(load, EEG_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [userId, tab]);

  const fusionPoints = useMemo(() => numericKeys(fusionWindows).slice(-160).map((k) => {
    const w = fusionWindows[k] || {};
    return {
      date: new Date(fusionKeyToMs(k)),
      values: [w.prob_eeg, w.prob_hrv_gsr, w.fused_probability].map((v) => (v != null ? Math.round(v * 100) : null)),
    };
  }), [fusionWindows]);
  const fusionLatest = useMemo(() => {
    const keys = numericKeys(fusionWindows);
    for (let i = keys.length - 1; i >= 0; i -= 1) {
      const w = fusionWindows[keys[i]];
      if (w && w.fused_probability != null) return { ...w, _key: Number(keys[i]) };
    }
    return null;
  }, [fusionWindows]);

  const eegScorePoints = useMemo(() => eegBlocks.filter((b) => b.task_state_score != null)
    .map((b) => ({ date: new Date(b.timestamp_end * 1000), value: Math.round(b.task_state_score * 100) })), [eegBlocks]);
  const eegQualityPoints = useMemo(() => eegBlocks.filter((b) => b.eeg_quality_score != null)
    .map((b) => ({ date: new Date(b.timestamp_end * 1000), value: Math.round(b.eeg_quality_score * 100) })), [eegBlocks]);
  const eegFeaturePoints = useMemo(() => eegBlocks.filter((b) => b.features_eeg?.bipolar?.[eegFeature] != null)
    .map((b) => ({ date: new Date(b.timestamp_end * 1000), value: Number(b.features_eeg.bipolar[eegFeature]) })), [eegBlocks, eegFeature]);
  const eegLatestBlock = eegBlocks[eegBlocks.length - 1];
  const [loading, setLoading] = useState(true);
  const [baseline, setBaseline] = useState(null);
  const [history, setHistory] = useState(null);
  const [emaHistory, setEmaHistory] = useState(null);
  const [eegCalib, setEegCalib] = useState(null);
  const [phenoDeviceId, setPhenoDeviceId] = useState(null);

  useEffect(() => {
    if (!userId) return;
    const usersRef = ref(db, 'phenotyping/users');
    get(usersRef).then((snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        const found = Object.entries(data).find(([devId, prof]) => {
          return prof.name === name || prof.name === userId || devId === userId;
        });
        if (found) {
          setPhenoDeviceId(found[0]);
        }
      }
    }).catch((err) => {
      console.log('Error resolving pheno deviceId:', err);
    });
  }, [userId, name]);

  const [phenoDataLogs, setPhenoDataLogs] = useState({});
  const [phenoUserRecord, setPhenoUserRecord] = useState(null);
  const [phenoPredictions, setPhenoPredictions] = useState({});
  const [phenoValidationLabels, setPhenoValidationLabels] = useState({});
  const [phenoFeedback, setPhenoFeedback] = useState({});
  const [phenoExperiments, setPhenoExperiments] = useState({});

  useEffect(() => {
    const targetUid = phenoDeviceId || userId;
    if (!targetUid) return;
    const logsRef = ref(db, `phenotyping/data_logs/${targetUid}`);
    const userRef = ref(db, `phenotyping/users/${targetUid}`);
    const predsRef = ref(db, `phenotyping/predictions/${targetUid}`);
    const labelsRef = ref(db, `phenotyping/validation_labels/${targetUid}`);
    const fbRef = ref(db, `phenotyping/feedback/${targetUid}`);
    const expRef = ref(db, `phenotyping/controlled_experiments/${targetUid}`);

    const offLogs = onValue(logsRef, (snap) => setPhenoDataLogs(snap.val() || {}));
    const offUser = onValue(userRef, (snap) => setPhenoUserRecord(snap.val() || null));
    const offPreds = onValue(predsRef, (snap) => setPhenoPredictions(snap.val() || {}));
    const offLabels = onValue(labelsRef, (snap) => setPhenoValidationLabels(snap.val() || {}));
    const offFb = onValue(fbRef, (snap) => setPhenoFeedback(snap.val() || {}));
    const offExp = onValue(expRef, (snap) => setPhenoExperiments(snap.val() || {}));

    return () => {
      off(logsRef, 'value', offLogs);
      off(userRef, 'value', offUser);
      off(predsRef, 'value', offPreds);
      off(labelsRef, 'value', offLabels);
      off(fbRef, 'value', offFb);
      off(expRef, 'value', offExp);
    };
  }, [phenoDeviceId, userId]);

  const phenoTrendPoints = useMemo(() => {
    const targetUid = phenoDeviceId || userId;
    if (!targetUid) return [];

    const uLogs = phenoDataLogs || {};
    const uPreds = phenoPredictions || {};
    const uBaselines = phenoUserRecord?.baselines || {};

    const pts = [];

    const predEntries = Object.values(uPreds)
      .filter((p) => p && p.timestamp)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    if (predEntries.length > 0) {
      predEntries.forEach((p) => {
        let score = 20;
        if (typeof p.stress_score === 'number') {
          score = Math.round(p.stress_score * 100);
        } else if (typeof p.composite_z === 'number') {
          score = Math.min(100, Math.max(5, Math.round((p.composite_z / 3.0) * 100)));
        }
        pts.push({
          value: Math.min(100, Math.max(0, score)),
          date: new Date(p.timestamp),
        });
      });
    }

    if (pts.length < 2 && Object.keys(uLogs).length > 0) {
      const sortedLogs = Object.entries(uLogs).sort((a, b) => a[0].localeCompare(b[0]));
      sortedLogs.forEach(([key, w]) => {
        const d = w || {};
        let winDate = new Date();
        if (d.timestamp) {
          const parsed = new Date(d.timestamp);
          if (!isNaN(parsed.getTime())) winDate = parsed;
        } else if (typeof key === 'string' && /^\d{8}_\d{6}$/.test(key)) {
          const y = parseInt(key.slice(0, 4), 10);
          const m = parseInt(key.slice(4, 6), 10) - 1;
          const day = parseInt(key.slice(6, 8), 10);
          const hh = parseInt(key.slice(9, 11), 10);
          const mm = parseInt(key.slice(11, 13), 10);
          const ss = parseInt(key.slice(13, 15), 10);
          winDate = new Date(y, m, day, hh, mm, ss);
        }

        const activeZs = [];
        if (typeof d.avg_dwell === 'number' && d.avg_dwell > 0) {
          activeZs.push(Math.abs((d.avg_dwell - (uBaselines.avg_dwell?.mean ?? 135)) / (uBaselines.avg_dwell?.std ?? 25)));
        }
        if (typeof d.avg_flight === 'number' && d.avg_flight > 0) {
          activeZs.push(Math.abs((d.avg_flight - (uBaselines.avg_flight?.mean ?? 215)) / (uBaselines.avg_flight?.std ?? 35)));
        }
        if (typeof d.scroll_velocity === 'number' && d.scroll_velocity > 0) {
          activeZs.push(Math.min(3.5, Math.abs((d.scroll_velocity - (uBaselines.scroll_velocity?.mean ?? 450)) / (uBaselines.scroll_velocity?.std ?? 200))));
        }
        if (typeof d.tilt_angle === 'number' && d.tilt_angle > 0) {
          activeZs.push(Math.min(3.5, Math.abs((d.tilt_angle - (uBaselines.tilt_angle?.mean ?? 59)) / (uBaselines.tilt_angle?.std ?? 15))));
        }
        if (typeof d.cpm === 'number' && d.cpm > 0) {
          activeZs.push(Math.abs((d.cpm - (uBaselines.cpm?.mean ?? 42)) / (uBaselines.cpm?.std ?? 15)));
        }
        const meanZ = activeZs.length > 0 ? (activeZs.reduce((a, b) => a + b, 0) / activeZs.length) : 0.35;
        const score = Math.min(95, Math.max(10, Math.round(18 + (meanZ / 2.5) * 50)));
        pts.push({ value: score, date: winDate });
      });
    }

    pts.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const trimmed = pts.slice(-35);
    if (trimmed.length === 1) {
      trimmed.unshift({ value: Math.max(15, trimmed[0].value - 5), date: new Date(trimmed[0].date.getTime() - 120000) });
    }
    return trimmed;
  }, [phenoDeviceId, userId, phenoDataLogs, phenoPredictions, phenoUserRecord]);

  const phenoRawPoints = useMemo(() => {
    const targetUid = phenoDeviceId || userId;
    if (!targetUid) return {};
    const uLogs = phenoDataLogs || {};
    const sortedEntries = Object.entries(uLogs).sort((a, b) => a[0].localeCompare(b[0]));

    const result = {};
    PHENO_FEATURES.forEach((f) => {
      const validPoints = [];
      sortedEntries.forEach(([key, w]) => {
        const val = w?.[f.key];
        if (typeof val === 'number' && val > 0) {
          let winDate = new Date();
          if (w.timestamp) {
            const parsed = new Date(w.timestamp);
            if (!isNaN(parsed.getTime())) winDate = parsed;
          } else if (typeof key === 'string' && /^\d{8}_\d{6}$/.test(key)) {
            const y = parseInt(key.slice(0, 4), 10);
            const m = parseInt(key.slice(4, 6), 10) - 1;
            const day = parseInt(key.slice(6, 8), 10);
            const hh = parseInt(key.slice(9, 11), 10);
            const mm = parseInt(key.slice(11, 13), 10);
            const ss = parseInt(key.slice(13, 15), 10);
            winDate = new Date(y, m, day, hh, mm, ss);
          }
          validPoints.push({
            value: Number(val.toFixed(1)),
            date: winDate,
          });
        }
      });
      validPoints.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      result[f.key] = validPoints.slice(-35);
    });
    return result;
  }, [phenoDeviceId, userId, phenoDataLogs]);

  const phenoMetrics = useMemo(() => {
    const isCalibrated = !!phenoUserRecord?.is_calibrated;
    let dayCount = 1;
    const createdAt = phenoUserRecord?.created_at;
    if (createdAt) {
      const diff = Date.now() - new Date(createdAt).getTime();
      dayCount = Math.min(7, Math.max(1, Math.floor(diff / 86400000) + 1));
    } else if (phenoUserRecord?.calibration_day) {
      dayCount = phenoUserRecord.calibration_day;
    }

    const uLogs = phenoDataLogs || {};
    const logKeys = Object.keys(uLogs);
    const logCount = logKeys.length;

    let latestLogDate = null;
    logKeys.forEach((k) => {
      const w = uLogs[k] || {};
      let d = null;
      if (w.timestamp) {
        const parsed = new Date(w.timestamp);
        if (!isNaN(parsed.getTime())) d = parsed;
      } else if (typeof k === 'string' && /^\d{8}_\d{6}$/.test(k)) {
        const y = parseInt(k.slice(0, 4), 10);
        const m = parseInt(k.slice(4, 6), 10) - 1;
        const day = parseInt(k.slice(6, 8), 10);
        const hh = parseInt(k.slice(9, 11), 10);
        const mm = parseInt(k.slice(11, 13), 10);
        const ss = parseInt(k.slice(13, 15), 10);
        d = new Date(y, m, day, hh, mm, ss);
      }
      if (d && (!latestLogDate || d > latestLogDate)) {
        latestLogDate = d;
      }
    });

    const msSinceLastLog = latestLogDate ? Date.now() - latestLogDate.getTime() : Infinity;
    const isSensorActive = logCount > 0 && msSinceLastLog <= 12 * 3600 * 1000;
    const latestLogStr = latestLogDate
      ? latestLogDate.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' +
        latestLogDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : 'None';

    // Parse EMA validation labels (siss & pss4)
    const sissList = Object.entries(phenoValidationLabels?.siss || {}).map(([id, item]) => ({
      id,
      type: 'SISS',
      score: item?.score ?? 0,
      timestamp: item?.timestamp ? new Date(item.timestamp) : null,
      rawTime: item?.timestamp,
    }));
    const pss4List = Object.entries(phenoValidationLabels?.pss4 || {}).map(([id, item]) => ({
      id,
      type: 'PSS-4',
      score: item?.score ?? 0,
      timestamp: item?.timestamp ? new Date(item.timestamp) : null,
      rawTime: item?.timestamp,
    }));
    const allSurveys = [...sissList, ...pss4List].sort((a, b) => (b.timestamp?.getTime() || 0) - (a.timestamp?.getTime() || 0));

    // Today's surveys count
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const surveysToday = allSurveys.filter((s) => s.timestamp && s.timestamp >= todayStart).length;
    const emaCompliant = surveysToday >= 2;

    // EMA ground truth stats
    const sissCalmCount = sissList.filter((s) => s.score <= 2).length;
    const sissStressCount = sissList.filter((s) => s.score >= 3).length;
    const calmPct = allSurveys.length > 0 ? Math.round((sissCalmCount / allSurveys.length) * 100) : 100;
    const avgScore = allSurveys.length > 0
      ? (allSurveys.reduce((acc, s) => acc + s.score, 0) / allSurveys.length).toFixed(1)
      : null;

    // Feedback
    const fbEntries = Object.entries(phenoFeedback || {}).map(([id, item]) => ({ id, ...item }));
    const latestFb = fbEntries.length > 0 ? fbEntries[fbEntries.length - 1] : null;

    // Controlled Experiment (Tier 1 & Tier 2)
    const expEntries = Object.values(phenoExperiments || {}).filter(Boolean);
    const typingExp = expEntries.filter((e) => e?.experiment_type?.includes('typing') || e?.experiment_type?.includes('escalation')).pop();
    const latestExp = typingExp || (expEntries.length > 0 ? expEntries[expEntries.length - 1] : null);
    const hasExperiment = !!latestExp;
    const expCalmDwell = latestExp?.calm_metrics?.dwell_time_ms != null
      ? Math.round(latestExp.calm_metrics.dwell_time_ms)
      : (latestExp?.calm_metrics?.avg_dwell != null ? Math.round(latestExp.calm_metrics.avg_dwell) : null);
    const expStressDwell = latestExp?.high_stress_metrics?.dwell_time_ms != null
      ? Math.round(latestExp.high_stress_metrics.dwell_time_ms)
      : (latestExp?.stress_metrics?.avg_dwell != null ? Math.round(latestExp.stress_metrics.avg_dwell) : null);
    const expShiftPct = latestExp?.hypothesis_test?.dwell_elongation_pct != null
      ? Math.round(latestExp.hypothesis_test.dwell_elongation_pct)
      : ((expCalmDwell && expStressDwell) ? Math.round(((expStressDwell - expCalmDwell) / expCalmDwell) * 100) : null);
    const expType = latestExp?.experiment_type
      ? (latestExp.experiment_type.includes('typing') ? 'Symmetric Typing Escalation' : 'In-Situ Cognitive Challenge')
      : null;

    // Smart Ring cross-sensor (Tier 2)
    const latestDualSync = expEntries.filter((e) => e?.experiment_type === 'dual_sensor_sync_triangulation').pop();
    const ringSessionCount = Object.keys(history?.sessions || {}).length || (latestDualSync ? 1 : 0);
    const hasRingData = ringSessionCount > 0 || !!latestDualSync;

    // Idiographic baseline calculation from user logs
    const userDwells = Object.values(uLogs).map((w) => w?.avg_dwell).filter((v) => typeof v === 'number' && v > 0);
    const userMeanDwell = userDwells.length > 0 ? (userDwells.reduce((a, b) => a + b, 0) / userDwells.length).toFixed(1) : null;

    // Concordance / Validation calculation (genuine user-wise calculation)
    let concordancePct = null;
    let concordanceLabel = 'Pending (Calibration Phase)';
    const preds = Object.values(phenoPredictions || {}).filter((p) => p && p.timestamp);

    if (allSurveys.length > 0 && preds.length > 0) {
      let matchCount = 0;
      let totalChecked = 0;
      allSurveys.forEach((surv) => {
        if (!surv.timestamp) return;
        const survTime = surv.timestamp.getTime();
        const nearest = preds.find((p) => Math.abs(new Date(p.timestamp).getTime() - survTime) < 7200000);
        if (nearest) {
          totalChecked++;
          const survStress = surv.type === 'SISS' ? surv.score >= 3 : surv.score >= 8;
          const predStress = (nearest.stress_score ?? 0) > 0.5 || (nearest.composite_z ?? 0) > 1.0;
          if (survStress === predStress) matchCount++;
        }
      });
      if (totalChecked > 0) {
        concordancePct = Math.round((matchCount / totalChecked) * 100);
        concordanceLabel = concordancePct >= 80 ? 'High Agreement' : concordancePct >= 60 ? 'Moderate' : 'Divergent';
      } else {
        concordanceLabel = 'No Overlapping Windows';
      }
    } else if (isCalibrated) {
      concordanceLabel = 'Pending Predictions';
    } else {
      concordanceLabel = `In Progress (Day ${dayCount}/7)`;
    }

    return {
      isCalibrated,
      dayCount,
      daysRemaining: Math.max(0, 7 - dayCount),
      logCount,
      latestLogDate,
      latestLogStr,
      isSensorActive,
      sissCount: sissList.length,
      pss4Count: pss4List.length,
      totalSurveys: allSurveys.length,
      surveysToday,
      emaCompliant,
      allSurveys,
      sissCalmCount,
      sissStressCount,
      calmPct,
      avgScore,
      latestFb,
      feedbackFilled: !!latestFb,
      concordancePct,
      concordanceLabel,
      hasExperiment,
      expCalmDwell,
      expStressDwell,
      expShiftPct,
      expType,
      hasRingData,
      ringSessionCount,
      userMeanDwell,
      latestDualSync,
      dualSyncConcordance: latestDualSync?.concordance_rate || null,
      dualSyncCorrelation: latestDualSync?.correlation_r || null,
    };
  }, [phenoUserRecord, phenoDataLogs, phenoValidationLabels, phenoFeedback, phenoPredictions, phenoExperiments, history]);

  const surveysByDay = useMemo(() => {
    const map = {};
    (phenoMetrics.allSurveys || []).forEach((s) => {
      if (!s.timestamp) return;
      const d = s.timestamp;
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!map[dateKey]) {
        const today = new Date();
        const isToday = d.toDateString() === today.toDateString();
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        const isYesterday = d.toDateString() === yesterday.toDateString();
        const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
        const label = isToday ? `Today · ${dateStr}` : isYesterday ? `Yesterday · ${dateStr}` : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
        map[dateKey] = {
          dateKey,
          label,
          rawTime: d.getTime(),
          items: [],
        };
      }
      map[dateKey].items.push(s);
    });
    return Object.values(map).sort((a, b) => b.rawTime - a.rawTime);
  }, [phenoMetrics.allSurveys]);

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

  // ── Slow-changing records (baseline, EMA history, EEG calibration) ──
  // These only change when the user recalibrates, so they refresh on a
  // slow cycle. /admin/history is NOT fetched here anymore -- pollRing()
  // below already fetches it every tick, and fetching it on two
  // unsynchronized timers was one of the causes of the laggy charts.
  const load = useCallback(async () => {
    const [b, e, eeg] = await Promise.all([
      api.get(`/admin/baseline/${userId}`).then((r) => r.data).catch(() => null),
      api.get(`/admin/ema/history/${userId}`).then((r) => r.data).catch(() => null),
      eegClient.get(`/admin/calibration/${userId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }).then((r) => r.data).catch(() => null),
    ]);
    setBaseline(b);
    setEmaHistory(e);
    setEegCalib(eeg);
    setLoading(false);
  }, [userId, token]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    load();
    const timer = setInterval(load, SLOW_REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]));

  // ── One live cycle for everything session-based ──────────────────
  // A finished session's predictions never change again, so they're
  // cached after the first fetch -- each tick only re-fetches the
  // session list and the LATEST session (3 requests, down from up to 6,
  // plus a third uncapped fetch over every session that used to run
  // separately for the distribution card). `pollInFlight` stops ticks
  // from stacking up behind a slow/cold-starting server.
  const sessionCache = useRef(new Map());
  const pollInFlight = useRef(false);
  useEffect(() => { sessionCache.current = new Map(); }, [userId]);

  const pollRing = useCallback(async () => {
    if (pollInFlight.current) return;
    pollInFlight.current = true;
    try {
      const [statusRes, histRes] = await Promise.all([
        axios.get(`${API_BASE}/devices/${DEVICE_ID}/status`).catch(() => null),
        api.get(`/admin/history/${userId}`).catch(() => null),
      ]);
      setDeviceStatus(statusRes?.data?.status || 'offline');
      if (!histRes) return; // transient failure -- keep last-known data on screen
      setHistory(histRes.data);

      const sessionIds = Object.keys(histRes.data?.sessions || {}).sort();
      const latestId = sessionIds[sessionIds.length - 1];
      if (!latestId) { setRingFeed([]); setRingChart([]); setSessionDist({ normal: 0, stress: 0 }); return; }

      const recentIds = sessionIds.slice(-RECENT_SESSIONS_FOR_CHART);
      const cache = sessionCache.current;
      const sessionResults = await Promise.all(recentIds.map(async (sid) => {
        if (sid !== latestId && cache.has(sid)) return cache.get(sid);
        const data = await api.get(`/admin/history/${userId}/${sid}`).then((r) => r.data).catch(() => null);
        if (data && sid !== latestId) {
          // Older sessions' waveform previews are never rendered (only the
          // newest window's are) -- drop them before caching.
          const preds = {};
          Object.entries(data.predictions || {}).forEach(([k, w]) => {
            const { wave_gsr, ibi_sequence, ...rest } = w || {};
            preds[k] = rest;
          });
          const slim = { ...data, predictions: preds };
          cache.set(sid, slim);
          return slim;
        }
        return data;
      }));

      const latestPredictions = Object.values(sessionResults[sessionResults.length - 1]?.predictions || {})
        .sort((a, b) => (b.window_idx ?? 0) - (a.window_idx ?? 0));
      setRingFeed(latestPredictions.slice(0, 5));

      // Merged across recentIds, newest-first -- ringTrend/FeatureTrendChart
      // .reverse() this to get oldest-first for charting.
      const merged = sessionResults
        .flatMap((data) => Object.values(data?.predictions || {}))
        .filter((w) => w.timestamp)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      setRingChart(merged.slice(0, CHART_POINTS_MAX));

      // Normal-vs-Stress distribution over the same recent sessions,
      // majority-voted per session -- no extra network calls.
      const dist = { normal: 0, stress: 0 };
      sessionResults.forEach((data) => {
        const preds = Object.values(data?.predictions || {});
        if (preds.length === 0) return;
        const stressCount = preds.filter((p) => p.label === 'Stress').length;
        if (stressCount > preds.length / 2) dist.stress++; else dist.normal++;
      });
      setSessionDist(dist);
    } finally {
      pollInFlight.current = false;
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

  const text  = COLORS.light.text;
  const muted = COLORS.light.textMuted;
  const sessions = history?.sessions ? Object.entries(history.sessions) : [];
  const pss4 = history?.pss4 ? Object.entries(history.pss4) : [];
  const emaEntries = emaHistory?.ema_history ? Object.values(emaHistory.ema_history) : [];

  const ringConnected = deviceStatus === 'online';
  const ringLatest = ringFeed[0];
  const ringTrendColor = ringLatest?.label === 'Stress' ? COLORS.stress : COLORS.normal;
  // Memoized so the (memoized) LineChart only re-renders when the series
  // actually changes, not on every unrelated state update.
  const ringTrend = useMemo(() => [...ringChart]
    .reverse()
    .filter((w) => w.prob_stress !== undefined && w.prob_stress !== null)
    .map((w, i) => ({
      value: Math.round(w.prob_stress * 100),
      date: parseTimestamp(w.timestamp || w.timestamp_end, ringChart.length - 1 - i),
    })), [ringChart]);

  // Trend-window baseline -- mean of the earliest readings currently loaded
  // (ringTrend is oldest-first, now spanning RECENT_SESSIONS_FOR_CHART
  // sessions, not just the latest one), same derivation the user app used
  // to show on its own Ring chart before that moved here per request
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
        <View style={styles.identity}>
          <View style={styles.avatar}>
            <Text style={styles.avatarLetter}>{(name || userId || '?').trim().charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: text }]} numberOfLines={1}>{name || userId}</Text>
            <Text style={[styles.subtitle, { color: muted }]}>
              @{userId}{isLiveForThisUser ? ' · wearing the devices now' : ''}
            </Text>
          </View>
          {isLiveForThisUser ? (
            <View style={styles.livePill}>
              <StatusDot color={COLORS.normal} active size={7} />
              <Text style={styles.livePillText}>Live</Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.tabRow}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tabBtn, tab === t && styles.tabOn]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, { color: tab === t ? COLORS.brandDark : muted }, tab === t && { fontWeight: '800' }]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={COLORS.brand} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 12 }}>
          {tab === 'Fusion' && (
            <>
              <Card elevated>
                <View style={styles.rowBetween}>
                  <Text style={[styles.cardTitle, { color: text, marginBottom: 0 }]}>Fusion — all modalities</Text>
                  <StatusDot color={isLiveForThisUser ? COLORS.normal : muted} active={isLiveForThisUser} />
                </View>
                <Text style={{ color: muted, marginTop: 4, marginBottom: 12, fontSize: 11 }}>
                  Mind (EEG), Body (HRV+GSR) and fused probability · last few sessions{isLiveForThisUser ? ' + live' : ''}
                </Text>
                {fusionPoints.length < 2
                  ? <Text style={{ color: muted, fontSize: 12 }}>No fusion windows recorded for this user yet.</Text>
                  : (
                    <LineChart points={fusionPoints} multiLine width={TREND_CHART_WIDTH} height={210} maxValue={100} suffix="%"
                      seriesColors={[COLORS.eeg, COLORS.hrv, COLORS.brand]}
                      seriesLabels={['Mind (EEG)', 'Body (HRV+GSR)', 'Fused']} />
                  )}
              </Card>
              <Card>
                <Text style={[styles.cardTitle, { color: text }]}>Latest fusion window</Text>
                {fusionLatest ? (
                  <>
                    <Row label="When" value={new Date(fusionKeyToMs(fusionLatest._key)).toLocaleString()} muted={muted} text={text} />
                    <Row label="Fused probability" value={`${Math.round(fusionLatest.fused_probability * 100)}%`} muted={muted} text={text} />
                    <Row label="Fused threshold" value={fusionLatest.fused_threshold != null ? `${Math.round(fusionLatest.fused_threshold * 100)}%` : '—'} muted={muted} text={text} />
                    <Row label="Label" value={fusionLatest.fused_label === 1 ? 'Stress' : 'Normal'} muted={muted} text={text} />
                    <Row label="Mind (EEG)" value={fusionLatest.prob_eeg != null ? `${Math.round(fusionLatest.prob_eeg * 100)}%` : '—'} muted={muted} text={text} />
                    <Row label="Body (HRV+GSR)" value={fusionLatest.prob_hrv_gsr != null ? `${Math.round(fusionLatest.prob_hrv_gsr * 100)}%` : '—'} muted={muted} text={text} />
                    <Row label="Trend" value={fusionLatest.stress_trend || '—'} muted={muted} text={text} />
                  </>
                ) : <Text style={{ color: muted }}>Nothing yet.</Text>}
              </Card>
            </>
          )}

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

              {ringFeed.length > 0 && (ringFeed[0].wave_gsr?.length > 1 || ringFeed[0].ibi_sequence?.length > 1) && (
                <Card>
                  <Text style={[styles.cardTitle, { color: text }]}>Raw Signal Waveform</Text>
                  <Text style={{ color: muted, marginBottom: 14, fontSize: 11 }}>
                    Processed signal from the latest window (window {ringFeed[0].window_idx ?? '—'}) —
                    not raw sensor data, only the filtered/decimated preview extract_features.py computes.
                  </Text>
                  <RawWaveformChart
                    title="GSR (processed, phasic + tonic)"
                    hint="Low-pass filtered, detrended, outlier-cleaned — spikes are real SCR responses"
                    lastValue={ringFeed[0].wave_gsr?.[ringFeed[0].wave_gsr.length - 1]}
                    unit=" µS"
                    values={ringFeed[0].wave_gsr}
                    color={COLORS.gsr}
                    width={TREND_CHART_WIDTH}
                    t={{ textSub: muted, textMuted: muted, text }}
                  />
                  <RawWaveformChart
                    title="IBI — beat-to-beat interval"
                    hint="One value per detected heartbeat — a sudden dip is a fast-beat spike"
                    lastValue={ringFeed[0].ibi_sequence?.[ringFeed[0].ibi_sequence.length - 1]}
                    unit=" ms"
                    values={ringFeed[0].ibi_sequence}
                    color={COLORS.hrv}
                    width={TREND_CHART_WIDTH}
                    t={{ textSub: muted, textMuted: muted, text }}
                  />
                </Card>
              )}

              {ringTrend.length > 1 && (
                <Card>
                  <View style={styles.rowBetween}>
                    <Text style={[styles.cardTitle, { color: text, marginBottom: 0 }]}>Stress Trend</Text>
                    <StatusDot color={ringTrendColor} active={ringConnected} />
                  </View>
                  <Text style={{ color: muted, marginTop: 4, marginBottom: 12, fontSize: 11 }}>
                    P(stress) across this and recent previous sessions' telemetry windows
                  </Text>
                  <LineChart
                    points={ringTrend}
                    color={ringTrendColor}
                    width={TREND_CHART_WIDTH}
                    height={145}
                    maxValue={100}
                    baselineValue={STRESS_DECISION_THRESHOLD_PERCENT}
                    baselineLabel="Stress threshold"
                    baseline2Value={ringSessionBaseline}
                    baseline2Label="Session start"
                    colorZones
                  />
                </Card>
              )}

              {ringChart.length > 1 && (() => {
                const f = RING_FEATURE_CHARTS.find((x) => x.key === ringFeature) || RING_FEATURE_CHARTS[0];
                return (
                  <FeatureTrendChart
                    chartWindows={ringChart}
                    featureKey={f.key}
                    label="Feature trend"
                    unit={f.unit}
                    color={f.color}
                    muted={muted}
                    text={text}
                    picker={(
                      <Dropdown value={f.key} onChange={setRingFeature}
                        options={RING_FEATURE_CHARTS.map((x) => ({ value: x.key, label: x.label }))} />
                    )}
                  />
                );
              })()}

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
                <Text style={[styles.cardTitle, { color: text, marginBottom: 2 }]}>Task-state score</Text>
                <Text style={{ color: muted, marginBottom: 12, fontSize: 11 }}>
                  Per ~25s block, last few sessions · dashed line = effective high-load threshold
                </Text>
                {eegScorePoints.length < 2
                  ? <Text style={{ color: muted, fontSize: 12 }}>No EEG blocks recorded for this user yet.</Text>
                  : (
                    <LineChart points={eegScorePoints} color={COLORS.eeg} width={TREND_CHART_WIDTH} height={180} maxValue={100} suffix="%"
                      colorZones
                      baselineValue={Math.round((eegLatestBlock?.effective_high_load_p ?? eegCalib?.personal_high_load_p ?? 0.7933) * 100)}
                      baselineLabel="High-load threshold" />
                  )}
              </Card>

              {(() => {
                const f = EEG_FEATURES.find((x) => x.key === eegFeature) || EEG_FEATURES[0];
                return (
                  <Card>
                    <View style={styles.rowBetween}>
                      <Text style={[styles.cardTitle, { color: text, marginBottom: 0 }]}>Bipolar feature</Text>
                      <Dropdown value={f.key} onChange={setEegFeature}
                        options={EEG_FEATURES.map((x) => ({ value: x.key, label: x.label }))} />
                    </View>
                    <View style={{ height: 12 }} />
                    {eegFeaturePoints.length < 2
                      ? <Text style={{ color: muted, fontSize: 12 }}>No blocks with this feature yet.</Text>
                      : <LineChart key={f.key} points={eegFeaturePoints} color={f.color} width={TREND_CHART_WIDTH} height={170} />}
                  </Card>
                );
              })()}

              {eegQualityPoints.length > 1 && (
                <Card>
                  <Text style={[styles.cardTitle, { color: text, marginBottom: 12 }]}>Signal quality</Text>
                  <LineChart points={eegQualityPoints} color={COLORS.normal} width={TREND_CHART_WIDTH} height={150} maxValue={100} suffix="%" />
                </Card>
              )}

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

          {tab === 'Phone' && (
            <>
              {/* Participant Overview & Calibration Card */}
              <Card>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cardTitle, { color: text, marginBottom: 2 }]}>
                      Phone Phenotyping
                    </Text>
                    <Text style={{ color: muted, fontSize: 12 }}>
                      @{phenoDeviceId || userId}
                    </Text>
                  </View>
                  <View style={{
                    backgroundColor: (phenoMetrics.isCalibrated ? COLORS.normal : '#F59E0B') + '18',
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: 12,
                  }}>
                    <Text style={{
                      fontSize: 11,
                      fontWeight: '800',
                      color: phenoMetrics.isCalibrated ? COLORS.normal : '#D97706',
                    }}>
                      {phenoMetrics.isCalibrated
                        ? '✓ Calibrated'
                        : `Still Calibrating · Day ${phenoMetrics.dayCount} of 7`}
                    </Text>
                  </View>
                </View>

                {/* 4-Stat Metric Strip */}
                <View style={styles.phenoStatGrid}>
                  <View style={styles.phenoStatTile}>
                    <Text style={[styles.phenoStatVal, { color: phenoMetrics.isCalibrated ? COLORS.normal : '#D97706' }]}>
                      {phenoMetrics.isCalibrated ? 'Calibrated' : `Day ${phenoMetrics.dayCount}/7`}
                    </Text>
                    <Text style={[styles.phenoStatLbl, { color: muted }]}>Calibration</Text>
                  </View>

                  <View style={styles.phenoStatTile}>
                    <Text style={[styles.phenoStatVal, { color: COLORS.brand }]}>
                      {phenoMetrics.logCount}
                    </Text>
                    <Text style={[styles.phenoStatLbl, { color: muted }]}>Log Records</Text>
                  </View>

                  <View style={styles.phenoStatTile}>
                    <Text style={[styles.phenoStatVal, { color: '#8B5CF6' }]}>
                      {phenoMetrics.totalSurveys}
                    </Text>
                    <Text style={[styles.phenoStatLbl, { color: muted }]}>EMA Surveys</Text>
                  </View>

                  <View style={styles.phenoStatTile}>
                    <Text style={[styles.phenoStatVal, { color: phenoMetrics.isSensorActive ? COLORS.normal : muted }]}>
                      {phenoMetrics.isSensorActive ? 'Active' : 'Idle'}
                    </Text>
                    <Text style={[styles.phenoStatLbl, { color: muted }]}>Sensor Sync</Text>
                  </View>
                </View>

                <View style={[styles.rowBetween, { marginTop: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: COLORS.light.border }]}>
                  <Text style={{ fontSize: 11, color: muted }}>
                    Last sync: {phenoMetrics.latestLogStr}
                  </Text>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: phenoMetrics.isCalibrated ? COLORS.normal : '#D97706' }}>
                    {phenoMetrics.isCalibrated ? '7-Day Baseline Ready' : `${phenoMetrics.daysRemaining} days remaining`}
                  </Text>
                </View>
              </Card>

              {/* Stress Trend Card */}
              {phenoTrendPoints.length > 1 ? (
                <Card>
                  <View style={styles.rowBetween}>
                    <Text style={[styles.cardTitle, { color: text, marginBottom: 0 }]}>Stress Trend</Text>
                    {phenoMetrics.isCalibrated ? (
                      <View style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        backgroundColor: (phenoTrendPoints[phenoTrendPoints.length - 1]?.value > 65
                          ? COLORS.stress
                          : phenoTrendPoints[phenoTrendPoints.length - 1]?.value > 35
                          ? '#F59E0B'
                          : COLORS.normal) + '20',
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                        borderRadius: 12,
                        gap: 5
                      }}>
                        <StatusDot
                          color={
                            phenoTrendPoints[phenoTrendPoints.length - 1]?.value > 65
                              ? COLORS.stress
                              : phenoTrendPoints[phenoTrendPoints.length - 1]?.value > 35
                              ? '#F59E0B'
                              : COLORS.normal
                          }
                          active={true}
                          size={7}
                        />
                        <Text style={{
                          fontSize: 11,
                          fontWeight: '800',
                          color: phenoTrendPoints[phenoTrendPoints.length - 1]?.value > 65
                            ? COLORS.stress
                            : phenoTrendPoints[phenoTrendPoints.length - 1]?.value > 35
                            ? '#F59E0B'
                            : COLORS.normal
                        }}>
                          {phenoTrendPoints[phenoTrendPoints.length - 1]?.value > 65
                            ? `Stressed (${Math.round(phenoTrendPoints[phenoTrendPoints.length - 1]?.value)}%)`
                            : phenoTrendPoints[phenoTrendPoints.length - 1]?.value > 35
                            ? `Moderate (${Math.round(phenoTrendPoints[phenoTrendPoints.length - 1]?.value)}%)`
                            : `Calm (${Math.round(phenoTrendPoints[phenoTrendPoints.length - 1]?.value)}%)`}
                        </Text>
                      </View>
                    ) : (
                      <StatusDot
                        color={
                          phenoTrendPoints[phenoTrendPoints.length - 1]?.value > 65
                            ? COLORS.stress
                            : phenoTrendPoints[phenoTrendPoints.length - 1]?.value > 35
                            ? '#F59E0B'
                            : COLORS.normal
                        }
                        active={true}
                      />
                    )}
                  </View>
                  <Text style={{ color: muted, marginTop: 4, marginBottom: 12, fontSize: 11 }}>
                    Continuous stress score (0–100)
                  </Text>
                  <LineChart
                    variant="phenotyping"
                    points={phenoTrendPoints}
                    color={
                      phenoTrendPoints[phenoTrendPoints.length - 1]?.value > 65
                        ? COLORS.stress
                        : phenoTrendPoints[phenoTrendPoints.length - 1]?.value > 35
                        ? '#F59E0B'
                        : COLORS.normal
                    }
                    width={TREND_CHART_WIDTH}
                    height={145}
                    maxValue={100}
                    baselineValue={65}
                    baselineLabel="Stress threshold"
                    baselineColor={COLORS.stress}
                    baseline2Value={35}
                    baseline2Label="Calm baseline"
                    baseline2Color={COLORS.warning}
                    colorZones
                  />
                </Card>
              ) : null}

              {/* 3. Interaction Features: 5 Charts Row by Row */}
              <View style={{ marginTop: 6, marginBottom: 4 }}>
                <Text style={[styles.sectionLabel, { color: muted }]}>Interaction Features ({PHENO_FEATURES.length})</Text>
              </View>
              {PHENO_FEATURES.map((f) => {
                const pts = phenoRawPoints[f.key] || [];
                const latestVal = pts.length ? pts[pts.length - 1].value : null;
                return (
                  <Card key={f.key}>
                    <View style={styles.rowBetween}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                        <Text style={{ fontSize: 18 }}>{f.icon}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.cardTitle, { color: text, marginBottom: 1 }]}>{f.label}</Text>
                          <Text style={{ color: muted, fontSize: 11 }}>
                            Baseline ~{f.baseline}{f.unit}{latestVal != null ? ` · Latest ${latestVal}${f.unit}` : ''}
                          </Text>
                        </View>
                      </View>
                      <View style={[styles.phenoBadge, { backgroundColor: f.color + '18' }]}>
                        <Text style={[styles.phenoBadgeText, { color: f.color }]}>
                          {latestVal != null ? `${latestVal}${f.unit}` : 'Pending'}
                        </Text>
                      </View>
                    </View>
                    <View style={{ marginTop: 8 }}>
                      {pts.length < 2 ? (
                        <Text style={{ color: muted, fontSize: 12, paddingVertical: 10 }}>Not enough windows recorded yet.</Text>
                      ) : (
                        <LineChart
                          variant="phenotyping"
                          points={pts}
                          color={f.color}
                          width={TREND_CHART_WIDTH}
                          height={135}
                          suffix={f.unit}
                        />
                      )}
                    </View>
                  </Card>
                );
              })}

              {/* 4. Continuous Roadmap (with Show/Hide Toggle) */}
              <Card>
                <TouchableOpacity
                  style={styles.cardHeaderTouchable}
                  onPress={() => setShowRoadmap((prev) => !prev)}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={[styles.cardTitle, { color: text, marginBottom: 0 }]}>Continuous Roadmap</Text>
                      <View style={[styles.phenoBadge, { backgroundColor: COLORS.brand + '18' }]}>
                        <Text style={[styles.phenoBadgeText, { color: COLORS.brand }]}>7-Day Timeline</Text>
                      </View>
                    </View>
                    <Text style={{ color: muted, fontSize: 11.5, marginTop: 2 }}>
                      7-day calibration timeline and behavioral distributions
                    </Text>
                  </View>
                  <View style={styles.toggleIconPill}>
                    <Icon name={showRoadmap ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.brand} />
                  </View>
                </TouchableOpacity>

                {showRoadmap && (
                  <View style={{ marginTop: 12 }}>
                    <TouchableOpacity
                      style={[styles.openBtn, { backgroundColor: COLORS.brand }]}
                      onPress={() => navigation.navigate('PhenotypingAnalysis', { userId: phenoDeviceId || userId, userName: name || userId, mode: 'analysis' })}
                    >
                      <Text style={{ color: '#FFFFFF', fontWeight: '800' }}>Open Continuous Roadmap →</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </Card>

              {/* 5. Validations & Concordance (with Show/Hide Toggle, 3-Tier Multi-Source Framework) */}
              <Card>
                <TouchableOpacity
                  style={styles.cardHeaderTouchable}
                  onPress={() => setShowValidation((prev) => !prev)}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Text style={[styles.cardTitle, { color: text, marginBottom: 0 }]}>Validations & Concordance</Text>
                      <View style={[styles.phenoBadge, { backgroundColor: '#6366F118' }]}>
                        <Text style={[styles.phenoBadgeText, { color: '#6366F1' }]}>3-Tier Triangulation</Text>
                      </View>
                      <View style={[styles.phenoBadge, { backgroundColor: phenoMetrics.concordancePct != null ? '#10B98118' : '#F59E0B18' }]}>
                        <Text style={[styles.phenoBadgeText, { color: phenoMetrics.concordancePct != null ? '#059669' : '#D97706' }]}>
                          {phenoMetrics.concordancePct != null ? `${phenoMetrics.concordancePct}% Match` : 'Ground Truth Audit'}
                        </Text>
                      </View>
                    </View>
                    <Text style={{ color: muted, fontSize: 11.5, marginTop: 2 }}>
                      Multi-source verification: Cognitive challenges, physiological sensors & EMA
                    </Text>
                  </View>
                  <View style={styles.toggleIconPill}>
                    <Icon name={showValidation ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.brand} />
                  </View>
                </TouchableOpacity>

                {showValidation && (
                  <View style={{ marginTop: 14 }}>
                    {/* Tier 1 Card */}
                    <View style={styles.validationTierCard}>
                      <View style={styles.validationTierHeader}>
                        <View style={[styles.tierCircle, { backgroundColor: phenoMetrics.hasExperiment ? '#6366F1' : '#94A3B8' }]}>
                          <Text style={styles.tierCircleText}>T1</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.validationTierTitle}>Tier 1: Experimental Cognitive Induction</Text>
                          <Text style={styles.validationTierSub}>
                            {phenoMetrics.hasExperiment
                              ? `${phenoMetrics.expType || 'In-Situ Typing Challenge'} Protocol`
                              : 'In-Situ Typing Challenge & Speed Escalation Protocol'}
                          </Text>
                        </View>
                        <View style={[styles.phenoBadge, { backgroundColor: phenoMetrics.hasExperiment ? '#6366F118' : '#94A3B818' }]}>
                          <Text style={[styles.phenoBadgeText, { color: phenoMetrics.hasExperiment ? '#6366F1' : '#64748B' }]}>
                            {phenoMetrics.hasExperiment ? 'Completed' : 'Pending Challenge'}
                          </Text>
                        </View>
                      </View>
                      {phenoMetrics.hasExperiment ? (
                        <View style={styles.validationStatGrid}>
                          <View style={styles.validationStatCell}>
                            <Text style={styles.validationStatVal}>{phenoMetrics.expCalmDwell} ms</Text>
                            <Text style={styles.validationStatLbl}>Calm Dwell</Text>
                          </View>
                          <View style={styles.validationStatCell}>
                            <Text style={[styles.validationStatVal, { color: COLORS.stress }]}>{phenoMetrics.expStressDwell} ms</Text>
                            <Text style={styles.validationStatLbl}>Stress Dwell</Text>
                          </View>
                          <View style={styles.validationStatCell}>
                            <Text style={[styles.validationStatVal, { color: '#059669' }]}>
                              {phenoMetrics.expShiftPct > 0 ? `+${phenoMetrics.expShiftPct}%` : `${phenoMetrics.expShiftPct}%`}
                            </Text>
                            <Text style={styles.validationStatLbl}>Latency Shift</Text>
                          </View>
                        </View>
                      ) : (
                        <View style={styles.pendingValidationBox}>
                          <Text style={styles.pendingValidationText}>No in-situ cognitive challenge administered for this participant yet.</Text>
                        </View>
                      )}
                    </View>

                    {/* Tier 2 Card */}
                    <View style={styles.validationTierCard}>
                      <View style={styles.validationTierHeader}>
                        <View style={[styles.tierCircle, { backgroundColor: phenoMetrics.hasRingData ? '#10B981' : '#94A3B8' }]}>
                          <Text style={styles.tierCircleText}>T2</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.validationTierTitle}>Tier 2: Multimodal Cross-Sensor Triangulation</Text>
                          <Text style={styles.validationTierSub}>Smart Ring PPG / HRV & EDA Galvanic Spikes Sync</Text>
                        </View>
                        <View style={[styles.phenoBadge, { backgroundColor: phenoMetrics.hasRingData ? '#10B98118' : '#94A3B818' }]}>
                          <Text style={[styles.phenoBadgeText, { color: phenoMetrics.hasRingData ? '#059669' : '#64748B' }]}>
                            {phenoMetrics.hasRingData ? `${phenoMetrics.ringSessionCount} Sessions` : 'Pending Pairing'}
                          </Text>
                        </View>
                      </View>
                      {phenoMetrics.hasRingData ? (
                        <View style={styles.validationStatGrid}>
                          <View style={styles.validationStatCell}>
                            <Text style={[styles.validationStatVal, { color: '#059669' }]}>
                              {phenoMetrics.dualSyncConcordance || `${phenoMetrics.ringSessionCount} Sess`}
                            </Text>
                            <Text style={styles.validationStatLbl}>Sync Concordance</Text>
                          </View>
                          <View style={styles.validationStatCell}>
                            <Text style={styles.validationStatVal}>
                              {phenoMetrics.dualSyncCorrelation || 'Synchronized'}
                            </Text>
                            <Text style={styles.validationStatLbl}>Autonomic (r)</Text>
                          </View>
                          <View style={styles.validationStatCell}>
                            <Text style={[styles.validationStatVal, { color: COLORS.stress }]}>Time-Locked</Text>
                            <Text style={styles.validationStatLbl}>Cross-Modal Feed</Text>
                          </View>
                        </View>
                      ) : (
                        <View style={styles.pendingValidationBox}>
                          <Text style={styles.pendingValidationText}>Smart Ring not paired / no cross-sensor session recorded for this participant yet.</Text>
                        </View>
                      )}
                    </View>

                    {/* Tier 3 Card */}
                    <View style={styles.validationTierCard}>
                      <View style={styles.validationTierHeader}>
                        <View style={[styles.tierCircle, { backgroundColor: phenoMetrics.totalSurveys > 0 ? '#F59E0B' : '#94A3B8' }]}>
                          <Text style={styles.tierCircleText}>T3</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.validationTierTitle}>Tier 3: Ecological Momentary Ground Truth</Text>
                          <Text style={styles.validationTierSub}>SISS & PSS-4 Momentary Self-Reports</Text>
                        </View>
                        <View style={[styles.phenoBadge, { backgroundColor: phenoMetrics.totalSurveys > 0 ? '#10B98118' : '#94A3B818' }]}>
                          <Text style={[styles.phenoBadgeText, { color: phenoMetrics.totalSurveys > 0 ? '#059669' : '#64748B' }]}>
                            {phenoMetrics.totalSurveys > 0 ? `${phenoMetrics.totalSurveys} Reports` : 'Pending Surveys'}
                          </Text>
                        </View>
                      </View>
                      {phenoMetrics.totalSurveys > 0 ? (
                        <View style={styles.validationStatGrid}>
                          <View style={styles.validationStatCell}>
                            <Text style={[styles.validationStatVal, { color: '#059669' }]}>{phenoMetrics.calmPct}%</Text>
                            <Text style={styles.validationStatLbl}>Calm Baseline</Text>
                          </View>
                          <View style={styles.validationStatCell}>
                            <Text style={styles.validationStatVal}>{phenoMetrics.avgScore} / 5</Text>
                            <Text style={styles.validationStatLbl}>Avg SISS Score</Text>
                          </View>
                          <View style={styles.validationStatCell}>
                            <Text style={[styles.validationStatVal, { color: phenoMetrics.sissStressCount > 0 ? COLORS.stress : '#059669' }]}>
                              {phenoMetrics.sissStressCount}
                            </Text>
                            <Text style={styles.validationStatLbl}>Elevated Reports</Text>
                          </View>
                        </View>
                      ) : (
                        <View style={styles.pendingValidationBox}>
                          <Text style={styles.pendingValidationText}>No momentary self-reports recorded for this participant yet.</Text>
                        </View>
                      )}
                    </View>

                    {/* Participant Idiographic Drift Summary */}
                    <View style={{ marginTop: 8 }}>
                      <Row
                        label="Participant Concordance"
                        value={phenoMetrics.concordancePct != null ? `${phenoMetrics.concordancePct}% (${phenoMetrics.concordanceLabel})` : phenoMetrics.concordanceLabel}
                        muted={muted}
                        text={phenoMetrics.concordancePct != null ? text : '#D97706'}
                      />
                      <Row
                        label="Resting Calm Baseline"
                        value={phenoMetrics.userMeanDwell ? `~${phenoMetrics.userMeanDwell} ms (Normal Calm)` : 'Pending Telemetry'}
                        muted={muted}
                        text={phenoMetrics.userMeanDwell ? '#059669' : muted}
                      />
                      <Row
                        label="Acute Stress Cut-Point"
                        value="Z ≥ 1.85σ (Idiographic Drift)"
                        muted={muted}
                        text={COLORS.stress}
                      />
                      <Row
                        label="Calibration Profile"
                        value={phenoMetrics.isCalibrated ? 'Calibrated (7-Day Baseline)' : `In Progress (Day ${phenoMetrics.dayCount}/7)`}
                        muted={muted}
                        text={phenoMetrics.isCalibrated ? '#059669' : '#D97706'}
                      />
                    </View>
                  </View>
                )}
              </Card>

              {/* 6 & 7: Split Section: Left Side = EMA Surveys & Results | Right Side = Participant Feedback */}
              <View style={styles.emaFeedbackSplitRow}>
                {/* Left Side: EMA Surveys & Results */}
                <View style={styles.emaFeedbackSplitCol}>
                  <Card style={styles.splitCard}>
                    <TouchableOpacity
                      style={styles.cardHeaderTouchable}
                      onPress={() => setShowEma((prev) => !prev)}
                      activeOpacity={0.7}
                    >
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <Text style={[styles.cardTitle, { color: text, marginBottom: 0 }]}>EMA Surveys & Results</Text>
                          <View style={{
                            backgroundColor: (phenoMetrics.emaCompliant ? COLORS.normal : '#F59E0B') + '18',
                            paddingHorizontal: 8,
                            paddingVertical: 3,
                            borderRadius: 8,
                          }}>
                            <Text style={{
                              fontSize: 10,
                              fontWeight: '800',
                              color: phenoMetrics.emaCompliant ? COLORS.normal : '#D97706',
                            }}>
                              {phenoMetrics.surveysToday >= 2 ? `✓ ${phenoMetrics.surveysToday}/2 Today` : `${phenoMetrics.surveysToday}/2 Today`}
                            </Text>
                          </View>
                        </View>
                        <Text style={{ color: muted, fontSize: 11.5, marginTop: 2 }}>
                          {phenoMetrics.totalSurveys} total ({phenoMetrics.sissCount} SISS · {phenoMetrics.pss4Count} PSS-4) · Default shows 3 days
                        </Text>
                      </View>
                      <View style={styles.toggleIconPill}>
                        <Icon name={showEma ? 'chevron-up' : 'chevron-down'} size={18} color="#0284C7" />
                      </View>
                    </TouchableOpacity>

                    {showEma && (
                      <View style={{ marginTop: 12 }}>
                        {surveysByDay.length > 0 ? (
                          <View>
                            {(showAllEmaDays ? surveysByDay : surveysByDay.slice(0, 3)).map((dayGroup) => (
                              <View key={dayGroup.dateKey} style={styles.emaDaySection}>
                                {/* Day Header */}
                                <View style={styles.emaDayHeader}>
                                  <Text style={styles.emaDayTitle}>{dayGroup.label}</Text>
                                  <View style={styles.emaDayPill}>
                                    <Text style={styles.emaDayPillText}>{dayGroup.items.length} survey{dayGroup.items.length > 1 ? 's' : ''}</Text>
                                  </View>
                                </View>

                                {/* Day Survey Items */}
                                {dayGroup.items.map((s, idx) => {
                                  const isSiss = s.type === 'SISS';
                                  const maxScore = isSiss ? 5 : 16;
                                  const isHigh = isSiss ? s.score >= 4 : s.score >= 11;
                                  const isMed = isSiss ? s.score === 3 : s.score >= 6;
                                  const scoreColor = isHigh ? COLORS.stress : isMed ? '#F59E0B' : COLORS.normal;
                                  const scoreLabel = isHigh ? 'Elevated' : isMed ? 'Moderate' : 'Calm';
                                  const timeStr = s.timestamp ? s.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';

                                  return (
                                    <View key={s.id || idx} style={styles.phenoSurveyItem}>
                                      <View style={styles.rowBetween}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                          <View style={[styles.phenoBadge, { backgroundColor: isSiss ? '#0284C718' : '#10B98118' }]}>
                                            <Text style={[styles.phenoBadgeText, { color: isSiss ? '#0284C7' : '#059669' }]}>
                                              {s.type}
                                            </Text>
                                          </View>
                                          <Text style={{ fontSize: 12, fontWeight: '700', color: text }}>
                                            Score {s.score}/{maxScore}
                                          </Text>
                                        </View>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                          <Text style={{ color: muted, fontSize: 11 }}>{timeStr}</Text>
                                          <View style={[styles.phenoBadge, { backgroundColor: scoreColor + '18' }]}>
                                            <Text style={[styles.phenoBadgeText, { color: scoreColor }]}>
                                              {scoreLabel}
                                            </Text>
                                          </View>
                                        </View>
                                      </View>
                                    </View>
                                  );
                                })}
                              </View>
                            ))}

                            {surveysByDay.length > 3 && (
                              <TouchableOpacity
                                style={styles.emaExpandBtn}
                                onPress={() => setShowAllEmaDays((prev) => !prev)}
                                activeOpacity={0.7}
                              >
                                <Text style={styles.emaExpandBtnText}>
                                  {showAllEmaDays
                                    ? 'Show less (3 days)'
                                    : `View older days (${surveysByDay.length - 3} more)`}
                                </Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        ) : (
                          <View style={{ paddingVertical: 8 }}>
                            <Text style={{ color: muted, fontSize: 12 }}>No EMA survey submitted yet.</Text>
                            <Text style={{ color: muted, fontSize: 11, marginTop: 2 }}>Target: 2 momentary check-ins per day.</Text>
                          </View>
                        )}
                      </View>
                    )}
                  </Card>
                </View>

                {/* Right Side: Participant Feedback */}
                <View style={styles.emaFeedbackSplitCol}>
                  <Card style={styles.splitCard}>
                    <TouchableOpacity
                      style={styles.cardHeaderTouchable}
                      onPress={() => setShowFeedback((prev) => !prev)}
                      activeOpacity={0.7}
                    >
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <Text style={[styles.cardTitle, { color: text, marginBottom: 0 }]}>Participant Feedback</Text>
                          <View style={{
                            backgroundColor: (phenoMetrics.feedbackFilled ? '#10B981' : '#64748B') + '18',
                            paddingHorizontal: 8,
                            paddingVertical: 3,
                            borderRadius: 8,
                          }}>
                            <Text style={{
                              fontSize: 10,
                              fontWeight: '800',
                              color: phenoMetrics.feedbackFilled ? '#059669' : '#64748B',
                            }}>
                              {phenoMetrics.feedbackFilled ? '✓ Submitted' : 'Pending'}
                            </Text>
                          </View>
                        </View>
                        <Text style={{ color: muted, fontSize: 11.5, marginTop: 2 }}>
                          {phenoMetrics.feedbackFilled ? 'Usability, trust & user experience scores' : 'Awaiting participant submission'}
                        </Text>
                      </View>
                      <View style={styles.toggleIconPill}>
                        <Icon name={showFeedback ? 'chevron-up' : 'chevron-down'} size={18} color="#0284C7" />
                      </View>
                    </TouchableOpacity>

                    {showFeedback && (
                      <View style={{ marginTop: 12 }}>
                        {phenoMetrics.latestFb ? (
                          <View>
                            {/* Overall Score Highlight Card */}
                            <View style={styles.fbScoreCard}>
                              <View>
                                <Text style={styles.fbScoreBig}>
                                  {(phenoMetrics.latestFb.overall_score || 4.5).toFixed(1)} <Text style={{ fontSize: 15, fontWeight: '700' }}>/ 5.0</Text>
                                </Text>
                                <Text style={styles.fbScoreSub}>Overall Usability & Satisfaction</Text>
                              </View>
                              <View style={styles.fbStarPill}>
                                <Text style={styles.fbStarText}>★★★★★</Text>
                              </View>
                            </View>

                            {/* Subscales Breakdown */}
                            <Text style={[styles.validationTierTitle, { marginTop: 10, marginBottom: 6 }]}>
                              Usability Subscales
                            </Text>
                            {phenoMetrics.latestFb.subscales && typeof phenoMetrics.latestFb.subscales === 'object' && Object.entries(phenoMetrics.latestFb.subscales).map(([k, v]) => {
                              const numVal = Number(v) || 0;
                              const pct = Math.min(100, Math.round((numVal / 5) * 100));
                              return (
                                <View key={k} style={styles.fbSubscaleRow}>
                                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                                    <Text style={{ fontSize: 11.5, fontWeight: '700', color: text }}>{k}</Text>
                                    <Text style={{ fontSize: 11.5, fontWeight: '900', color: '#0284C7' }}>{numVal.toFixed(1)} / 5</Text>
                                  </View>
                                  <View style={styles.fbProgressBarBg}>
                                    <View style={[styles.fbProgressBarFill, { width: `${pct}%`, backgroundColor: pct >= 80 ? '#059669' : pct >= 50 ? '#0284C7' : '#D97706' }]} />
                                  </View>
                                </View>
                              );
                            })}

                            {/* Participant Comment Quote */}
                            {phenoMetrics.latestFb.comment ? (
                              <View style={[styles.phenoQuoteBox, { backgroundColor: '#F8FAFC', borderLeftColor: '#0284C7' }]}>
                                <Text style={{ fontSize: 11.5, color: text, fontStyle: 'italic', lineHeight: 17 }}>
                                  "{phenoMetrics.latestFb.comment}"
                                </Text>
                              </View>
                            ) : null}

                            {/* Submission Timestamp */}
                            {phenoMetrics.latestFb.timestamp && (
                              <Text style={{ color: muted, fontSize: 10.5, marginTop: 8, textAlign: 'right' }}>
                                Submitted: {new Date(phenoMetrics.latestFb.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                              </Text>
                            )}
                          </View>
                        ) : (
                          <View style={styles.pendingValidationBox}>
                            <Icon name="comment-question-outline" size={24} color={muted} style={{ marginBottom: 4 }} />
                            <Text style={[styles.pendingValidationText, { fontWeight: '700', color: text, fontStyle: 'normal' }]}>
                              No feedback submitted yet
                            </Text>
                            <Text style={[styles.pendingValidationText, { marginTop: 2 }]}>
                              This participant has not yet completed the 12-item usability and trust questionnaire.
                            </Text>
                            <View style={{ marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                              {['Ease of Use', 'Trust & Accuracy', 'Privacy & Comfort', 'Usefulness'].map((item) => (
                                <View key={item} style={[styles.phenoBadge, { backgroundColor: '#F1F5F9' }]}>
                                  <Text style={[styles.phenoBadgeText, { color: muted }]}>{item}: Pending</Text>
                                </View>
                              ))}
                            </View>
                          </View>
                        )}
                      </View>
                    )}
                  </Card>
                </View>
              </View>
            </>
          )}

          {tab === 'Relax' && (
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
  title: { fontSize: 22, fontWeight: '900', letterSpacing: -0.3 },
  subtitle: { fontSize: 12, marginTop: 2, fontWeight: '600' },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: COLORS.brandSoft, alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { fontSize: 18, fontWeight: '900', color: COLORS.brandDark },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: COLORS.normalSoft },
  livePillText: { fontSize: 11, fontWeight: '800', color: COLORS.normalDark },
  // Same segmented control as the website (web/src/styles.css .seg).
  tabRow: { flexDirection: 'row', gap: 4, marginHorizontal: 20, marginTop: 8, padding: 4, borderRadius: 28, backgroundColor: COLORS.light.pillBg },
  tabBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 24 },
  tabOn: { backgroundColor: COLORS.light.card, shadowColor: '#1E293B', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  tabText: { fontSize: 12, fontWeight: '700' },
  cardTitle: { fontSize: 15, fontWeight: '800', marginBottom: 10 },
  sectionLabel: { fontSize: 12, fontWeight: '800', marginTop: 4, marginBottom: 4, marginLeft: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveValue: { fontSize: 18, fontWeight: '900' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, paddingVertical: 6 },
  rowWithBadge: { alignItems: 'center', paddingVertical: 8 },
  rowLabel: { fontSize: 12, flex: 1 },
  rowValue: { fontSize: 12, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  note: { fontSize: 11, marginTop: 12, lineHeight: 16 },
  openBtn: { padding: 14, borderRadius: 14, alignItems: 'center' },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  distBarBg: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  distBarFill: { height: 8, borderRadius: 4 },
  distValue: { width: 24, fontSize: 13, fontWeight: '800', textAlign: 'right' },
  distLabel: { minWidth: 60, fontSize: 11 },
  signalHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  signalTitle: { fontSize: 12, fontWeight: '700' },
  signalValue: { fontSize: 13, fontWeight: '800' },
  phenoStatGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
    marginBottom: 6,
  },
  phenoStatTile: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: COLORS.light.pillBg,
    padding: 10,
    borderRadius: 12,
  },
  phenoStatVal: {
    fontSize: 16,
    fontWeight: '900',
  },
  phenoStatLbl: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  phenoSurveyItem: {
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.light.border,
    marginBottom: 8,
    backgroundColor: COLORS.light.card,
  },
  phenoBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  phenoBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  phenoQuoteBox: {
    padding: 10,
    borderRadius: 10,
    borderLeftWidth: 3,
    marginTop: 6,
    marginBottom: 4,
  },
  cardHeaderTouchable: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  toggleIconPill: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.light.pillBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  validationTierCard: {
    backgroundColor: COLORS.light.pillBg,
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
  },
  validationTierHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  tierCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tierCircleText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
  },
  validationTierTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.light.text,
  },
  validationTierSub: {
    fontSize: 10.5,
    color: COLORS.light.textMuted,
  },
  validationStatGrid: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  validationStatCell: {
    flex: 1,
    backgroundColor: COLORS.light.card,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 4,
    alignItems: 'center',
  },
  validationStatVal: {
    fontSize: 12.5,
    fontWeight: '900',
    color: COLORS.light.text,
  },
  validationStatLbl: {
    fontSize: 9.5,
    fontWeight: '600',
    color: COLORS.light.textMuted,
    marginTop: 1,
    textAlign: 'center',
  },
  rocCardWrap: {
    backgroundColor: COLORS.light.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.light.border,
    padding: 10,
    marginTop: 6,
    marginBottom: 8,
  },
  emaScrollBox: {
    maxHeight: 380,
  },
  emaDaySection: {
    marginBottom: 10,
  },
  emaDayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 2,
    marginBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.light.border,
  },
  emaDayTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.light.text,
  },
  emaDayPill: {
    backgroundColor: COLORS.light.pillBg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  emaDayPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.light.textMuted,
  },
  pendingValidationBox: {
    backgroundColor: COLORS.light.card,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
    marginTop: 4,
  },
  pendingValidationText: {
    fontSize: 11,
    color: COLORS.light.textMuted,
    fontStyle: 'italic',
  },
  emaExpandBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    marginTop: 4,
    borderRadius: 8,
    backgroundColor: COLORS.light.pillBg,
  },
  emaExpandBtnText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#0284C7',
  },
  emaFeedbackSplitRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'stretch',
    marginBottom: 4,
  },
  emaFeedbackSplitCol: {
    flex: 1,
    minWidth: 320,
  },
  splitCard: {
    flex: 1,
    height: '100%',
    marginBottom: 10,
  },
  fbScoreCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0284C712',
    padding: 10,
    borderRadius: 10,
    marginBottom: 8,
  },
  fbScoreBig: {
    fontSize: 20,
    fontWeight: '900',
    color: '#0284C7',
  },
  fbScoreSub: {
    fontSize: 10.5,
    color: COLORS.light.textMuted,
    fontWeight: '600',
    marginTop: 1,
  },
  fbStarPill: {
    backgroundColor: '#0284C718',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  fbStarText: {
    fontSize: 12,
    color: '#D97706',
    letterSpacing: 2,
  },
  fbSubscaleRow: {
    marginBottom: 8,
  },
  fbProgressBarBg: {
    height: 6,
    backgroundColor: '#E2E8F0',
    borderRadius: 3,
    overflow: 'hidden',
  },
  fbProgressBarFill: {
    height: 6,
    borderRadius: 3,
  },
});
