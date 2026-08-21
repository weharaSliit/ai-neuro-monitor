// Live EEG (wearable02, T7/T8) session screen -- watches
// phsycological/{sessionId} in Realtime Database directly (matching
// modules/fusion's and modules/phenotyping's established
// direct-RTDB-read convention) and displays the current task_state_score/
// label/trend/quality as backend/psychological/mqtt_bridge.py's live loop
// writes them.
//
// Does NOT start or stop the wearable02 firmware, the MQTT broker, or
// backend/psychological/mqtt_bridge.py -- those already run independently.
// "Start Session" here only begins watching a session_id; whoever runs the
// bridge script is responsible for using the same id (it prints the id it
// generated on startup).
//
// Naming honesty (see phscycological/results/CURRENT_SYSTEM.md Section 1):
// this screen must say "task load" / "cognitive load", never "stress" --
// this EEG model outputs task_state_score, not a validated subjective-
// stress probability.
import React, { useCallback, useRef, useState } from 'react';
import {
    View, Text, StyleSheet, TextInput,
    TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LineChart } from 'react-native-gifted-charts';
import { ref, onValue, off } from 'firebase/database';
import { db } from '../firebase';
import { useTheme } from '../../physiological/config/ThemeContext';
import { STRESS_COLORS, STRESS_EMOJI, EEG_TREND_LABELS, TASK_STATE_LABELS } from '../config/config';

// A raw block is 6250 samples (25s @ 250Hz, see backend/psychological/
// realtime/resample.py::SOURCE_FS) -- far too many points for a readable
// mobile line chart or to push through re-renders smoothly. Evenly-spaced
// stride decimation down to a fixed point count for DISPLAY only; this
// screen is a live glance at signal shape/amplitude, not a signal-analysis
// tool -- full-resolution data still lands in Firebase (phsycological_raw)
// and the backend's local CSV log (backend/psychological/logs/) either way.
const CHART_POINTS = 120;

function downsample(values) {
    if (!values || values.length === 0) return [];
    if (values.length <= CHART_POINTS) return values;
    const stride = values.length / CHART_POINTS;
    const out = [];
    for (let i = 0; i < CHART_POINTS; i++) {
        out.push(values[Math.floor(i * stride)]);
    }
    return out;
}

function toChartData(values) {
    return downsample(values).map((v) => ({ value: v }));
}

function defaultSessionId() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `wearable02_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T`
        + `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Picks the highest numeric window key present in a
 * phsycological/{sessionId} snapshot object -- mirrors
 * FusionSessionScreen's latestWindow() / PhenotypingDashboard.jsx's
 * pattern of sorting entries and taking the latest. */
function latestWindow(windowsObj) {
    if (!windowsObj) return null;
    const keys = Object.keys(windowsObj).filter((k) => /^\d+$/.test(k));
    if (keys.length === 0) return null;
    keys.sort((a, b) => Number(a) - Number(b));
    return windowsObj[keys[keys.length - 1]];
}

function SignalChart({ title, lastValue, data, color, t, last }) {
    return (
        <View style={[styles.signalBlock, last ? null : { marginBottom: 16 }]}>
            <View style={styles.signalHeaderRow}>
                <Text style={[styles.signalTitle, { color: t.textSub }]}>{title}</Text>
                <Text style={[styles.signalValue, { color: t.text }]}>
                    {lastValue !== undefined && lastValue !== null ? `${lastValue.toFixed(1)} µV` : '—'}
                </Text>
            </View>
            {data.length > 1 ? (
                <LineChart
                    data={data}
                    height={70}
                    color={color}
                    thickness={1.5}
                    hideDataPoints
                    hideYAxisText
                    hideAxesAndRules
                    curved
                    backgroundColor="transparent"
                    initialSpacing={0}
                    endSpacing={0}
                    spacing={2}
                />
            ) : (
                <Text style={[styles.waiting, { color: t.textMuted, paddingVertical: 4 }]}>—</Text>
            )}
        </View>
    );
}

export default function EegSessionScreen({ navigation }) {
    const { isDark, theme: t, COLORS } = useTheme();
    const [sessionId, setSessionId] = useState(defaultSessionId());
    const [watching, setWatching] = useState(false);
    const [latest, setLatest] = useState(null);
    const [hasAnyWindow, setHasAnyWindow] = useState(false);
    const [latestRaw, setLatestRaw] = useState(null);
    const [hasAnyRaw, setHasAnyRaw] = useState(false);
    const listenerRef = useRef(null);
    const rawListenerRef = useRef(null);

    const startWatching = useCallback(() => {
        if (!sessionId.trim()) return;
        setLatest(null);
        setHasAnyWindow(false);
        setLatestRaw(null);
        setHasAnyRaw(false);

        const sessionRef = ref(db, `phsycological/${sessionId.trim()}`);
        const handler = onValue(sessionRef, (snapshot) => {
            const data = snapshot.val();
            setHasAnyWindow(!!data);
            setLatest(latestWindow(data));
        });
        listenerRef.current = sessionRef;

        // Sibling path -- see backend/psychological/firebase_service.py::
        // push_raw() -- raw ADC codes + decoded uV per block, kept separate
        // from the derived task_state_score record above so a large raw
        // payload never bloats it.
        const rawRef = ref(db, `phsycological_raw/${sessionId.trim()}`);
        const rawHandler = onValue(rawRef, (snapshot) => {
            const data = snapshot.val();
            setHasAnyRaw(!!data);
            setLatestRaw(latestWindow(data));
        });
        rawListenerRef.current = rawRef;

        setWatching(true);
    }, [sessionId]);

    const stopWatching = useCallback(() => {
        if (listenerRef.current) {
            off(listenerRef.current);
            listenerRef.current = null;
        }
        if (rawListenerRef.current) {
            off(rawListenerRef.current);
            rawListenerRef.current = null;
        }
        setWatching(false);
    }, []);

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
    const stateColor = label !== undefined && label !== null ? STRESS_COLORS[label] : COLORS.brand;

    const ch1Uv = latestRaw?.ch1_uv;
    const ch2Uv = latestRaw?.ch2_uv;
    // bipolar = T7 - T8, reference-agnostic by construction -- same
    // derivation the deployed model itself uses (see
    // psycological/results/CURRENT_SYSTEM.md Section 3), computed here
    // client-side rather than stored separately since it's fully determined
    // by ch1_uv/ch2_uv already in the raw record.
    const bipolarUv = (ch1Uv && ch2Uv && ch1Uv.length === ch2Uv.length)
        ? ch1Uv.map((v, i) => v - ch2Uv[i])
        : null;
    const ch1ChartData = ch1Uv ? toChartData(ch1Uv) : [];
    const ch2ChartData = ch2Uv ? toChartData(ch2Uv) : [];
    const bipolarChartData = bipolarUv ? toChartData(bipolarUv) : [];
    const lastCh1 = ch1Uv?.[ch1Uv.length - 1];
    const lastCh2 = ch2Uv?.[ch2Uv.length - 1];
    const lastBipolar = bipolarUv?.[bipolarUv.length - 1];

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: t.bg }]} edges={['top', 'left', 'right']}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
                <ScrollView contentContainerStyle={styles.scroll}>
                    <View style={styles.header}>
                        <TouchableOpacity onPress={() => navigation.goBack()}>
                            <Text style={[styles.back, { color: COLORS.brand }]}>{'←'} Back</Text>
                        </TouchableOpacity>
                        <Text style={[styles.title, { color: t.text }]}>Live EEG</Text>
                        <Text style={[styles.subtitle, { color: t.textMuted }]}>
                            T7/T8 cognitive-load readings, live (wearable02)
                        </Text>
                    </View>

                    <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                        <Text style={[styles.label, { color: t.textSub }]}>Session ID</Text>
                        <TextInput
                            style={[styles.input, { color: t.text, borderColor: t.border }]}
                            value={sessionId}
                            onChangeText={setSessionId}
                            editable={!watching}
                            autoCapitalize="none"
                            autoCorrect={false}
                            placeholder="session id"
                            placeholderTextColor={t.textMuted}
                        />
                        <Text style={[styles.hint, { color: t.textMuted }]}>
                            Use the SAME session id backend/psychological/mqtt_bridge.py printed on
                            startup (or pass EEG_SESSION_ID to set your own).
                        </Text>

                        {!watching ? (
                            <TouchableOpacity
                                style={[styles.button, { backgroundColor: COLORS.brand }]}
                                onPress={startWatching}
                                activeOpacity={0.85}
                            >
                                <Text style={styles.buttonText}>Start Session (watch live)</Text>
                            </TouchableOpacity>
                        ) : (
                            <TouchableOpacity
                                style={[styles.button, styles.buttonDanger]}
                                onPress={stopWatching}
                                activeOpacity={0.85}
                            >
                                <Text style={styles.buttonText}>Stop Watching</Text>
                            </TouchableOpacity>
                        )}
                    </View>

                    {watching && (
                        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
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

                                    {baselineDegraded && (
                                        <Text style={[styles.warningText, { color: '#ef4444' }]}>
                                            ⚠ Baseline degraded — calibration never reached GOOD quality;
                                            scores here are not trustworthy.
                                        </Text>
                                    )}
                                    {highLoadAlert && (
                                        <Text style={[styles.warningText, { color: '#ef4444' }]}>
                                            ⚠ High load alert
                                        </Text>
                                    )}
                                    {microBreak && (
                                        <Text style={[styles.warningText, { color: '#f59e0b' }]}>
                                            ⏸ Micro-break recommended
                                        </Text>
                                    )}
                                    {fatigueWarning && (
                                        <Text style={[styles.warningText, { color: '#f59e0b' }]}>
                                            😴 Fatigue warning
                                        </Text>
                                    )}
                                </>
                            )}
                        </View>
                    )}

                    {watching && (
                        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                            <Text style={[styles.label, { color: t.textSub, marginBottom: 12 }]}>
                                Raw Signal (latest block)
                            </Text>
                            {!hasAnyRaw ? (
                                <Text style={[styles.waiting, { color: t.textMuted }]}>
                                    Waiting for first raw block…
                                </Text>
                            ) : (
                                <>
                                    <SignalChart
                                        title="Channel 1 (T7)"
                                        lastValue={lastCh1}
                                        data={ch1ChartData}
                                        color={COLORS.hrv || COLORS.brand}
                                        t={t}
                                    />
                                    <SignalChart
                                        title="Channel 2 (T8)"
                                        lastValue={lastCh2}
                                        data={ch2ChartData}
                                        color={COLORS.gsr || COLORS.brand}
                                        t={t}
                                    />
                                    <SignalChart
                                        title="Bipolar (T7 − T8)"
                                        lastValue={lastBipolar}
                                        data={bipolarChartData}
                                        color={stateColor}
                                        t={t}
                                        last
                                    />
                                    <Text style={[styles.hint, { color: t.textMuted, marginTop: 4 }]}>
                                        Decoded µV, decimated to {CHART_POINTS} points for display — full-resolution
                                        samples are stored in Firebase and the backend's raw CSV log either way.
                                    </Text>
                                </>
                            )}
                        </View>
                    )}
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container:    { flex: 1 },
    scroll:       { padding: 20, paddingBottom: 40 },
    header:       { marginBottom: 20 },
    back:         { fontSize: 14, fontWeight: '600', marginBottom: 14 },
    title:        { fontSize: 26, fontWeight: '900' },
    subtitle:     { fontSize: 13, marginTop: 4 },
    card:         { borderRadius: 18, borderWidth: 1, padding: 18, marginBottom: 16 },
    label:        { fontSize: 12, fontWeight: '700', marginBottom: 6 },
    input:        { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
    hint:         { fontSize: 11, marginTop: 8, lineHeight: 16 },
    button:       { marginTop: 14, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
    buttonDanger: { backgroundColor: '#ef4444' },
    buttonText:   { color: '#fff', fontSize: 15, fontWeight: '800' },
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
});
