// Live HRV/GSR session screen -- watches
// physiological/predictions/{userId}/{sessionId} in Realtime Database
// directly (matching EegSessionScreen.js/FusionSessionScreen.js's
// direct-RTDB-listener convention), and displays the current window's
// label/probability plus a session trendline. Complements (does not
// replace) modules/physiological/screens/Ringscreen.js's simpler
// device-status + 5-window feed view, the same way this screen sits
// alongside (not instead of) the tab-bar's EEG tab.
//
// Scoped by the LOGGED-IN app account's userId, matching
// Ringscreen.js's existing pollFeed() convention -- backend/physiological/
// mqtt_bridge.py currently hardcodes USER_ID="Wehara" for every live
// prediction it posts (see that file), so this only shows real data while
// logged in as that account; this is an existing constraint of the live
// pipeline, not something new here.
import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
    View, Text, StyleSheet, TextInput, Dimensions,
    TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LineChart from '../../shared/LineChart';
import { ref, onValue, off } from 'firebase/database';
import { db } from '../firebase';
import { useTheme } from '../../physiological/config/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { STRESS_COLORS, STRESS_LABELS, STRESS_EMOJI } from '../../physiological/config/config';

const TREND_CHART_WIDTH = Dimensions.get('window').width - 2 * 20 - 2 * 18;

// Firebase push-keys sort correctly in chronological order as plain
// strings (their own well-known property) -- no numeric window index
// needed the way EEG/Fusion's own wall-clock-bucket keys use one.
function sortedPushKeys(obj) {
    if (!obj) return [];
    return Object.keys(obj).sort();
}

function latestPrediction(obj) {
    const keys = sortedPushKeys(obj);
    return keys.length ? obj[keys[keys.length - 1]] : null;
}

export default function HrvGsrSessionScreen({ navigation, route }) {
    const showBack = route?.name === 'HrvGsr';
    const { theme: t, COLORS } = useTheme();
    const { user } = useAuth();
    const userId = user?.userId;

    const [sessionId, setSessionId] = useState('');
    const [watching, setWatching] = useState(false);
    const [predictions, setPredictions] = useState(null);
    const [hasAny, setHasAny] = useState(false);
    const listenerRef = useRef(null);

    const startWatching = useCallback((idOverride) => {
        if (!userId) return;
        const targetId = (idOverride ?? sessionId).trim();
        if (!targetId) return;
        if (targetId === sessionId && listenerRef.current) return;  // already watching this session
        setSessionId(targetId);
        setPredictions(null);
        setHasAny(false);

        const sessionRef = ref(db, `physiological/predictions/${userId}/${targetId}`);
        const handler = onValue(sessionRef, (snapshot) => {
            const data = snapshot.val();
            setHasAny(!!data);
            setPredictions(data);
        });
        listenerRef.current = sessionRef;
        setWatching(true);
    }, [sessionId, userId]);  // eslint-disable-line react-hooks/exhaustive-deps -- idOverride intentionally omitted

    const stopWatching = useCallback(() => {
        if (listenerRef.current) {
            off(listenerRef.current);
            listenerRef.current = null;
        }
        setWatching(false);
    }, []);

    useEffect(() => {
        if (!userId) return;
        // A live subscription, not a one-time get() -- picks up the current
        // session the instant App.js writes it and follows any later
        // rotation automatically, so there's never a manual "Start" step
        // needed. fusion_en/current_session_id (not physiological/...) --
        // this is the exact field backend/physiological/mqtt_bridge.py's
        // own _poll_session_pointer() follows for its rotation, kept in
        // sync with psychological/fusion_en_sessions by App.js's
        // resolveLiveSessionId() writing all three together.
        const pointerRef = ref(db, 'fusion_en/current_session_id');
        const handler = onValue(pointerRef, (snapshot) => {
            const liveId = snapshot.val();
            if (liveId) startWatching(liveId);
        });
        return () => off(pointerRef, 'value', handler);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- startWatching is always called
        // with an explicit liveId override here, so its own sessionId-state closure never matters.
    }, [userId]);

    const orderedKeys = useMemo(() => sortedPushKeys(predictions), [predictions]);
    const latest = useMemo(() => latestPrediction(predictions), [predictions]);

    const stressTrend = useMemo(() => {
        return orderedKeys
            .map((k) => predictions[k])
            .filter((w) => w?.timestamp && w.prob_stress !== undefined && w.prob_stress !== null)
            .map((w) => ({ value: Math.round(w.prob_stress * 100), date: new Date(w.timestamp) }));
    }, [orderedKeys, predictions]);

    const prediction = latest?.prediction;
    const label = prediction !== undefined && prediction !== null ? STRESS_LABELS[prediction] : latest?.label;
    const probStress = latest?.prob_stress;
    const probNormal = latest?.prob_normal;
    const trending = latest?.trending_toward_stress;
    const stateColor = prediction !== undefined && prediction !== null ? STRESS_COLORS[prediction] : COLORS.brand;

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: t.bg }]} edges={['top', 'left', 'right']}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
                <ScrollView contentContainerStyle={styles.scroll}>
                    <View style={styles.header}>
                        {showBack && (
                            <TouchableOpacity onPress={() => navigation.goBack()}>
                                <Text style={[styles.back, { color: COLORS.brand }]}>{'←'} Back</Text>
                            </TouchableOpacity>
                        )}
                        <Text style={[styles.title, { color: t.text }]}>Live HRV/GSR</Text>
                        <Text style={[styles.subtitle, { color: t.textMuted }]}>
                            Ring stress readings, live (wearable01)
                        </Text>
                    </View>

                    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
                        <Text style={[styles.label, { color: t.textSub }]}>Session ID</Text>
                        <TextInput
                            style={[styles.input, { color: t.text, borderColor: t.border }]}
                            value={sessionId}
                            editable={false}
                            placeholder="waiting for live session…"
                            placeholderTextColor={t.textMuted}
                        />
                        <Text style={[styles.hint, { color: t.textMuted }]}>
                            Follows the current live session automatically — no manual start needed.
                        </Text>

                        {watching && (
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
                        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
                            {!hasAny ? (
                                <Text style={[styles.waiting, { color: t.textMuted }]}>
                                    Waiting for first reading… (one window every 60s)
                                </Text>
                            ) : (
                                <>
                                    <View style={styles.stateRow}>
                                        <Text style={styles.stateEmoji}>
                                            {prediction !== undefined && prediction !== null ? STRESS_EMOJI[prediction] : '…'}
                                        </Text>
                                        <View style={{ flex: 1 }}>
                                            <Text style={[styles.stateLabel, { color: stateColor }]}>
                                                {label || 'Scoring…'}
                                            </Text>
                                            <Text style={[styles.stateProb, { color: t.textMuted }]}>
                                                {probStress !== undefined && probStress !== null
                                                    ? `${(probStress * 100).toFixed(0)}% P(stress)` : ''}
                                            </Text>
                                        </View>
                                    </View>

                                    <View style={styles.metaRow}>
                                        <Text style={[styles.metaLabel, { color: t.textSub }]}>P(normal)</Text>
                                        <Text style={[styles.metaValue, { color: t.text }]}>
                                            {probNormal !== undefined && probNormal !== null
                                                ? `${(probNormal * 100).toFixed(0)}%` : '—'}
                                        </Text>
                                    </View>

                                    <View style={styles.metaRow}>
                                        <Text style={[styles.metaLabel, { color: t.textSub }]}>Trending toward stress</Text>
                                        <Text style={[styles.metaValue, { color: t.text }]}>
                                            {trending === undefined || trending === null ? '—' : (trending ? 'Yes' : 'No')}
                                        </Text>
                                    </View>
                                </>
                            )}
                        </View>
                    )}

                    {watching && stressTrend.length > 1 && (
                        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
                            <Text style={[styles.label, { color: t.textSub, marginBottom: 12 }]}>
                                Session trendline — P(stress) per window (%)
                            </Text>
                            <LineChart
                                points={stressTrend}
                                color={stateColor}
                                width={TREND_CHART_WIDTH}
                                height={130}
                                fallback={<Text style={[styles.waiting, { color: t.textMuted }]}>Loading chart…</Text>}
                            />
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
});
