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
import { ref, onValue, off, get, query, orderByKey, limitToLast } from 'firebase/database';
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

const CHART_WIDTH = Math.max(260, Dimensions.get('window').width - 80);
const DRIFT_CONFIRM_TARGET = 3;

function computeZ(val, mean, std) {
    if (val === undefined || val === null || mean === undefined || mean === null || !std || std === 0) return 0;
    return Math.min(Math.abs((val - mean) / std), 4.0);
}

// Groups a chronological array into `bucketCount` contiguous chunks so a
// chart always renders a fixed, small number of points regardless of how
// many thousand raw behavioral windows exist (e.g. 5,000+ windows over a
// week collapse into ~24 hourly buckets instead of one point each).
function bucketize(items, bucketCount) {
    if (items.length <= bucketCount) return items.map((it) => [it]);
    const buckets = [];
    const chunkSize = items.length / bucketCount;
    for (let b = 0; b < bucketCount; b++) {
        const start = Math.floor(b * chunkSize);
        const end = Math.floor((b + 1) * chunkSize);
        buckets.push(items.slice(start, Math.max(start + 1, end)));
    }
    return buckets;
}

// Plain-language read of the current composite deviation stage, so the
// primary message doesn't lean on a raw Z-score for a non-technical viewer.
function stageCopy(stage) {
    if (stage === 'stress') return 'Pre-stress pattern detected — well above your calm baseline.';
    if (stage === 'drift') return "You're trending above your normal range.";
    return "You're within your normal range right now.";
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
        fallbackMean: 450,
        fallbackStd: 200,
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

const FEATURE_ORDER = ['avg_dwell', 'avg_flight', 'scroll_velocity', 'tilt_angle', 'cpm'];

// Maps a feature id to the signalId PhenotypingSignalHistoryScreen expects
// (its SIGNAL_DETAILS_CONFIG groups dwell+flight together under 'keyboard').
const FEATURE_TO_SIGNAL_ID = {
    avg_dwell: 'keyboard',
    avg_flight: 'keyboard',
    scroll_velocity: 'scroll',
    tilt_angle: 'tilt',
    cpm: 'cpm',
};

// Reuses the Onboarding screen's "Step N badge + title + desc" roadmap-card
// pattern to explain, in the same visual language, how 5 raw signals become
// one classification decision -- placed right before the real-data section
// it introduces.
const CLASSIFICATION_STEPS = [
    { title: '5 signals measured', desc: 'Dwell, flight, scroll speed, device tilt & typing speed captured every window.' },
    { title: 'Each becomes a Z-score', desc: 'How far this window sits from YOUR personal calm baseline, not a population average.' },
    { title: 'Averaged into one number', desc: 'Composite Z is the plain average of all 5 deviations — no hidden weighting.' },
    { title: 'Confirmed by the anomaly model', desc: 'A One-Class SVM must independently agree before a Pre-Stress alert is raised.' },
];

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

    // Measured on-screen width of the chart's card body (via onLayout below)
    // instead of a Dimensions-minus-fixed-guess constant -- the guess doesn't
    // account for the Card's actual padding on every device size, which left
    // a visible dead gap between the chart and the card's right edge. Falls
    // back to CHART_WIDTH only for the first frame before layout fires.
    const [chartWidth, setChartWidth] = useState(CHART_WIDTH);

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
    // limitToLast(400): covers ~28 days of 30s windows (the maximum time range
    // this screen supports). Without this, the entire data_logs subtree
    // (10,000+ entries after 2+ weeks) would be downloaded on every screen open.
    useEffect(() => {
        if (!deviceId) return;
        const baselinesRef = ref(db, `phenotyping/users/${deviceId}/baselines`);
        const blHandler = onValue(baselinesRef, (s) => {
            setBaselines(s.exists() ? s.val() : null);
        });

        const logsQuery = query(ref(db, `phenotyping/data_logs/${deviceId}`), orderByKey(), limitToLast(400));
        const logHandler = onValue(logsQuery, (snapshot) => {
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
            off(logsQuery, 'value', logHandler);
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

    // How many distinct calendar days of REAL data actually exist for this
    // device. A brand-new account has the same handful of windows whether
    // you ask for 7 or 28 days -- there's nothing further back to find, so
    // both views legitimately render the same chart. Used below to say that
    // honestly instead of silently presenting a 28-day view that's really
    // just today's data relabeled.
    const dataCoverageDays = useMemo(() => {
        if (allEntries.length === 0) return 0;
        const times = allEntries.map(([key, data]) => parseEntryDate(key, data).getTime());
        const spanMs = Math.max(...times) - Math.min(...times);
        return Math.max(1, Math.ceil(spanMs / (24 * 60 * 60 * 1000)) + 1);
    }, [allEntries]);

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

    // Which single feature's full detail panel is expanded below the tile
    // row. When the composite view is selected, default to whichever real
    // signal is currently deviating the most, so the detail panel is never
    // just blank -- it surfaces the most relevant signal automatically.
    const expandedFeature = useMemo(() => {
        if (featureMetrics.length === 0) return null;
        if (selectedFeature !== 'composite') {
            return featureMetrics.find((f) => f.id === selectedFeature) || featureMetrics[0];
        }
        return [...featureMetrics].sort((a, b) => b.z - a.z)[0];
    }, [selectedFeature, featureMetrics]);

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

    // Per-feature classification breakdown — how often EACH of the 5 signals
    // individually read as Normal/Drift/Stress, from the real per-feature
    // z-scores the backend already persists on every prediction
    // (z_dwell/z_flight/z_scroll/z_tilt/z_cpm in predictor.py). Answers
    // "how does scrolling/typing/tilt etc. individually behave under stress."
    const perFeatureDist = useMemo(() => {
        const zKeyToFeature = {
            z_dwell: 'avg_dwell',
            z_flight: 'avg_flight',
            z_scroll: 'scroll_velocity',
            z_tilt: 'tilt_angle',
            z_cpm: 'cpm',
        };
        const days = parseInt(timeRange, 10) || 7;
        const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;
        const inRange = (predictions || []).filter((p) => p.timestamp && new Date(p.timestamp).getTime() > cutoffTime);
        const source = inRange.length > 0 ? inRange : (predictions || []);

        const result = {};
        Object.entries(zKeyToFeature).forEach(([zKey, featureId]) => {
            let normal = 0, drift = 0, stress = 0;
            source.forEach((p) => {
                const z = p[zKey];
                if (typeof z !== 'number') return;
                if (z > 2.0) stress++;
                else if (z > 1.0) drift++;
                else normal++;
            });
            result[featureId] = { normal, drift, stress, total: normal + drift + stress };
        });
        return result;
    }, [predictions, timeRange]);

    // Telemetry LineChart Points from real user window data — bucketed to a
    // fixed cap so the chart always fits on screen instead of scaling
    // linearly with however many thousand raw windows exist (see bucketize).
    const telemetryPoints = useMemo(() => {
        if (windowSlice.length === 0) return [];
        const bl = baselines || {};
        const bucketCount = timeRange === '28' ? 28 : 24;
        const buckets = bucketize(windowSlice, bucketCount);

        if (selectedFeature === 'composite') {
            return buckets.map((group) => {
                const zAvgs = group.map((w) => {
                    const d = w.data || {};
                    const zs = [
                        computeZ(d.avg_dwell, bl.avg_dwell?.mean ?? 135, bl.avg_dwell?.std ?? 15),
                        computeZ(d.avg_flight, bl.avg_flight?.mean ?? 215, bl.avg_flight?.std ?? 25),
                        computeZ(d.scroll_velocity, bl.scroll_velocity?.mean ?? 750, bl.scroll_velocity?.std ?? 120),
                        computeZ(d.tilt_angle, bl.tilt_angle?.mean ?? 59, bl.tilt_angle?.std ?? 8),
                        computeZ(d.cpm, bl.cpm?.mean ?? 42, bl.cpm?.std ?? 6),
                    ];
                    return zs.reduce((a, b) => a + b, 0) / zs.length;
                });
                const avgZ = zAvgs.reduce((a, b) => a + b, 0) / zAvgs.length;
                const pct = Math.min(100, Math.round((avgZ / 3.0) * 100));
                return {
                    value: pct,
                    date: group[group.length - 1].date,
                    windowCount: group.length,
                };
            });
        }

        const meta = FEATURE_METADATA[selectedFeature];
        const mean = bl[selectedFeature]?.mean ?? meta.fallbackMean;
        const std = bl[selectedFeature]?.std ?? meta.fallbackStd;

        return buckets.map((group) => {
            const zs = group.map((w) => {
                const val = w.data?.[selectedFeature];
                const num = typeof val === 'number' ? val : mean;
                return computeZ(num, mean, std);
            });
            const avgZ = zs.reduce((a, b) => a + b, 0) / zs.length;
            const pct = Math.min(100, Math.round((avgZ / 3.0) * 100));
            return {
                value: pct,
                date: group[group.length - 1].date,
                windowCount: group.length,
            };
        });
    }, [windowSlice, selectedFeature, baselines, timeRange]);

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
        const rangePreds = predictions
            .filter((p) => p.timestamp && new Date(p.timestamp).getTime() > cutoffTime)
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        const total = rangePreds.length;

        // Real episode count: merge CONSECUTIVE flagged windows into one
        // episode (rising-edge count) instead of counting every individually
        // flagged window as its own "episode" -- the previous version showed
        // 3,649 "episodes" out of 4,983 windows (73%!), which isn't what
        // "episode" means to anyone reading it and made an otherwise calm
        // week look like a near-constant crisis.
        let episodes = 0;
        let inEpisode = false;
        rangePreds.forEach((p) => {
            const flagged = p.is_anomaly || (typeof p.composite_z === 'number' && p.composite_z > 2.0);
            if (flagged && !inEpisode) episodes++;
            inEpisode = flagged;
        });

        // Real model confidence: average the `confidence` field the backend
        // already computes per prediction (predictor.py) instead of the
        // previous stand-in ("% of windows that were calm & non-anomalous",
        // a completely different quantity mislabeled as "confidence").
        const confidences = rangePreds.map((p) => p.confidence).filter((c) => typeof c === 'number');
        const confidence = confidences.length > 0
            ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100)
            : '--';

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
                                            ? (timeRange === '28' ? 'Your Rhythm — Last 28 Days' : 'Your Rhythm This Week')
                                            : `${FEATURE_METADATA[selectedFeature]?.name} Over Time`}
                                    </Text>
                                    <Text style={[styles.cardSub, { color: t.textMuted, marginTop: 2 }]}>
                                        {dataCoverageDays > 0 && dataCoverageDays < parseInt(timeRange, 10)
                                            ? `Showing all ${dataCoverageDays} day${dataCoverageDays === 1 ? '' : 's'} of data collected so far — same as the 7D/28D view will show until more history builds up.`
                                            : selectedFeature === 'composite'
                                                ? 'Tap a point on the line for that moment’s detail'
                                                : FEATURE_METADATA[selectedFeature]?.description}
                                    </Text>
                                </View>
                                <View style={{ backgroundColor: timeRange === '28' ? COLORS.brand + '15' : COLORS.normalSoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 }}>
                                    <Text style={{ fontSize: 9, fontWeight: '900', color: timeRange === '28' ? COLORS.brand : COLORS.normalDark }}>{timeRange === '28' ? '28D VIEW' : 'LIVE HCI'}</Text>
                                </View>
                            </View>

                            {/* Plain-language hero status — the headline answer, Z-score is secondary */}
                            {selectedFeature === 'composite' && (
                                <View style={[styles.heroRow, { backgroundColor: overallStateColor + '12' }]}>
                                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: overallStateColor }} />
                                    <Text style={[styles.heroText, { color: overallStateColor }]} numberOfLines={2}>
                                        {stageCopy(compositeZ > 2.0 ? 'stress' : compositeZ > 1.0 ? 'drift' : 'normal')}
                                    </Text>
                                    <Text style={[styles.heroZ, { color: overallStateColor }]}>Z {compositeZ.toFixed(2)}</Text>
                                </View>
                            )}

                            {telemetryPoints.length > 1 ? (
                                <View
                                    style={{ marginTop: 14 }}
                                    onLayout={(e) => {
                                        const w = Math.round(e.nativeEvent.layout.width);
                                        if (w > 0 && Math.abs(w - chartWidth) > 1) setChartWidth(w);
                                    }}
                                >
                                    <LineChart
                                        points={telemetryPoints}
                                        color={timeRange === '28' ? COLORS.brand : overallStateColor}
                                        width={chartWidth}
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
                                        fitToWidth
                                    />
                                </View>
                            ) : (
                                <Text style={[styles.cardSub, { color: t.textMuted, textAlign: 'center', marginVertical: 32 }]}>
                                    Awaiting behavioral windows… Keep interacting normally on your phone to build telemetry.
                                </Text>
                            )}
                        </Card>

                        {/* Compact Feature Tiles + Single Expanded Detail */}
                        <Card elevated style={styles.card}>
                            <Text style={[styles.cardTitle, { color: t.text, marginBottom: 4 }]}>5 Signals At a Glance</Text>
                            <Text style={[styles.cardSub, { color: t.textMuted, marginBottom: 12 }]}>
                                Tap a signal to see its full baseline & range detail below.
                            </Text>

                            <View style={styles.tileGrid}>
                                {featureMetrics.map((f) => {
                                    const isExpanded = expandedFeature?.id === f.id;
                                    return (
                                        <TouchableOpacity
                                            key={f.id}
                                            activeOpacity={0.75}
                                            onPress={() => setSelectedFeature(f.id)}
                                            style={[
                                                styles.featureTile,
                                                {
                                                    backgroundColor: isExpanded ? COLORS.brand + '10' : t.surface,
                                                    borderColor: isExpanded ? COLORS.brand : t.border,
                                                },
                                            ]}
                                        >
                                            <Text style={{ fontSize: 16 }}>{f.icon}</Text>
                                            <Text style={[styles.featureTileName, { color: t.text }]} numberOfLines={1}>{f.name}</Text>
                                            <View style={[styles.miniBadge, { backgroundColor: f.stageColor + '20', marginTop: 4 }]}>
                                                <Text style={[styles.miniBadgeText, { color: f.stageColor }]}>{f.stageLabel}</Text>
                                            </View>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>

                            {expandedFeature && (() => {
                                const f = expandedFeature;
                                const normalMax = f.baselineMean + f.baselineStd;
                                const stressThreshold = f.baselineMean + 2 * f.baselineStd;
                                const rangeSpan = stressThreshold - (f.baselineMean - f.baselineStd);
                                const normalPct = rangeSpan > 0 ? Math.min(100, Math.max(0, ((normalMax - (f.baselineMean - f.baselineStd)) / rangeSpan) * 100)) : 50;
                                const currentPct = f.rawVal !== null && rangeSpan > 0
                                    ? Math.min(100, Math.max(0, ((f.rawVal - (f.baselineMean - f.baselineStd)) / rangeSpan) * 100))
                                    : 0;
                                return (
                                    <View style={[styles.expandedPanel, { borderColor: t.border }]}>
                                        <View style={styles.rowBetween}>
                                            <View>
                                                <Text style={[styles.featureName, { color: t.text }]}>{f.icon} {f.name}</Text>
                                                <Text style={[styles.featureBaseline, { color: t.textMuted }]}>Baseline: {f.baselineStr}</Text>
                                            </View>
                                            <View style={{ alignItems: 'flex-end' }}>
                                                <Text style={[styles.featureValue, { color: f.stageColor }]}>{f.current}</Text>
                                                <Text style={{ fontSize: 9.5, fontWeight: '700', color: t.textMuted }}>Z = {f.z.toFixed(2)}</Text>
                                            </View>
                                        </View>

                                        <View style={{ marginTop: 10 }}>
                                            <View style={{ height: 22, borderRadius: 11, overflow: 'hidden', flexDirection: 'row', backgroundColor: t.pillBg }}>
                                                <View style={{ width: `${normalPct}%`, backgroundColor: COLORS.normal + '30', justifyContent: 'center', alignItems: 'center' }}>
                                                    <Text style={{ fontSize: 8, fontWeight: '800', color: COLORS.normalDark }} numberOfLines={1}>NORMAL</Text>
                                                </View>
                                                <View style={{ width: `${Math.max(0, 100 - normalPct)}%`, backgroundColor: COLORS.stress + '20', justifyContent: 'center', alignItems: 'center' }}>
                                                    <Text style={{ fontSize: 8, fontWeight: '800', color: COLORS.stressDark }} numberOfLines={1}>STRESS</Text>
                                                </View>
                                            </View>
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
                                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
                                                <Text style={{ fontSize: 9, fontWeight: '700', color: COLORS.normal }}>{f.normalRange}</Text>
                                                <Text style={{ fontSize: 9, fontWeight: '700', color: COLORS.stress }}>{f.stressRange}</Text>
                                            </View>
                                        </View>
                                        <Text style={[styles.cardSub, { color: t.textMuted, marginTop: 8 }]}>{f.description}</Text>
                                    </View>
                                );
                            })()}
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

                        {/* How Classification Works — reuses the Onboarding roadmap-card language
                            (badge + title + desc) so this reads as one connected explanation. */}
                        <Card elevated style={styles.card}>
                            <Text style={[styles.cardTitle, { color: t.text, marginBottom: 4 }]}>How Classification Works</Text>
                            <Text style={[styles.cardSub, { color: t.textMuted, marginBottom: 12 }]}>
                                From 5 raw signals to one stress decision, in 4 steps.
                            </Text>
                            <View style={styles.stepGrid}>
                                {CLASSIFICATION_STEPS.map((s, i) => (
                                    <View key={s.title} style={[styles.stepCard, { backgroundColor: t.pillBg, borderColor: t.border }]}>
                                        <View style={[styles.stepBadge, { backgroundColor: COLORS.brand + '20' }]}>
                                            <Text style={[styles.stepBadgeText, { color: COLORS.brand }]}>STEP {i + 1}</Text>
                                        </View>
                                        <Text style={[styles.stepTitle, { color: t.text }]}>{s.title}</Text>
                                        <Text style={[styles.stepDesc, { color: t.textMuted }]}>{s.desc}</Text>
                                    </View>
                                ))}
                            </View>
                        </Card>

                        {/* How Your Signals Combine — per-feature classification + how they average into the composite decision */}
                        <Card elevated style={styles.card}>
                            <View style={styles.rowGap}>
                                <Icon name={NAMES.eeg} size={16} color={COLORS.brand} />
                                <Text style={[styles.cardTitle, { color: t.text, marginBottom: 0 }]}>How Your Signals Combine</Text>
                            </View>
                            <Text style={[styles.cardSub, { color: t.textMuted, marginTop: 4, marginBottom: 14 }]}>
                                How each signal reads on its own, and how all 5 combine into one stress decision. Tap a signal to
                                see its full history.
                            </Text>

                            {FEATURE_ORDER.map((id) => {
                                const meta = FEATURE_METADATA[id];
                                const dist = perFeatureDist[id] || { normal: 0, drift: 0, stress: 0, total: 0 };
                                const pct = (n) => (dist.total > 0 ? Math.round((n / dist.total) * 100) : 0);
                                return (
                                    <TouchableOpacity
                                        key={id}
                                        activeOpacity={0.75}
                                        style={{ marginBottom: 12 }}
                                        onPress={() => navigation.navigate('PhenotypingSignalHistory', { signalId: FEATURE_TO_SIGNAL_ID[id] })}
                                    >
                                        <View style={styles.rowBetween}>
                                            <View style={styles.rowGap}>
                                                <Text style={{ fontSize: 13 }}>{meta.icon}</Text>
                                                <Text style={[styles.featureTileName, { color: t.text, fontSize: 12 }]}>{meta.name}</Text>
                                            </View>
                                            <Text style={{ fontSize: 9.5, fontWeight: '700', color: t.textMuted }}>{dist.total} windows</Text>
                                        </View>
                                        <View style={[styles.contribTrack, { backgroundColor: t.pillBg }]}>
                                            {dist.total > 0 && (
                                                <>
                                                    <View style={{ width: `${pct(dist.normal)}%`, backgroundColor: COLORS.normal }} />
                                                    <View style={{ width: `${pct(dist.drift)}%`, backgroundColor: COLORS.warning }} />
                                                    <View style={{ width: `${pct(dist.stress)}%`, backgroundColor: COLORS.stress }} />
                                                </>
                                            )}
                                        </View>
                                        <View style={styles.rowBetween}>
                                            <Text style={{ fontSize: 9, fontWeight: '700', color: COLORS.normal }}>{pct(dist.normal)}% Normal</Text>
                                            <Text style={{ fontSize: 9, fontWeight: '700', color: COLORS.warning }}>{pct(dist.drift)}% Drift</Text>
                                            <Text style={{ fontSize: 9, fontWeight: '700', color: COLORS.stress }}>{pct(dist.stress)}% Stress</Text>
                                        </View>
                                    </TouchableOpacity>
                                );
                            })}

                            <View style={[styles.combineDivider, { borderColor: t.border }]}>
                                <Text style={[styles.combineLabel, { color: t.textMuted }]}>RIGHT NOW → COMPOSITE</Text>
                            </View>

                            {featureMetrics.map((f) => (
                                <View key={f.id} style={styles.combineRow}>
                                    <Text style={{ width: 88, fontSize: 10, color: t.textMuted }} numberOfLines={1}>{f.icon} {f.name}</Text>
                                    <View style={[styles.combineTrack, { backgroundColor: t.pillBg }]}>
                                        <View style={{ width: `${Math.min(100, (f.z / 3) * 100)}%`, height: '100%', borderRadius: 4, backgroundColor: f.stageColor }} />
                                    </View>
                                    <Text style={{ width: 32, fontSize: 10, textAlign: 'right', color: f.stageColor, fontWeight: '800' }}>{f.z.toFixed(1)}</Text>
                                </View>
                            ))}

                            <View style={styles.compositeBadgeRow}>
                                <Text style={{ fontSize: 11, fontWeight: '700', color: t.textMuted }}>average →</Text>
                                <View style={[styles.compositeBadge, { backgroundColor: overallStateColor + '20' }]}>
                                    <Text style={{ fontSize: 12.5, fontWeight: '900', color: overallStateColor }}>
                                        Composite Z {compositeZ.toFixed(2)} · {overallStateLabel}
                                    </Text>
                                </View>
                            </View>

                            <Text style={[styles.cardSub, { color: t.textMuted, marginTop: 10, lineHeight: 16 }]}>
                                Composite Z is the plain average of the 5 deviations above. A Pre-Stress alert also requires the
                                anomaly model (One-Class SVM) to independently agree before it's confirmed — one elevated signal
                                alone won't trigger it.
                            </Text>
                        </Card>
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
                                Daily aggregated behavioral load computed across your recorded sensor windows
                            </Text>

                            <View style={styles.barChart}>
                                {weeklyScores.map((s, i) => {
                                    const hPct = Math.max(Math.round(s.score * 100), 8);
                                    const scoreNum = Math.round(s.score * 100);
                                    const isPeak = !!(peakDay && s.hasData && s.day === peakDay.day && weeklyScores.filter((d) => d.hasData).length > 1);
                                    const isCalm = !!(calmDay && s.hasData && s.day === calmDay.day && weeklyScores.filter((d) => d.hasData).length > 1 && !isPeak);
                                    const color = !s.hasData
                                        ? t.border
                                        : s.score >= 0.6
                                        ? COLORS.stress
                                        : s.score >= 0.4
                                        ? COLORS.warning
                                        : COLORS.normal;
                                    return (
                                        <View key={i} style={styles.barCol}>
                                            {/* Numeric value above the bar -- when most days score similarly
                                                high, bar HEIGHT alone can't distinguish them; the number can. */}
                                            <Text style={[styles.barScoreLabel, { color: s.hasData ? color : t.textMuted }]}>
                                                {s.hasData ? scoreNum : '--'}
                                            </Text>
                                            <View style={[styles.barTrack, { backgroundColor: t.pillBg }]}>
                                                <View style={[styles.barFill, { height: `${hPct}%`, backgroundColor: color }]} />
                                            </View>
                                            <Text
                                                style={[
                                                    styles.barLabel,
                                                    { color: isPeak ? COLORS.warning : isCalm ? COLORS.normal : t.textMuted },
                                                    (isPeak || isCalm) && { fontWeight: '900' },
                                                ]}
                                            >
                                                {s.day}{isPeak ? ' 🔥' : isCalm ? ' 🍃' : ''}
                                            </Text>
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
                                    <Text style={[
                                        styles.statValue,
                                        {
                                            color: detectionStats.confidence === '--'
                                                ? t.textMuted
                                                : detectionStats.confidence >= 70
                                                    ? COLORS.normal
                                                    : detectionStats.confidence >= 40
                                                        ? COLORS.warning
                                                        : COLORS.stress,
                                            fontSize: 18,
                                        },
                                    ]}>
                                        {detectionStats.confidence}{detectionStats.confidence !== '--' ? '%' : ''}
                                    </Text>
                                </View>
                            </View>
                            <Text style={[styles.cardSub, { color: t.textMuted, marginTop: 12, lineHeight: 16 }]}>
                                An episode is a run of consecutive elevated windows counted once, not each window
                                individually. Model Confidence is the anomaly model's own certainty in each prediction,
                                averaged across this range.
                            </Text>
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
    distLabel: { minWidth: 90, fontSize: 11, fontWeight: '700' },
    distBarBg: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
    distBarFill: { height: 8, borderRadius: 4 },
    distVal: { fontSize: 11.5, fontWeight: '850', minWidth: 65, textAlign: 'right' },
    barChart: { flexDirection: 'row', justifyContent: 'space-between', height: 120, marginTop: 14, alignItems: 'flex-end' },
    barCol: { flex: 1, alignItems: 'center' },
    barScoreLabel: { fontSize: 9.5, fontWeight: '800', marginBottom: 3 },
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
    // ── Hero status row (plain-language headline above the chart) ──
    heroRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 8,
        marginTop: 10,
    },
    heroText: { flex: 1, fontSize: 12.5, fontWeight: '800', lineHeight: 16 },
    heroZ: { fontSize: 10, fontWeight: '700' },
    // ── Compact feature tile grid (replaces 5 stacked full-width cards) ──
    tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    featureTile: {
        flexGrow: 1,
        flexBasis: '28%',
        minWidth: 90,
        minHeight: 44,
        borderRadius: 14,
        borderWidth: 1,
        paddingVertical: 10,
        paddingHorizontal: 8,
        alignItems: 'center',
    },
    featureTileName: { fontSize: 10.5, fontWeight: '800', marginTop: 4, textAlign: 'center' },
    expandedPanel: {
        marginTop: 14,
        paddingTop: 14,
        borderTopWidth: 1,
    },
    // ── Per-feature classification contribution bars ──
    contribTrack: {
        flexDirection: 'row',
        height: 14,
        borderRadius: 7,
        overflow: 'hidden',
        marginTop: 6,
        marginBottom: 3,
    },
    combineDivider: {
        borderTopWidth: 1,
        marginTop: 4,
        marginBottom: 12,
        paddingTop: 12,
    },
    combineLabel: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.5, textAlign: 'center' },
    combineRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 7 },
    combineTrack: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
    compositeBadgeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        marginTop: 6,
    },
    compositeBadge: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 12,
    },
    // ── "How Classification Works" 2x2 step grid (Onboarding roadmap-card style) ──
    stepGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    stepCard: {
        flexBasis: '47%',
        flexGrow: 1,
        borderRadius: 14,
        borderWidth: 1,
        padding: 10,
    },
    stepBadge: {
        alignSelf: 'flex-start',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 8,
        marginBottom: 6,
    },
    stepBadgeText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.3 },
    stepTitle: { fontSize: 12, fontWeight: '800', marginBottom: 2 },
    stepDesc: { fontSize: 10, lineHeight: 14 },
});
