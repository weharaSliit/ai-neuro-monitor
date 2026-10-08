// ============================================================
// AdminEegLiveScreen.js
// Live EEG dashboard: task-state card (cognitive load probability + label),
// a preprocessed (filtered) bipolar T7-T8 waveform chart, and the
// 29-feature bipolar grid -- all sourced from the same per-block record
// (psychological/{userId}/{sessionId}/{window}), updated once per
// BLOCK_SEC=25s block. No raw ADC signal here or anywhere in Firebase --
// see backend/psychological/app.py's /predict route and
// pipeline.py::_downsample_wave(); the waveform is the already-filtered
// signal the model itself scores, just decimated for charting. Reads
// psychological/{userId}/... for an ADMIN-SELECTED userId (route param)
// instead of useAuth()'s own logged-in user. Same hardware constraint as
// AdminUserDetailScreen's "Live Now" card -- only shows real data while
// this specific user happens to be the currently active global session
// (psychological/current_session_id), since there's only one EEG headset.
// ============================================================
import { getContentWidth } from '../../shared/theme/layout';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    View, Text, StyleSheet, Dimensions,
    TouchableOpacity, ScrollView,
} from 'react-native';
import ScreenBackground from '../../shared/ScreenBackground';
import Card from '../../shared/Card';
import Icon, { NAMES } from '../../shared/Icon';
import LineChart from '../../shared/LineChart';
import Svg, { Path, Circle, Line as SvgLine } from 'react-native-svg';
import { ref, onValue, off, get, query, orderByChild, limitToLast } from 'firebase/database';
import { db } from '../../../firebase';
import { COLORS } from '../../physiological/config/theme';
import { STRESS_COLORS, STRESS_EMOJI, EEG_TREND_LABELS, TASK_STATE_LABELS } from '../../eeg/config/config';
import { eegClient } from '../../shared/eegApiClient';
import { useAuth } from '../../../context/AuthContext';

const CHART_POINTS = 120;
const RAW_CHART_WIDTH = Math.max(260, getContentWidth() - 80);

function downsampleWithIndices(values) {
    if (!values || values.length === 0) return { values: [], indices: [] };
    if (values.length <= CHART_POINTS) return { values, indices: values.map((_, i) => i) };
    const stride = values.length / CHART_POINTS;
    const out = [];
    const indices = [];
    for (let i = 0; i < CHART_POINTS; i++) {
        const idx = Math.floor(i * stride);
        indices.push(idx);
        out.push(values[idx]);
    }
    return { values: out, indices };
}

const BIPOLAR_FEATURES = [
    { key: 'delta_power', label: 'δ pow' }, { key: 'delta_rel_power', label: 'δ rel' }, { key: 'delta_log_power', label: 'δ log' },
    { key: 'theta_power', label: 'θ pow' }, { key: 'theta_rel_power', label: 'θ rel' }, { key: 'theta_log_power', label: 'θ log' },
    { key: 'alpha_power', label: 'α pow' }, { key: 'alpha_rel_power', label: 'α rel' }, { key: 'alpha_log_power', label: 'α log' },
    { key: 'beta_power', label: 'β pow' }, { key: 'beta_rel_power', label: 'β rel' }, { key: 'beta_log_power', label: 'β log' },
    { key: 'gamma_power', label: 'γ pow' }, { key: 'gamma_rel_power', label: 'γ rel' }, { key: 'gamma_log_power', label: 'γ log' },
    { key: 'total_power', label: 'total' },
    { key: 'theta_alpha_ratio', label: 'θ/α' }, { key: 'beta_alpha_ratio', label: 'β/α' }, { key: 'theta_beta_ratio', label: 'θ/β' },
    { key: 'spectral_entropy', label: 'spec ent' }, { key: 'spectral_slope', label: 'spec slope' },
    { key: 'hjorth_activity', label: 'H act' }, { key: 'hjorth_mobility', label: 'H mob' }, { key: 'hjorth_complexity', label: 'H cplx' },
    { key: 'mean', label: 'mean' }, { key: 'std', label: 'std' }, { key: 'rms', label: 'rms' }, { key: 'ptp', label: 'ptp' },
    { key: 'sample_entropy', label: 'samp ent' },
];

function percentile(sorted, p) {
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
    return sorted[idx];
}

function chartRange(values) {
    if (!values || values.length === 0) return { points: [], min: 0, max: 1 };
    const sorted = [...values].sort((a, b) => a - b);
    let lo = percentile(sorted, 0.05);
    let hi = percentile(sorted, 0.95);
    if (hi <= lo) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.1;
    const clampLo = lo - pad;
    const clampHi = hi + pad;
    const { values: dsValues } = downsampleWithIndices(values);
    const now = Date.now();
    const points = dsValues.map((v, i) => ({
        value: Math.min(clampHi, Math.max(clampLo, v)),
        date: new Date(now - (dsValues.length - i) * 1000 * (25 / dsValues.length)),
    }));
    return { points, min: lo, max: hi };
}

function sortedWindowsList(windowsObj) {
    if (!windowsObj) return [];
    const keys = Object.keys(windowsObj).filter((k) => /^\d+$/.test(k));
    keys.sort((a, b) => Number(a) - Number(b));
    return keys.map((k) => windowsObj[k]);
}

const TREND_CHART_POINTS_LIMIT = 40; // ~40 blocks * 25s/block = ~16.7 min of live trend history
// A "session" is one login-to-logout span, not "how far back the trend
// chart should remember" -- see RingSummaryScreen.js/EegSummaryScreen.js's
// identical reasoning. Backfills this many PRIOR sessions' own blocks
// alongside whatever's currently live, so the charts don't go blank
// between live sessions.
const RECENT_SESSIONS_FOR_CHART = 4;
const CHART_POINTS_MAX = 160; // TREND_CHART_POINTS_LIMIT(40) * RECENT_SESSIONS_FOR_CHART(4)

function BipolarWaveformChart({ points, min, max, color, width, height = 150 }) {
    if (!points || points.length < 2) return null;
    const PAD_X = 6;
    const PAD_Y = 14;
    const plotWidth = Math.max(10, width - PAD_X * 2);
    const plotHeight = Math.max(10, height - PAD_Y * 2);

    const range = (max - min) || 1;
    const toX = (i) => PAD_X + (i / (points.length - 1)) * plotWidth;
    const toY = (val) => PAD_Y + (1 - Math.min(1, Math.max(0, (val - min) / range))) * plotHeight;

    const zeroY = toY(0);
    const hasZero = zeroY >= PAD_Y && zeroY <= (height - PAD_Y);

    let pathD = '';
    points.forEach((p, i) => {
        const x = toX(i);
        const y = toY(p.value);
        if (i === 0) {
            pathD += `M ${x.toFixed(1)} ${y.toFixed(1)}`;
        } else {
            pathD += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
        }
    });

    return (
        <View style={{ width, height, overflow: 'hidden', backgroundColor: '#F8FAFC', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 2 }}>
            <Svg width={width - 4} height={height - 4}>
                {/* Horizontal reference grid lines */}
                <SvgLine x1={PAD_X} y1={PAD_Y} x2={width - PAD_X} y2={PAD_Y} stroke="#CBD5E1" strokeWidth={0.8} strokeDasharray="3,3" />
                {hasZero && (
                    <SvgLine x1={PAD_X} y1={zeroY} x2={width - PAD_X} y2={zeroY} stroke="#94A3B8" strokeWidth={1} strokeDasharray="4,3" />
                )}
                <SvgLine x1={PAD_X} y1={height - PAD_Y} x2={width - PAD_X} y2={height - PAD_Y} stroke="#CBD5E1" strokeWidth={0.8} strokeDasharray="3,3" />

                {/* The Waveform Path */}
                <Path d={pathD} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            </Svg>
        </View>
    );
}

function BipolarFeaturesChart({ features, pointWidth: minPointWidth = 36, height = 150 }) {
    const [boxW, setBoxW] = useState(0);
    if (!features) return null;
    // Fill the card when there's room; keep >= minPointWidth and scroll otherwise.
    const pointWidth = Math.max(minPointWidth, boxW > 0 ? boxW / BIPOLAR_FEATURES.length : 0);
    const rawValues = BIPOLAR_FEATURES.map(({ key }) => {
        const v = features[key] ?? 0;
        return Math.sign(v) * Math.log10(1 + Math.abs(v));
    });

    let min = Math.min(...rawValues);
    let max = Math.max(...rawValues);
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.15;
    const plotMin = min - pad;
    const plotMax = max + pad;
    const range = (plotMax - plotMin) || 1;

    const totalWidth = BIPOLAR_FEATURES.length * pointWidth;
    const PAD_Y = 16;
    const plotHeight = height - PAD_Y * 2;
    const toY = (val) => PAD_Y + (1 - (val - plotMin) / range) * plotHeight;

    const coords = rawValues.map((v, i) => ({
        x: i * pointWidth + pointWidth / 2,
        y: toY(v),
        raw: features[BIPOLAR_FEATURES[i].key] ?? 0,
    }));

    let pathD = '';
    coords.forEach((c, i) => {
        if (i === 0) pathD += `M ${c.x.toFixed(1)} ${c.y.toFixed(1)}`;
        else pathD += ` L ${c.x.toFixed(1)} ${c.y.toFixed(1)}`;
    });

    return (
        <ScrollView horizontal showsHorizontalScrollIndicator nestedScrollEnabled={true} style={{ width: '100%' }}
            onLayout={(e) => { const w = Math.floor(e.nativeEvent.layout.width); if (w > 0 && Math.abs(w - boxW) > 1) setBoxW(w); }}>
            <View style={{ width: totalWidth, paddingVertical: 4 }}>
                <Svg width={totalWidth} height={height}>
                    {/* Grid lines */}
                    <SvgLine x1={0} y1={PAD_Y} x2={totalWidth} y2={PAD_Y} stroke="#E2E8F0" strokeWidth={0.8} strokeDasharray="3,3" />
                    <SvgLine x1={0} y1={height / 2} x2={totalWidth} y2={height / 2} stroke="#CBD5E1" strokeWidth={0.8} strokeDasharray="4,3" />
                    <SvgLine x1={0} y1={height - PAD_Y} x2={totalWidth} y2={height - PAD_Y} stroke="#E2E8F0" strokeWidth={0.8} strokeDasharray="3,3" />

                    {/* Vertical guideline for each feature column */}
                    {coords.map((c, i) => (
                        <SvgLine key={`v-${i}`} x1={c.x} y1={PAD_Y} x2={c.x} y2={height - PAD_Y} stroke="#F1F5F9" strokeWidth={1} />
                    ))}

                    {/* Connected Feature Line */}
                    <Path d={pathD} stroke={COLORS.brand} strokeWidth={2.2} fill="none" strokeLinejoin="round" />

                    {/* Feature Data Points */}
                    {coords.map((c, i) => (
                        <Circle key={`pt-${i}`} cx={c.x} cy={c.y} r={4} fill={COLORS.brand} stroke="#FFFFFF" strokeWidth={1.5} />
                    ))}
                </Svg>

                {/* Column Labels exactly aligned to each point */}
                <View style={{ flexDirection: 'row', width: totalWidth, marginTop: 6 }}>
                    {BIPOLAR_FEATURES.map(({ key, label: fLabel }) => {
                        const real = features[key] ?? 0;
                        return (
                            <View key={key} style={{ width: pointWidth, alignItems: 'center' }}>
                                <Text style={[styles.featureLabelText, { color: COLORS.light.textSub }]} numberOfLines={1}>{fLabel}</Text>
                                <Text style={[styles.featureValueText, { color: COLORS.light.textMuted }]} numberOfLines={1}>
                                    {Math.abs(real) >= 1000 ? real.toFixed(0) : real.toFixed(1)}
                                </Text>
                            </View>
                        );
                    })}
                </View>
            </View>
        </ScrollView>
    );
}

function SignalChart({ title, lastValue, points, min, max, color, t, last }) {
    return (
        <View style={[styles.signalBlock, last ? null : { marginBottom: 16 }]}>
            <View style={styles.signalHeaderRow}>
                <Text style={[styles.signalTitle, { color: t.textSub }]}>{title}</Text>
                <Text style={[styles.signalValue, { color: t.text }]}>
                    {lastValue !== undefined && lastValue !== null ? `${lastValue.toFixed(1)} µV` : '—'}
                </Text>
            </View>
            {points.length > 1 ? (
                <>
                    <LineChart
                        points={points.map((p) => ({ value: p.value }))}
                        color={color}
                        width={RAW_CHART_WIDTH}
                        height={160}
                        suffix=" µV"
                        minGap={3}
                    />
                    <Text style={[styles.signalRange, { color: t.textMuted }]}>
                        This block's range: {min.toFixed(1)} to {max.toFixed(1)} µV
                        {(max - min) < 1 ? ' — flat/railed (near-constant reading)' : ''}
                    </Text>
                </>
            ) : (
                <Text style={[styles.waiting, { color: t.textMuted, paddingVertical: 4 }]}>—</Text>
            )}
        </View>
    );
}

export default function AdminEegLiveScreen({ route, navigation }) {
    const { userId } = route?.params || {};
    const t = COLORS.light;
    const COLORS_FLAT = COLORS;
    const [sessionId, setSessionId] = useState('');
    const [watching, setWatching] = useState(false);
    const [windowsList, setWindowsList] = useState([]);
    const [historicalWindowsList, setHistoricalWindowsList] = useState([]);
    const [hasAnyWindow, setHasAnyWindow] = useState(false);
    const [calibrationResult, setCalibrationResult] = useState(null);
    const [thresholdResult, setThresholdResult] = useState(null);
    const [populationHighLoadP, setPopulationHighLoadP] = useState(null);
    const listenerRef = useRef(null);
    const calibListenerRef = useRef(null);
    const thresholdListenerRef = useRef(null);
    const { token } = useAuth();

    // Real population default (DecisionThresholds.high_load_p), fetched from
    // the backend's own single source of truth -- not a hardcoded/duplicated
    // frontend constant that could drift if threshold_set_B is ever re-tuned.
    // Used only as the chart's fallback for a user who hasn't completed the
    // onboarding threshold task yet (personal_high_load_p missing).
    useEffect(() => {
        if (!userId) return;
        let cancelled = false;
        eegClient.get(`/admin/calibration/${userId}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
            .then((res) => {
                if (!cancelled) setPopulationHighLoadP(res.data?.population_high_load_p ?? null);
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [userId, token]);

    const startWatching = useCallback((idOverride) => {
        if (!userId) return;
        const targetId = (idOverride ?? sessionId).trim();
        if (!targetId) return;
        if (targetId === sessionId && listenerRef.current) return;
        setSessionId(targetId);
        setWindowsList([]);
        setHasAnyWindow(false);
        setCalibrationResult(null);
        setThresholdResult(null);

        // limitToLast(TREND_CHART_POINTS_LIMIT), not 1 -- the cognitive-load
        // trend chart below needs real history across blocks, not just the
        // latest reading every other card on this screen uses.
        const sessionRef = query(
            ref(db, `psychological/${userId}/${targetId}`), orderByChild('window'), limitToLast(TREND_CHART_POINTS_LIMIT)
        );
        onValue(sessionRef, (snapshot) => {
            const data = snapshot.val();
            setHasAnyWindow(!!data);
            setWindowsList(sortedWindowsList(data));
        });
        listenerRef.current = sessionRef;

        const calibRef = ref(db, `psychological/${userId}/${targetId}/calibration_result`);
        onValue(calibRef, (snapshot) => setCalibrationResult(snapshot.val() || null));
        calibListenerRef.current = calibRef;

        // personal_high_load_p lives here (finalize_personal_threshold()'s
        // outcome, written by push_threshold_result()) -- NOT in
        // calibration_result above, which only ever covers the resting-
        // baseline phase, never the onboarding threshold task.
        const thresholdRef = ref(db, `psychological/${userId}/${targetId}/threshold_result`);
        onValue(thresholdRef, (snapshot) => setThresholdResult(snapshot.val() || null));
        thresholdListenerRef.current = thresholdRef;

        setWatching(true);
    }, [sessionId, userId]);

    // One-time backfill of this user's OWN prior sessions (not the live
    // listener above) -- keys under psychological/{userId} are session
    // IDs (mintSessionId()'s ISO-timestamp format), so they sort
    // chronologically as strings. Re-runs when sessionId changes so a
    // just-ended live session gets folded into history once a new one
    // starts (or the pointer goes quiet).
    useEffect(() => {
        if (!userId) return;
        let cancelled = false;
        get(ref(db, `psychological/${userId}`)).then((snapshot) => {
            if (cancelled) return;
            const all = snapshot.val() || {};
            const sids = Object.keys(all)
                .filter((k) => all[k] && typeof all[k] === 'object' && k !== sessionId)
                .sort();
            const priorSids = sids.slice(-RECENT_SESSIONS_FOR_CHART);
            setHistoricalWindowsList(priorSids.flatMap((sid) => sortedWindowsList(all[sid])));
        }).catch(() => {});
        return () => { cancelled = true; };
    }, [userId, sessionId]);

    useEffect(() => {
        if (!userId) return;
        // Same global pointer the (deleted) EegSessionScreen.js watched --
        // only ever resolves to a session that actually belongs to `userId`
        // when this user IS the currently active one (see this screen's
        // header comment). If it belongs to someone else, the read below
        // against psychological/{userId}/{otherSession} simply finds
        // nothing, which is the correct, honest outcome.
        const pointerRef = ref(db, 'psychological/current_session_id');
        const handler = onValue(pointerRef, (snapshot) => {
            const liveId = snapshot.val();
            if (liveId) startWatching(liveId);
        });
        return () => off(pointerRef, 'value', handler);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId]);

    // Falls back to the most recent PRIOR session's last block when nobody
    // is currently live for this user, so the waveform/features cards below
    // still show something instead of going blank between live sessions --
    // historicalWindowsList is already sorted oldest-to-newest across the
    // last RECENT_SESSIONS_FOR_CHART sessions (see the backfill effect above).
    const latest = windowsList.length > 0
        ? windowsList[windowsList.length - 1]
        : (historicalWindowsList.length > 0 ? historicalWindowsList[historicalWindowsList.length - 1] : null);

    const skipped = latest?.skipped;
    const label = latest?.task_state_label;
    const score = latest?.task_state_score;
    const trend = latest?.task_state_trend;
    const qualityScore = latest?.eeg_quality_score;
    const qualityFlag = latest?.eeg_quality_flag;
    const highLoadAlert = latest?.high_load_alert;
    const microBreak = latest?.micro_break_recommended;
    const fatigueWarning = latest?.fatigue_warning;
    const baselineDegraded = latest?.baseline_degraded;
    const stateColor = label !== undefined && label !== null ? STRESS_COLORS[label] : COLORS_FLAT.brand;

    // Preprocessed (filtered, uV-scale) bipolar T7-T8 waveform for this
    // block -- pipeline.py::_downsample_wave(), 200 points per BLOCK_SEC=25s
    // block. Same `latest` record already fetched above, not a raw-signal
    // path -- see backend/psychological/app.py's /predict route (raw ADC
    // codes are never themselves stored in Firebase).
    const waveUv = latest?.wave_uv;
    const hasWave = !!(waveUv && waveUv.length > 0);
    const waveChart = hasWave ? chartRange(waveUv) : { points: [], min: 0, max: 1 };
    const lastWave = waveUv?.[waveUv.length - 1];
    const bipolarFeatures = latest?.features_eeg?.bipolar;

    // Cognitive-load-vs-threshold trend: task_state_score (0-1) per block,
    // scaled to 0-100 to match LineChart's colorZones convention (Ring/
    // Fusion's own stress-vs-threshold charts). personal_high_load_p (this
    // user's own onboarding threshold task) is preferred; when it's not
    // available yet, falls back to the REAL population default fetched from
    // the backend (populationHighLoadP, above) -- not a hardcoded/duplicated
    // frontend constant.
    const scoreTrendPoints = useMemo(() => {
        const merged = [...historicalWindowsList, ...windowsList]
            .filter((w) => !w.skipped && w.task_state_score != null)
            .map((w) => ({ value: w.task_state_score * 100, date: new Date((w.timestamp_end ?? Date.now() / 1000) * 1000) }));
        merged.sort((a, b) => a.date - b.date);
        return merged.slice(-CHART_POINTS_MAX);
    }, [historicalWindowsList, windowsList]);
    const personalHighLoadP = thresholdResult?.status === 'ok' ? thresholdResult.personal_high_load_p : null;
    const isPersonalized = personalHighLoadP != null;
    const highLoadThresholdPct = isPersonalized
        ? personalHighLoadP * 100
        : (populationHighLoadP != null ? populationHighLoadP * 100 : null);
    const restingBaselinePct = calibrationResult?.status === 'ok' && calibrationResult.resting_calibrated_p != null
        ? calibrationResult.resting_calibrated_p * 100 : null;

    let trendHeadline = null;
    if (highLoadThresholdPct != null && trend) {
        if (trend === 'increasing') {
            trendHeadline = { text: '📈 Cognitive load increasing — trending toward your high-load threshold', color: COLORS_FLAT.warningDark };
        } else if (trend === 'decreasing') {
            trendHeadline = { text: '📉 Easing — trending away from your high-load threshold', color: COLORS_FLAT.normalDark };
        } else {
            trendHeadline = { text: '→ Stable relative to your high-load threshold', color: t.textMuted };
        }
    }

    return (
        <ScreenBackground edges={['top', 'left', 'right']}>
            <ScrollView contentContainerStyle={styles.scroll}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backRow}>
                    <Icon name={NAMES.back} size={20} color={COLORS_FLAT.brand} />
                    <Text style={{ color: COLORS_FLAT.brand, fontWeight: '700' }}>Back</Text>
                </TouchableOpacity>
                <Text style={[styles.title, { color: t.text }]}>Live EEG — {userId}</Text>
                <Text style={[styles.subtitle, { color: t.textMuted }]}>
                    T7/T8 cognitive-load readings (wearable02)
                </Text>

                {!watching && scoreTrendPoints.length === 0 && (
                    <Card>
                        <Text style={[styles.waiting, { color: t.textMuted }]}>
                            Waiting for a live session to begin…
                        </Text>
                    </Card>
                )}

                {!watching && scoreTrendPoints.length > 0 && (
                    <Card>
                        <Text style={[styles.waiting, { color: t.textMuted }]}>
                            Not currently live — showing history from previous sessions below.
                        </Text>
                    </Card>
                )}

                {watching && (
                    <Card accentColor={stateColor} elevated>
                        {!hasAnyWindow ? (
                            <Text style={[styles.waiting, { color: t.textMuted }]}>
                                Waiting for first reading… (calibration takes ~75s)
                            </Text>
                        ) : skipped ? (
                            <Text style={[styles.waiting, { color: t.textMuted }]}>
                                Latest block skipped by the signal-quality gate — check electrode contact.
                            </Text>
                        ) : (
                            <>
                                <View style={styles.stateRow}>
                                    <Text style={styles.stateEmoji}>
                                        {label !== undefined && label !== null ? STRESS_EMOJI[label] : '…'}
                                    </Text>
                                    <View style={{ flex: 1 }}>
                                        <Text style={[styles.stateLabel, { color: stateColor }]}>
                                            {label !== undefined && label !== null
                                                ? TASK_STATE_LABELS[label] : 'Scoring…'}
                                        </Text>
                                        <Text style={[styles.stateProb, { color: t.textMuted }]}>
                                            {score !== undefined && score !== null
                                                ? `${(score * 100).toFixed(0)}% task_state_score` : ''}
                                        </Text>
                                    </View>
                                </View>

                                <View style={styles.metaRow}>
                                    <Text style={[styles.metaLabel, { color: t.textSub }]}>Trend</Text>
                                    <Text style={[styles.metaValue, { color: t.text }]}>
                                        {trend ? (EEG_TREND_LABELS[trend] || trend) : '—'}
                                    </Text>
                                </View>

                                <View style={styles.metaRow}>
                                    <Text style={[styles.metaLabel, { color: t.textSub }]}>Signal quality</Text>
                                    <Text style={[styles.metaValue, { color: t.text }]}>
                                        {qualityScore !== undefined && qualityScore !== null
                                            ? `${qualityScore.toFixed(0)}${qualityFlag ? ' (trusted)' : ' (untrusted)'}`
                                            : '—'}
                                    </Text>
                                </View>

                                <View style={styles.metaRow}>
                                    <Text style={[styles.metaLabel, { color: t.textSub }]}>Sensitivity</Text>
                                    <Text style={[styles.metaValue, { color: t.text }]}>
                                        {calibrationResult?.status === 'ok' && calibrationResult.thresholds_personalized
                                            ? `Personalized (${calibrationResult.baseline_shift >= 0 ? '+' : ''}${(calibrationResult.baseline_shift * 100).toFixed(1)}%)`
                                            : 'Standard (not enough clean blocks to personalize)'}
                                    </Text>
                                </View>

                                {baselineDegraded && (
                                    <Text style={[styles.warningText, { color: COLORS_FLAT.stress }]}>
                                        ⚠ Baseline degraded — calibration never reached GOOD quality; scores here are not trustworthy.
                                    </Text>
                                )}
                                {highLoadAlert && (
                                    <Text style={[styles.warningText, { color: COLORS_FLAT.stress }]}>⚠ High load alert</Text>
                                )}
                                {microBreak && (
                                    <Text style={[styles.warningText, { color: COLORS_FLAT.warning }]}>⏸ Micro-break recommended</Text>
                                )}
                                {fatigueWarning && (
                                    <Text style={[styles.warningText, { color: COLORS_FLAT.warning }]}>😴 Fatigue warning</Text>
                                )}
                            </>
                        )}
                    </Card>
                )}

                {(watching || hasWave) && (
                    <Card>
                        <Text style={[styles.label, { color: t.textSub, marginBottom: 4 }]}>Bipolar EEG Waveform (T7 − T8)</Text>
                        <Text style={[styles.hint, { color: t.textMuted, marginBottom: 12 }]}>
                            Preprocessed (filtered) signal, not raw ADC output. Updates every 25s block.
                            {!watching && hasWave ? ' Showing the last block from a previous session (not live).' : ''}
                        </Text>
                        {!hasWave ? (
                            <Text style={[styles.waiting, { color: t.textMuted }]}>Waiting for first block…</Text>
                        ) : (
                            <SignalChart title="Bipolar (T7 − T8)" lastValue={lastWave} points={waveChart.points} min={waveChart.min} max={waveChart.max} color={stateColor} t={t} last />
                        )}
                    </Card>
                )}

                {(watching || scoreTrendPoints.length > 0) && (
                    <Card accentColor={highLoadThresholdPct != null ? stateColor : undefined}>
                        <Text style={[styles.label, { color: t.textSub, marginBottom: 4 }]}>Cognitive Load vs. Threshold</Text>
                        <Text style={[styles.hint, { color: t.textMuted, marginBottom: 8 }]}>
                            task_state_score across this and previous sessions, against this user's own calibrated thresholds.
                        </Text>

                        {highLoadThresholdPct == null ? (
                            <Text style={[styles.waiting, { color: t.textMuted }]}>
                                Loading threshold…
                            </Text>
                        ) : (
                            <>
                                <View style={styles.thresholdInfoRow}>
                                    <Text style={[styles.thresholdInfoText, { color: t.textSub }]}>
                                        High-load threshold: <Text style={{ fontWeight: '800', color: t.text }}>{highLoadThresholdPct.toFixed(1)}%</Text>
                                        {' '}
                                        <Text style={{ fontStyle: 'italic' }}>
                                            {isPersonalized ? '(personalized)' : '(population default — no onboarding threshold task yet)'}
                                        </Text>
                                    </Text>
                                    {restingBaselinePct != null && (
                                        <Text style={[styles.thresholdInfoText, { color: t.textSub }]}>
                                            Resting baseline: <Text style={{ fontWeight: '800', color: t.text }}>{restingBaselinePct.toFixed(1)}%</Text>
                                        </Text>
                                    )}
                                </View>

                                {trendHeadline && (
                                    <Text style={[styles.trendHeadline, { color: trendHeadline.color }]}>{trendHeadline.text}</Text>
                                )}

                                {scoreTrendPoints.length > 1 ? (
                                    <LineChart
                                        points={scoreTrendPoints}
                                        color={stateColor}
                                        width={RAW_CHART_WIDTH}
                                        height={160}
                                        maxValue={100}
                                        baselineValue={highLoadThresholdPct}
                                        baselineLabel="High-load threshold"
                                        baseline2Value={restingBaselinePct ?? undefined}
                                        baseline2Label="Resting baseline"
                                        colorZones
                                    />
                                ) : (
                                    <Text style={[styles.waiting, { color: t.textMuted }]}>Collecting more blocks…</Text>
                                )}
                            </>
                        )}
                    </Card>
                )}

                {bipolarFeatures && (
                    <Card>
                        <Text style={[styles.label, { color: t.textSub, marginBottom: 4 }]}>Bipolar (T7 − T8) Differential Features</Text>
                        <Text style={[styles.hint, { color: t.textMuted, marginBottom: 12 }]}>
                            All 29 features from this block's T7−T8 differential signal. Updates every 25s block.
                            {!watching ? ' Showing the last block from a previous session (not live).' : ''}
                        </Text>
                        <BipolarFeaturesChart
                            features={bipolarFeatures}
                            pointWidth={36}
                            height={140}
                        />
                    </Card>
                )}

            </ScrollView>
        </ScreenBackground>
    );
}

const styles = StyleSheet.create({
    scroll:       { padding: 20, paddingBottom: 40 },
    backRow:      { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 10 },
    title:        { fontSize: 22, fontWeight: '900' },
    subtitle:     { fontSize: 12, marginTop: 2, marginBottom: 16 },
    label:        { fontSize: 12, fontWeight: '700' },
    hint:         { fontSize: 11, lineHeight: 16 },
    waiting:      { fontSize: 13, textAlign: 'center', paddingVertical: 10 },
    stateRow:     { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 18 },
    stateEmoji:   { fontSize: 40 },
    stateLabel:   { fontSize: 22, fontWeight: '900' },
    stateProb:    { fontSize: 13, marginTop: 2 },
    metaRow:      { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
    metaLabel:    { fontSize: 13, fontWeight: '600' },
    metaValue:    { fontSize: 13, fontWeight: '700' },
    warningText:  { fontSize: 13, fontWeight: '700', marginTop: 10 },
    thresholdInfoRow:  { flexDirection: 'row', gap: 18, marginBottom: 8 },
    thresholdInfoText: { fontSize: 12, fontWeight: '600' },
    trendHeadline:     { fontSize: 13, fontWeight: '700', marginBottom: 10 },
    signalBlock:      {},
    signalHeaderRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
    signalTitle:      { fontSize: 12, fontWeight: '700' },
    signalValue:      { fontSize: 13, fontWeight: '800' },
    signalRange:      { fontSize: 10, marginTop: 4 },
    featureLabelText:  { fontSize: 8, textAlign: 'center' },
    featureValueText:  { fontSize: 8, fontWeight: '700', marginTop: 2 },
});
