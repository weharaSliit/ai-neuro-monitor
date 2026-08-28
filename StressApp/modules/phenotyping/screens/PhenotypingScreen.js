// ============================================================
// PhenotypingScreen.js -- RN port of the standalone phenotyping app's
// PhenotypingDashboard.jsx (src/pages/PhenotypingDashboard.jsx), as part
// of merging phenotyping into StressApp itself (see the "Bring
// Phenotyping Into StressApp" plan). Reuses StressApp's existing
// SafeAreaView/ScrollView/card patterns (matching Ringscreen.js/
// DashboardScreen.js) instead of the original's Tailwind classes.
//
// Data sources unchanged from the original: phenotyping/predictions/
// {deviceId} and phenotyping/data_logs/{deviceId} in Firebase RTDB, both
// written by KeystrokeCollectorService.java (see that file) and by
// backend/phenotyping_behavior/app.py's /behavior/predict route. {deviceId}
// is this device's own randomly-generated Digital Phenotyping tracking id
// (see modules/phenotyping/utils/deviceIdentity.js) -- NOT the shared
// account login id, since behavioral biometrics are inherently per-device.
// ============================================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, NativeModules, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ref, onValue, off, get, update } from 'firebase/database';
import { db } from '../firebase';
import ScreenBackground from '../../shared/ScreenBackground';
import Card from '../../shared/Card';
import AvatarButton from '../../shared/AvatarButton';
import StatusDot from '../../shared/StatusDot';
import Icon, { NAMES } from '../../shared/Icon';
import { useTheme } from '../../physiological/config/ThemeContext';
import { COLORS } from '../../physiological/config/theme';
import { useAuth } from '../../../context/AuthContext';
import { API_BASE } from '../config/config';
import { getCalibrationStatus, markCalibrated, shouldAttemptCalibrateToday } from '../utils/calibrationStatus';
import { isPhenotypingOnboarded } from './PhenotypingOnboardingScreen';
import { usePhenotypingDeviceId } from '../utils/deviceIdentity';

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
    const userName = user?.name || 'there';
    // This device's own Digital Phenotyping tracking id -- created
    // automatically (once, ever) the first time this screen mounts on this
    // device. See modules/phenotyping/utils/deviceIdentity.js.
    const deviceId = usePhenotypingDeviceId();

    const [calibStatus, setCalibStatus] = useState(null);
    const [onboarded, setOnboarded] = useState(true); // assume true until checked, avoids a flash
    const [liveWindow, setLiveWindow] = useState(null);
    const [recentLogs, setRecentLogs] = useState([]);
    const [lastUpdated, setLastUpdated] = useState(null);
    // Whether the PhenoCare AccessibilityService is actually enabled right now.
    // Checked on every screen focus so users know immediately if they revoked it.
    const [accessibilityOn, setAccessibilityOn] = useState(true); // optimistic until first check

    // Seed this device's phenotyping profile in Firebase the first time its
    // tracking id resolves -- guarantees phenotyping/users/{deviceId}/name
    // exists from day 1 (backend/phenotyping_behavior/firebase_service.py's
    // get_user_display_name() reads it for the shared fusion_engine key),
    // instead of only appearing after 7-day calibration.
    useEffect(() => {
        if (!deviceId) return;
        (async () => {
            try {
                const profileRef = ref(db, `phenotyping/users/${deviceId}`);
                const snapshot = await get(profileRef);
                if (!snapshot.exists()) {
                    await update(profileRef, {
                        name: userName,
                        is_calibrated: false,
                        created_at: new Date().toISOString(),
                    });
                }
            } catch (err) {
                console.log('[phenotyping_init] failed:', err.message);
            }
        })();
    }, [deviceId, userName]);

    const refreshCalibStatus = useCallback(async () => {
        if (!deviceId) return;
        setCalibStatus(await getCalibrationStatus(deviceId));
    }, [deviceId]);

    useFocusEffect(useCallback(() => { refreshCalibStatus(); }, [refreshCalibStatus]));

    useFocusEffect(useCallback(() => {
        if (!deviceId) return;
        isPhenotypingOnboarded(deviceId).then(setOnboarded);
    }, [deviceId]));

    // Live Accessibility check — re-runs every time the screen comes into focus
    // so that users who revoke the permission in Settings see an immediate warning.
    // Uses Android's AccessibilityManager via NativeModules.PhenotypingIdentity;
    // the method is a no-op on iOS (accessibility capture is Android-only).
    useFocusEffect(useCallback(() => {
        if (Platform.OS !== 'android') return;
        const { PhenotypingIdentity } = NativeModules;
        if (!PhenotypingIdentity?.isAccessibilityServiceEnabled) return;
        PhenotypingIdentity.isAccessibilityServiceEnabled()
            .then((enabled) => setAccessibilityOn(!!enabled))
            .catch(() => setAccessibilityOn(true)); // assume OK if method missing
    }, []));

    // Auto-trigger real calibration once 7+ days have passed and the
    // backend hasn't confirmed it yet -- same logic/throttle as the
    // original PhenotypingDashboard.jsx.
    useEffect(() => {
        if (!deviceId || !calibStatus || calibStatus.isCalibrated || calibStatus.dayNumber < 7) return;
        (async () => {
            if (!(await shouldAttemptCalibrateToday(deviceId))) return;
            try {
                const res = await fetch(`${API_BASE}/behavior/calibrate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id: deviceId, name: userName }),
                });
                const data = await res.json();
                if (res.ok && data.status === 'calibrated') {
                    await markCalibrated(deviceId);
                    refreshCalibStatus();
                }
            } catch {
                // will retry tomorrow via shouldAttemptCalibrateToday
            }
        })();
    }, [deviceId, userName, calibStatus, refreshCalibStatus]);

    // Live behavioral window
    useEffect(() => {
        if (!deviceId) return;
        const logsRef = ref(db, `phenotyping/data_logs/${deviceId}`);
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
    }, [deviceId]);


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

    const { statusMainColor, statusLabel, statusEmoji } = useMemo(() => {
        if (!calibStatus?.isCalibrated) {
            return {
                statusMainColor: COLORS.brand,
                statusLabel: 'CALIBRATING',
                statusEmoji: '⚖️',
            };
        }
        const avgDwell = liveWindow?.avg_dwell || 0;
        if (avgDwell > 150) {
            return {
                statusMainColor: COLORS.stress,
                statusLabel: 'STRESS',
                statusEmoji: '😰',
            };
        } else if (avgDwell > 130) {
            return {
                statusMainColor: COLORS.warning,
                statusLabel: 'PRE-STRESS',
                statusEmoji: '😐',
            };
        } else {
            return {
                statusMainColor: COLORS.normal,
                statusLabel: 'NORMAL',
                statusEmoji: '😊',
            };
        }
    }, [calibStatus, liveWindow, COLORS]);

    return (
        <ScreenBackground>
            {/* Top custom header bar */}
            <View style={styles.topHeader}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backRow} activeOpacity={0.7}>
                    <Icon name={NAMES.back} size={20} color={COLORS.brand} />
                    <Text style={{ color: COLORS.brand, fontWeight: '700' }}>Overview</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    onPress={() => navigation.navigate('PhenotypingEma', { initialTab: 'siss' })}
                    style={[styles.emaHeaderBtn, { backgroundColor: COLORS.brandSoft }]}
                    activeOpacity={0.8}
                >
                    <Icon name="clipboard-text-outline" size={16} color={COLORS.brand} />
                    <Text style={[styles.emaHeaderBtnText, { color: COLORS.brand }]}>EMA Survey</Text>
                </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
                <Text style={[styles.plainTitle, { color: t.text }]}>Digital Phenotyping</Text>

                {/* Behavioral Sensor Telemetry Status Card (matches Ring/EEG Summary Screens) */}
                <Card accentColor={accessibilityOn ? COLORS.normal : COLORS.warning} elevated style={styles.hwCard}>
                    <View style={styles.rowBetween}>
                        <View style={styles.rowGap}>
                            <Icon name="cellphone-cog" size={18} color={accessibilityOn ? COLORS.normal : COLORS.warning} />
                            <Text style={[styles.cardTitle, { color: t.text, marginBottom: 0 }]}>Behavioral Sensor Status</Text>
                        </View>
                        <View style={[styles.statusPill, { backgroundColor: accessibilityOn ? COLORS.normalSoft : COLORS.warningSoft }]}>
                            <StatusDot color={accessibilityOn ? COLORS.normal : COLORS.warning} active={accessibilityOn} size={8} />
                            <Text style={[styles.statusPillText, { color: accessibilityOn ? COLORS.normalDark : COLORS.warningDark }]}>
                                {accessibilityOn ? 'Streaming' : 'Offline'}
                            </Text>
                        </View>
                    </View>
                    <Text style={[styles.cardSub, { color: t.textMuted, marginTop: 10 }]}>
                        {accessibilityOn 
                            ? `PhenoCare Sensor is actively recording typing cadence & window switching rate (Device: ${deviceId?.slice(0, 8) || 'unknown'}...)`
                            : 'PhenoCare Sensor is offline. Please enable the service in Settings → Accessibility.'}
                    </Text>
                </Card>

                {/* Calibration / Stress State Circle Card */}
                <Card style={styles.scoreCard} accentColor={statusMainColor}>
                    <View style={styles.gaugeWrap}>
                        <View style={[styles.scoreHalo, { borderColor: statusMainColor + '40' }]}>
                            {calibStatus?.isCalibrated ? (
                                <View style={styles.centerAlign}>
                                    <Text style={styles.gaugeEmoji}>{statusEmoji}</Text>
                                    <Text style={[styles.gaugeStatusLabel, { color: statusMainColor }]}>
                                        {statusLabel}
                                    </Text>
                                </View>
                            ) : (
                                <View style={styles.centerAlign}>
                                    <Text style={[styles.gaugeDay, { color: COLORS.brand }]}>
                                        Day {calibStatus?.dayNumber || 1}
                                    </Text>
                                    <Text style={[styles.gaugeSub, { color: t.textMuted }]}>
                                        of 7
                                    </Text>
                                </View>
                            )}
                        </View>
                        
                        <View style={styles.gaugeInfoBlock}>
                            <Text style={[styles.gaugeTitle, { color: t.text }]}>
                                {calibStatus?.isCalibrated ? "Calibrated User Status" : "Calibration Progress"}
                            </Text>
                            <Text style={[styles.gaugeDesc, { color: t.textMuted }]}>
                                {calibStatus?.isCalibrated 
                                    ? `Current status is ${statusLabel.toLowerCase()} based on real-time keystroke rhythm & app multitasking.`
                                    : `Currently gathering your baseline behavioral signals. Day ${calibStatus?.dayNumber || 1} calibration active.`}
                            </Text>
                        </View>
                    </View>
                </Card>

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
                            onPress={() => navigation.navigate('PhenotypingSignalHistory', { signalId: s.id })}
                        >
                            <SignalCard {...s} t={t} />
                        </TouchableOpacity>
                    ))}
                </View>

                {/* Quick Actions */}
                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: t.text }]}>Quick Action</Text>
                    <View style={styles.actionsRow}>
                        <QuickAction icon="📈" label="Patterns" color={COLORS.brand} isDark={isDark}
                            onPress={() => navigation.navigate('PhenotypingAnalysis', { initialTab: 'patterns' })} />
                        <QuickAction icon="⚡" label="Analysis" color={COLORS.normal} isDark={isDark}
                            onPress={() => navigation.navigate('PhenotypingAnalysis', { initialTab: 'overview' })} />
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
    scroll: { paddingBottom: 40 },
    topHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 20, marginTop: 12, marginBottom: 8 },
    emaHeaderBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
    emaHeaderBtnText: { fontSize: 11, fontWeight: '800' },
    backRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    plainTitle: { fontSize: 22, fontWeight: '900', letterSpacing: -0.2, marginHorizontal: 20, marginBottom: 14 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
    dateStr: { fontSize: 12, fontWeight: '700', marginBottom: 2 },
    greeting: { fontSize: 24, fontWeight: '900', letterSpacing: -0.3 },
    onboardBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, borderWidth: 1, padding: 14, marginHorizontal: 20, marginTop: 8, marginBottom: 4 },
    onboardTitle: { fontSize: 13, fontWeight: '800' },
    onboardSub: { fontSize: 11, marginTop: 2 },
    hwCard: { marginHorizontal: 20, marginVertical: 8, padding: 18, borderRadius: 22 },
    rowGap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
    statusPillText: { fontSize: 11, fontWeight: '800' },
    cardTitle: { fontSize: 15, fontWeight: '800' },
    cardSub: { fontSize: 12 },
    scoreCard: { marginHorizontal: 20, marginVertical: 8, padding: 18, borderRadius: 22 },
    gaugeWrap: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 4 },
    scoreHalo: { width: 90, height: 90, borderRadius: 45, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
    centerAlign: { alignItems: 'center', justifyContent: 'center' },
    gaugeEmoji: { fontSize: 22 },
    gaugeStatusLabel: { fontSize: 11, fontWeight: '900', letterSpacing: -0.2, marginTop: 2 },
    gaugeDay: { fontSize: 18, fontWeight: '900' },
    gaugeSub: { fontSize: 10, fontWeight: '800' },
    gaugeInfoBlock: { flex: 1 },
    gaugeTitle: { fontSize: 14, fontWeight: '800', marginBottom: 4 },
    gaugeDesc: { fontSize: 11.5, lineHeight: 16 },
    section: { marginHorizontal: 20, marginVertical: 10 },
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
    actionIcon: { fontSize: 20 },
    actionLabel: { fontSize: 11, fontWeight: '800', textAlign: 'center' },
    lastUpdated: { textAlign: 'center', fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 12 },
});
