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
import { useFocusEffect } from '@react-navigation/native';
import { ref, onValue, off } from 'firebase/database';
import { db } from '../firebase';
import ScreenBackground from '../../shared/ScreenBackground';
import Card from '../../shared/Card';
import AvatarButton from '../../shared/AvatarButton';
import Icon, { NAMES } from '../../shared/Icon';
import { useTheme } from '../../physiological/config/ThemeContext';
import { COLORS } from '../../physiological/config/theme';
import { useAuth } from '../../../context/AuthContext';
import { API_BASE } from '../config/config';
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
        <Card style={styles.signalCard} accentColor={color}>
            <View style={styles.signalTop}>
                <Text style={styles.signalIcon}>{icon}</Text>
                <View style={{ flex: 1 }}>
                    <Text style={[styles.signalTitle, { color: t.text }]}>{title}</Text>
                    <Text style={[styles.signalSubtext, { color: t.textMuted }]}>{subtext}</Text>
                </View>
                <Text style={[styles.signalValue, { color }]}>{value}</Text>
            </View>
        </Card>
    );
}

function QuickAction({ icon, label, color, isDark, onPress }) {
    return (
        <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={{ flex: 1 }}>
            <View style={[styles.actionTile, {
                backgroundColor: color + '12',
                borderColor: color + '30',
            }]}>
                <Text style={styles.actionIcon}>{icon}</Text>
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

    return (
        <ScreenBackground>
            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backRow} activeOpacity={0.7}>
                    <Icon name={NAMES.back} size={20} color={COLORS.brand} />
                    <Text style={{ color: COLORS.brand, fontWeight: '700' }}>Overview</Text>
                </TouchableOpacity>

                {/* Plain title -- no fusion-style stress-colored hero here,
                    phenotyping is a separate non-physiological signal. */}
                <Text style={[styles.plainTitle, { color: t.text }]}>Digital Phenotyping</Text>

                {!onboarded && (
                    <TouchableOpacity
                        style={[styles.onboardBanner, { backgroundColor: COLORS.brandSoft, borderColor: COLORS.brand + '30' }]}
                        onPress={() => navigation.navigate('PhenotypingOnboarding')}
                        activeOpacity={0.85}
                    >
                        <Icon name="cellphone-check" size={24} color={COLORS.brand} />
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.onboardTitle, { color: t.text }]}>Set up phone statistics</Text>
                            <Text style={[styles.onboardSub, { color: t.textMuted }]}>Passive typing rhythm & activity context setup</Text>
                        </View>
                        <Icon name={NAMES.chevronRight} size={18} color={COLORS.brand} />
                    </TouchableOpacity>
                )}

                {/* Digital Signals Section */}
                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: t.text }]}>Passive Behavioral Signals</Text>
                    <Text style={[styles.sectionSub, { color: t.textMuted }]}>
                        Continuous non-intrusive smartphone usage patterns
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

                {/* Quick Actions */}
                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: t.text }]}>Self-Report Check-Ins</Text>
                    <View style={styles.actionsRow}>
                        <QuickAction icon="⚡" label="Quick Check" color={COLORS.warning} isDark={isDark}
                            onPress={() => navigation.navigate('PhenotypingEma', { initialTab: 'siss' })} />
                        <QuickAction icon="✨" label="Weekly PSS" color={COLORS.brand} isDark={isDark}
                            onPress={() => navigation.navigate('PhenotypingEma', { initialTab: 'pss4' })} />
                        <QuickAction icon="📈" label="Signal History" color={COLORS.normal} isDark={isDark}
                            onPress={() => navigation.navigate('PhenotypingSignalHistory')} />
                    </View>
                </View>

                <Text style={[styles.lastUpdated, { color: t.textMuted }]}>
                    {liveWindow ? `updated ${lastUpdated ? lastUpdated.split('_')[1]?.slice(0, 2) + ':' + lastUpdated.split('_')[1]?.slice(2, 4) : 'recently'}` : 'waiting for first reading…'}
                </Text>
            </ScrollView>
        </ScreenBackground>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    scroll: { padding: 20, paddingBottom: 40 },
    backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 14 },
    plainTitle: { fontSize: 22, fontWeight: '900', letterSpacing: -0.2, marginBottom: 14 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
    dateStr: { fontSize: 12, fontWeight: '700', marginBottom: 2 },
    greeting: { fontSize: 24, fontWeight: '900', letterSpacing: -0.3 },
    onboardBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, borderWidth: 1, padding: 14, marginTop: 12, marginBottom: 4 },
    onboardTitle: { fontSize: 13, fontWeight: '800' },
    onboardSub: { fontSize: 11, marginTop: 2 },
    scoreCard: { padding: 20, borderRadius: 24, marginVertical: 10 },
    gaugeWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
    scoreHalo: { width: 110, height: 110, borderRadius: 55, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
    dayHalo: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 20 },
    gaugeEmoji: { fontSize: 26, marginBottom: 2 },
    gaugeScore: { fontSize: 36, fontWeight: '900', letterSpacing: -1 },
    gaugeDay: { fontSize: 24, fontWeight: '900' },
    gaugeSub: { fontSize: 14, fontWeight: '800', letterSpacing: 0.2 },
    gaugeDelta: { fontSize: 11, fontWeight: '700', marginTop: 4 },
    dayBarsRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
    dayBarWrap: { alignItems: 'center' },
    dayBarFill: { width: 10, height: 30, borderRadius: 5 },
    dayBarLabel: { fontSize: 10, fontWeight: '700', marginTop: 5 },
    section: { marginBottom: 20 },
    sectionTitle: { fontSize: 15, fontWeight: '800', marginBottom: 2 },
    sectionSub: { fontSize: 12, marginBottom: 12 },
    signalCard: { borderRadius: 20, borderWidth: 1, padding: 16, marginBottom: 10 },
    signalTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    signalIcon: { fontSize: 22 },
    signalTitle: { fontSize: 14, fontWeight: '800' },
    signalSubtext: { fontSize: 11, marginTop: 2 },
    signalValue: { fontSize: 14, fontWeight: '800' },
    actionsRow: { flexDirection: 'row', gap: 10 },
    actionTile: { borderRadius: 18, borderWidth: 1, paddingVertical: 16, alignItems: 'center', gap: 6 },
    actionLabel: { fontSize: 11, fontWeight: '800', textAlign: 'center' },
    lastUpdated: { textAlign: 'center', fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8 },
});
