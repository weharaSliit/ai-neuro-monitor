import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    View, Text, StyleSheet, TextInput, Dimensions,
    TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';

const CHART_WIDTH = Dimensions.get('window').width - 2 * 20 - 2 * 18 - 40;
import { SafeAreaView } from 'react-native-safe-area-context';
import { WithSkiaWeb } from '@shopify/react-native-skia/lib/module/web';
import { ref, onValue, off, get } from 'firebase/database';
import { db } from '../firebase';
import { useTheme } from '../../physiological/config/ThemeContext';
import { STRESS_COLORS, STRESS_LABELS, STRESS_EMOJI, FUSION_TREND_LABELS } from '../config/config';

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
    const [sessionId, setSessionId] = useState('');
    const [watching, setWatching] = useState(false);
    const [windows, setWindows] = useState(null);
    const [hasAnyWindow, setHasAnyWindow] = useState(false);
    const listenerRef = useRef(null);
    const startWatching = useCallback((idOverride) => {
        const targetId = (idOverride ?? sessionId).trim();
        if (!targetId) return;
        setSessionId(targetId);
        setWindows(null);
        setHasAnyWindow(false);

        const sessionRef = ref(db, `fusion_en/${targetId}`);
        const handler = onValue(sessionRef, (snapshot) => {
            const data = snapshot.val();
            setHasAnyWindow(!!data);
            setWindows(data);
        });
        listenerRef.current = { sessionRef, handler };
        setWatching(true);
    }, [sessionId]);  
    useEffect(() => {
        let cancelled = false;
        // Lives inside fusion_en_sessions/ itself (this screen's own
        // domain, and the same root fusion_live_session.py already polls)
        // -- no separate shared pointer store, see App.js's
        // CURRENT_SESSION_ID_ROOTS.
        get(ref(db, 'fusion_en_sessions/current_session_id')).then((snapshot) => {
            if (cancelled) return;
            const liveId = snapshot.val();
            if (liveId) startWatching(liveId);
        }).catch(() => {});
        return () => { cancelled = true; };
    }, []);

    const latest = useMemo(() => latestWindow(windows), [windows]);
    const { fusedHistory, baselinePercent } = useMemo(() => {
        const keys = sortedWindowKeys(windows);
        // Each window key IS a real wall-clock bucket index (see
        // backend/common/fusion.py's fusion_window_key(): int(time.time() //
        // FUSION_WINDOW_BUCKET_SEC)) -- multiplying back out gives a genuine
        // timestamp per point, not a synthetic sequential index.
        const history = keys
            .map((k) => ({ v: windows[k]?.fused_probability, key: k }))
            .filter(({ v }) => v !== undefined && v !== null)
            .map(({ v, key }) => ({ value: Math.round(v * 100), date: new Date(Number(key) * 60000) }));
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

    const label = latest?.fused_label;
    const prob = latest?.fused_probability;
    const trend = latest?.stress_trend;
    const deviation = latest?.stress_deviation;
    const stateColor = label !== undefined && label !== null ? STRESS_COLORS[label] : COLORS.brand;
    const eegProb = latest?.prob_eeg;
    const hrvGsrProb = latest?.prob_hrv_gsr;
    const eegWeight = latest?.eeg_weight;
    const hrvGsrWeight = latest?.hrv_gsr_weight;
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
                            Auto-fills with the current live session on open. Edit this and press
                            Start only to watch a different or past session's id.
                        </Text>

                        {!watching ? (
                            <TouchableOpacity
                                style={[styles.button, { backgroundColor: COLORS.brand }]}
                                onPress={() => startWatching()}
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
                                    Waiting for first reading…
                                </Text>
                            ) : (
                                <>
                                    <View style={styles.gaugeRow}>
                                        <Text style={styles.stateEmoji}>
                                            {label !== undefined && label !== null ? STRESS_EMOJI[label] : '…'}
                                        </Text>
                                        <View style={{ flex: 1, marginLeft: 14 }}>
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

                                    {fusedHistory.length > 1 && (
                                        <View style={styles.trendBlock}>
                                            <Text style={[styles.hint, { color: t.textMuted, marginTop: 0, marginBottom: 10 }]}>
                                                Session trendline — fused stress probability per window (%)
                                                {baselinePercent !== null ? ` — baseline ${baselinePercent}%` : ''}
                                            </Text>
                                            <WithSkiaWeb
                                                getComponent={() => import('../../shared/SkiaLineGraph')}
                                                componentProps={{
                                                    points: fusedHistory,
                                                    color: stateColor,
                                                    width: CHART_WIDTH,
                                                    height: 130,
                                                }}
                                                fallback={<Text style={[styles.waiting, { color: t.textMuted }]}>Loading chart…</Text>}
                                            />
                                        </View>
                                    )}

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
    stateEmoji:   { fontSize: 40 },
    stateLabel:   { fontSize: 22, fontWeight: '900' },
    stateProb:    { fontSize: 13, marginTop: 2 },
    trendBlock:   { marginBottom: 18 },
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
