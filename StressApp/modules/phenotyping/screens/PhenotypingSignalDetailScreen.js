// ============================================================
// PhenotypingSignalDetailScreen.js -- RN port of the standalone app's
// SignalDetail.jsx. Shows the live value(s) for one signal (keyboard/
// scroll/app_switch/activity/screen), its baseline comparison, a recent-
// windows trend, and a plain-language explanation of what it measures.
// ============================================================
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import ScreenBackground from '../../shared/ScreenBackground';
import { ref, onValue, off } from 'firebase/database';
import { db } from '../firebase';
import { useTheme } from '../../physiological/config/ThemeContext';
import { COLORS as STATIC_COLORS } from '../../physiological/config/theme';
import Icon, { NAMES } from '../../shared/Icon';
import { usePhenotypingDeviceId } from '../utils/deviceIdentity';

// STATIC_COLORS (not useTheme()'s COLORS) since this config object lives at
// module scope, outside any component -- was previously hardcoded to the
// old sage palette's exact hex values, which silently went stale once this
// redesign's new "Calm Mist" palette landed. Importing the live COLORS
// object directly keeps it correct across any future palette change.
const SIGNAL_CONFIG = {
    keyboard: {
        title: '⌨️ Keyboard Patterns',
        measures: [
            { id: 'dwell', name: 'Dwell Time', unit: 'ms', color: STATIC_COLORS.warning,
              explanation: "Dwell time is how long you hold each key down when typing. When you're stressed, fingers tend to press keys for longer as muscle tension increases and fine motor control becomes less precise." },
            { id: 'flight', name: 'Flight Time', unit: 'ms', color: STATIC_COLORS.normal,
              explanation: 'Flight time is the gap between releasing one key and pressing the next. Longer flight times suggest slower cognitive processing, often linked to distraction or mental fatigue.' },
        ],
    },
    scroll: {
        title: '📜 Screen Scrolling',
        measures: [{ id: 'scroll_vel', name: 'Scroll Velocity', unit: 'px/s', color: STATIC_COLORS.normal,
            explanation: 'How fast you scroll through content. Faster scrolling than usual can indicate impatience or difficulty focusing — a subtle pre-stress marker.' }],
    },
    tilt: {
        title: '📐 Device Tilt Angle',
        measures: [{ id: 'tilt_angle', name: 'Tilt Angle', unit: '°', color: '#A895C9',
            explanation: 'The angle at which you hold your phone, measured by the accelerometer. Studies show people hunch over their phone (higher tilt angle) when stressed or anxious. Population mean ≈59° when calm.' }],
    },
    cpm: {
        title: '🔡 Typing Speed (CPM)',
        measures: [{ id: 'cpm', name: 'Characters Per Minute', unit: 'cpm', color: '#E0A458',
            explanation: 'How fast you type in this window. A significant drop in typing speed compared to your personal baseline can signal cognitive fatigue or mental overload, even before you consciously feel it.' }],
    },
    app_switch: {
        title: '🔀 App Switching Frequency',
        measures: [{ id: 'switch_rate', name: 'Switch Rate', unit: '/min', color: STATIC_COLORS.gsr,
            explanation: 'How often you switch between apps. High switching indicates multitasking and fragmented attention.' }],
    },
    activity: {
        title: '🚶 Activity Context',
        measures: [{ id: 'motion', name: 'Motion Detected', unit: '', color: STATIC_COLORS.normal,
            explanation: 'Whether significant physical motion (like walking) is detected. Motion invalidates keystroke timing analysis for that window.' }],
    },
    screen: {
        title: '📱 Screen On/Off Times',
        measures: [{ id: 'unlocks', name: 'Unlock Frequency', unit: 'unlocks', color: STATIC_COLORS.warning,
            explanation: 'How often you unlock your phone. High unlock frequency, especially for very short sessions, is a strong behavioral marker for anxiety and checking behaviors.' }],
    },
};

function statusColor(status, COLORS) {
    if (status === 'anomalous') return COLORS.stress;
    if (status === 'elevated') return COLORS.warning;
    if (status === 'pending') return COLORS.light.textSub;
    return COLORS.normal;
}

export default function PhenotypingSignalDetailScreen({ navigation, route }) {
    const { theme: t, COLORS } = useTheme();
    const deviceId = usePhenotypingDeviceId();
    const signalId = route?.params?.signalId || 'keyboard';
    const config = SIGNAL_CONFIG[signalId];

    const [measures, setMeasures] = useState(null);
    // Personal baselines from Firebase — populated after 7-day calibration.
    // Until calibration completes, bl is null and we fall back to the
    // Kaggle population means as the displayed baseline string.
    const [bl, setBl] = useState(null);

    // ── Baseline listener ────────────────────────────────────────────────────
    useEffect(() => {
        if (!deviceId) return;
        const blRef = ref(db, `phenotyping/users/${deviceId}/baselines`);
        const handler = onValue(blRef, (snap) => {
            setBl(snap.val() || null);
        });
        return () => off(blRef, 'value', handler);
    }, [deviceId]);

    // ── Helper: format a personal baseline mean with fallback ────────────────
    // Returns e.g. "134 ms (personal)" if calibrated, or "120 ms (pop. avg)" if not.
    function fmtBaseline(fieldKey, decimals, unit, populationFallback) {
        const mean = bl?.[fieldKey]?.mean;
        if (mean != null && mean > 0) {
            const val = decimals === 0 ? Math.round(mean) : mean.toFixed(decimals);
            return `${val} ${unit} (personal)`;
        }
        return `${populationFallback} (pop. avg)`;
    }

    useEffect(() => {
        if (!deviceId || !config) return;
        const metricsRef = ref(db, `phenotyping/data_logs/${deviceId}`);
        const handler = onValue(metricsRef, (snapshot) => {
            const raw = snapshot.val();
            if (!raw) {
                setMeasures(config.measures.map((m) => ({ ...m, value: `-- ${m.unit}`, baseline: '--', status: 'pending' })));
                return;
            }
            const entries = Object.values(raw).slice(-10);
            const latest = entries[entries.length - 1];

            if (signalId === 'keyboard') {
                // Personal baseline from Firebase, or Kaggle population mean as fallback
                const dwellMean  = bl?.avg_dwell?.mean  || 5.74;   // Kaggle mean in ms (stored as ms)
                const flightMean = bl?.avg_flight?.mean || 917.46; // Kaggle mean in ms
                setMeasures([
                    { ...config.measures[0],
                      value:    `${Math.round(latest.avg_dwell || 0)} ms`,
                      baseline: fmtBaseline('avg_dwell', 0, 'ms', '5.74 ms'),
                      // anomalous if >30% above personal mean; elevated if >15%
                      status:   (latest.avg_dwell || 0) > dwellMean * 1.30 ? 'anomalous'
                              : (latest.avg_dwell || 0) > dwellMean * 1.15 ? 'elevated' : 'normal' },
                    { ...config.measures[1],
                      value:    `${Math.round(latest.avg_flight || 0)} ms`,
                      baseline: fmtBaseline('avg_flight', 0, 'ms', '917 ms'),
                      status:   (latest.avg_flight || 0) > flightMean * 1.20 ? 'elevated' : 'normal' },
                ]);
            } else if (signalId === 'scroll') {
                const scrollMean = bl?.scroll_velocity?.mean || 922.39;
                setMeasures([{ ...config.measures[0],
                    value:    `${Math.round(latest.scroll_velocity || 0)} px/s`,
                    baseline: fmtBaseline('scroll_velocity', 0, 'px/s', '922 px/s'),
                    status:   (latest.scroll_velocity || 0) > scrollMean * 1.30 ? 'elevated' : 'normal' }]);
            } else if (signalId === 'tilt') {
                const tiltMean = bl?.tilt_angle?.mean || 59.09;
                setMeasures([{ ...config.measures[0],
                    value:    `${Math.round(latest.tilt_angle || 0)}°`,
                    baseline: fmtBaseline('tilt_angle', 1, '°', '59.1°'),
                    status:   (latest.tilt_angle || 0) > tiltMean * 1.30 ? 'elevated' : 'normal' }]);
            } else if (signalId === 'cpm') {
                const cpmMean = bl?.cpm?.mean || 39.40;
                setMeasures([{ ...config.measures[0],
                    value:    `${Math.round(latest.cpm || 0)} cpm`,
                    baseline: fmtBaseline('cpm', 1, 'cpm', '39.4 cpm'),
                    // elevated if typing speed drops more than 40% below personal mean
                    status:   (latest.cpm || 0) < cpmMean * 0.60 && (latest.avg_dwell || 0) > 0 ? 'elevated' : 'normal' }]);
            } else if (signalId === 'app_switch') {
                const switchMean = bl?.app_switch_rate?.mean;
                const switchBaseline = switchMean ? `${switchMean.toFixed(1)} /min (personal)` : '2.0 /min (pop. avg)';
                setMeasures([{ ...config.measures[0],
                    value:    `${(latest.app_switch_rate || 0).toFixed(1)} /min`,
                    baseline: switchBaseline,
                    status:   'normal' }]);
            } else if (signalId === 'activity') {
                setMeasures([{ ...config.measures[0],
                    value:  latest.data_valid === false ? 'Motion' : 'Stationary',
                    baseline: '—',
                    status: latest.data_valid === false ? 'elevated' : 'normal' }]);
            } else if (signalId === 'screen') {
                setMeasures([{ ...config.measures[0],
                    value:    `${latest.unlocks_count || 0} unlocks`,
                    baseline: '—',
                    status:   (latest.unlocks_count || 0) > 30 ? 'elevated' : 'normal' }]);
            }
        });
        return () => off(metricsRef, 'value', handler);
    }, [deviceId, signalId, bl]);   // re-run when bl changes (calibration arrives mid-session)


    if (!config) {
        return (
            <ScreenBackground>
                <Text style={{ color: t.textMuted, textAlign: 'center', marginTop: 40 }}>Signal not found</Text>
            </ScreenBackground>
        );
    }

    return (
        <ScreenBackground edges={['left', 'right']}>
            {/* Header row */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
                    <Icon name={NAMES.back} size={22} color={COLORS.brand} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: t.text }]}>
                    {config?.title || 'Signal Detail'}
                </Text>
                <View style={{ width: 22 }} />
            </View>

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
        </ScreenBackground>
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
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 },
    backBtn: { padding: 4 },
    headerTitle: { fontSize: 16, fontWeight: '900', letterSpacing: -0.2 },
});
