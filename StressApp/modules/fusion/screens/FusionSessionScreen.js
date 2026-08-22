// Live fusion session screen -- watches fusion_en/{sessionId} in Realtime
// Database directly (matching modules/phenotyping's established
// direct-RTDB-read convention) and displays the current fused stress
// label/probability/trend/deviation as the backend live loop
// (fushion engin/fusion_live_session.py) writes them.
//
// Does NOT start or stop the EEG/HRV-GSR backend processes or the Python
// fusion loop -- those already run independently. "Start Session" here
// only begins watching a session_id; whoever operates the EEG/HRV-GSR
// processes and the fusion loop is responsible for using the same id.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    View, Text, StyleSheet, TextInput, Dimensions,
    TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';

// Card content width: screen width minus ScrollView padding (styles.scroll,
// 20 each side) and card padding (styles.card, 18 each side) -- gifted-
// charts' LineChart doesn't auto-fit its parent by default (adjustToWidth
// alone wasn't enough in the installed version), it just keeps growing
// with the point count/default spacing, which overflowed the card once a
// session accumulated more than ~6-7 fused windows.
const CHART_WIDTH = Dimensions.get('window').width - 2 * 20 - 2 * 18 - 40;
import { SafeAreaView } from 'react-native-safe-area-context';
import CircularProgress from 'react-native-circular-progress-indicator';
import { LineChart } from 'react-native-gifted-charts';
import { ref, onValue, off, set } from 'firebase/database';
import { db } from '../firebase';
import { useTheme } from '../../physiological/config/ThemeContext';
import { STRESS_COLORS, STRESS_LABELS, STRESS_EMOJI, FUSION_TREND_LABELS } from '../config/config';

// scripts/start_all.sh pins SESSION_ID=live_session_1 for every backend
// component (both wearable bridges + the fusion engine) -- matching that
// here means this screen has real data to show the moment it mounts,
// instead of watching an empty freshly-generated id no process is writing
// under.
const DEFAULT_SESSION_ID = 'live_session_1';

/** Numeric window keys in ascending order -- fusion_en/{sessionId}'s keys
 * are fusion_window_key() wall-clock buckets now (backend/common/fusion.py),
 * not small contiguous indices, so this only ever assumes they sort
 * numerically, never that they start at 0 or are evenly spaced. */
function sortedWindowKeys(windowsObj) {
    if (!windowsObj) return [];
    return Object.keys(windowsObj)
        .filter((k) => /^\d+$/.test(k))
        .sort((a, b) => Number(a) - Number(b));
}

function latestWindow(windowsObj) {
    const keys = sortedWindowKeys(windowsObj);
    return keys.length ? windowsObj[keys[keys.length - 1]] : null;
}

function MetricBadge({ label, value, unit, color, t }) {
    return (
        <View style={styles.metricBadge}>
            <Text style={[styles.metricBadgeValue, { color }]}>
                {value === undefined || value === null ? '—' : `${value.toFixed(1)}${unit || ''}`}
            </Text>
            <Text style={[styles.metricBadgeLabel, { color: t.textMuted }]}>{label}</Text>
        </View>
    );
}

export default function FusionSessionScreen({ navigation }) {
    const { isDark, theme: t, COLORS } = useTheme();
    const [sessionId, setSessionId] = useState(DEFAULT_SESSION_ID);
    const [watching, setWatching] = useState(false);
    const [ended, setEnded] = useState(false);
    const [windows, setWindows] = useState(null);
    const [hasAnyWindow, setHasAnyWindow] = useState(false);
    const listenerRef = useRef(null);

    const startWatching = useCallback(() => {
        if (!sessionId.trim()) return;
        setEnded(false);
        setWindows(null);
        setHasAnyWindow(false);

        // Clears any stale ended=true from a PREVIOUS "End Session" press --
        // that flag lives in Firebase (fusion_en_sessions/{id}/ended), not
        // local state, and is what fusion_live_session.py (the Python
        // process that actually computes fused_probability/fused_label)
        // checks every poll to decide whether to keep running AT ALL --
        // once true it exits for good, not just for this screen instance.
        // With this screen now auto-watching the same default session_id on
        // every mount, a screen genuinely re-opening for a live session
        // should always mean "this session is active", so clear it here
        // rather than leaving the backend fusion process dead until someone
        // notices the dashboard went stale and manually clears it.
        set(ref(db, `fusion_en_sessions/${sessionId.trim()}/ended`), false);

        const sessionRef = ref(db, `fusion_en/${sessionId.trim()}`);
        const handler = onValue(sessionRef, (snapshot) => {
            const data = snapshot.val();
            setHasAnyWindow(!!data);
            setWindows(data);
        });
        listenerRef.current = { sessionRef, handler };
        setWatching(true);
    }, [sessionId]);

    // Auto-watch the default (live) session on mount -- no reason to make
    // the user click "Start Session" just to see data a backend process is
    // already publishing. Runs once; manually editing the session id and
    // pressing Start still works for watching a non-default session.
    useEffect(() => {
        startWatching();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const latest = useMemo(() => latestWindow(windows), [windows]);

    // Trend history: every window with a real fused_probability, in
    // ascending key order -- powers the trendline chart below. Baseline is
    // the mean of the first 3 (matches fusion_live_session.py's BASELINE_N
    // exactly, see poll_once()'s stress_deviation computation), derived
    // client-side from latest.fused_probability - latest.stress_deviation
    // rather than duplicated as its own backend field.
    const { fusedHistory, baselinePercent } = useMemo(() => {
        const keys = sortedWindowKeys(windows);
        const values = keys
            .map((k) => windows[k]?.fused_probability)
            .filter((v) => v !== undefined && v !== null);
        const history = values.map((v) => ({ value: Math.round(v * 100) }));
        const latestProb = latest?.fused_probability;
        const latestDev = latest?.stress_deviation;
        const baseline = (latestProb !== undefined && latestProb !== null
            && latestDev !== undefined && latestDev !== null)
            ? Math.round((latestProb - latestDev) * 100)
            : null;
        return { fusedHistory: history, baselinePercent: baseline };
    }, [windows, latest]);

    const stopWatching = useCallback(() => {
        if (listenerRef.current) {
            off(listenerRef.current.sessionRef);
            listenerRef.current = null;
        }
        setWatching(false);
    }, []);

    const endSession = useCallback(async () => {
        await set(ref(db, `fusion_en_sessions/${sessionId.trim()}/ended`), true);
        stopWatching();
        setEnded(true);
    }, [sessionId, stopWatching]);

    const label = latest?.fused_label;
    const prob = latest?.fused_probability;
    const trend = latest?.stress_trend;
    const deviation = latest?.stress_deviation;
    const stateColor = label !== undefined && label !== null ? STRESS_COLORS[label] : COLORS.brand;

    // Per-modality breakdown of THIS fused reading -- see
    // fushion engin/fusion_live_session.py::poll_once()'s write dict.
    // prob_eeg/prob_hrv_gsr are null when that modality is genuinely
    // missing/untrusted for this window (not "read 0"), and the *_weight
    // fields are that modality's actual share of the fused_probability
    // above (they sum to 1 across whichever modalities ARE present) --
    // together these make the black-box weighted average visible: which
    // modality is actually driving the number on screen right now.
    const eegProb = latest?.prob_eeg;
    const hrvGsrProb = latest?.prob_hrv_gsr;
    const eegWeight = latest?.eeg_weight;
    const hrvGsrWeight = latest?.hrv_gsr_weight;

    // Namespaced field (backend/physiological/firebase_service.py::
    // _hrv_gsr_fusion_fields) -- can be absent independently of fused_*
    // above (e.g. no HRV/GSR reading for this window yet); the panel below
    // handles that missing case itself. The EEG-side equivalent
    // (features_eeg, incl. the 29-feature bipolar breakdown) now lives on
    // the Live EEG dashboard instead -- see EegSessionScreen.js.
    const hrvGsr = latest?.features_hrv_gsr;

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: t.bg }]} edges={['top', 'left', 'right']}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
                <ScrollView contentContainerStyle={styles.scroll}>
                    <View style={styles.header}>
                        <TouchableOpacity onPress={() => navigation.goBack()}>
                            <Text style={[styles.back, { color: COLORS.brand }]}>{'←'} Back</Text>
                        </TouchableOpacity>
                        <Text style={[styles.title, { color: t.text }]}>Live Fusion</Text>
                        <Text style={[styles.subtitle, { color: t.textMuted }]}>
                            Combined EEG + HRV/GSR stress state, live
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
                            Use the SAME session id you passed to the EEG (--firebase-session-id) and
                            HRV/GSR (session_id) processes, and to fusion_live_session.py --session-id.
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
                                onPress={endSession}
                                activeOpacity={0.85}
                            >
                                <Text style={styles.buttonText}>End Session</Text>
                            </TouchableOpacity>
                        )}
                    </View>

                    {watching && (
                        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                            {!hasAnyWindow ? (
                                <Text style={[styles.waiting, { color: t.textMuted }]}>
                                    Waiting for first reading…
                                </Text>
                            ) : (
                                <>
                                    <View style={styles.gaugeRow}>
                                        <CircularProgress
                                            value={prob !== undefined && prob !== null ? prob * 100 : 0}
                                            radius={64}
                                            duration={600}
                                            activeStrokeColor={stateColor}
                                            inActiveStrokeColor={t.border}
                                            inActiveStrokeOpacity={0.3}
                                            title={label !== undefined && label !== null ? STRESS_EMOJI[label] : '…'}
                                            titleFontSize={26}
                                            titleColor={stateColor}
                                            progressValueColor={t.text}
                                            valueSuffix="%"
                                        />
                                        <View style={{ flex: 1, marginLeft: 18 }}>
                                            <Text style={[styles.stateLabel, { color: stateColor }]}>
                                                {label !== undefined && label !== null
                                                    ? STRESS_LABELS[label] : 'Scoring…'}
                                            </Text>
                                            <Text style={[styles.stateProb, { color: t.textMuted }]}>
                                                {prob !== undefined && prob !== null
                                                    ? `${(prob * 100).toFixed(0)}% fused stress probability` : ''}
                                            </Text>
                                        </View>
                                    </View>

                                    <View style={styles.metaRow}>
                                        <Text style={[styles.metaLabel, { color: t.textSub }]}>Trend</Text>
                                        <Text style={[styles.metaValue, { color: t.text }]}>
                                            {trend ? (FUSION_TREND_LABELS[trend] || trend) : '—'}
                                        </Text>
                                    </View>

                                    <View style={styles.metaRow}>
                                        <Text style={[styles.metaLabel, { color: t.textSub }]}>Deviation</Text>
                                        <Text style={[styles.metaValue, { color: t.text }]}>
                                            {deviation === undefined || deviation === null
                                                ? 'establishing baseline…'
                                                : `${deviation >= 0 ? '+' : ''}${deviation.toFixed(2)} `
                                                  + `${deviation >= 0 ? 'above' : 'below'} your baseline`}
                                        </Text>
                                    </View>

                                    <View style={styles.sourcesBlock}>
                                        <Text style={[styles.metaLabel, { color: t.textSub, marginBottom: 10 }]}>
                                            Sources (this reading)
                                        </Text>
                                        <View style={styles.sourceRow}>
                                            <View style={[styles.sourceDot, {
                                                backgroundColor: eegProb !== undefined && eegProb !== null
                                                    ? (COLORS.hrv || COLORS.brand) : t.border,
                                            }]} />
                                            <Text style={[styles.sourceName, { color: t.text }]}>EEG</Text>
                                            <Text style={[styles.sourceValue, { color: t.textMuted }]}>
                                                {eegProb !== undefined && eegProb !== null
                                                    ? `${(eegProb * 100).toFixed(0)}% · ${((eegWeight || 0) * 100).toFixed(0)}% weight`
                                                    : 'not reporting'}
                                            </Text>
                                        </View>
                                        <View style={styles.sourceRow}>
                                            <View style={[styles.sourceDot, {
                                                backgroundColor: hrvGsrProb !== undefined && hrvGsrProb !== null
                                                    ? (COLORS.gsr || COLORS.brand) : t.border,
                                            }]} />
                                            <Text style={[styles.sourceName, { color: t.text }]}>HRV/GSR</Text>
                                            <Text style={[styles.sourceValue, { color: t.textMuted }]}>
                                                {hrvGsrProb !== undefined && hrvGsrProb !== null
                                                    ? `${(hrvGsrProb * 100).toFixed(0)}% · ${((hrvGsrWeight || 0) * 100).toFixed(0)}% weight`
                                                    : 'not reporting'}
                                            </Text>
                                        </View>
                                    </View>
                                </>
                            )}
                        </View>
                    )}

                    {watching && hasAnyWindow && fusedHistory.length > 1 && (
                        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                            <Text style={[styles.label, { color: t.textSub }]}>Session Trendline</Text>
                            <Text style={[styles.hint, { color: t.textMuted, marginTop: 0, marginBottom: 12 }]}>
                                Fused stress probability per window (%)
                                {baselinePercent !== null ? ` — baseline ${baselinePercent}%` : ''}
                            </Text>
                            <LineChart
                                data={fusedHistory}
                                width={CHART_WIDTH}
                                height={130}
                                color={COLORS.brand}
                                thickness={1.5}
                                curved
                                hideDataPoints
                                yAxisColor={t.border}
                                xAxisColor={t.border}
                                yAxisTextStyle={{ color: t.textMuted, fontSize: 9 }}
                                noOfSections={4}
                                maxValue={100}
                                rulesColor={t.border}
                                backgroundColor="transparent"
                                showReferenceLine1={baselinePercent !== null}
                                referenceLine1Position={baselinePercent || 0}
                                referenceLine1Config={{ color: t.textMuted, dashWidth: 4, dashGap: 4 }}
                                adjustToWidth
                                disableScroll
                                initialSpacing={4}
                                endSpacing={4}
                            />
                        </View>
                    )}

                    {watching && hasAnyWindow && (
                        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                            <Text style={[styles.label, { color: t.textSub, marginBottom: 12 }]}>
                                Physiological Panel (HRV/GSR)
                            </Text>
                            {!hrvGsr ? (
                                <Text style={[styles.waiting, { color: t.textMuted }]}>
                                    No HRV/GSR reading for this window yet.
                                </Text>
                            ) : (
                                <View style={styles.badgeRow}>
                                    <MetricBadge label="AVNN (ms)" value={hrvGsr.avnn} color={COLORS.hrv || COLORS.brand} t={t} />
                                    <MetricBadge label="SD1 (HRV)" value={hrvGsr.sd1} color={COLORS.hrv || COLORS.brand} t={t} />
                                    <MetricBadge label="SCL (µS)" value={hrvGsr.scl_mean} unit="" color={COLORS.gsr || COLORS.brand} t={t} />
                                </View>
                            )}
                        </View>
                    )}

                    {ended && (
                        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                            <Text style={[styles.waiting, { color: t.textMuted }]}>
                                Session ended. Start a new session id to watch again.
                            </Text>
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
    gaugeRow:     { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
    stateLabel:   { fontSize: 22, fontWeight: '900' },
    stateProb:    { fontSize: 13, marginTop: 2 },
    metaRow:      { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
    metaLabel:    { fontSize: 13, fontWeight: '600' },
    metaValue:    { fontSize: 13, fontWeight: '700' },
    badgeRow:     { flexDirection: 'row', justifyContent: 'space-between' },
    metricBadge:      { flex: 1, alignItems: 'center' },
    metricBadgeValue: { fontSize: 17, fontWeight: '900' },
    metricBadgeLabel: { fontSize: 10, fontWeight: '600', marginTop: 4, textAlign: 'center' },
    sourcesBlock: { marginTop: 4, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(128,128,128,0.25)' },
    sourceRow:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
    sourceDot:    { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
    sourceName:   { fontSize: 13, fontWeight: '700', width: 78 },
    sourceValue:  { fontSize: 12, flex: 1 },
});
