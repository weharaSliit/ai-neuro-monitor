// ============================================================
// PhenotypingScreen.js -- Digital Phenotyping Dashboard
// Passive smartphone keystroke & interaction cadence telemetry.
// Streamlined interactive first-install Onboarding Modal matching the app UI:
// Step 1: Visual breadcrumb (Settings -> Accessibility -> PhenoCare Sensor) + Interactive Switch
// Step 2: 7-Day Calibration Roadmap with auto-transition to Dashboard.
// ============================================================
import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, NativeModules, Platform, Modal, Linking, AppState } from 'react-native';
import Svg, { Circle as SvgCircle, Path as SvgPath } from 'react-native-svg';
import { useFocusEffect } from '@react-navigation/native';
import { ref, onValue, off, update, query, limitToLast, orderByKey } from 'firebase/database';
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

// digitalSignals' own ids (avg_dwell, scroll_velocity, ...) don't match
// PhenotypingSignalHistoryScreen's SIGNAL_DETAILS_CONFIG keys (keyboard,
// scroll, ...) -- passing them straight through as `signalId` silently fell
// back to that screen's 'keyboard' default for any id it didn't recognize,
// e.g. tapping "Screen Scrolling" opened Keyboard Patterns history instead.
const SIGNAL_HISTORY_ID = {
    avg_dwell: 'keyboard',
    scroll_velocity: 'scroll',
    app_switch: 'app_switch',
};

// ── Micro sparkline using raw SVG ────────────────────────────────────
function Sparkline({ values, color, width = 80, height = 32, baselineMean }) {
    if (!values || values.length < 2) return <View style={{ width, height }} />;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const padX = 2; const padY = 4;
    const w = width - padX * 2;
    const h = height - padY * 2;
    const toX = (i) => padX + (i / (values.length - 1)) * w;
    const toY = (v) => padY + h - ((v - min) / span) * h;
    // Build SVG path string from points
    const pathD = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');
    const blY = baselineMean != null
        ? (padY + h - ((Math.min(max, Math.max(min, baselineMean)) - min) / span) * h).toFixed(1)
        : null;
    const lastX = toX(values.length - 1);
    const lastY = toY(values[values.length - 1]);
    return (
        <Svg width={width} height={height}>
            {blY != null && (
                <SvgPath
                    d={`M${padX},${blY} L${(padX + w).toFixed(1)},${blY}`}
                    stroke={color}
                    strokeWidth={1}
                    strokeDasharray="3,3"
                    opacity={0.4}
                    fill="none"
                />
            )}
            <SvgPath d={pathD} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
            <SvgCircle cx={lastX} cy={lastY} r={2.5} fill={color} />
        </Svg>
    );
}

// ── Deviation bar: shows how far current value is from baseline ─────────────
function DeviationBar({ z, color, t }) {
    const pct = Math.min(100, Math.round((Math.min(z, 3) / 3) * 100));
    return (
        <View style={{ height: 3, borderRadius: 2, backgroundColor: t.pillBg || '#eee', marginTop: 5, overflow: 'hidden' }}>
            <View style={{ width: `${pct}%`, height: 3, borderRadius: 2, backgroundColor: color }} />
        </View>
    );
}

// ── Interactive signal card with sparkline ──────────────────────────────────
// onPress is optional -- omit it for cards where a numeric 7-day history
// view wouldn't mean anything (Activity Context is a Still/Moving state,
// not a continuous baseline-tracked value).
function MiniSignalCard({ icon, title, subtext, value, deltaText, color, sparkValues, baselineMean, z, t, onPress }) {
    return (
        <TouchableOpacity onPress={onPress} activeOpacity={onPress ? 0.8 : 1} disabled={!onPress}>
            <Card style={styles.signalCard} accentColor={color}>
                <View style={styles.signalRow}>
                    <View style={{ flex: 1 }}>
                        <View style={styles.signalTitleRow}>
                            <Text style={styles.signalIcon}>{icon}</Text>
                            <Text style={[styles.signalTitle, { color: t.text }]}>{title}</Text>
                        </View>
                        <Text style={[styles.signalSubtext, { color: t.textMuted }]} numberOfLines={1}>{subtext}</Text>
                        <DeviationBar z={z || 0} color={color} t={t} />
                    </View>
                    <View style={styles.signalRight}>
                        <Sparkline values={sparkValues} color={color} width={72} height={28} baselineMean={baselineMean} />
                        <Text style={[styles.signalValue, { color }]}>{value}</Text>
                        {deltaText ? <Text style={[styles.signalDelta, { color }]}>{deltaText}</Text> : null}
                    </View>
                </View>
            </Card>
        </TouchableOpacity>
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
    const [onboarded, setOnboarded] = useState(false);  // starts false; set true after isPhenotypingOnboarded() resolves
    const [showOnboardingModal, setShowOnboardingModal] = useState(false);
    const [onboardingStep, setOnboardingStep] = useState(1);
    const [sensorToggle, setSensorToggle] = useState(false);
    const [accessibilityOn, setAccessibilityOn] = useState(false); // starts false; set true once check passes

    // ── Sensor verification state (for onboarding Step 1)
    const [sensorCheckStatus, setSensorCheckStatus] = useState('unknown'); // 'unknown' | 'checking' | 'on' | 'off'
    const sensorCheckIntervalRef = useRef(null);

    // ── Firebase data
    const [firebaseProfile, setFirebaseProfile] = useState(null);
    const [baselines, setBaselines] = useState(null);
    const [latestPrediction, setLatestPrediction] = useState(null);
    const [liveWindow, setLiveWindow] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(null);
    // Rolling history for sparklines (last 20 windows)
    const [windowHistory, setWindowHistory] = useState([]);

    // ── Motion detection (walking/running), from the real activity-recognition
    // signal in liveWindow.data_valid -- see digitalSignals' "activity" entry below.
    const isUserMoving = liveWindow?.data_valid === false;

    // ── 30-second live ticker
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 30_000);
        return () => clearInterval(id);
    }, []);


    // ── Firebase profile (display_name, created_at, study_id, is_calibrated)
    // For new users we only write display_name + created_at + is_calibrated:false
    // so the real 7-day countdown starts immediately.
    // is_calibrated is set to true ONLY by the backend's /behavior/calibrate
    // endpoint after the 7-day window completes with the user's own data.
    useEffect(() => {
        if (!deviceId) return;
        const AS = require('@react-native-async-storage/async-storage').default;
        const profileRef = ref(db, `phenotyping/users/${deviceId}`);
        const handler = onValue(profileRef, async (snap) => {
            if (snap.exists()) {
                const p = snap.val();
                setFirebaseProfile(p);
                try { await AS.setItem(`@pheno_profile_${deviceId}`, JSON.stringify(p)); } catch { }
            } else {
                try { const c = await AS.getItem(`@pheno_profile_${deviceId}`); if (c) setFirebaseProfile(JSON.parse(c)); } catch { }
                // NEW USER: create a minimal profile so the 7-day countdown
                // starts. Do NOT set is_calibrated:true or write any baselines
                // here — those are set by /behavior/calibrate after day 7.
                update(profileRef, {
                    display_name: user?.name || 'User',
                    is_calibrated: false,
                    created_at: new Date().toISOString(),
                }).catch(() => { });
            }
        }, async () => {
            try { const c = await AS.getItem(`@pheno_profile_${deviceId}`); if (c) setFirebaseProfile(JSON.parse(c)); } catch { }
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

    // ── Actual freshness of the last behavioral window, replacing a static
    // "LIVE" badge that used to show regardless of how old the data really
    // was. The sensor flushes every ~30s while there's activity, so "fresh"
    // allows a little slack (90s) for a flush to land; past that it's
    // either idle (normal) or something's actually stuck.
    const signalFreshness = useMemo(() => {
        if (!lastUpdated) return { ageMs: null, label: null, isFresh: false };
        const s = lastUpdated;
        const updatedAt = new Date(
            +s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8),
            +s.slice(9, 11), +s.slice(11, 13), +s.slice(13, 15)
        );
        const ageMs = now.getTime() - updatedAt.getTime();
        const ageMin = Math.floor(ageMs / 60000);
        let label;
        if (ageMs < 45_000) label = 'just now';
        else if (ageMin < 60) label = `${ageMin}m ago`;
        else label = `${Math.floor(ageMin / 60)}h ago`;
        return { ageMs, label, isFresh: ageMs >= 0 && ageMs < 90_000 };
    }, [lastUpdated, now]);

    // Freshness of the prediction actually driving the "Behavioral Sensor
    // Status" gauge below (latestPrediction, a different Firebase path than
    // the data_logs-based signalFreshness above). The gauge label is fully
    // live-wired to real Firebase data -- if it looks "stuck," this makes
    // that visible: either it's a fresh reading (the real behavior IS
    // currently reading as stressed) or it's stale (sensor hasn't posted a
    // new window recently), which are two very different things to act on.
    const predictionFreshness = useMemo(() => {
        const ts = latestPrediction?.timestamp;
        if (!ts) return { ageMs: null, label: null, isFresh: false };
        const updatedAt = new Date(ts);
        if (isNaN(updatedAt.getTime())) return { ageMs: null, label: null, isFresh: false };
        const ageMs = now.getTime() - updatedAt.getTime();
        const ageMin = Math.floor(ageMs / 60000);
        let label;
        if (ageMs < 45_000) label = 'just now';
        else if (ageMin < 60) label = `${ageMin}m ago`;
        else label = `${Math.floor(ageMin / 60)}h ago`;
        return { ageMs, label, isFresh: ageMs >= 0 && ageMs < 90_000 };
    }, [latestPrediction, now]);

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
            if (val) try { await AS.setItem(`@pheno_bl_${deviceId}`, JSON.stringify(val)); } catch { }
            else try { const c = await AS.getItem(`@pheno_bl_${deviceId}`); if (c) setBaselines(JSON.parse(c)); } catch { }
        }, async () => { try { const c = await AS.getItem(`@pheno_bl_${deviceId}`); if (c) setBaselines(JSON.parse(c)); } catch { } });
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
                if (latest) try { await AS.setItem(`@pheno_pred_${deviceId}`, JSON.stringify(latest)); } catch { }
            } else try { const c = await AS.getItem(`@pheno_pred_${deviceId}`); if (c) setLatestPrediction(JSON.parse(c)); } catch { }
        }, async () => { try { const c = await AS.getItem(`@pheno_pred_${deviceId}`); if (c) setLatestPrediction(JSON.parse(c)); } catch { } });
        return () => off(ref(db, `phenotyping/predictions/${deviceId}`), 'value', handler);
    }, [deviceId]);

    // ── Live behavioral window with offline cache + rolling history for sparklines
    // limitToLast(20): we only need the last 20 windows for the sparkline history.
    // Without this, the entire data_logs subtree (thousands of 30s windows after
    // 7+ days) would be downloaded on every screen open and every new window write.
    useEffect(() => {
        if (!deviceId) return;
        const AS = require('@react-native-async-storage/async-storage').default;
        const logsQuery = query(ref(db, `phenotyping/data_logs/${deviceId}`), orderByKey(), limitToLast(20));
        const loadCache = async () => { try { const c = await AS.getItem(`@pheno_win_${deviceId}`); if (c) { const { k, d } = JSON.parse(c); setLiveWindow(d); setLastUpdated(k); } } catch { } };
        const handler = onValue(logsQuery, async (snapshot) => {
            const raw = snapshot.val();
            if (raw) {
                const entries = Object.entries(raw).sort((a, b) => a[0].localeCompare(b[0]));
                const [k, d] = entries[entries.length - 1];
                setLiveWindow(d); setLastUpdated(k);
                // All 20 windows for sparkline history
                const hist = entries.map(([, v]) => v);
                setWindowHistory(hist);
                try { await AS.setItem(`@pheno_win_${deviceId}`, JSON.stringify({ k, d })); } catch { }
            } else { await loadCache(); }
        }, loadCache);
        return () => off(logsQuery, 'value', handler);
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
                    update(ref(db, `phenotyping/users/${deviceId}`), { is_calibrated: true }).catch(() => { });
                }
            } catch { }
        })();
    }, [deviceId, displayName, liveCalibStatus]);

    // ── Sensor check helper (used during onboarding)
    const checkSensorStatus = useCallback(async () => {
        if (Platform.OS !== 'android' || !PhenotypingIdentity?.isAccessibilityServiceEnabled) {
            // Non-Android or native module missing — assume ON so onboarding can proceed
            setSensorCheckStatus('on');
            return;
        }
        setSensorCheckStatus('checking');
        try {
            const enabled = await PhenotypingIdentity.isAccessibilityServiceEnabled();
            setSensorCheckStatus(enabled ? 'on' : 'off');
            if (enabled) setAccessibilityOn(true);
        } catch {
            setSensorCheckStatus('off');
        }
    }, []);

    // Run sensor check when onboarding modal opens at Step 1.
    // Also subscribe to AppState so the check fires automatically when the
    // user comes back from Android Accessibility Settings — without this,
    // the modal keeps showing ❌ even after the sensor is turned on because
    // a React Native <Modal> keeps the underlying screen in focus the whole
    // time, so useFocusEffect never re-fires on return.
    useEffect(() => {
        if (showOnboardingModal && onboardingStep === 1) {
            checkSensorStatus();
            // Re-check every time the app comes to the foreground (user
            // returns from Settings after enabling the accessibility service).
            const sub = AppState.addEventListener('change', (nextState) => {
                if (nextState === 'active') {
                    checkSensorStatus();
                }
            });
            return () => sub.remove();
        }
        // Clear any lingering interval when modal closes
        if (!showOnboardingModal && sensorCheckIntervalRef.current) {
            clearInterval(sensorCheckIntervalRef.current);
            sensorCheckIntervalRef.current = null;
        }
    }, [showOnboardingModal, onboardingStep, checkSensorStatus]);

    // ── Onboarding handlers
    const handleToggleSensor = async (val) => {
        setSensorToggle(val);
        if (val) {
            if (Platform.OS === 'android' && PhenotypingIdentity) {
                try {
                    await PhenotypingIdentity.requestRuntimePermissions();
                } catch (e) {
                    // Permission request failed or was denied — sensor can still
                    // run without ACTIVITY_RECOGNITION (motion gate just defaults
                    // to data_valid=true) and without POST_NOTIFICATIONS (no EMA alerts).
                    console.warn('PhenoCare: requestRuntimePermissions error', e);
                }
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

    // ── Compute Z-score helper
    const getZ = (val, mean, std) => (!mean || !std || val == null) ? 0 : Math.abs((val - mean) / std);
    const colorZ = (z) => z > 2.0 ? COLORS.stress : z > 1.0 ? COLORS.warning : COLORS.normal;

    // ── Build sparkline history arrays per feature from windowHistory
    const sparkHistories = useMemo(() => {
        if (windowHistory.length === 0) return {};
        return {
            avg_dwell: windowHistory.map(w => w.avg_dwell || 0).filter(v => v > 0),
            scroll_velocity: windowHistory.map(w => w.scroll_velocity || 0).filter(v => v > 0),
            app_switch: windowHistory.map(w => (w.app_switch_rate || 0) * 60),
        };
    }, [windowHistory]);

    // ── Signal cards: only rendered when liveWindow exists (no fallback dashes)
    const digitalSignals = useMemo(() => {
        if (!liveWindow) return null; // hide entirely — no dashes
        const bl = baselines || {};
        const appSwitchPerMin = Number(liveWindow.app_switch_rate || 0) * 60;
        const isMoving = liveWindow.data_valid === false;
        const delta = (val, mean) => {
            if (!mean || !val) return null;
            const pct = Math.round(((val - mean) / mean) * 100);
            if (Math.abs(pct) < 5) return null;
            return (pct > 0 ? '▲ +' : '▼ ') + pct + '% vs calm';
        };
        const dwellZ = getZ(liveWindow.avg_dwell, bl.avg_dwell?.mean || 135, bl.avg_dwell?.std || 15);
        const scrollZ = getZ(liveWindow.scroll_velocity, bl.scroll_velocity?.mean || 750, bl.scroll_velocity?.std || 120);
        const switchZ = appSwitchPerMin > 4 ? 3 : appSwitchPerMin > 2.5 ? 1.5 : 0;
        return [
            {
                id: 'avg_dwell', icon: '⌨️', title: 'Keyboard Patterns',
                value: `${Math.round(liveWindow.avg_dwell || 0)} ms`,
                subtext: delta(liveWindow.avg_dwell, bl.avg_dwell?.mean) || 'Typing rhythm & key press duration',
                color: colorZ(dwellZ), z: dwellZ,
                sparkValues: sparkHistories.avg_dwell,
                baselineMean: bl.avg_dwell?.mean || 135,
            },
            {
                id: 'scroll_velocity', icon: '📜', title: 'Screen Scrolling',
                value: `${Math.round(liveWindow.scroll_velocity || 0)} px/s`,
                subtext: delta(liveWindow.scroll_velocity, bl.scroll_velocity?.mean) || 'Scroll speed & frequency patterns',
                color: colorZ(scrollZ), z: scrollZ,
                sparkValues: sparkHistories.scroll_velocity,
                baselineMean: bl.scroll_velocity?.mean || 750,
            },
            {
                id: 'app_switch', icon: '📱', title: 'Screen Activity',
                value: `${appSwitchPerMin.toFixed(1)} /min`,
                subtext: appSwitchPerMin > 0.001 ? 'App switching rate active' : 'No app switches this window',
                color: colorZ(switchZ), z: switchZ,
                sparkValues: sparkHistories.app_switch,
                baselineMean: 1.5,
            },
            {
                id: 'activity', icon: '🚶', title: 'Activity Context',
                value: isMoving ? 'Moving' : 'Still',
                subtext: isMoving ? 'Motion detected · baseline paused' : 'Stationary · signal valid',
                color: isMoving ? COLORS.warning : COLORS.normal, z: isMoving ? 2.5 : 0,
                sparkValues: [],
                baselineMean: null,
            },
        ];
    }, [liveWindow, baselines, COLORS, sparkHistories]);

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
                {/* Page header — no name/device text */}
                <View style={{ marginHorizontal: 20, marginBottom: 12 }}>
                    <Text style={[styles.plainTitle, { color: t.text }]}>Digital Phenotyping</Text>
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

                    {!accessibilityOn && (
                        <Text style={[styles.cardSub, { color: t.textMuted, marginTop: 6, marginBottom: 8 }]}>
                            Sensor offline — enable in Settings → Accessibility.
                        </Text>
                    )}

                    {/* Centered Large Circular Progress Gauge */}
                    <View style={styles.centerGaugeWrap}>
                        <View style={{ width: 154, height: 154, alignItems: 'center', justifyContent: 'center' }}>
                            <Svg width={154} height={154} style={StyleSheet.absoluteFill}>
                                {/* Background Ring Track */}
                                <SvgCircle
                                    cx={77}
                                    cy={77}
                                    r={70}
                                    stroke={statusMainColor + '20'}
                                    strokeWidth={10}
                                    fill="transparent"
                                />
                                {/* Dynamic Progress Fill */}
                                <SvgCircle
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

                    {/* Freshness of the reading driving the status above -- makes it
                        visible whether this is a current live reading or a stale one,
                        instead of leaving "why isn't this changing?" unanswered. */}
                    {liveCalibStatus?.isCalibrated && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 4 }}>
                            <StatusDot color={predictionFreshness.isFresh ? COLORS.normal : t.textMuted} active={predictionFreshness.isFresh} size={6} />
                            <Text style={{ fontSize: 10.5, fontWeight: '700', color: predictionFreshness.isFresh ? COLORS.normal : t.textMuted }}>
                                {predictionFreshness.isFresh
                                    ? 'Live reading · updated just now'
                                    : predictionFreshness.label
                                        ? `Last reading ${predictionFreshness.label} — sensor idle`
                                        : 'Waiting for first reading'}
                            </Text>
                        </View>
                    )}
                </Card>

                {/* Passive Behavioral Signals — only shown when live data exists */}
                {digitalSignals && (
                    <View style={styles.section}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                            <Text style={[styles.sectionTitle, { color: t.text }]}>Passive Behavioral Signals</Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                <StatusDot color={signalFreshness.isFresh ? COLORS.normal : t.textMuted} active={signalFreshness.isFresh} size={7} />
                                <Text style={{ fontSize: 10, fontWeight: '800', color: signalFreshness.isFresh ? COLORS.normal : t.textMuted }}>
                                    {signalFreshness.isFresh ? 'LIVE' : (signalFreshness.label ? signalFreshness.label.toUpperCase() : 'IDLE')}
                                </Text>
                            </View>
                        </View>
                        <Text style={[styles.sectionSub, { color: t.textMuted }]}>
                            Arrows compare this window against your own calm baseline.
                        </Text>

                        {digitalSignals.map((s) => (
                            <MiniSignalCard
                                key={s.id}
                                icon={s.icon}
                                title={s.title}
                                subtext={s.subtext}
                                value={s.value}
                                deltaText={null}
                                color={s.color}
                                sparkValues={s.sparkValues}
                                baselineMean={s.baselineMean}
                                z={s.z}
                                t={t}
                                onPress={
                                    s.id === 'activity'
                                        ? undefined
                                        : () => navigation.navigate('PhenotypingSignalHistory', { signalId: SIGNAL_HISTORY_ID[s.id] || s.id })
                                }
                            />
                        ))}
                    </View>
                )}

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
                        <QuickAction icon="✅" label="Validation" color={COLORS.stress} isDark={isDark}
                            onPress={() => navigation.navigate('PhenotypingValidation')} />
                    </View>
                </View>

                <Text style={[styles.lastUpdated, { color: t.textMuted }]}>
                    {liveWindow
                        ? `• updated ${signalFreshness.label || 'recently'} (${lastUpdated ? lastUpdated.split('_')[1]?.slice(0, 2) + ':' + lastUpdated.split('_')[1]?.slice(2, 4) : '--:--'})`
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

                                {/* ── Live Sensor Status Pill ── */}
                                <View style={[styles.sensorStatusRow, {
                                    backgroundColor: sensorCheckStatus === 'on'
                                        ? (COLORS.normalSoft || (COLORS.normal + '18'))
                                        : sensorCheckStatus === 'checking'
                                            ? (t.pillBg)
                                            : (COLORS.stressSoft || (COLORS.stress + '18')),
                                    borderColor: sensorCheckStatus === 'on'
                                        ? (COLORS.normal + '60')
                                        : sensorCheckStatus === 'checking'
                                            ? t.border
                                            : (COLORS.stress + '40'),
                                }]}>
                                    <Text style={{ fontSize: 18 }}>
                                        {sensorCheckStatus === 'on' ? '✅' : sensorCheckStatus === 'checking' ? '⏳' : '❌'}
                                    </Text>
                                    <View style={{ flex: 1, marginLeft: 10 }}>
                                        <Text style={[styles.sensorStatusTitle, {
                                            color: sensorCheckStatus === 'on'
                                                ? (COLORS.normalDark || COLORS.normal)
                                                : sensorCheckStatus === 'checking'
                                                    ? t.textMuted
                                                    : (COLORS.stressDark || COLORS.stress),
                                        }]}>
                                            {sensorCheckStatus === 'on'
                                                ? 'PhenoCare Sensor Active'
                                                : sensorCheckStatus === 'checking'
                                                    ? 'Checking sensor status…'
                                                    : 'Sensor Not Enabled'}
                                        </Text>
                                        <Text style={[styles.sensorStatusSub, { color: t.textMuted }]}>
                                            {sensorCheckStatus === 'on'
                                                ? 'Accessibility service is running'
                                                : sensorCheckStatus === 'checking'
                                                    ? 'Reading from phone settings'
                                                    : 'Go to Settings → Accessibility → PhenoCare'}
                                        </Text>
                                    </View>
                                </View>

                                {/* ── Open Settings + Check Again row ── */}
                                {sensorCheckStatus !== 'on' && (
                                    <View style={styles.sensorActionRow}>
                                        <TouchableOpacity
                                            style={[styles.sensorActionBtn, { backgroundColor: COLORS.brand, flex: 2 }]}
                                            onPress={async () => {
                                                if (Platform.OS === 'android' && PhenotypingIdentity) {
                                                    try { await PhenotypingIdentity.requestRuntimePermissions(); } catch { }
                                                }
                                                // Deep-link to Android Accessibility settings
                                                if (Platform.OS === 'android') {
                                                    Linking.sendIntent('android.settings.ACCESSIBILITY_SETTINGS').catch(() =>
                                                        Linking.openSettings()
                                                    );
                                                } else {
                                                    Linking.openSettings();
                                                }
                                            }}
                                            activeOpacity={0.8}
                                        >
                                            <Text style={styles.sensorActionBtnText}>⚙️  Open Accessibility Settings</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[styles.sensorActionBtn, { backgroundColor: t.pillBg, borderWidth: 1.5, borderColor: t.border, flex: 1 }]}
                                            onPress={checkSensorStatus}
                                            activeOpacity={0.8}
                                        >
                                            <Text style={[styles.sensorActionBtnText, { color: COLORS.brand }]}>↺  Check</Text>
                                        </TouchableOpacity>
                                    </View>
                                )}

                                {/* ── Continue button — only enabled when sensor ON ── */}
                                <TouchableOpacity
                                    style={[styles.modalActionBtn, {
                                        backgroundColor: sensorCheckStatus === 'on' ? COLORS.brand : (t.pillBg),
                                        borderWidth: sensorCheckStatus === 'on' ? 0 : 1.5,
                                        borderColor: t.border,
                                        marginTop: 14,
                                    }]}
                                    onPress={async () => {
                                        if (sensorCheckStatus !== 'on') return;
                                        if (Platform.OS === 'android' && PhenotypingIdentity) {
                                            try {
                                                await PhenotypingIdentity.requestRuntimePermissions();
                                            } catch (e) {
                                                console.warn('PhenoCare: requestRuntimePermissions error', e);
                                            }
                                            PhenotypingIdentity.scheduleEmaNotifications();
                                        }
                                        setOnboardingStep(2);
                                    }}
                                    activeOpacity={sensorCheckStatus === 'on' ? 0.8 : 1}
                                >
                                    <Text style={[styles.modalActionBtnText, {
                                        color: sensorCheckStatus === 'on' ? '#FFF' : t.textMuted,
                                    }]}>
                                        {sensorCheckStatus === 'on' ? 'Continue →' : 'Enable sensor to continue'}
                                    </Text>
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
    plainTitle: { fontSize: 22, fontWeight: '900', letterSpacing: -0.2, marginBottom: 4 },
    hwCard: { marginHorizontal: 20, marginVertical: 8, padding: 18, borderRadius: 22 },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    rowGap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
    statusPillText: { fontSize: 11, fontWeight: '800' },
    cardTitle: { fontSize: 15, fontWeight: '800' },
    cardSub: { fontSize: 12 },
    centerGaugeWrap: { alignItems: 'center', justifyContent: 'center', width: '100%', paddingVertical: 4 },
    centerAlign: { alignItems: 'center', justifyContent: 'center' },
    gaugeEmoji: { fontSize: 26, marginBottom: 2 },
    gaugeStatusLabel: { fontSize: 13, fontWeight: '900', letterSpacing: -0.2, marginTop: 2 },
    gaugeDay: { fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
    gaugeSub: { fontSize: 11, fontWeight: '800' },
    gaugeHourSub: { fontSize: 10, fontWeight: '900', letterSpacing: 0.3, marginTop: 3 },
    section: { marginHorizontal: 20, marginVertical: 10 },
    sectionTitle: { fontSize: 15, fontWeight: '800', marginBottom: 0 },
    sectionSub: { fontSize: 11, marginBottom: 10, marginTop: 2 },
    // ── New signal card with sparkline
    signalCard: { borderRadius: 16, borderWidth: 1, padding: 12, marginBottom: 8 },
    signalRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    signalTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 1 },
    signalIcon: { fontSize: 16 },
    signalTitle: { fontSize: 13, fontWeight: '800' },
    signalSubtext: { fontSize: 10.5, marginTop: 0 },
    signalRight: { alignItems: 'flex-end', gap: 2, minWidth: 80 },
    signalValue: { fontSize: 15, fontWeight: '900', marginTop: 2 },
    signalDelta: { fontSize: 9, fontWeight: '700', opacity: 0.85 },
    actionsRow: { flexDirection: 'row', gap: 8 },
    actionTile: { borderRadius: 16, borderWidth: 1, paddingVertical: 13, paddingHorizontal: 4, alignItems: 'center', gap: 5 },
    actionIcon: { fontSize: 18 },
    actionLabel: { fontSize: 9.5, fontWeight: '800', textAlign: 'center' },
    lastUpdated: { textAlign: 'center', fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 12 },

    // Modal styles
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
    // Sensor verification styles
    sensorStatusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 16,
        borderWidth: 1.5,
        padding: 14,
        marginBottom: 12,
    },
    sensorStatusTitle: {
        fontSize: 13,
        fontWeight: '800',
    },
    sensorStatusSub: {
        fontSize: 11,
        marginTop: 2,
        fontWeight: '500',
    },
    sensorActionRow: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 4,
    },
    sensorActionBtn: {
        borderRadius: 12,
        paddingVertical: 10,
        alignItems: 'center',
        paddingHorizontal: 8,
    },
    sensorActionBtnText: {
        color: '#FFF',
        fontSize: 11.5,
        fontWeight: '800',
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
