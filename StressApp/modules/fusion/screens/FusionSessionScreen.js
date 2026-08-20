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
import React, { useCallback, useRef, useState } from 'react';
import {
    View, Text, StyleSheet, TextInput,
    TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ref, onValue, off, set } from 'firebase/database';
import { db } from '../firebase';
import { useTheme } from '../../physiological/config/ThemeContext';
import { STRESS_COLORS, STRESS_LABELS, STRESS_EMOJI, FUSION_TREND_LABELS } from '../config/config';

function defaultSessionId() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `session_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T`
        + `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Picks the highest numeric window key present in a fusion_en/{sessionId}
 * snapshot object -- mirrors PhenotypingDashboard.jsx's pattern of sorting
 * entries and taking the latest. */
function latestWindow(windowsObj) {
    if (!windowsObj) return null;
    const keys = Object.keys(windowsObj).filter((k) => /^\d+$/.test(k));
    if (keys.length === 0) return null;
    keys.sort((a, b) => Number(a) - Number(b));
    return windowsObj[keys[keys.length - 1]];
}

export default function FusionSessionScreen({ navigation }) {
    const { isDark, theme: t, COLORS } = useTheme();
    const [sessionId, setSessionId] = useState(defaultSessionId());
    const [watching, setWatching] = useState(false);
    const [ended, setEnded] = useState(false);
    const [latest, setLatest] = useState(null);
    const [hasAnyWindow, setHasAnyWindow] = useState(false);
    const listenerRef = useRef(null);

    const startWatching = useCallback(() => {
        if (!sessionId.trim()) return;
        setEnded(false);
        setLatest(null);
        setHasAnyWindow(false);

        const sessionRef = ref(db, `fusion_en/${sessionId.trim()}`);
        const handler = onValue(sessionRef, (snapshot) => {
            const data = snapshot.val();
            setHasAnyWindow(!!data);
            setLatest(latestWindow(data));
        });
        listenerRef.current = { sessionRef, handler };
        setWatching(true);
    }, [sessionId]);

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
                                    <View style={styles.stateRow}>
                                        <Text style={styles.stateEmoji}>
                                            {label !== undefined && label !== null ? STRESS_EMOJI[label] : '…'}
                                        </Text>
                                        <View style={{ flex: 1 }}>
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
                                </>
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
    stateRow:     { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 18 },
    stateEmoji:   { fontSize: 40 },
    stateLabel:   { fontSize: 22, fontWeight: '900' },
    stateProb:    { fontSize: 13, marginTop: 2 },
    metaRow:      { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
    metaLabel:    { fontSize: 13, fontWeight: '600' },
    metaValue:    { fontSize: 13, fontWeight: '700' },
});
