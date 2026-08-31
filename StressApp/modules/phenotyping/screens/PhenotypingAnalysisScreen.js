// ============================================================
// PhenotypingAnalysisScreen.js
// Consumer & Clinical Phenotyping Telemetry: Continuous behavioral drift,
// 5-feature baseline deviation matrix, Normal vs Stress stage ranges,
// multi-window temporal confirmation, and 7-day calibration roadmap.
// Reuses the shared LineChart, Card, StatusDot, and Theme tokens matching
// RingSummaryScreen and EegSummaryScreen.
// All values, baseline envelopes, stage thresholds, and window counts are
// dynamically derived from Firebase RTDB without static hardcoding.
// ============================================================
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions } from 'react-native';
import { ref, onValue, off, get } from 'firebase/database';
import { db } from '../firebase';
import ScreenBackground from '../../shared/ScreenBackground';
import Card from '../../shared/Card';
import StatusDot from '../../shared/StatusDot';
import Icon, { NAMES } from '../../shared/Icon';
import MoodBadge from '../../shared/MoodBadge';
import LineChart from '../../shared/LineChart';
import { useTheme } from '../../physiological/config/ThemeContext';
import { usePhenotypingDeviceId } from '../utils/deviceIdentity';
import { computeCalibrationStatus } from '../utils/calibrationStatus';

const CHART_WIDTH = Dimensions.get('window').width - 2 * 16 - 2 * 16;

function computeZ(val, mean, std) {
    if (val === undefined || val === null || mean === undefined || mean === null || !std || std === 0) return 0;
    return Math.min(Math.abs((val - mean) / std), 4.0);
}

function buildWeeklyChart(predictions) {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(now - (6 - i) * dayMs);
        return { day: d.toLocaleDateString('en-US', { weekday: 'short' }), date: d.toDateString(), scores: [] };
    });
    (predictions || []).forEach((p) => {
        if (!p.timestamp) return;
        const pDateStr = new Date(p.timestamp).toDateString();
        const bucket = days.find((d) => d.date === pDateStr);
        if (bucket && typeof p.stress_score === 'number') {
            bucket.scores.push(p.stress_score);
        }
    });
    return days.map((d) => ({
        day: d.day,
        score: d.scores.length ? d.scores.reduce((a, b) => a + b, 0) / d.scores.length : 0,
        hasData: d.scores.length > 0,
    }));
}

function DistBar({ label, value, total, color, muted }) {
    const pct = total > 0 ? (value / total) * 100 : 0;
    return (
        <View style={styles.distRow}>
            <Text style={[styles.distLabel, { color: muted }]}>{label}</Text>
            <View style={[styles.distBarBg, { backgroundColor: muted + '25' }]}>
                <View style={[styles.distBarFill, { width: `${pct}%`, backgroundColor: color }]} />
            </View>
            <Text style={[styles.distVal, { color }]}>{value} ({pct.toFixed(0)}%)</Text>
        </View>
    );
}

const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'patterns', label: 'Patterns' },
    { id: 'baseline', label: 'Baseline' },
];

const FEATURE_METADATA = {
    composite: {
        id: 'composite',
        name: 'Composite Drift',
        icon: '⚡',
        unit: 'Z',
        description: 'Multi-signal composite Z-score deviation across all active keystroke, touch, and posture biometrics.',
    },
    avg_dwell: {
        id: 'avg_dwell',
        name: 'Dwell Time',
        icon: '⌨️',
        unit: 'ms',
        decimals: 0,
        fallbackMean: 135,
        fallbackStd: 15,
        stressDirection: 'high',
        description: 'Key press duration. Stressed muscle tension causes longer key holding times.',
    },
    avg_flight: {
        id: 'avg_flight',
        name: 'Flight Time',
        icon: '✈️',
        unit: 'ms',
        decimals: 0,
        fallbackMean: 215,
        fallbackStd: 25,
        stressDirection: 'high',
        description: 'Inter-key latency. Cognitive hesitation and fatigue prolong key-to-key flight times.',
    },
    scroll_velocity: {
        id: 'scroll_velocity',
        name: 'Scroll Speed',
        icon: '📜',
        unit: 'px/s',
        decimals: 0,
        fallbackMean: 750,
        fallbackStd: 120,
        stressDirection: 'high',
        description: 'Vertical swipe velocity. Rapid, erratic flicking indicates agitation and urgency.',
    },
    tilt_angle: {
        id: 'tilt_angle',
        name: 'Device Tilt',
        icon: '📐',
        unit: '°',
        decimals: 1,
        fallbackMean: 59.0,
        fallbackStd: 8.0,
        stressDirection: 'high',
        description: 'Accelerometer pitch. Stressed hunching causes higher forward tilt angles.',
    },
    cpm: {
        id: 'cpm',
        name: 'Typing Speed',
        icon: '🔡',
        unit: 'cpm',
        decimals: 0,
        fallbackMean: 42,
        fallbackStd: 6,
        stressDirection: 'low',
        description: 'Text throughput in characters per minute. Significant speed drops signal cognitive overload.',
    },
};

export default function PhenotypingAnalysisScreen({ navigation, route }) {
    const { isDark, theme: t, COLORS } = useTheme();
    const ownDeviceId = usePhenotypingDeviceId();
    const routeDeviceId = route?.params?.userId || route?.params?.deviceId;
    const deviceId = routeDeviceId || ownDeviceId;

    const mode = route?.params?.mode;
    const [userProfileName, setUserProfileName] = useState(route?.params?.userName || null);

    const filteredTabs = useMemo(() => {
        if (mode === 'patterns') {
            return TABS.filter((tab) => tab.id === 'patterns');
        } else if (mode === 'analysis') {
            return TABS.filter((tab) => tab.id === 'overview' || tab.id === 'baseline');
        }
        return TABS;
    }, [mode]);

    const [activeTab, setActiveTab] = useState(() => {
        const initial = route?.params?.initialTab;
        if (initial && filteredTabs.some((tab) => tab.id === initial)) {
            return initial;
        }
        return filteredTabs[0]?.id || 'overview';
    });

    const [timeRange, setTimeRange] = useState('7'); // '7' (7 days) or '28' (28 days)
    const [selectedFeature, setSelectedFeature] = useState('composite');
    const [predictions, setPredictions] = useState(null);
    const [allEntries, setAllEntries] = useState([]);
    const [latestWindow, setLatestWindow] = useState(null);
    const [baselines, setBaselines] = useState(null);
    const [dataLogCount, setDataLogCount] = useState(null);
    const [calibStatus, setCalibStatus] = useState(null);

    useEffect(() => {
        const initial = route?.params?.initialTab;
        if (initial && filteredTabs.some((tab) => tab.id === initial)) {
            setActiveTab(initial);
        }
    }, [route?.params?.initialTab, filteredTabs]);

    // Real user profile (display_name, created_at, is_calibrated) from
    // Firebase -- the SINGLE source of truth for calibration status here.
    // PREVIOUSLY calibStatus came from getCalibrationStatus(deviceId), which
    // reads THIS device's own AsyncStorage cache. That's correct for the
    // live user dashboard (PhenotypingScreen.js, offline-tolerant by
    // design) but wrong here: when an admin opens another user's analysis,
    // that deviceId's key was never written on the admin's phone, so it
    // silently fabricated a fresh "Day 1, not calibrated" state instead of
    // that patient's real calibration status. Firebase already has the
    // real created_at/is_calibrated for every user (own or admin-viewed),
    // so read it directly and reuse the same day-number/phase math.
    useEffect(() => {
        if (!deviceId) return;
        const profileRef = ref(db, `phenotyping/users/${deviceId}`);
        const handler = onValue(profileRef, (snap) => {
            const p = snap.val() || {};
            if (p.display_name || p.name) setUserProfileName(p.display_name || p.name);
            setCalibStatus(computeCalibrationStatus(p));
        });
        return () => off(profileRef, 'value', handler);
    }, [deviceId]);

    // Real Predictions Listener
    useEffect(() => {
        if (!deviceId) return;
        const predRef = ref(db, `phenotyping/predictions/${deviceId}`);
        const handler = onValue(predRef, (snap) => {
            const raw = snap.val();
            setPredictions(raw ? Object.values(raw) : []);
        });
        return () => off(predRef, 'value', handler);
    }, [deviceId]);

    // Real Baselines & Data Logs Listener
    useEffect(() => {
        if (!deviceId) return;
        const baselinesRef = ref(db, `phenotyping/users/${deviceId}/baselines`);
        const blHandler = onValue(baselinesRef, (s) => {
            setBaselines(s.exists() ? s.val() : null);
        });

        const logsRef = ref(db, `phenotyping/data_logs/${deviceId}`);
        const logHandler = onValue(logsRef, (snapshot) => {
            const raw = snapshot.val();
            if (raw) {
                const entries = Object.entries(raw).sort((a, b) => a[0].localeCompare(b[0]));
                setAllEntries(entries);
                setDataLogCount(entries.length);
                const last = entries[entries.length - 1];
                setLatestWindow(last ? last[1] : null);
            } else {
                setAllEntries([]);
                setDataLogCount(0);
                setLatestWindow(null);
            }
        });
        return () => {
            off(baselinesRef, 'value', blHandler);
            off(logsRef, 'value', logHandler);
        };
    }, [deviceId]);

    // Parse date helper from key or timestamp
    const parseEntryDate = (key, data) => {
        if (data?.timestamp) return new Date(data.timestamp);
        try {
            const parts = key.split('_');
            const d = parts[0];
            const yr = parseInt(d.slice(0, 4), 10);
            const mo = parseInt(d.slice(4, 6), 10) - 1;
            const dy = parseInt(d.slice(6, 8), 10);
            if (parts[1]) {
                const tStr = parts[1];
                const hr = parseInt(tStr.slice(0, 2), 10);
                const mn = parseInt(tStr.slice(2, 4), 10);
                return new Date(yr, mo, dy, hr, mn);
            }
            return new Date(yr, mo, dy);
        } catch {
            return new Date();
        }
    };

    // Filter real entries based on selected time range (7 days vs 28 days)
    const windowSlice = useMemo(() => {
        const days = parseInt(timeRange, 10) || 7;
        const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;
        
        const filtered = allEntries.filter(([key, data]) => {
            const entryDate = parseEntryDate(key, data);
            return entryDate.getTime() >= cutoffTime;
        });

        // If dataset in range is empty, fallback to the most recent entries
        const target = filtered.length > 0 ? filtered : allEntries.slice(-(days === 28 ? 40 : 15));

        return target.map(([key, data]) => ({
            key,
            date: parseEntryDate(key, data),
            data,
        }));
    }, [allEntries, timeRange]);

    // 5 Feature Deviations Calculation — 100% derived from real user baselines
    const featureMetrics = useMemo(() => {
        const lw = latestWindow || {};
        const bl = baselines || {};

        const list = [
            { key: 'avg_dwell', raw: lw.avg_dwell },
            { key: 'avg_flight', raw: lw.avg_flight },
            { key: 'scroll_velocity', raw: lw.scroll_velocity },
            { key: 'tilt_angle', raw: lw.tilt_angle },
            { key: 'cpm', raw: lw.cpm },
        ];

        return list.map((item) => {
            const meta = FEATURE_METADATA[item.key];
            const hasPersonal = bl[item.key]?.mean !== undefined && bl[item.key]?.mean !== null;
            const mean = hasPersonal ? bl[item.key].mean : meta.fallbackMean;
            const std = (hasPersonal && bl[item.key].std) ? bl[item.key].std : meta.fallbackStd;
            const val = typeof item.raw === 'number' ? item.raw : null;
            const z = val !== null ? computeZ(val, mean, std) : 0;
            const stage = z > 2.0 ? 'stress' : z > 1.0 ? 'drift' : 'normal';
            const stageLabel = stage === 'stress' ? 'Pre-Stress' : stage === 'drift' ? 'Elevated Drift' : 'Normal';
            const stageColor = stage === 'stress' ? COLORS.stress : stage === 'drift' ? COLORS.warning : COLORS.normal;

            // Dynamically calculate user's empirical range corridors
            const fmt = (num) => (meta.decimals === 0 ? Math.round(num) : num.toFixed(meta.decimals));
            let dynamicNormalRange = '';
            let dynamicStressRange = '';

            if (meta.stressDirection === 'low') {
                // CPM: drops indicate stress
                dynamicNormalRange = `${fmt(Math.max(0, mean - std))} – ${fmt(mean + std)} ${meta.unit}`;
                dynamicStressRange = `< ${fmt(Math.max(0, mean - 2 * std))} ${meta.unit}`;
            } else {
                // Dwell, Flight, Scroll, Tilt: increases indicate stress
                dynamicNormalRange = `${fmt(Math.max(0, mean - std))} – ${fmt(mean + std)} ${meta.unit}`;
                dynamicStressRange = `> ${fmt(mean + 2 * std)} ${meta.unit}`;
            }

            const currentStr = val !== null ? `${fmt(val)} ${meta.unit}` : '--';
            const baselineStr = `${fmt(mean)} ±${fmt(std)} ${meta.unit} ${hasPersonal ? '(personal)' : '(benchmark)'}`;

            return {
                ...meta,
                current: currentStr,
                rawVal: val,
                baselineMean: mean,
                baselineStd: std,
                baselineStr,
                z,
                stage,
                stageLabel,
                stageColor,
                normalRange: dynamicNormalRange,
                stressRange: dynamicStressRange,
                hasPersonal,
            };
        });
    }, [latestWindow, baselines, COLORS]);

    // Composite Z-score derived from real predictions or feature deviations
    const compositeZ = useMemo(() => {
        if (predictions && predictions.length > 0) {
            const withZ = predictions.filter((p) => typeof p.composite_z === 'number');
            if (withZ.length > 0) {
                return withZ[withZ.length - 1].composite_z;
            }
        }
        const validZs = featureMetrics.map((f) => f.z).filter((z) => typeof z === 'number');
        if (validZs.length === 0) return 0;
        return validZs.reduce((a, b) => a + b, 0) / validZs.length;
    }, [predictions, featureMetrics]);

    // Real Distribution across historical predictions
    const stageDist = useMemo(() => {
        if (!predictions || predictions.length === 0) {
            return { normal: 0, drift: 0, stress: 0, total: 0 };
        }
        let normal = 0;
        let drift = 0;
        let stress = 0;
        predictions.forEach((p) => {
            const z = typeof p.composite_z === 'number' ? p.composite_z : (p.stress_score || 0) * 3.0;
            if (p.is_anomaly || z > 2.0) stress++;
            else if (z > 1.0) drift++;
            else normal++;
        });
        return { normal, drift, stress, total: predictions.length };
    }, [predictions]);

    // Telemetry LineChart Points from real user window data
    const telemetryPoints = useMemo(() => {
        if (windowSlice.length === 0) return [];
        const bl = baselines || {};

        if (selectedFeature === 'composite') {
            return windowSlice.map((w) => {
                const d = w.data || {};
                const zs = [
                    computeZ(d.avg_dwell, bl.avg_dwell?.mean ?? 135, bl.avg_dwell?.std ?? 15),
                    computeZ(d.avg_flight, bl.avg_flight?.mean ?? 215, bl.avg_flight?.std ?? 25),
                    computeZ(d.scroll_velocity, bl.scroll_velocity?.mean ?? 750, bl.scroll_velocity?.std ?? 120),
                    computeZ(d.tilt_angle, bl.tilt_angle?.mean ?? 59, bl.tilt_angle?.std ?? 8),
                    computeZ(d.cpm, bl.cpm?.mean ?? 42, bl.cpm?.std ?? 6),
                ];
                const avgZ = zs.reduce((a, b) => a + b, 0) / zs.length;
                const pct = Math.min(100, Math.round((avgZ / 3.0) * 100));
                return {
                    value: pct,
                    date: w.date,
                };
            });
        }

        const meta = FEATURE_METADATA[selectedFeature];
        const mean = bl[selectedFeature]?.mean ?? meta.fallbackMean;
        const std = bl[selectedFeature]?.std ?? meta.fallbackStd;

        return windowSlice.map((w) => {
            const val = w.data?.[selectedFeature];
            const num = typeof val === 'number' ? val : mean;
            const z = computeZ(num, mean, std);
            const pct = Math.min(100, Math.round((z / 3.0) * 100));
            return {
                value: pct,
                date: w.date,
            };
        });
    }, [windowSlice, selectedFeature, baselines]);

    // Weekly Overview stats derived dynamically from real predictions
    const { weeklyScores, avgScore, peakDay, calmDay, detectionStats } = useMemo(() => {
        if (!predictions || predictions.length === 0) {
            const empty = Array.from({ length: 7 }, (_, i) => {
                const d = new Date();
                d.setDate(d.getDate() - (6 - i));
                return { day: d.toLocaleDateString('en-US', { weekday: 'short' }), score: 0, hasData: false };
            });
            return {
                weeklyScores: empty,
                avgScore: '--',
                peakDay: null,
                calmDay: null,
                detectionStats: { episodes: '--', total: '--', confidence: '--' },
            };
        }
        const ws = buildWeeklyChart(predictions);
        const withData = ws.filter((d) => d.hasData);
        const avg = withData.length ? Math.round((withData.reduce((a, b) => a + b.score, 0) / withData.length) * 100) : '--';
        const peak = withData.length ? withData.reduce((a, b) => (a.score > b.score ? a : b)) : null;
        const calm = withData.length ? withData.reduce((a, b) => (a.score < b.score ? a : b)) : null;

        const days = parseInt(timeRange, 10) || 7;
        const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;
        const rangePreds = predictions.filter((p) => p.timestamp && new Date(p.timestamp).getTime() > cutoffTime);
        const episodes = rangePreds.filter((p) => p.is_anomaly || (p.composite_z && p.composite_z > 2.0)).length;
        const total = rangePreds.length;
        const normalCorrect = rangePreds.filter((p) => !p.is_anomaly && (p.stress_score || 0) < 0.4).length;
        const confidence = total > 0 ? Math.round((normalCorrect / total) * 100) : '--';

        return {
            weeklyScores: ws,
            avgScore: avg,
            peakDay: peak,
            calmDay: calm,
            detectionStats: { episodes, total, confidence },
        };
    }, [predictions, timeRange]);

    const titleText = useMemo(() => {
        if (mode === 'patterns') {
            return timeRange === '28' ? 'Behavioral Pattern Analysis' : 'Pattern Charts';
        }
        if (mode === 'analysis') return 'Behavioral Analysis';
        return 'Behavioral Telemetry';
    }, [mode, timeRange]);

    const subTitleText = useMemo(() => {
        if (mode === 'patterns') {
            if (timeRange === '28') return '28-day baseline deviation tracking with normal corridor & anomaly boundaries';
            return '7-day calibration period · Live typing rhythm & 5-signal behavioral deviation';
        }
        if (mode === 'analysis') return `Stress patterns, baseline drift & validation confidence (${timeRange}D view)`;
        return `Idiographic baseline drift, anomaly boundary & continuous telemetry (${timeRange}D view)`;
    }, [mode, timeRange]);

    const overallStateColor = compositeZ > 2.0 ? COLORS.stress : compositeZ > 1.0 ? COLORS.warning : COLORS.normal;
    const overallStateLabel = compositeZ > 2.0 ? 'Pre-Stress Anomaly' : compositeZ > 1.0 ? 'Elevated Drift' : 'Normal Baseline';

    return (
        <ScreenBackground edges={['left', 'right']}>
            {/* Header row */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
                    <Icon name={NAMES.back} size={22} color={COLORS.brand} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: t.text }]}>Digital Phenotyping</Text>
                <View style={{ width: 22 }} />
            </View>

            {/* Title & Range Toggle */}
            <View style={styles.titleToggleRow}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={[styles.titleText, { color: t.text }]}>{titleText}</Text>
                    <Text style={[styles.subTitleText, { color: t.textMuted }]}>{subTitleText}</Text>
                </View>
                <View style={[styles.toggleContainer, { backgroundColor: t.pillBg, borderColor: t.border }]}>
                    <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={() => setTimeRange('7')}
                        style={[styles.toggleBtn, timeRange === '7' && { backgroundColor: COLORS.brand }]}
                    >
                        <Text style={[styles.toggleBtnText, { color: timeRange === '7' ? '#FFF' : t.textMuted }]}>7D</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={() => setTimeRange('28')}
                        style={[styles.toggleBtn, timeRange === '28' && { backgroundColor: COLORS.brand }]}
                    >
                        <Text style={[styles.toggleBtnText, { color: timeRange === '28' ? '#FFF' : t.textMuted }]}>28D</Text>
                    </TouchableOpacity>
                </View>
            </View>

            {/* Top Navigation Tabs */}
            {filteredTabs.length > 1 && (
                <View style={styles.tabRow}>
                    {filteredTabs.map((tab) => (
                        <TouchableOpacity
                            key={tab.id}
                            style={[styles.tabBtn, { backgroundColor: activeTab === tab.id ? COLORS.brand : t.surface, borderColor: t.border }]}
                            onPress={() => setActiveTab(tab.id)}
                            activeOpacity={0.8}
                        >
                            <Text style={{ color: activeTab === tab.id ? '#fff' : t.textMuted, fontSize: 11, fontWeight: '800' }}>
                                {tab.label}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
            )}

            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
                {/* ═════════════════════════════════════════════════════════════════ */}
                {/* TAB 1: PATTERNS (Continuous Drift, 5-Features, Ranges)           */}
                {/* ═════════════════════════════════════════════════════════════════ */}
                {activeTab === 'patterns' && (
                    <>
                        {/* 7D: Calibration Period Card | 28D: Baseline & Deviation Summary */}
                        {timeRange === '7' ? (
                            <Card accentColor={calibStatus?.isCalibrated ? COLORS.normal : COLORS.brand} elevated style={styles.card}>
                                <View style={styles.rowBetween}>
                                    <View style={styles.rowGap}>
                                        <Icon name={calibStatus?.isCalibrated ? NAMES.checkCircle : NAMES.trendUp} size={18} color={calibStatus?.isCalibrated ? COLORS.normal : COLORS.brand} />
                                        <Text style={[styles.cardTitle, { color: t.text, marginBottom: 0 }]}>Normal Baseline Calibration Period</Text>
                                    </View>
                                    <View style={[styles.statusPill, { backgroundColor: calibStatus?.isCalibrated ? COLORS.normalSoft : COLORS.brand + '20' }]}>
                                        <StatusDot color={calibStatus?.isCalibrated ? COLORS.normal : COLORS.brand} active size={8} />
                                        <Text style={[styles.statusPillText, { color: calibStatus?.isCalibrated ? COLORS.normalDark : COLORS.brand }]}>
                                            {calibStatus?.isCalibrated ? 'CALIBRATED' : 'LEARNING'}
                                        </Text>
                                    </View>
                                </View>
                                <View style={{ marginTop: 10 }}>
                                    <View style={[styles.progressTrack, { backgroundColor: t.pillBg, height: 6, borderRadius: 3 }]}>
                                        <View style={[styles.progressFill, { width: `${calibStatus?.progressPct || 0}%`, backgroundColor: calibStatus?.isCalibrated ? COLORS.normal : COLORS.brand, height: 6, borderRadius: 3 }]} />
                                    </View>
                                    {!calibStatus?.isCalibrated && (
                                        <View style={[styles.rowBetween, { marginTop: 4 }]}>
                                            <Text style={{ fontSize: 10.5, fontWeight: '700', color: t.textMuted }}>{calibStatus?.displayDays || 'Day 1 of 7'}</Text>
                                            <Text style={{ fontSize: 10.5, fontWeight: '700', color: t.textMuted }}>{calibStatus?.progressPct || 0}% complete</Text>
                                        </View>
                                    )}
                                </View>
                                <Text style={[styles.cardSub, { color: t.textMuted, marginTop: 8 }]}>
                                    {calibStatus?.isCalibrated
                                        ? 'Your personal baseline fingerprint is established. Monitoring deviations from your unique rhythm.'
                                        : 'Collecting your natural typing rhythm, scroll habits & device posture to build a personalized baseline.'}
                                </Text>
                            </Card>
                        ) : (
                            <Card accentColor={overallStateColor} elevated style={styles.card}>
                                <View style={styles.rowBetween}>
                                    <View style={styles.rowGap}>
                                        <Icon name={NAMES.brain} size={18} color={overallStateColor} />
                                        <Text style={[styles.cardTitle, { color: t.text, marginBottom: 0 }]}>28-Day Baseline & Deviation Summary</Text>
                                    </View>
                                    <View style={[styles.statusPill, { backgroundColor: overallStateColor + '20' }]}>
                                        <StatusDot color={overallStateColor} active size={8} />
                                        <Text style={[styles.statusPillText, { color: overallStateColor }]}>{overallStateLabel}</Text>
                                    </View>
                                </View>
                                {/* Normal Baseline Corridor Visual */}
                                <View style={{ marginTop: 10, backgroundColor: COLORS.normalSoft, borderRadius: 10, padding: 10 }}>
                                    <View style={styles.rowBetween}>
                                        <View style={styles.rowGap}>
                                            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.normal }} />
                                            <Text style={{ fontSize: 11, fontWeight: '800', color: COLORS.normalDark }}>Normal Baseline Corridor</Text>
                                        </View>
                                        <Text style={{ fontSize: 11, fontWeight: '800', color: COLORS.normalDark }}>Z {'<'} 1.0</Text>
                                    </View>
                                </View>
                                <View style={{ marginTop: 6, backgroundColor: COLORS.warning + '15', borderRadius: 10, padding: 10 }}>
                                    <View style={styles.rowBetween}>
                                        <View style={styles.rowGap}>
                                            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.warning }} />
                                            <Text style={{ fontSize: 11, fontWeight: '800', color: COLORS.warning }}>Elevated Drift Zone</Text>
                                        </View>
                                        <Text style={{ fontSize: 11, fontWeight: '800', color: COLORS.warning }}>Z 1.0 – 2.0</Text>
                                    </View>
                                </View>
                                <View style={{ marginTop: 6, backgroundColor: COLORS.stressSoft, borderRadius: 10, padding: 10 }}>
                                    <View style={styles.rowBetween}>
                                        <View style={styles.rowGap}>
                                            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.stress }} />
                                            <Text style={{ fontSize: 11, fontWeight: '800', color: COLORS.stressDark }}>Pre-Stress Anomaly</Text>
                                        </View>
                                        <Text style={{ fontSize: 11, fontWeight: '800', color: COLORS.stressDark }}>Z {'>'} 2.0</Text>
                                    </View>
                                </View>
                                <Text style={[styles.cardSub, { color: t.textMuted, marginTop: 8 }]}>
                                    Composite Drift Z = {compositeZ.toFixed(2)} · Extended 28-day longitudinal behavioral tracking active
                                </Text>
                            </Card>
                        )}

                        {/* Feature Switcher Pills */}
                        <View style={styles.featureChipsContainer}>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsScroll}>
                                <TouchableOpacity
                                    activeOpacity={0.8}
                                    style={[
                                        styles.chipBtn,
                                        { backgroundColor: selectedFeature === 'composite' ? COLORS.brand : t.surface, borderColor: t.border },
                                    ]}
                                    onPress={() => setSelectedFeature('composite')}
                                >
                                    <Text style={[styles.chipText, { color: selectedFeature === 'composite' ? '#FFF' : t.text }]}>
                                        ⚡ Composite Drift
                                    </Text>
                                </TouchableOpacity>
                                {featureMetrics.map((f) => (
                                    <TouchableOpacity
                                        key={f.id}
                                        activeOpacity={0.8}
                                        style={[
                                            styles.chipBtn,
                                            { backgroundColor: selectedFeature === f.id ? COLORS.brand : t.surface, borderColor: t.border },
                                        ]}
                                        onPress={() => setSelectedFeature(f.id)}
                                    >
                                        <Text style={[styles.chipText, { color: selectedFeature === f.id ? '#FFF' : t.text }]}>
                                            {f.icon} {f.name}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                        </View>

                        {/* Interactive Continuous Telemetry LineChart */}
                        <Card elevated style={styles.card}>
                            <View style={styles.rowBetween}>
                                <View style={{ flex: 1, marginRight: 8 }}>
                                    <Text style={[styles.cardTitle, { color: t.text }]}>
                                        {selectedFeature === 'composite'
                                            ? (timeRange === '28'
                                                ? `28-DAY BEHAVIORAL DRIFT (${windowSlice.length} WINDOWS)`
                                                : `CALIBRATION DRIFT CURVE (${windowSlice.length} WINDOWS)`)
                                            : `${FEATURE_METADATA[selectedFeature]?.name.toUpperCase()} DEVIATION CURVE`}
                                    </Text>
                                    <Text style={[styles.cardSub, { color: t.textMuted, marginTop: 2 }]}>
                                        {selectedFeature === 'composite'
                                            ? (timeRange === '28'
                                                ? 'Long-range baseline corridor with deviation highlights'
                                                : 'Horizontal pan enabled · Tap points for exact timestamps & delta')
                                            : FEATURE_METADATA[selectedFeature]?.description}
                                    </Text>
                                </View>
                                <View style={{ backgroundColor: timeRange === '28' ? COLORS.brand + '15' : COLORS.normalSoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 }}>
                                    <Text style={{ fontSize: 9, fontWeight: '900', color: timeRange === '28' ? COLORS.brand : COLORS.normalDark }}>{timeRange === '28' ? '28D VIEW' : 'LIVE HCI'}</Text>
                                </View>
                            </View>

                            {telemetryPoints.length > 1 ? (
                                <View style={{ marginTop: 14 }}>
                                    <LineChart
                                        points={telemetryPoints}
                                        color={timeRange === '28' ? COLORS.brand : overallStateColor}
                                        width={CHART_WIDTH}
                                        height={timeRange === '28' ? 180 : 150}
                                        maxValue={100}
                                        hideValues
                                        baselineValue={65}
                                        baselineLabel={timeRange === '28' ? 'Anomaly boundary (Z>2.0)' : 'Pre-stress boundary (Z>2.0)'}
                                        baselineColor={COLORS.stress}
                                        baseline2Value={35}
                                        baseline2Label={timeRange === '28' ? 'Normal upper limit (Z>1.0)' : 'Drift threshold (Z>1.0)'}
                                        baseline2Color={COLORS.warning}
                                        colorZones
                                    />
                                    {/* 28D: Normal baseline band legend */}
                                    {timeRange === '28' && (
                                        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 8 }}>
                                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                                <View style={{ width: 12, height: 3, borderRadius: 2, backgroundColor: COLORS.normal }} />
                                                <Text style={{ fontSize: 9, fontWeight: '700', color: COLORS.normal }}>Normal Baseline</Text>
                                            </View>
                                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                                <View style={{ width: 12, height: 3, borderRadius: 2, backgroundColor: COLORS.warning }} />
                                                <Text style={{ fontSize: 9, fontWeight: '700', color: COLORS.warning }}>Drift Zone</Text>
                                            </View>
                                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                                <View style={{ width: 12, height: 3, borderRadius: 2, backgroundColor: COLORS.stress }} />
                                                <Text style={{ fontSize: 9, fontWeight: '700', color: COLORS.stress }}>Anomaly</Text>
                                            </View>
                                        </View>
                                    )}
                                </View>
                            ) : (
                                <Text style={[styles.cardSub, { color: t.textMuted, textAlign: 'center', marginVertical: 32 }]}>
                                    Awaiting behavioral windows… Keep interacting normally on your phone to build telemetry.
                                </Text>
                            )}
                        </Card>

                        {/* 5-Feature Baseline & Deviation Breakdown */}
                        <Card elevated style={styles.card}>
                            <Text style={[styles.cardTitle, { color: t.text, marginBottom: 4 }]}>
                                {timeRange === '28' ? '5-Feature Baseline & Deviation Map' : '5-Feature Baseline & Stage Ranges'}
                            </Text>
                            <Text style={[styles.cardSub, { color: t.textMuted, marginBottom: 14 }]}>
                                {timeRange === '28'
                                    ? 'Visual comparison of each biometric against personal baseline corridor'
                                    : 'Tap any biometric feature below to plot its dedicated telemetry curve above.'}
                            </Text>

                            {(timeRange === '7' && selectedFeature === 'composite'
                                ? featureMetrics
                                : timeRange === '7'
                                    ? featureMetrics.filter((f) => f.id === selectedFeature)
                                    : featureMetrics
                            ).map((f) => {
                                const isSelected = selectedFeature === f.id;
                                // Visual bar calculation: position current value between normal and stress
                                const normalMax = f.baselineMean + f.baselineStd;
                                const stressThreshold = f.baselineMean + 2 * f.baselineStd;
                                const rangeSpan = stressThreshold - (f.baselineMean - f.baselineStd);
                                const normalPct = rangeSpan > 0 ? Math.min(100, Math.max(0, ((normalMax - (f.baselineMean - f.baselineStd)) / rangeSpan) * 100)) : 50;
                                const currentPct = f.rawVal !== null && rangeSpan > 0
                                    ? Math.min(100, Math.max(0, ((f.rawVal - (f.baselineMean - f.baselineStd)) / rangeSpan) * 100))
                                    : 0;

                                return (
                                    <TouchableOpacity
                                        key={f.id}
                                        activeOpacity={0.7}
                                        onPress={() => setSelectedFeature(f.id)}
                                        style={[
                                            styles.featureCard,
                                            {
                                                backgroundColor: isSelected ? COLORS.brand + '10' : t.surface,
                                                borderColor: isSelected ? COLORS.brand : t.border,
                                            },
                                        ]}
                                    >
                                        <View style={styles.rowBetween}>
                                            <View style={styles.rowGap}>
                                                <Text style={{ fontSize: 18 }}>{f.icon}</Text>
                                                <View>
                                                    <Text style={[styles.featureName, { color: t.text }]}>{f.name}</Text>
                                                    <Text style={[styles.featureBaseline, { color: t.textMuted }]}>
                                                        Baseline: {f.baselineStr}
                                                    </Text>
                                                </View>
                                            </View>
                                            <View style={{ alignItems: 'flex-end' }}>
                                                <Text style={[styles.featureValue, { color: f.stageColor }]}>{f.current}</Text>
                                                <View style={[styles.miniBadge, { backgroundColor: f.stageColor + '20' }]}>
                                                    <Text style={[styles.miniBadgeText, { color: f.stageColor }]}>
                                                        Z = {f.z.toFixed(2)} · {f.stageLabel}
                                                    </Text>
                                                </View>
                                            </View>
                                        </View>

                                        {/* Visual Bar: Normal vs Stress Range Comparison */}
                                        <View style={{ marginTop: 10 }}>
                                            {/* Range Bar Track */}
                                            <View style={{ height: 22, borderRadius: 11, overflow: 'hidden', flexDirection: 'row', backgroundColor: t.pillBg }}>
                                                {/* Normal Zone */}
                                                <View style={{ width: `${normalPct}%`, backgroundColor: COLORS.normal + '30', justifyContent: 'center', alignItems: 'center' }}>
                                                    <Text style={{ fontSize: 8, fontWeight: '800', color: COLORS.normalDark }} numberOfLines={1}>NORMAL</Text>
                                                </View>
                                                {/* Drift Zone */}
                                                <View style={{ width: `${Math.max(0, 100 - normalPct)}%`, backgroundColor: COLORS.stress + '20', justifyContent: 'center', alignItems: 'center' }}>
                                                    <Text style={{ fontSize: 8, fontWeight: '800', color: COLORS.stressDark }} numberOfLines={1}>STRESS</Text>
                                                </View>
                                            </View>
                                            {/* Current Value Indicator */}
                                            {f.rawVal !== null && (
                                                <View style={{ position: 'relative', height: 14, marginTop: 2 }}>
                                                    <View style={{
                                                        position: 'absolute',
                                                        left: `${currentPct}%`,
                                                        marginLeft: -6,
                                                        width: 0,
                                                        height: 0,
                                                        borderLeftWidth: 6,
                                                        borderRightWidth: 6,
                                                        borderBottomWidth: 8,
                                                        borderLeftColor: 'transparent',
                                                        borderRightColor: 'transparent',
                                                        borderBottomColor: f.stageColor,
                                                        transform: [{ rotate: '180deg' }],
                                                    }} />
                                                    <Text style={{ position: 'absolute', left: `${currentPct}%`, marginLeft: -18, top: 7, fontSize: 8, fontWeight: '800', color: f.stageColor, width: 36, textAlign: 'center' }}>
                                                        NOW
                                                    </Text>
                                                </View>
                                            )}
                                            {/* Range Labels */}
                                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
                                                <Text style={{ fontSize: 9, fontWeight: '700', color: COLORS.normal }}>{f.normalRange}</Text>
                                                <Text style={{ fontSize: 9, fontWeight: '700', color: COLORS.stress }}>{f.stressRange}</Text>
                                            </View>
                                        </View>
                                    </TouchableOpacity>
                                );
                            })}
                        </Card>

                        {/* State Distribution Card */}
                        {stageDist.total > 0 && (
                            <Card elevated style={styles.card}>
                                <Text style={[styles.cardTitle, { color: t.text, marginBottom: 8 }]}>Historical State Distribution</Text>
                                <DistBar
                                    label="Normal Calm"
                                    value={stageDist.normal}
                                    total={stageDist.total}
                                    color={COLORS.normal}
                                    muted={t.textMuted}
                                />
                                <DistBar
                                    label="Elevated Drift"
                                    value={stageDist.drift}
                                    total={stageDist.total}
                                    color={COLORS.warning}
                                    muted={t.textMuted}
                                />
                                <DistBar
                                    label="Pre-Stress"
                                    value={stageDist.stress}
                                    total={stageDist.total}
                                    color={COLORS.stress}
                                    muted={t.textMuted}
                                />
                            </Card>
                        )}
                    </>
                )}

                {/* ═════════════════════════════════════════════════════════════════ */}
                {/* TAB 2: OVERVIEW (Weekly Bar Chart, Peak/Calm Days, Stats)        */}
                {/* ═════════════════════════════════════════════════════════════════ */}
                {activeTab === 'overview' && (
                    <>
                        <Card elevated style={styles.card}>
                            <View style={styles.rowBetween}>
                                <Text style={[styles.cardTitle, { color: t.text }]}>Weekly Behavioral Stress Pattern</Text>
                                <Text style={[styles.avgBadge, { color: COLORS.brand, backgroundColor: COLORS.brand + '15' }]}>
                                    Avg {avgScore}/100
                                </Text>
                            </View>
                            <Text style={[styles.cardSub, { color: t.textMuted, marginTop: 4 }]}>
                                Daily aggregated behavioral load computed across 30-minute windows
                            </Text>

                            <View style={styles.barChart}>
                                {weeklyScores.map((s, i) => {
                                    const hPct = Math.max(Math.round(s.score * 100), 8);
                                    const color = !s.hasData
                                        ? t.border
                                        : s.score >= 0.6
                                        ? COLORS.stress
                                        : s.score >= 0.4
                                        ? COLORS.warning
                                        : COLORS.normal;
                                    return (
                                        <View key={i} style={styles.barCol}>
                                            <View style={[styles.barTrack, { backgroundColor: t.pillBg }]}>
                                                <View style={[styles.barFill, { height: `${hPct}%`, backgroundColor: color }]} />
                                            </View>
                                            <Text style={[styles.barLabel, { color: t.textMuted }]}>{s.day}</Text>
                                        </View>
                                    );
                                })}
                            </View>
                        </Card>

                        {/* Peak vs Calmest stats */}
                        <View style={styles.statsRow}>
                            <View style={[styles.statBox, { backgroundColor: t.surface, borderColor: t.border }]}>
                                <Text style={[styles.statLabel, { color: t.textMuted }]}>Average Score</Text>
                                <Text style={[styles.statValue, { color: t.text }]}>{avgScore}</Text>
                            </View>
                            <View style={[styles.statBox, { backgroundColor: t.surface, borderColor: t.border }]}>
                                <Text style={[styles.statLabel, { color: t.textMuted }]}>Peak Stress Day</Text>
                                <Text style={[styles.statValue, { color: COLORS.warning, fontSize: 16 }]}>
                                    {peakDay?.day || '--'}
                                </Text>
                            </View>
                            <View style={[styles.statBox, { backgroundColor: t.surface, borderColor: t.border }]}>
                                <Text style={[styles.statLabel, { color: t.textMuted }]}>Calmest Day</Text>
                                <Text style={[styles.statValue, { color: COLORS.normal, fontSize: 16 }]}>
                                    {calmDay?.day || '--'}
                                </Text>
                            </View>
                        </View>

                        {/* Pre-Stress Detection Summary */}
                        <Card elevated style={styles.card}>
                            <Text style={[styles.cardTitle, { color: t.text, marginBottom: 12 }]}>
                                Pre-Stress Detection & Validation Summary
                            </Text>
                            <View style={styles.rowBetween}>
                                <View>
                                    <Text style={[styles.hint, { color: t.textMuted }]}>Episodes detected</Text>
                                    <Text style={[styles.statValue, { color: t.text, fontSize: 18 }]}>
                                        {detectionStats.episodes}
                                    </Text>
                                </View>
                                <View>
                                    <Text style={[styles.hint, { color: t.textMuted }]}>Windows evaluated</Text>
                                    <Text style={[styles.statValue, { color: t.text, fontSize: 18 }]}>
                                        {detectionStats.total}
                                    </Text>
                                </View>
                                <View>
                                    <Text style={[styles.hint, { color: t.textMuted }]}>Model Confidence</Text>
                                    <Text style={[styles.statValue, { color: COLORS.normal, fontSize: 18 }]}>
                                        {detectionStats.confidence}%
                                    </Text>
                                </View>
                            </View>
                        </Card>
                    </>
                )}

                {/* ═════════════════════════════════════════════════════════════════ */}
                {/* TAB 3: BASELINE (7-Day Calibration & Continual EMA Learning)     */}
                {/* ═════════════════════════════════════════════════════════════════ */}
                {activeTab === 'baseline' && (
                    <>
                        {/* 7-Day Calibration Roadmap Card */}
                        <Card elevated style={styles.card} accentColor={calibStatus?.isCalibrated ? COLORS.normal : COLORS.brand}>
                            <View style={styles.rowBetween}>
                                <View style={styles.rowGap}>
                                    <Icon
                                        name={calibStatus?.isCalibrated ? NAMES.checkCircle : NAMES.trendUp}
                                        size={18}
                                        color={calibStatus?.isCalibrated ? COLORS.normal : COLORS.brand}
                                    />
                                    <Text style={[styles.cardTitle, { color: t.text, marginBottom: 0 }]}>
                                        7-Day Calibration Roadmap
                                    </Text>
                                </View>
                                <View
                                    style={[
                                        styles.statusPill,
                                        {
                                            backgroundColor: calibStatus?.isCalibrated
                                                ? COLORS.normalSoft
                                                : COLORS.brand + '20',
                                        },
                                    ]}
                                >
                                    <Text
                                        style={[
                                            styles.statusPillText,
                                            {
                                                color: calibStatus?.isCalibrated
                                                    ? COLORS.normalDark
                                                    : COLORS.brand,
                                            },
                                        ]}
                                    >
                                        {calibStatus?.isCalibrated ? 'CALIBRATED' : 'LEARNING'}
                                    </Text>
                                </View>
                            </View>

                            <View style={{ marginTop: 12 }}>
                                <View style={[styles.progressTrack, { backgroundColor: t.pillBg, height: 8, borderRadius: 4 }]}>
                                    <View
                                        style={[
                                            styles.progressFill,
                                            {
                                                width: `${calibStatus?.progressPct || 0}%`,
                                                backgroundColor: calibStatus?.isCalibrated ? COLORS.normal : COLORS.brand,
                                                height: 8,
                                                borderRadius: 4,
                                            },
                                        ]}
                                    />
                                </View>
                                <View style={[styles.rowBetween, { marginTop: 6 }]}>
                                    <Text style={{ fontSize: 11, fontWeight: '700', color: t.text }}>
                                        {calibStatus?.displayDays || 'Day 1 of 7'}
                                    </Text>
                                    <Text style={{ fontSize: 11, fontWeight: '700', color: t.textMuted }}>
                                        {calibStatus?.progressPct || 0}% complete
                                    </Text>
                                </View>
                            </View>

                            <Text style={[styles.cardSub, { color: t.textMuted, marginTop: 10, lineHeight: 17 }]}>
                                {calibStatus?.isCalibrated
                                    ? 'Your personalized baseline fingerprint is locked in. The engine continues adapting to subtle lifestyle shifts using EMA during confirmed calm windows.'
                                    : 'Passive observation stage: collecting natural typing rhythm, holding angles, and scrolling habits to compute your unique baseline mean and standard deviation.'}
                            </Text>

                            <View style={[styles.rowBetween, { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: t.border }]}>
                                <Text style={[styles.hint, { color: t.textMuted }]}>Valid stationary windows</Text>
                                <Text style={[styles.featureName, { color: t.text }]}>
                                    {dataLogCount !== null ? `${dataLogCount} windows` : '-- windows'}
                                </Text>
                            </View>
                            <View style={[styles.rowBetween, { marginTop: 8 }]}>
                                <Text style={[styles.hint, { color: t.textMuted }]}>Inference model</Text>
                                <Text style={[styles.featureName, { color: t.text }]}>One-Class SVM (Idiographic)</Text>
                            </View>
                        </Card>

                        {/* Continual Learning EMA Baseline Table */}
                        <Card elevated style={styles.card}>
                            <Text style={[styles.cardTitle, { color: t.text }]}>Idiographic Baseline Matrix (EMA)</Text>
                            <Text style={[styles.cardSub, { color: t.textMuted, marginTop: 4, marginBottom: 12 }]}>
                                Adapts dynamically using Exponential Moving Average (α = 0.2), updated exclusively during verified
                                non-anomalous stationary windows.
                            </Text>

                            {featureMetrics.map((f, i) => (
                                <View
                                    key={f.id}
                                    style={[
                                        styles.baselineRow,
                                        { borderColor: t.border },
                                        i === 0 && { borderTopWidth: 0 },
                                    ]}
                                >
                                    <View style={styles.rowGap}>
                                        <Text style={{ fontSize: 15 }}>{f.icon}</Text>
                                        <Text style={[styles.featureName, { color: t.text }]}>{f.name}</Text>
                                    </View>
                                    <Text style={[styles.hint, { color: t.textMuted, fontWeight: '700' }]}>
                                        {f.baselineStr}
                                    </Text>
                                </View>
                            ))}
                        </Card>
                    </>
                )}
            </ScrollView>
        </ScreenBackground>
    );
}

const styles = StyleSheet.create({
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 4,
    },
    backBtn: { padding: 4 },
    headerTitle: { fontSize: 15, fontWeight: '800' },
    titleToggleRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingBottom: 10,
        paddingTop: 4,
    },
    titleText: { fontSize: 20, fontWeight: '900', letterSpacing: -0.4 },
    subTitleText: { fontSize: 11, marginTop: 2 },
    toggleContainer: {
        flexDirection: 'row',
        borderRadius: 20,
        borderWidth: 1,
        padding: 2,
        alignItems: 'center',
    },
    toggleBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16 },
    toggleBtnText: { fontSize: 10.5, fontWeight: '800' },
    tabRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
    tabBtn: { flex: 1, paddingVertical: 9, borderRadius: 12, borderWidth: 1, alignItems: 'center' },
    scroll: { padding: 16, paddingTop: 6, paddingBottom: 40 },
    card: { marginVertical: 6, padding: 16, borderRadius: 20 },
    cardTitle: { fontSize: 12, fontWeight: '850', textTransform: 'uppercase', letterSpacing: 0.4 },
    cardSub: { fontSize: 11.5, lineHeight: 16 },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    rowGap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    statusPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    statusPillText: { fontSize: 11, fontWeight: '800' },
    featureChipsContainer: { marginVertical: 6 },
    chipsScroll: { gap: 6, paddingVertical: 2 },
    chipBtn: {
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 14,
        borderWidth: 1,
    },
    chipText: { fontSize: 11, fontWeight: '800' },
    featureCard: {
        borderRadius: 14,
        borderWidth: 1,
        padding: 12,
        marginBottom: 10,
    },
    featureName: { fontSize: 13, fontWeight: '800' },
    featureBaseline: { fontSize: 10.5, marginTop: 2 },
    featureValue: { fontSize: 15, fontWeight: '900' },
    miniBadge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
        marginTop: 3,
    },
    miniBadgeText: { fontSize: 9.5, fontWeight: '800' },
    rangeBox: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        borderRadius: 8,
        borderWidth: 1,
        padding: 8,
        marginTop: 8,
    },
    rangeItem: { flex: 1 },
    rangeLabel: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase' },
    rangeVal: { fontSize: 11, fontWeight: '800', marginTop: 1 },
    distRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
    distLabel: { width: 90, fontSize: 11, fontWeight: '700' },
    distBarBg: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
    distBarFill: { height: 8, borderRadius: 4 },
    distVal: { fontSize: 11.5, fontWeight: '850', minWidth: 65, textAlign: 'right' },
    barChart: { flexDirection: 'row', justifyContent: 'space-between', height: 120, marginTop: 14, alignItems: 'flex-end' },
    barCol: { flex: 1, alignItems: 'center' },
    barTrack: { width: 18, height: 90, borderRadius: 8, overflow: 'hidden', justifyContent: 'flex-end' },
    barFill: { width: '100%', borderRadius: 8 },
    barLabel: { fontSize: 9.5, fontWeight: '700', marginTop: 6 },
    statsRow: { flexDirection: 'row', gap: 8, marginVertical: 6 },
    statBox: { flex: 1, borderRadius: 14, borderWidth: 1, padding: 12, alignItems: 'center' },
    statLabel: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase' },
    statValue: { fontSize: 18, fontWeight: '900', marginTop: 4 },
    avgBadge: { fontSize: 11, fontWeight: '850', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
    hint: { fontSize: 11 },
    progressTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
    progressFill: { height: '100%', borderRadius: 4 },
    baselineRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 10,
        borderTopWidth: 1,
    },
});
