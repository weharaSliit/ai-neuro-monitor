// ============================================================
// PhenotypingScreen.js -- Digital Phenotyping Dashboard
// Passive smartphone keystroke & interaction cadence telemetry.
// Streamlined interactive first-install Onboarding Modal matching the app UI:
// Step 1: Visual breadcrumb (Settings -> Accessibility -> PhenoCare Sensor) + Interactive Switch
// Step 2: 7-Day Calibration Roadmap with auto-transition to Dashboard.
// ============================================================
import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, NativeModules, Platform, Modal, Switch, Animated } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useFocusEffect } from '@react-navigation/native';
import { ref, onValue, off, get, update, query, limitToLast, orderByKey } from 'firebase/database';
import { db } from '../firebase';
import ScreenBackground from '../../shared/ScreenBackground';
import Card from '../../shared/Card';
import StatusDot from '../../shared/StatusDot';
import Icon, { NAMES } from '../../shared/Icon';
import { useTheme } from '../../physiological/config/ThemeContext';
import { COLORS } from '../../physiological/config/theme';
import { useAuth } from '../../../context/AuthContext';
import { API_BASE } from '../config/config';
import { getCalibrationStatus, markCalibrated, shouldAttemptCalibrateToday } from '../utils/calibrationStatus';
import { isPhenotypingOnboarded, markPhenotypingOnboarded } from './PhenotypingOnboardingScreen';
import { usePhenotypingDeviceId } from '../utils/deviceIdentity';

const { PhenotypingIdentity } = NativeModules;

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
    const deviceId = usePhenotypingDeviceId();

    // ── UI state
    const [onboarded, setOnboarded] = useState(true);
    const [showOnboardingModal, setShowOnboardingModal] = useState(false);
    const [onboardingStep, setOnboardingStep] = useState(1);
    const [sensorToggle, setSensorToggle] = useState(false);
    const [accessibilityOn, setAccessibilityOn] = useState(true);

    // ── Firebase data
    const [firebaseProfile, setFirebaseProfile] = useState(null);
    const [baselines, setBaselines] = useState(null);
    const [latestPrediction, setLatestPrediction] = useState(null);
    const [liveWindow, setLiveWindow] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(null);

    // ── Motion detection (walking/running) animated alert
    const isUserMoving = liveWindow?.data_valid === false;
    const motionBounce = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        if (isUserMoving) {
            Animated.loop(
                Animated.sequence([
                    Animated.timing(motionBounce, { toValue: -8, duration: 400, useNativeDriver: true }),
                    Animated.timing(motionBounce, { toValue: 0, duration: 400, useNativeDriver: true }),
                ])
            ).start();
        } else {
            motionBounce.setValue(0);
        }
    }, [isUserMoving]);

    // ── 30-second live ticker
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 30_000);
        return () => clearInterval(id);
    }, []);

    // ── Firebase profile (display_name, created_at, study_id, is_calibrated)
    useEffect(() => {
        if (!deviceId) return;
        const AS = require('@react-native-async-storage/async-storage').default;
        const profileRef = ref(db, `phenotyping/users/${deviceId}`);
        const handler = onValue(profileRef, async (snap) => {
            if (snap.exists()) {
                const p = snap.val();
                setFirebaseProfile(p);
                try { await AS.setItem(`@pheno_profile_${deviceId}`, JSON.stringify(p)); } catch {}
            } else {
                try { const c = await AS.getItem(`@pheno_profile_${deviceId}`); if (c) setFirebaseProfile(JSON.parse(c)); } catch {}
                update(profileRef, { display_name: user?.name || 'User', is_calibrated: false, created_at: new Date().toISOString() }).catch(() => {});
            }
        }, async () => {
            try { const c = await AS.getItem(`@pheno_profile_${deviceId}`); if (c) setFirebaseProfile(JSON.parse(c)); } catch {}
        });
        return () => off(profileRef, 'value', handler);
    }, [deviceId]);

    const displayName = firebaseProfile?.display_name || firebaseProfile?.name || user?.name || 'User';
    const studyId = firebaseProfile?.study_id || null;
    const surveyActivity = firebaseProfile?.survey_answers?.activity || null;
    const surveySchedule = firebaseProfile?.survey_answers?.schedule || null;

    // ── Calibration status from Firebase created_at (not AsyncStorage!)
    const liveCalibStatus = useMemo(() => {
        const createdAt = firebaseProfile?.created_at ? new Date(firebaseProfile.created_at) : null;
        if (!createdAt || isNaN(createdAt.getTime())) return null;
        const isCalibrated = !!(firebaseProfile?.is_calibrated);
        const daysElapsed = Math.floor(Math.max(0, now.getTime() - createdAt.getTime()) / 86_400_000);
        const dayNumber = Math.min(daysElapsed + 1, 99);
        return { dayNumber, isCalibrated, phase: isCalibrated ? 'active' : (dayNumber <= 7 ? 'calibration' : 'awaiting') };
    }, [firebaseProfile, now]);

    // ── Within-day progress: 1h → 24h fill
    const dayProgress = useMemo(() => {
        const mins = now.getHours() * 60 + now.getMinutes();
        return Math.min(1, Math.max(0.04, mins / 1440));
    }, [now]);

    // ── Onboarding check
    useFocusEffect(useCallback(() => {
        if (!deviceId) return;
        isPhenotypingOnboarded(deviceId).then((ok) => {
            setOnboarded(ok);
            if (!ok) { setShowOnboardingModal(true); setOnboardingStep(1); setSensorToggle(false); }
        });
    }, [deviceId]));

    // ── Accessibility sensor check
    useFocusEffect(useCallback(() => {
        if (Platform.OS !== 'android') return;
        if (!PhenotypingIdentity?.isAccessibilityServiceEnabled) return;
        PhenotypingIdentity.isAccessibilityServiceEnabled()
            .then((e) => setAccessibilityOn(!!e))
            .catch(() => setAccessibilityOn(true));
    }, []));

    // ── Baselines with offline cache
    useEffect(() => {
        if (!deviceId) return;
        const AS = require('@react-native-async-storage/async-storage').default;
        const blRef = ref(db, `phenotyping/users/${deviceId}/baselines`);
        const handler = onValue(blRef, async (snap) => {
            const val = snap.val();
            setBaselines(val || null);
            if (val) try { await AS.setItem(`@pheno_bl_${deviceId}`, JSON.stringify(val)); } catch {}
            else try { const c = await AS.getItem(`@pheno_bl_${deviceId}`); if (c) setBaselines(JSON.parse(c)); } catch {}
        }, async () => { try { const c = await AS.getItem(`@pheno_bl_${deviceId}`); if (c) setBaselines(JSON.parse(c)); } catch {} });
        return () => off(blRef, 'value', handler);
    }, [deviceId]);

    // ── Latest prediction: query only last 50 (not all 4,344!) sorted by timestamp
    useEffect(() => {
        if (!deviceId) return;
        const AS = require('@react-native-async-storage/async-storage').default;
        // limitToLast(50) = most recent 50 Firebase keys (which are timestamp-based)
        const predQ = query(ref(db, `phenotyping/predictions/${deviceId}`), orderByKey(), limitToLast(50));
        const handler = onValue(predQ, async (snap) => {
            const raw = snap.val();
            if (raw) {
                // Sort by ISO timestamp field to guarantee ordering
                const preds = Object.values(raw).sort((a, b) =>
                    new Date(a.timestamp || 0) - new Date(b.timestamp || 0)
                );
                const latest = preds[preds.length - 1] || null;
                setLatestPrediction(latest);
                if (latest) try { await AS.setItem(`@pheno_pred_${deviceId}`, JSON.stringify(latest)); } catch {}
            } else try { const c = await AS.getItem(`@pheno_pred_${deviceId}`); if (c) setLatestPrediction(JSON.parse(c)); } catch {}
        }, async () => { try { const c = await AS.getItem(`@pheno_pred_${deviceId}`); if (c) setLatestPrediction(JSON.parse(c)); } catch {} });
        return () => off(ref(db, `phenotyping/predictions/${deviceId}`), 'value', handler);
    }, [deviceId]);

    // ── Live behavioral window with offline cache
    useEffect(() => {
        if (!deviceId) return;
        const AS = require('@react-native-async-storage/async-storage').default;
        const logsRef = ref(db, `phenotyping/data_logs/${deviceId}`);
        const loadCache = async () => { try { const c = await AS.getItem(`@pheno_win_${deviceId}`); if (c) { const { k, d } = JSON.parse(c); setLiveWindow(d); setLastUpdated(k); } } catch {} };
        const handler = onValue(logsRef, async (snapshot) => {
            const raw = snapshot.val();
            if (raw) {
                const entries = Object.entries(raw).sort((a, b) => a[0].localeCompare(b[0]));
                const [k, d] = entries[entries.length - 1];
                setLiveWindow(d); setLastUpdated(k);
                try { await AS.setItem(`@pheno_win_${deviceId}`, JSON.stringify({ k, d })); } catch {}
            } else { await loadCache(); }
        }, loadCache);
        return () => off(logsRef, 'value', handler);
    }, [deviceId]);

    // ── Auto-calibrate after 7+ days
    useEffect(() => {
        if (!deviceId || !liveCalibStatus || liveCalibStatus.isCalibrated || liveCalibStatus.dayNumber < 7) return;
        (async () => {
            if (!(await shouldAttemptCalibrateToday(deviceId))) return;
            try {
                const res = await fetch(`${API_BASE}/behavior/calibrate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: deviceId, name: displayName }) });
                const data = await res.json();
                if (res.ok && data.status === 'calibrated') {
                    await markCalibrated(deviceId);
                    update(ref(db, `phenotyping/users/${deviceId}`), { is_calibrated: true }).catch(() => {});
                }
            } catch {}
        })();
    }, [deviceId, displayName, liveCalibStatus]);

    // ── Onboarding handlers
    const handleToggleSensor = (val) => {
        setSensorToggle(val);
        if (val) {
            if (Platform.OS === 'android' && PhenotypingIdentity) {
                PhenotypingIdentity.requestRuntimePermissions();
                PhenotypingIdentity.scheduleEmaNotifications();
            }
            setTimeout(() => setOnboardingStep(2), 450);
        }
    };

    const handleCompleteOnboarding = async () => {
        if (!deviceId) return;
        await markPhenotypingOnboarded(deviceId, { sensorEnabled: true });
        setOnboarded(true); setShowOnboardingModal(false);
    };

    // ── Signal cards: context-aware — meaningful labels, not raw zeros
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
        const bl = baselines || {};
        const getZ = (val, mean, std) => (!mean || !std || !val) ? 0 : Math.abs((val - mean) / std);
        const colorZ = (z, active) => {
            if (!active) return t.textMuted;
            return z > 2.0 ? COLORS.stress : z > 1.0 ? COLORS.warning : COLORS.normal;
        };
        // Convert /second → /min for display
        const appSwitchPerMin = Number(liveWindow.app_switch_rate || 0) * 60;
        const hasDwell = liveWindow.avg_dwell > 0;
        const hasScroll = liveWindow.scroll_velocity > 0;
        const hasTilt = liveWindow.tilt_angle > 0;
        const hasCpm = liveWindow.cpm > 0;
        const hasSwitch = appSwitchPerMin > 0.001;
        const isMoving = liveWindow.data_valid === false;
        // Baseline delta: shows "▲ +34% vs baseline"
        const delta = (val, mean) => {
            if (!mean || !val) return null;
            const pct = Math.round(((val - mean) / mean) * 100);
            if (Math.abs(pct) < 5) return null;
            return (pct > 0 ? '▲ +' : '▼ ') + pct + '% vs your baseline';
        };
        return [
            { id: 'keyboard', icon: '⌨️', title: 'Keyboard Patterns',
              value: `${Math.round(liveWindow.avg_dwell || 0)} ms`,
              subtext: hasDwell ? (delta(liveWindow.avg_dwell, bl.avg_dwell?.mean) || 'Typing rhythm & key press duration') : 'Typing rhythm & key press duration',
              color: colorZ(getZ(liveWindow.avg_dwell, bl.avg_dwell?.mean || 135, bl.avg_dwell?.std || 15), hasDwell) },
            { id: 'app_switch', icon: '📱', title: 'Screen Activity',
              value: `${appSwitchPerMin.toFixed(2)} /min`,
              subtext: hasSwitch ? 'App switching rate & multitasking' : 'No app switches in this window',
              color: appSwitchPerMin > 4 ? COLORS.stress : appSwitchPerMin > 2.5 ? COLORS.warning : (hasSwitch ? COLORS.normal : t.textMuted) },
            { id: 'scroll', icon: '📜', title: 'Screen Scrolling',
              value: `${Math.round(liveWindow.scroll_velocity || 0)} px/s`,
              subtext: hasScroll ? (delta(liveWindow.scroll_velocity, bl.scroll_velocity?.mean) || 'Scroll speed & frequency patterns') : 'Scroll speed & frequency patterns',
              color: colorZ(getZ(liveWindow.scroll_velocity, bl.scroll_velocity?.mean || 750, bl.scroll_velocity?.std || 120), hasScroll) },
            { id: 'tilt', icon: '📐', title: 'Device Tilt',
              value: `${Math.round(liveWindow.tilt_angle || 0)}°`,
              subtext: 'Phone holding angle & posture',
              color: colorZ(getZ(liveWindow.tilt_angle, bl.tilt_angle?.mean || 59, bl.tilt_angle?.std || 8), hasTilt) },
            { id: 'cpm', icon: '🔡', title: 'Typing Speed',
              value: `${Math.round(liveWindow.cpm || 0)} cpm`,
              subtext: 'Characters per minute this window',
              color: colorZ(getZ(liveWindow.cpm, bl.cpm?.mean || 42, bl.cpm?.std || 6), hasCpm) },
            { id: 'activity', icon: '🚶', title: 'Activity Context',
              value: isMoving ? 'In motion' : 'Stationary',
              subtext: isMoving ? '⚠️ Motion detected — signals recorded but excluded from baseline' : 'No significant motion detected',
              color: isMoving ? COLORS.warning : COLORS.normal },
        ];
    }, [liveWindow, baselines, COLORS, t.textMuted]);

    // ── Gauge status: CALIBRATING (days 1-7) → CALM/PRE-STRESS/HIGH STRESS (day 7+)
    const { statusMainColor, statusLabel, statusEmoji } = useMemo(() => {
        if (!liveCalibStatus?.isCalibrated) {
            return { statusMainColor: COLORS.brand, statusLabel: 'CALIBRATING', statusEmoji: '⚖️' };
        }
        if (latestPrediction) {
            const label = (latestPrediction.label || '').toLowerCase();
            const score = Number(latestPrediction.stress_score || 0);
            if (latestPrediction.is_anomaly || score > 0.85 || label.includes('high'))
                return { statusMainColor: COLORS.stress, statusLabel: 'HIGH STRESS', statusEmoji: '😰' };
            if (score > 0.6 || label.includes('pre'))
                return { statusMainColor: COLORS.warning, statusLabel: 'PRE-STRESS', statusEmoji: '😐' };
            if (score > 0.4)
                return { statusMainColor: COLORS.warning, statusLabel: 'ELEVATED', statusEmoji: '😕' };
            return { statusMainColor: COLORS.normal, statusLabel: 'CALM', statusEmoji: '😊' };
        }
        return { statusMainColor: COLORS.normal, statusLabel: 'NORMAL', statusEmoji: '😊' };
    }, [liveCalibStatus, latestPrediction, COLORS]);

    // ── Ring arc
    const ringProgress = liveCalibStatus?.isCalibrated
        ? (latestPrediction?.stress_score != null ? Math.min(1, Number(latestPrediction.stress_score)) : 0.3)
        : dayProgress;




    return (
        <ScreenBackground>
            {/* Top custom header bar */}
            <View style={styles.topHeader}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backRow} activeOpacity={0.7}>
                    <Icon name={NAMES.back} size={20} color={COLORS.brand} />
                    <Text style={{ color: COLORS.brand, fontWeight: '700' }}>Overview</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    onPress={() => navigation.navigate('PhenotypingEma', { initialTab: 'siss', mode: 'stress' })}
                    style={[styles.emaHeaderBtn, { backgroundColor: COLORS.brandSoft }]}
                    activeOpacity={0.8}
                >
                    <Icon name="clipboard-text-outline" size={16} color={COLORS.brand} />
                    <Text style={[styles.emaHeaderBtnText, { color: COLORS.brand }]}>EMA Survey</Text>
                </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
                {/* Page header with real user name */}
                <View style={{ marginHorizontal: 20, marginBottom: 12 }}>
                    <Text style={[styles.plainTitle, { color: t.text, marginBottom: 2 }]}>Digital Phenotyping</Text>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: t.textMuted }}>
                        {[
                            displayName ? `👤 ${displayName}` : '',
                            studyId ? `📋 ${studyId}` : '',
                        ].filter(Boolean).join('  ·  ')}
                    </Text>
                </View>

                {/* Unified Behavioral Sensor & Calibration Telemetry Card */}
                <Card accentColor={accessibilityOn ? statusMainColor : COLORS.warning} elevated style={styles.hwCard}>
                    {/* Top Status Header */}
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

                    <Text style={[styles.cardSub, { color: t.textMuted, marginTop: 8, marginBottom: 10 }]}>
                        {accessibilityOn
                            ? `Recording since ${firebaseProfile?.created_at ? new Date(firebaseProfile.created_at).toLocaleDateString() : '...'} — Device: ${deviceId?.slice(0, 8) || '...'}...`
                            : 'Sensor offline — enable in Settings → Accessibility.'}
                    </Text>

                    {/* Centered Large Circular Progress Gauge */}
                    <View style={styles.centerGaugeWrap}>
                        <View style={{ width: 154, height: 154, alignItems: 'center', justifyContent: 'center' }}>
                            <Svg width={154} height={154} style={StyleSheet.absoluteFill}>
                                {/* Background Ring Track */}
                                <Circle
                                    cx={77}
                                    cy={77}
                                    r={70}
                                    stroke={statusMainColor + '20'}
                                    strokeWidth={10}
                                    fill="transparent"
                                />
                                {/* Dynamic Time-Progress Fill Outline (Day 1: 1hr to 24hr) */}
                                <Circle
                                    cx={77}
                                    cy={77}
                                    r={70}
                                    stroke={statusMainColor}
                                    strokeWidth={10}
                                    fill="transparent"
                                    strokeDasharray={`${2 * Math.PI * 70} ${2 * Math.PI * 70}`}
                                    strokeDashoffset={2 * Math.PI * 70 * (1 - ringProgress)}
                                    strokeLinecap="round"
                                    transform="rotate(-90 77 77)"
                                />
                            </Svg>

                            {/* Centered Middle Texts */}
                            <View style={styles.centerAlign}>
                                {liveCalibStatus?.isCalibrated ? (
                                    <>
                                        <Text style={styles.gaugeEmoji}>{statusEmoji}</Text>
                                        <Text style={[styles.gaugeStatusLabel, { color: statusMainColor }]}>
                                            {statusLabel}
                                        </Text>
                                        <Text style={[styles.gaugeSub, { color: statusMainColor, marginTop: 1 }]}>
                                            {Math.round(Number(latestPrediction?.stress_score || 0) * 100)}% stress
                                        </Text>
                                        {latestPrediction?.timestamp ? (
                                            <Text style={[{ fontSize: 9, color: t.textMuted, fontWeight: '700', marginTop: 2 }]}>
                                                {new Date(latestPrediction.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </Text>
                                        ) : null}
                                    </>
                                ) : (
                                    <>
                                        <Text style={[styles.gaugeDay, { color: statusMainColor }]}>
                                            Day {liveCalibStatus?.dayNumber || (firebaseProfile ? 1 : '...')}
                                        </Text>
                                        <Text style={[styles.gaugeSub, { color: t.textMuted }]}>of 7</Text>
                                        <Text style={[styles.gaugeHourSub, { color: statusMainColor }]}>
                                            {Math.max(1, Math.round(dayProgress * 24))}h / 24h
                                        </Text>
                                    </>
                                )}
                            </View>
                        </View>
                    </View>
                </Card>

                {/* Digital Signals Section */}
                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: t.text }]}>Passive Behavioral Signals</Text>
                    <Text style={[styles.sectionSub, { color: t.textMuted }]}>
                        Continuous non-intrusive smartphone usage patterns
                    </Text>

                    {/* 🚶 Motion Detection Animated Alert Banner */}
                    {isUserMoving && (
                        <View style={{
                            flexDirection: 'row', alignItems: 'center',
                            backgroundColor: isDark ? 'rgba(255,165,0,0.15)' : 'rgba(255,165,0,0.1)',
                            borderRadius: 14, padding: 12, marginBottom: 10,
                            borderWidth: 1, borderColor: isDark ? 'rgba(255,165,0,0.3)' : 'rgba(255,165,0,0.25)',
                        }}>
                            <Animated.Text style={{
                                fontSize: 28,
                                transform: [{ translateY: motionBounce }],
                                marginRight: 10,
                            }}>
                                🏃
                            </Animated.Text>
                            <View style={{ flex: 1 }}>
                                <Text style={{ fontWeight: '800', fontSize: 13, color: COLORS.warning }}>
                                    Motion Detected!
                                </Text>
                                <Text style={{ fontSize: 11, color: t.textMuted, marginTop: 2 }}>
                                    Walking or running detected — signals are still recorded but excluded from your baseline.
                                </Text>
                            </View>
                            <Animated.Text style={{
                                fontSize: 22,
                                transform: [{ translateY: motionBounce }],
                            }}>
                                🚶
                            </Animated.Text>
                        </View>
                    )}

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
                            onPress={() => navigation.navigate('PhenotypingAnalysis', { initialTab: 'patterns', mode: 'patterns' })} />
                        <QuickAction icon="⚡" label="Analysis" color={COLORS.normal} isDark={isDark}
                            onPress={() => navigation.navigate('PhenotypingAnalysis', { initialTab: 'overview', mode: 'analysis' })} />
                        <QuickAction icon="📝" label="Feedback" color={COLORS.brand} isDark={isDark}
                            onPress={() => navigation.navigate('PhenotypingEma', { initialTab: 'feedback', mode: 'feedback' })} />
                    </View>
                </View>

                <Text style={[styles.lastUpdated, { color: t.textMuted }]}>
                    {liveWindow
                        ? `• live — updated ${lastUpdated ? lastUpdated.split('_')[1]?.slice(0, 2) + ':' + lastUpdated.split('_')[1]?.slice(2, 4) : 'recently'}`
                        : 'Waiting for first reading…'}
                </Text>
            </ScrollView>

            {/* ═════════════════════════════════════════════════════════════ */}
            {/* FIRST INSTALL STREAMLINED ONBOARDING POP-UP (THEME-MATCHED)   */}
            {/* ═════════════════════════════════════════════════════════════ */}
            <Modal
                visible={showOnboardingModal}
                transparent
                animationType="fade"
                onRequestClose={() => { }}
            >
                <View style={styles.modalBackdrop}>
                    <View style={[styles.modalCard, { backgroundColor: t.surface, borderColor: t.border }]}>

                        {/* STEP 1: Enable PhenoCare Sensor Flow */}
                        {onboardingStep === 1 && (
                            <View>
                                <View style={styles.modalHeaderRow}>
                                    <View style={[styles.alertIconCircle, { backgroundColor: COLORS.brand + '20' }]}>
                                        <Icon name={NAMES.device} size={18} color={COLORS.brand} />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={[styles.modalTitle, { color: t.text }]}>Enable PhenoCare Sensor</Text>
                                        <Text style={[styles.modalSubtext, { color: t.textMuted }]}>
                                            Passive keystroke & touch rhythm tracking
                                        </Text>
                                    </View>
                                </View>

                                {/* Concise Visual Step Flow Breadcrumb */}
                                <View style={[styles.breadcrumbBox, { backgroundColor: t.pillBg, borderColor: t.border }]}>
                                    <View style={styles.breadcrumbItem}>
                                        <Text style={{ fontSize: 13 }}>⚙️</Text>
                                        <Text style={[styles.breadcrumbText, { color: t.text }]}>Settings</Text>
                                    </View>
                                    <Text style={[styles.breadcrumbArrow, { color: COLORS.brand }]}>➔</Text>
                                    <View style={styles.breadcrumbItem}>
                                        <Text style={{ fontSize: 13 }}>♿</Text>
                                        <Text style={[styles.breadcrumbText, { color: t.text }]}>Accessibility</Text>
                                    </View>
                                    <Text style={[styles.breadcrumbArrow, { color: COLORS.brand }]}>➔</Text>
                                    <View style={styles.breadcrumbItem}>
                                        <Text style={{ fontSize: 13 }}>📱</Text>
                                        <Text style={[styles.breadcrumbText, { color: COLORS.brand, fontWeight: '850' }]}>PhenoCare</Text>
                                    </View>
                                </View>

                                {/* Interactive Sensor Switch */}
                                <View style={[styles.toggleCard, { backgroundColor: sensorToggle ? COLORS.normalSoft : t.pillBg, borderColor: sensorToggle ? COLORS.normal : t.border }]}>
                                    <View style={{ flex: 1, marginRight: 10 }}>
                                        <Text style={[styles.toggleTitle, { color: t.text }]}>PhenoCare Sensor</Text>
                                        <Text style={[styles.toggleSub, { color: sensorToggle ? COLORS.normalDark : t.textMuted }]}>
                                            {sensorToggle ? '✓ Sensor Active & Streaming' : 'Tap switch to turn ON'}
                                        </Text>
                                    </View>
                                    <Switch
                                        value={sensorToggle}
                                        onValueChange={handleToggleSensor}
                                        trackColor={{ false: t.border, true: COLORS.normal }}
                                        thumbColor={sensorToggle ? '#FFF' : '#FFF'}
                                    />
                                </View>

                                <TouchableOpacity
                                    style={[styles.modalActionBtn, { backgroundColor: COLORS.brand }]}
                                    onPress={() => handleToggleSensor(true)}
                                    activeOpacity={0.8}
                                >
                                    <Text style={styles.modalActionBtnText}>Turn On Sensor →</Text>
                                </TouchableOpacity>
                            </View>
                        )}

                        {/* STEP 2: 7-Day Calibration Path Roadmap */}
                        {onboardingStep === 2 && (
                            <View>
                                <View style={styles.modalHeaderRow}>
                                    <View style={[styles.alertIconCircle, { backgroundColor: COLORS.normalSoft }]}>
                                        <Icon name={NAMES.trendUp} size={18} color={COLORS.normal} />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={[styles.modalTitle, { color: t.text }]}>7-Day Calibration Roadmap</Text>
                                        <Text style={[styles.modalSubtext, { color: t.textMuted }]}>
                                            Adaptive baseline creation timeline
                                        </Text>
                                    </View>
                                </View>

                                <ScrollView style={{ maxHeight: 330, marginTop: 4 }} showsVerticalScrollIndicator={false}>
                                    {/* Card 1: Day 1-3 */}
                                    <View style={[styles.roadmapCard, { backgroundColor: t.pillBg, borderColor: t.border }]}>
                                        <View style={styles.roadmapHeader}>
                                            <View style={[styles.roadmapBadge, { backgroundColor: COLORS.brand + '20' }]}>
                                                <Text style={[styles.roadmapBadgeText, { color: COLORS.brand }]}>DAY 1–3</Text>
                                            </View>
                                        </View>
                                        <Text style={[styles.roadmapCardTitle, { color: t.text }]}>Learning your rhythm</Text>
                                        <Text style={[styles.roadmapCardDesc, { color: t.textMuted }]}>
                                            PhenoCare observes your typing speed, scroll habits, and screen usage patterns.
                                        </Text>
                                    </View>

                                    {/* Card 2: Day 3-5 */}
                                    <View style={[styles.roadmapCard, { backgroundColor: t.pillBg, borderColor: t.border }]}>
                                        <View style={styles.roadmapHeader}>
                                            <View style={[styles.roadmapBadge, { backgroundColor: COLORS.normal + '20' }]}>
                                                <Text style={[styles.roadmapBadgeText, { color: COLORS.normal }]}>DAY 3–5</Text>
                                            </View>
                                        </View>
                                        <Text style={[styles.roadmapCardTitle, { color: t.text }]}>Building your fingerprint</Text>
                                        <Text style={[styles.roadmapCardDesc, { color: t.textMuted }]}>
                                            A unique behavioral baseline is created from your natural phone usage.
                                        </Text>
                                    </View>

                                    {/* Card 3: Day 5-7 */}
                                    <View style={[styles.roadmapCard, { backgroundColor: t.pillBg, borderColor: t.border }]}>
                                        <View style={styles.roadmapHeader}>
                                            <View style={[styles.roadmapBadge, { backgroundColor: COLORS.warning + '20' }]}>
                                                <Text style={[styles.roadmapBadgeText, { color: COLORS.warning }]}>DAY 5–7</Text>
                                            </View>
                                        </View>
                                        <Text style={[styles.roadmapCardTitle, { color: t.text }]}>Calibrating your baseline</Text>
                                        <Text style={[styles.roadmapCardDesc, { color: t.textMuted }]}>
                                            The AI refines mean & deviation thresholds personalized to you.
                                        </Text>
                                    </View>

                                    {/* Card 4: Day 7+ */}
                                    <View style={[styles.roadmapCard, { backgroundColor: t.pillBg, borderColor: t.border }]}>
                                        <View style={styles.roadmapHeader}>
                                            <View style={[styles.roadmapBadge, { backgroundColor: COLORS.stress + '20' }]}>
                                                <Text style={[styles.roadmapBadgeText, { color: COLORS.stress }]}>DAY 7+</Text>
                                            </View>
                                        </View>
                                        <Text style={[styles.roadmapCardTitle, { color: t.text }]}>Pre-stress predictions begin</Text>
                                        <Text style={[styles.roadmapCardDesc, { color: t.textMuted }]}>
                                            You'll receive alerts when your behavior deviates from your baseline.
                                        </Text>
                                    </View>
                                </ScrollView>

                                <TouchableOpacity
                                    style={[styles.modalActionBtn, { backgroundColor: COLORS.brand, marginTop: 12 }]}
                                    onPress={handleCompleteOnboarding}
                                    activeOpacity={0.8}
                                >
                                    <Text style={styles.modalActionBtnText}>Enter PhenoCare Dashboard →</Text>
                                </TouchableOpacity>
                            </View>
                        )}
                    </View>
                </View>
            </Modal>
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
    hwCard: { marginHorizontal: 20, marginVertical: 8, padding: 18, borderRadius: 22 },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    rowGap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
    statusPillText: { fontSize: 11, fontWeight: '800' },
    cardTitle: { fontSize: 15, fontWeight: '800' },
    cardSub: { fontSize: 12 },
    scoreCard: { marginHorizontal: 20, marginVertical: 8, padding: 22, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
    centerGaugeWrap: { alignItems: 'center', justifyContent: 'center', width: '100%', paddingVertical: 4 },
    centerAlign: { alignItems: 'center', justifyContent: 'center' },
    gaugeEmoji: { fontSize: 26, marginBottom: 2 },
    gaugeStatusLabel: { fontSize: 13, fontWeight: '900', letterSpacing: -0.2, marginTop: 2 },
    gaugeDay: { fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
    gaugeSub: { fontSize: 11, fontWeight: '800' },
    gaugeHourSub: { fontSize: 10, fontWeight: '900', letterSpacing: 0.3, marginTop: 3 },
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

    // App-Matched Modal Styles
    modalBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.65)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    modalCard: {
        width: '100%',
        maxWidth: 400,
        borderRadius: 24,
        borderWidth: 1.5,
        padding: 20,
        elevation: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.35,
        shadowRadius: 10,
    },
    modalHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginBottom: 14,
    },
    alertIconCircle: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    modalTitle: {
        fontSize: 16,
        fontWeight: '900',
        letterSpacing: -0.2,
    },
    modalSubtext: {
        fontSize: 11.5,
        marginTop: 2,
    },
    breadcrumbBox: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginBottom: 14,
        borderWidth: 1,
    },
    breadcrumbItem: {
        alignItems: 'center',
        gap: 3,
    },
    breadcrumbText: {
        fontSize: 10.5,
        fontWeight: '750',
    },
    breadcrumbArrow: {
        fontSize: 13,
        fontWeight: '900',
    },
    toggleCard: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderRadius: 16,
        padding: 14,
        marginBottom: 14,
        borderWidth: 1.5,
    },
    toggleTitle: {
        fontSize: 13,
        fontWeight: '800',
    },
    toggleSub: {
        fontSize: 11,
        marginTop: 2,
        fontWeight: '600',
    },
    modalActionBtn: {
        borderRadius: 16,
        paddingVertical: 13,
        alignItems: 'center',
    },
    modalActionBtnText: {
        color: '#FFF',
        fontSize: 13,
        fontWeight: '850',
    },

    // Roadmap styles
    roadmapCard: {
        borderRadius: 14,
        padding: 12,
        marginBottom: 8,
        borderWidth: 1,
    },
    roadmapHeader: {
        flexDirection: 'row',
        marginBottom: 4,
    },
    roadmapBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2.5,
        borderRadius: 6,
    },
    roadmapBadgeText: {
        fontSize: 9,
        fontWeight: '900',
        letterSpacing: 0.4,
    },
    roadmapCardTitle: {
        fontSize: 13,
        fontWeight: '850',
        marginBottom: 2,
    },
    roadmapCardDesc: {
        fontSize: 11,
        lineHeight: 15,
    },
});
