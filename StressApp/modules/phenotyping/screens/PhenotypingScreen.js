// ============================================================
// PhenotypingScreen.js -- RN port of the standalone phenotyping app's
// PhenotypingDashboard.jsx (src/pages/PhenotypingDashboard.jsx), as part
// of merging phenotyping into StressApp itself (see the "Bring
// Phenotyping Into StressApp" plan). Reuses StressApp's existing
// SafeAreaView/ScrollView/card patterns (matching Ringscreen.js/
// DashboardScreen.js) instead of the original's Tailwind classes.
//
// Data sources unchanged from the original: phenotyping/predictions/
// {userId} and phenotyping/data_logs/{userId} in Firebase RTDB, both
// written by KeystrokeCollectorService.java (see that file) and by
// backend/phenotyping_behavior/app.py's /behavior/predict route.
// ============================================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ref, onValue, off, query, limitToLast, get } from 'firebase/database';
import { db } from '../firebase';
import { useTheme } from '../../physiological/config/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { API_BASE, MOOD_EMOJI, gaugeColor } from '../config/config';
import { getCalibrationStatus, markCalibrated, shouldAttemptCalibrateToday } from '../utils/calibrationStatus';
import { isPhenotypingOnboarded } from './PhenotypingOnboardingScreen';

function getGreeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
}

function getDateStr() {
    return new Date().toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
}

function SignalCard({ icon, title, value, subtext, color, t }) {
    return (
        <View style={[styles.signalCard, { backgroundColor: t.surface, borderColor: t.border }]}>
            <View style={styles.signalTop}>
                <Text style={styles.signalIcon}>{icon}</Text>
                <View style={{ flex: 1 }}>
                    <Text style={[styles.signalTitle, { color: t.text }]}>{title}</Text>
                    <Text style={[styles.signalSubtext, { color: t.textMuted }]}>{subtext}</Text>
                </View>
                <Text style={[styles.signalValue, { color }]}>{value}</Text>
            </View>
        </View>
    );
}

function QuickAction({ icon, label, color, isDark, onPress }) {
    return (
        <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={{ flex: 1 }}>
            <View style={[styles.actionTile, {
                backgroundColor: isDark ? color + '10' : color + '08',
                borderColor: color + '30',
            }]}>
                <Text style={{ fontSize: 22 }}>{icon}</Text>
                <Text style={[styles.actionLabel, { color }]}>{label}</Text>
            </View>
        </TouchableOpacity>
    );
}

export default function PhenotypingScreen({ navigation }) {
    const { isDark, theme: t, COLORS } = useTheme();
    const { user } = useAuth();
    const userId = user?.userId;
    const userName = user?.name || 'there';

    const [calibStatus, setCalibStatus] = useState(null);
    const [onboarded, setOnboarded] = useState(true); // assume true until checked, avoids a flash
    const [stressData, setStressData] = useState({ score: 0, label: 'Waiting for data' });
    const [prevScore, setPrevScore] = useState(null);
    const [liveWindow, setLiveWindow] = useState(null);
    const [recentLogs, setRecentLogs] = useState([]);
    const [lastUpdated, setLastUpdated] = useState(null);

    const refreshCalibStatus = useCallback(async () => {
        if (!userId) return;
        setCalibStatus(await getCalibrationStatus(userId));
    }, [userId]);

    useFocusEffect(useCallback(() => { refreshCalibStatus(); }, [refreshCalibStatus]));

    useFocusEffect(useCallback(() => {
        if (!userId) return;
        isPhenotypingOnboarded(userId).then(setOnboarded);
    }, [userId]));

    // Auto-trigger real calibration once 7+ days have passed and the
    // backend hasn't confirmed it yet -- same logic/throttle as the
    // original PhenotypingDashboard.jsx.
    useEffect(() => {
        if (!userId || !calibStatus || calibStatus.isCalibrated || calibStatus.dayNumber < 7) return;
        (async () => {
            if (!(await shouldAttemptCalibrateToday(userId))) return;
            try {
                const res = await fetch(`${API_BASE}/behavior/calibrate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id: userId, name: userName }),
                });
                const data = await res.json();
                if (res.ok && data.status === 'calibrated') {
                    await markCalibrated(userId);
                    refreshCalibStatus();
                }
            } catch {
                // will retry tomorrow via shouldAttemptCalibrateToday
            }
        })();
    }, [userId, userName, calibStatus, refreshCalibStatus]);

    // Live stress score
    useEffect(() => {
        if (!userId) return;
        const predictionsRef = query(ref(db, `phenotyping/predictions/${userId}`), limitToLast(2));
        const handler = onValue(predictionsRef, (snapshot) => {
            const val = snapshot.val();
            if (!val) return;
            const entries = Object.values(val);
            const latest = entries[entries.length - 1];
            setPrevScore(entries.length >= 2 ? entries[entries.length - 2].stress_score : null);
            setStressData({ score: latest.stress_score, label: latest.label });
        });
        return () => off(predictionsRef, 'value', handler);
    }, [userId]);

    // Live behavioral window
    useEffect(() => {
        if (!userId) return;
        const logsRef = ref(db, `phenotyping/data_logs/${userId}`);
        const handler = onValue(logsRef, (snapshot) => {
            const raw = snapshot.val();
            if (!raw) return;
            const entries = Object.entries(raw).sort((a, b) => a[0].localeCompare(b[0]));
            const [latestKey, latestData] = entries[entries.length - 1];
            setLiveWindow(latestData);
            setRecentLogs(entries.map((e) => e[1]).slice(-10));
            setLastUpdated(latestKey);
        });
        return () => off(logsRef, 'value', handler);
    }, [userId]);

    const isCalibrating = calibStatus?.phase === 'calibration';
    const moodKey = isCalibrating ? 'Calibrating' : (stressData.label || 'Normal');
    const mood = MOOD_EMOJI[moodKey] || MOOD_EMOJI.Normal;
    const color = gaugeColor(stressData.score, isCalibrating);
    const scorePercent = Math.round((stressData.score || 0) * 100);

    const digitalSignals = useMemo(() => {
        if (!liveWindow) {
            return [
                { id: 'keyboard', icon: '⌨️', title: 'Keyboard Patterns', value: '— ms', subtext: 'Typing rhythm & key press duration' },
                { id: 'app_switch', icon: '📱', title: 'Screen Activity', value: '— /min', subtext: 'App switching rate & multitasking' },
                { id: 'scroll', icon: '📜', title: 'Screen Scrolling', value: '— px/s', subtext: 'Scroll speed & frequency patterns' },
                { id: 'tilt', icon: '📐', title: 'Device Tilt', value: '— °', subtext: 'Phone holding angle from accelerometer' },
                { id: 'cpm', icon: '🔡', title: 'Typing Speed', value: '— cpm', subtext: 'Characters per minute this window' },
                { id: 'activity', icon: '🚶', title: 'Activity Context', value: '—', subtext: 'Physical activity detection & noise gate' },
            ].map((s) => ({ ...s, color: t.textMuted }));
        }
        const appSwitchRate = liveWindow.app_switch_rate !== undefined ? Number(liveWindow.app_switch_rate).toFixed(1) : '0.0';
        return [
            {
                id: 'keyboard', icon: '⌨️', title: 'Keyboard Patterns',
                value: `${Math.round(liveWindow.avg_dwell || 0)} ms`,
                subtext: 'Typing rhythm & key press duration',
                color: (liveWindow.avg_dwell || 0) > 150 ? COLORS.stress : (liveWindow.avg_dwell || 0) > 130 ? COLORS.warning : COLORS.normal,
            },
            {
                id: 'app_switch', icon: '📱', title: 'Screen Activity',
                value: `${appSwitchRate} /min`,
                subtext: 'App switching rate & multitasking',
                color: parseFloat(appSwitchRate) > 4.0 ? COLORS.stress : parseFloat(appSwitchRate) > 2.5 ? COLORS.warning : COLORS.normal,
            },
            {
                id: 'scroll', icon: '📜', title: 'Screen Scrolling',
                value: `${Math.round(liveWindow.scroll_velocity || 0)} px/s`,
                subtext: 'Scroll speed & frequency patterns',
                color: (liveWindow.scroll_velocity || 0) > 60 ? COLORS.warning : COLORS.normal,
            },
            {
                // Tilt angle from accelerometer: population mean ~59°, stressed = more hunched (higher angle)
                id: 'tilt', icon: '📐', title: 'Device Tilt',
                value: `${Math.round(liveWindow.tilt_angle || 0)}°`,
                subtext: 'Phone holding angle — stress hunching >80°',
                color: (liveWindow.tilt_angle || 0) > 90 ? COLORS.warning : COLORS.normal,
            },
            {
                // CPM: typing speed; low CPM during a normally-active window can signal cognitive fatigue
                id: 'cpm', icon: '🔡', title: 'Typing Speed',
                value: `${Math.round(liveWindow.cpm || 0)} cpm`,
                subtext: 'Characters/min — drop may indicate fatigue',
                color: (liveWindow.cpm || 0) < 10 && (liveWindow.avg_dwell || 0) > 0 ? COLORS.warning : COLORS.normal,
            },
            {
                id: 'activity', icon: '🚶', title: 'Activity Context',
                value: liveWindow.data_valid === false ? 'In motion' : 'Stationary',
                subtext: liveWindow.data_valid === false
                    ? 'Motion detected — window excluded from baseline'
                    : 'Physical activity detection & noise gate',
                color: liveWindow.data_valid === false ? COLORS.warning : COLORS.normal,
            },
        ];
    }, [liveWindow, COLORS, t.textMuted]);

    const scoreDelta = prevScore !== null ? Math.round((stressData.score - prevScore) * 100) : null;
    const deltaText = scoreDelta === null ? null
        : scoreDelta === 0 ? 'No change since last reading'
        : scoreDelta > 0 ? `↑ ${scoreDelta} pts since last reading`
        : `↓ ${Math.abs(scoreDelta)} pts since last reading`;

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: t.bg }]} edges={['top', 'left', 'right']}>
            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
                <View style={styles.header}>
                    <Text style={[styles.dateStr, { color: t.textMuted }]}>{getDateStr()}</Text>
                    <Text style={[styles.greeting, { color: t.text }]}>{getGreeting()}, {userName}</Text>
                </View>

                {!onboarded && (
                    <TouchableOpacity
                        style={[styles.onboardBanner, { backgroundColor: COLORS.brand + '15', borderColor: COLORS.brand + '40' }]}
                        onPress={() => navigation.navigate('PhenotypingOnboarding')}
                        activeOpacity={0.85}
                    >
                        <Text style={{ fontSize: 20 }}>👋</Text>
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.onboardTitle, { color: t.text }]}>Set up behavioral tracking</Text>
                            <Text style={[styles.onboardSub, { color: t.textMuted }]}>A few questions + one permission — 2 minutes</Text>
                        </View>
                        <Text style={{ color: COLORS.brand, fontSize: 18 }}>→</Text>
                    </TouchableOpacity>
                )}

                <View style={styles.gaugeWrap}>
                    {isCalibrating ? (
                        <>
                            <Text style={[styles.gaugeDay, { color: COLORS.brand }]}>DAY {calibStatus.dayNumber}</Text>
                            <Text style={[styles.gaugeSub, { color: t.textMuted }]}>CALIBRATING · {calibStatus.title}</Text>
                        </>
                    ) : (
                        <>
                            <Text style={styles.gaugeEmoji}>{mood.emoji}</Text>
                            <Text style={[styles.gaugeScore, { color: t.text }]}>{scorePercent}</Text>
                            <Text style={[styles.gaugeSub, { color }]}>{stressData.label}</Text>
                            {deltaText && <Text style={[styles.gaugeDelta, { color: t.textMuted }]}>{deltaText}</Text>}
                        </>
                    )}
                </View>

                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: t.text }]}>Digital Signals</Text>
                    <Text style={[styles.sectionSub, { color: t.textMuted }]}>
                        Live behavioral metrics from your device — tap any card for detail
                    </Text>
                    {digitalSignals.map((s, i) => (
                        <TouchableOpacity
                            key={i}
                            activeOpacity={0.8}
                            onPress={() => navigation.navigate('PhenotypingSignalDetail', { signalId: s.id })}
                        >
                            <SignalCard {...s} t={t} />
                        </TouchableOpacity>
                    ))}
                </View>

                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: t.text }]}>Quick Actions</Text>
                    <View style={styles.actionsRow}>
                        <QuickAction icon="⚡" label="Quick Check" color={COLORS.warning} isDark={isDark}
                            onPress={() => navigation.navigate('PhenotypingEma', { initialTab: 'siss' })} />
                        <QuickAction icon="✨" label="Weekly PSS" color={COLORS.brand} isDark={isDark}
                            onPress={() => navigation.navigate('PhenotypingEma', { initialTab: 'pss4' })} />
                        <QuickAction icon="📊" label="Analysis" color={COLORS.stress} isDark={isDark}
                            onPress={() => navigation.navigate('PhenotypingAnalysis')} />
                        <QuickAction icon="📈" label="History" color={COLORS.hrv} isDark={isDark}
                            onPress={() => navigation.navigate('PhenotypingSignalHistory')} />
                    </View>
                </View>

                <Text style={[styles.lastUpdated, { color: t.textMuted }]}>
                    {liveWindow ? `updated ${lastUpdated ? lastUpdated.split('_')[1]?.slice(0, 2) + ':' + lastUpdated.split('_')[1]?.slice(2, 4) : 'recently'}` : 'waiting for first reading…'}
                </Text>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    scroll: { padding: 20, paddingBottom: 40 },
    header: { marginBottom: 8 },
    dateStr: { fontSize: 12, marginBottom: 2 },
    greeting: { fontSize: 22, fontWeight: '900' },
    onboardBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, borderWidth: 1, padding: 14, marginTop: 12 },
    onboardTitle: { fontSize: 13, fontWeight: '800' },
    onboardSub: { fontSize: 11, marginTop: 2 },
    gaugeWrap: { alignItems: 'center', justifyContent: 'center', marginVertical: 24 },
    gaugeEmoji: { fontSize: 40, marginBottom: 4 },
    gaugeScore: { fontSize: 48, fontWeight: '900', letterSpacing: -1 },
    gaugeDay: { fontSize: 32, fontWeight: '900' },
    gaugeSub: { fontSize: 12, fontWeight: '700', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
    gaugeDelta: { fontSize: 11, fontWeight: '700', marginTop: 8 },
    section: { marginBottom: 24 },
    sectionTitle: { fontSize: 15, fontWeight: '800', marginBottom: 2 },
    sectionSub: { fontSize: 11, marginBottom: 12 },
    signalCard: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10 },
    signalTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    signalIcon: { fontSize: 20 },
    signalTitle: { fontSize: 13, fontWeight: '700' },
    signalSubtext: { fontSize: 11, marginTop: 2 },
    signalValue: { fontSize: 14, fontWeight: '800' },
    actionsRow: { flexDirection: 'row', gap: 8 },
    actionTile: { borderRadius: 16, borderWidth: 1, paddingVertical: 14, alignItems: 'center', gap: 6 },
    actionLabel: { fontSize: 10, fontWeight: '700', textAlign: 'center' },
    lastUpdated: { textAlign: 'center', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8 },
});
