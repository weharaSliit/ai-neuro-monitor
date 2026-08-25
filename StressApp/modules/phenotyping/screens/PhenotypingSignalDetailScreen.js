// ============================================================
// PhenotypingSignalDetailScreen.js -- RN port of the standalone app's
// SignalDetail.jsx. Shows the live value(s) for one signal (keyboard/
// scroll/app_switch/activity/screen), its baseline comparison, a recent-
// windows trend, and a plain-language explanation of what it measures.
// ============================================================
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ref, onValue, off } from 'firebase/database';
import { db } from '../firebase';
import { useTheme } from '../../physiological/config/ThemeContext';
import { useAuth } from '../../../context/AuthContext';

const SIGNAL_CONFIG = {
    keyboard: {
        title: '⌨️ Keyboard Patterns',
        measures: [
            { id: 'dwell', name: 'Dwell Time', unit: 'ms', color: '#E0A458',
              explanation: "Dwell time is how long you hold each key down when typing. When you're stressed, fingers tend to press keys for longer as muscle tension increases and fine motor control becomes less precise." },
            { id: 'flight', name: 'Flight Time', unit: 'ms', color: '#7FB596',
              explanation: 'Flight time is the gap between releasing one key and pressing the next. Longer flight times suggest slower cognitive processing, often linked to distraction or mental fatigue.' },
        ],
    },
    scroll: {
        title: '📜 Screen Scrolling',
        measures: [{ id: 'scroll_vel', name: 'Scroll Velocity', unit: 'px/s', color: '#7FB596',
            explanation: 'How fast you scroll through content. Faster scrolling than usual can indicate impatience or difficulty focusing — a subtle pre-stress marker.' }],
    },
    app_switch: {
        title: '🔀 App Switching Frequency',
        measures: [{ id: 'switch_rate', name: 'Switch Rate', unit: '/min', color: '#A895C9',
            explanation: 'How often you switch between apps. High switching indicates multitasking and fragmented attention.' }],
    },
    activity: {
        title: '🚶 Activity Context',
        measures: [{ id: 'motion', name: 'Motion Detected', unit: '', color: '#7FB596',
            explanation: 'Whether significant physical motion (like walking) is detected. Motion invalidates keystroke timing analysis for that window.' }],
    },
    screen: {
        title: '📱 Screen On/Off Times',
        measures: [{ id: 'unlocks', name: 'Unlock Frequency', unit: 'unlocks', color: '#E0A458',
            explanation: 'How often you unlock your phone. High unlock frequency, especially for very short sessions, is a strong behavioral marker for anxiety and checking behaviors.' }],
    },
};

function statusColor(status, COLORS) {
    if (status === 'anomalous') return COLORS.stress;
    if (status === 'elevated') return COLORS.warning;
    if (status === 'pending') return '#8B8478';
    return COLORS.normal;
}

export default function PhenotypingSignalDetailScreen({ route }) {
    const { theme: t, COLORS } = useTheme();
    const { user } = useAuth();
    const userId = user?.userId;
    const signalId = route?.params?.signalId || 'keyboard';
    const config = SIGNAL_CONFIG[signalId];

    const [measures, setMeasures] = useState(null);

    useEffect(() => {
        if (!userId || !config) return;
        const metricsRef = ref(db, `phenotyping/data_logs/${userId}`);
        const handler = onValue(metricsRef, (snapshot) => {
            const raw = snapshot.val();
            if (!raw) {
                setMeasures(config.measures.map((m) => ({ ...m, value: `-- ${m.unit}`, baseline: '--', status: 'pending' })));
                return;
            }
            const entries = Object.values(raw).slice(-10);
            const latest = entries[entries.length - 1];

            if (signalId === 'keyboard') {
                setMeasures([
                    { ...config.measures[0], value: `${Math.round(latest.avg_dwell || 0)} ms`, baseline: '120 ms',
                      status: (latest.avg_dwell || 0) > 150 ? 'anomalous' : (latest.avg_dwell || 0) > 130 ? 'elevated' : 'normal' },
                    { ...config.measures[1], value: `${Math.round(latest.avg_flight || 0)} ms`, baseline: '195 ms', status: 'normal' },
                ]);
            } else if (signalId === 'scroll') {
                setMeasures([{ ...config.measures[0], value: `${Math.round(latest.scroll_velocity || 0)} px/s`, baseline: '38 px/s',
                    status: (latest.scroll_velocity || 0) > 60 ? 'elevated' : 'normal' }]);
            } else if (signalId === 'app_switch') {
                setMeasures([{ ...config.measures[0], value: `${(latest.app_switch_rate || 0).toFixed(1)} /min`, baseline: '2.0 /min', status: 'normal' }]);
            } else if (signalId === 'activity') {
                setMeasures([{ ...config.measures[0], value: latest.data_valid === false ? 'Motion' : 'Stationary', baseline: '—',
                    status: latest.data_valid === false ? 'elevated' : 'normal' }]);
            } else if (signalId === 'screen') {
                setMeasures([{ ...config.measures[0], value: `${latest.unlocks_count || 0} unlocks`, baseline: '—',
                    status: (latest.unlocks_count || 0) > 30 ? 'elevated' : 'normal' }]);
            }
        });
        return () => off(metricsRef, 'value', handler);
    }, [userId, signalId]);

    if (!config) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: t.bg }]}>
                <Text style={{ color: t.textMuted, textAlign: 'center', marginTop: 40 }}>Signal not found</Text>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: t.bg }]} edges={['left', 'right']}>
            <ScrollView contentContainerStyle={styles.scroll}>
                {(measures || []).map((m, i) => (
                    <View key={i} style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                        <View style={styles.rowBetween}>
                            <Text style={[styles.measureName, { color: t.text }]}>{m.name}</Text>
                            <Text style={[styles.measureValue, { color: m.color }]}>{m.value}</Text>
                        </View>
                        <View style={styles.rowStart}>
                            <Text style={[styles.hint, { color: t.textMuted }]}>Baseline: {m.baseline}</Text>
                            <View style={[styles.statusPill, { backgroundColor: statusColor(m.status, COLORS) + '20' }]}>
                                <Text style={{ color: statusColor(m.status, COLORS), fontSize: 10, fontWeight: '800' }}>{m.status}</Text>
                            </View>
                        </View>
                        <View style={[styles.explainBox, { backgroundColor: t.bg }]}>
                            <Text style={[styles.explainText, { color: t.textMuted }]}>{m.explanation}</Text>
                        </View>
                    </View>
                ))}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    scroll: { padding: 20, paddingBottom: 40 },
    card: { borderRadius: 18, borderWidth: 1, padding: 18, marginBottom: 14 },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    rowStart: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
    measureName: { fontSize: 16, fontWeight: '800' },
    measureValue: { fontSize: 18, fontWeight: '900' },
    hint: { fontSize: 11 },
    statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
    explainBox: { borderRadius: 12, padding: 12 },
    explainText: { fontSize: 12, lineHeight: 18 },
});
