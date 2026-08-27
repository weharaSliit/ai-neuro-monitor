// ============================================================
// AdminEegLiveScreen.js
// Full raw EEG live-signal view -- restored exactly as the old (deleted)
// EegSessionScreen.js showed it: task-state card, 3 raw µV channel charts,
// the 29-feature bipolar grid. Only difference from the original: reads
// psychological/{userId}/... for an ADMIN-SELECTED userId (route param)
// instead of useAuth()'s own logged-in user. Same hardware constraint as
// AdminUserDetailScreen's "Live Now" card -- only shows real data while
// this specific user happens to be the currently active global session
// (psychological/current_session_id), since there's only one EEG headset.
// ============================================================
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    View, Text, StyleSheet, Dimensions,
    TouchableOpacity, ScrollView,
} from 'react-native';
import ScreenBackground from '../../shared/ScreenBackground';
import Card from '../../shared/Card';
import Button from '../../shared/Button';
import Icon, { NAMES } from '../../shared/Icon';
import LineChart from '../../shared/LineChart';
import { ref, onValue, off, query, orderByChild, limitToLast } from 'firebase/database';
import { db } from '../../../firebase';
import { COLORS } from '../../physiological/config/theme';
import { STRESS_COLORS, STRESS_EMOJI, EEG_TREND_LABELS, TASK_STATE_LABELS } from '../../eeg/config/config';

const CHART_POINTS = 120;
const RAW_CHART_WIDTH = Dimensions.get('window').width - 2 * 20 - 2 * 18 - 60;
const RAW_CHART_HEIGHT = 260;
const RAW_CHART_CLIP_HEIGHT = RAW_CHART_HEIGHT + 16;

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
const BIPOLAR_POINT_WIDTH = 28;
const FEATURE_CHART_HEIGHT = 170;

function percentile(sorted, p) {
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
    return sorted[idx];
}

function chartRange(values, millis) {
    if (!values || values.length === 0) return { points: [], min: 0, max: 1 };
    const sorted = [...values].sort((a, b) => a - b);
    let lo = percentile(sorted, 0.05);
    let hi = percentile(sorted, 0.95);
    if (hi <= lo) { lo -= 1; hi += 1; }
    const { values: dsValues, indices } = downsampleWithIndices(values);
    const now = Date.now();
    const lastMillis = millis && millis.length > 0 ? millis[millis.length - 1] : null;
    const points = dsValues.map((v, i) => {
        const idx = indices[i];
        const m = lastMillis !== null && millis[idx] !== undefined ? millis[idx] : null;
        const date = m !== null ? new Date(now - (lastMillis - m)) : new Date(now - (dsValues.length - i));
        return { value: Math.min(hi, Math.max(lo, v)), date };
    });
    return { points, min: lo, max: hi };
}

function latestWindow(windowsObj) {
    if (!windowsObj) return null;
    const keys = Object.keys(windowsObj).filter((k) => /^\d+$/.test(k));
    if (keys.length === 0) return null;
    keys.sort((a, b) => Number(a) - Number(b));
    return windowsObj[keys[keys.length - 1]];
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
                    <View style={styles.signalChartClip}>
                        <LineChart
                            points={points}
                            color={color}
                            width={RAW_CHART_WIDTH}
                            height={RAW_CHART_HEIGHT}
                            fallback={<Text style={[styles.waiting, { color: t.textMuted }]}>Loading chart…</Text>}
                        />
                    </View>
                    <Text style={[styles.signalRange, { color: t.textMuted }]}>
                        this block's range: {min.toFixed(1)} to {max.toFixed(1)} µV
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
    const { userId } = route.params;
    const t = COLORS.light;
    const COLORS_FLAT = COLORS;
    const [sessionId, setSessionId] = useState('');
    const [watching, setWatching] = useState(false);
    const [latest, setLatest] = useState(null);
    const [hasAnyWindow, setHasAnyWindow] = useState(false);
    const [latestRaw, setLatestRaw] = useState(null);
    const [hasAnyRaw, setHasAnyRaw] = useState(false);
    const [calibrationResult, setCalibrationResult] = useState(null);
    const listenerRef = useRef(null);
    const rawListenerRef = useRef(null);
    const calibListenerRef = useRef(null);

    const startWatching = useCallback((idOverride) => {
        if (!userId) return;
        const targetId = (idOverride ?? sessionId).trim();
        if (!targetId) return;
        if (targetId === sessionId && listenerRef.current) return;
        setSessionId(targetId);
        setLatest(null);
        setHasAnyWindow(false);
        setLatestRaw(null);
        setHasAnyRaw(false);
        setCalibrationResult(null);

        const sessionRef = query(
            ref(db, `psychological/${userId}/${targetId}`), orderByChild('window'), limitToLast(1)
        );
        onValue(sessionRef, (snapshot) => {
            const data = snapshot.val();
            setHasAnyWindow(!!data);
            setLatest(latestWindow(data));
        });
        listenerRef.current = sessionRef;

        const rawRef = ref(db, `psychological/${userId}/${targetId}/live_raw`);
        onValue(rawRef, (snapshot) => {
            const data = snapshot.val();
            setHasAnyRaw(!!data);
            setLatestRaw(data);
        });
        rawListenerRef.current = rawRef;

        const calibRef = ref(db, `psychological/${userId}/${targetId}/calibration_result`);
        onValue(calibRef, (snapshot) => setCalibrationResult(snapshot.val() || null));
        calibListenerRef.current = calibRef;

        setWatching(true);
    }, [sessionId, userId]);

    const stopWatching = useCallback(() => {
        if (listenerRef.current) { off(listenerRef.current); listenerRef.current = null; }
        if (rawListenerRef.current) { off(rawListenerRef.current); rawListenerRef.current = null; }
        if (calibListenerRef.current) { off(calibListenerRef.current); calibListenerRef.current = null; }
        setWatching(false);
    }, []);

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

    const ch1Uv = latestRaw?.ch1_uv;
    const ch2Uv = latestRaw?.ch2_uv;
    const bipolarUv = (ch1Uv && ch2Uv && ch1Uv.length === ch2Uv.length)
        ? ch1Uv.map((v, i) => v - ch2Uv[i])
        : null;
    const rawMillis = latestRaw?.millis;
    const ch1Chart = ch1Uv ? chartRange(ch1Uv, rawMillis) : { points: [], min: 0, max: 1 };
    const ch2Chart = ch2Uv ? chartRange(ch2Uv, rawMillis) : { points: [], min: 0, max: 1 };
    const bipolarChart = bipolarUv ? chartRange(bipolarUv, rawMillis) : { points: [], min: 0, max: 1 };
    const lastCh1 = ch1Uv?.[ch1Uv.length - 1];
    const lastCh2 = ch2Uv?.[ch2Uv.length - 1];
    const lastBipolar = bipolarUv?.[bipolarUv.length - 1];
    const signedLog = (v) => Math.sign(v) * Math.log10(1 + Math.abs(v));
    const bipolarFeatures = latest?.features_eeg?.bipolar;
    const bipolarLinePoints = bipolarFeatures
        ? BIPOLAR_FEATURES.map(({ key }, i) => ({
              value: signedLog(bipolarFeatures[key] ?? 0),
              date: new Date(i),
          }))
        : [];

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

                {!watching && (
                    <Card>
                        <Text style={[styles.waiting, { color: t.textMuted }]}>
                            Waiting for a live session to begin…
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

                                {calibrationResult?.status === 'ok' && (
                                    <View style={styles.metaRow}>
                                        <Text style={[styles.metaLabel, { color: t.textSub }]}>Sensitivity</Text>
                                        <Text style={[styles.metaValue, { color: t.text }]}>
                                            {calibrationResult.thresholds_personalized
                                                ? `Personalized (${calibrationResult.baseline_shift >= 0 ? '+' : ''}${(calibrationResult.baseline_shift * 100).toFixed(1)}%)`
                                                : 'Standard (not enough clean blocks to personalize)'}
                                        </Text>
                                    </View>
                                )}

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

                {watching && (
                    <Card>
                        <Text style={[styles.label, { color: t.textSub, marginBottom: 12 }]}>Raw Signal (live, ~1s)</Text>
                        {!hasAnyRaw ? (
                            <Text style={[styles.waiting, { color: t.textMuted }]}>Waiting for first raw preview…</Text>
                        ) : (
                            <>
                                <SignalChart title="Channel 1 (T7)" lastValue={lastCh1} points={ch1Chart.points} min={ch1Chart.min} max={ch1Chart.max} color={COLORS_FLAT.hrv} t={t} />
                                <SignalChart title="Channel 2 (T8)" lastValue={lastCh2} points={ch2Chart.points} min={ch2Chart.min} max={ch2Chart.max} color={COLORS_FLAT.gsr} t={t} />
                                <SignalChart title="Bipolar (T7 − T8)" lastValue={lastBipolar} points={bipolarChart.points} min={bipolarChart.min} max={bipolarChart.max} color={stateColor} t={t} last />
                            </>
                        )}
                    </Card>
                )}

                {watching && bipolarLinePoints.length > 0 && (
                    <Card>
                        <Text style={[styles.label, { color: t.textSub, marginBottom: 4 }]}>Bipolar (T7 − T8) Differential Features</Text>
                        <Text style={[styles.hint, { color: t.textMuted, marginBottom: 12 }]}>
                            All 29 features from this block's T7−T8 differential signal. Updates every 25s block.
                        </Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator>
                            <View style={{ width: bipolarLinePoints.length * BIPOLAR_POINT_WIDTH }}>
                                <View style={{ height: FEATURE_CHART_HEIGHT }}>
                                    <LineChart
                                        points={bipolarLinePoints}
                                        color={COLORS_FLAT.brand}
                                        width={bipolarLinePoints.length * BIPOLAR_POINT_WIDTH}
                                        height={FEATURE_CHART_HEIGHT}
                                        fallback={<Text style={[styles.waiting, { color: t.textMuted }]}>Loading chart…</Text>}
                                    />
                                </View>
                                <View style={styles.featureLabelRow}>
                                    {BIPOLAR_FEATURES.map(({ key, label: fLabel }) => {
                                        const real = bipolarFeatures[key] ?? 0;
                                        return (
                                            <View key={key} style={[styles.featureLabelItem, { width: BIPOLAR_POINT_WIDTH }]}>
                                                <Text style={[styles.featureLabelText, { color: t.textSub }]}>{fLabel}</Text>
                                                <Text style={[styles.featureValueText, { color: t.textMuted }]}>
                                                    {Math.abs(real) >= 1000 ? real.toFixed(0) : real.toFixed(2)}
                                                </Text>
                                            </View>
                                        );
                                    })}
                                </View>
                            </View>
                        </ScrollView>
                    </Card>
                )}

                {watching && (
                    <Button label="Stop Watching" onPress={stopWatching} variant="danger" />
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
    signalBlock:      {},
    signalHeaderRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
    signalTitle:      { fontSize: 12, fontWeight: '700' },
    signalValue:      { fontSize: 13, fontWeight: '800' },
    signalChartClip:  { height: RAW_CHART_CLIP_HEIGHT, overflow: 'hidden' },
    signalRange:      { fontSize: 10, marginTop: 4 },
    featureLabelRow:   { flexDirection: 'row', marginTop: 8 },
    featureLabelItem:  { alignItems: 'center' },
    featureLabelText:  { fontSize: 8, textAlign: 'center' },
    featureValueText:  { fontSize: 8, fontWeight: '700', marginTop: 2 },
});
