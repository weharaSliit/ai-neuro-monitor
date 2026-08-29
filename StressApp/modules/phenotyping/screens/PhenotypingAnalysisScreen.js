// ============================================================
// PhenotypingAnalysisScreen.js -- RN port of the standalone app's
// Analysis.jsx. All the real data computation (weekly chart bucketing,
// z-score deviation from personal baseline, pre-stress detection stats)
// is preserved as-is; the chart rendering itself is simplified to plain
// RN Views (width/height-based bars) instead of the original's CSS.
// ============================================================
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import ScreenBackground from '../../shared/ScreenBackground';
import { ref, onValue, off, get } from 'firebase/database';
import { db } from '../firebase';
import { useTheme } from '../../physiological/config/ThemeContext';
import Icon, { NAMES } from '../../shared/Icon';
import { usePhenotypingDeviceId } from '../utils/deviceIdentity';
import { getCalibrationStatus } from '../utils/calibrationStatus';

function buildWeeklyChart(predictions) {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(now - (6 - i) * dayMs);
        return { day: d.toLocaleDateString('en-US', { weekday: 'short' }), date: d.toDateString(), scores: [] };
    });
    predictions.forEach((p) => {
        if (!p.timestamp) return;
        const pDateStr = new Date(p.timestamp).toDateString();
        const bucket = days.find((d) => d.date === pDateStr);
        if (bucket) {
            bucket.scores.push(p.stress_score);
        }
    });
    return days.map((d) => ({
        day: d.day,
        score: d.scores.length ? d.scores.reduce((a, b) => a + b, 0) / d.scores.length : 0,
        hasData: d.scores.length > 0,
    }));
}

function computeZ(val, mean, std) {
    if (!mean || !std || mean === 0) return 0;
    return Math.min(Math.abs((val - mean) / std), 3.0);
}

const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'patterns', label: 'Patterns' },
    { id: 'baseline', label: 'Baseline' },
];

export default function PhenotypingAnalysisScreen({ navigation, route }) {
    const { isDark, theme: t, COLORS } = useTheme();
    const deviceId = usePhenotypingDeviceId();

    const [activeTab, setActiveTab] = useState(route?.params?.initialTab || 'overview');
    const [predictions, setPredictions] = useState(null);
    const [latestWindow, setLatestWindow] = useState(null);
    const [allEntries, setAllEntries] = useState([]);
    const [timeRange, setTimeRange] = useState('7');
    const [baselines, setBaselines] = useState(null);
    const [dataLogCount, setDataLogCount] = useState(null);
    const [calibStatus, setCalibStatus] = useState(null);

    useEffect(() => {
        if (!deviceId) return;
        getCalibrationStatus(deviceId).then(setCalibStatus);
    }, [deviceId]);

    useEffect(() => {
        if (!deviceId) return;
        const predRef = ref(db, `phenotyping/predictions/${deviceId}`);
        const handler = onValue(predRef, (snap) => {
            const raw = snap.val();
            setPredictions(raw ? Object.values(raw) : []);
        });
        return () => off(predRef, 'value', handler);
    }, [deviceId]);

    useEffect(() => {
        if (!deviceId) return;
        get(ref(db, `phenotyping/users/${deviceId}/baselines`)).then((s) => { if (s.exists()) setBaselines(s.val()); });
        
        const logsRef = ref(db, `phenotyping/data_logs/${deviceId}`);
        const handler = onValue(logsRef, (snapshot) => {
            const raw = snapshot.val();
            if (raw) {
                const entries = Object.entries(raw).sort((a, b) => a[0].localeCompare(b[0]));
                setAllEntries(entries);
                setDataLogCount(entries.length);
                setLatestWindow(entries[entries.length - 1][1]);
            }
        });
        return () => off(logsRef, 'value', handler);
    }, [deviceId]);

    const recentWindows = useMemo(() => {
        const limit = timeRange === '28' ? 40 : 10;
        return allEntries.slice(-limit).map((e) => ({ ts: e[0], data: e[1] }));
    }, [allEntries, timeRange]);

    const maxDwell = useMemo(() => {
        const dwells = recentWindows.map(w => w.data?.avg_dwell).filter(v => typeof v === 'number');
        return dwells.length ? Math.max(...dwells) : 150;
    }, [recentWindows]);

    const { weeklyScores, avgScore, peakDay, calmDay } = useMemo(() => {
        if (!predictions || predictions.length === 0) {
            const empty = Array.from({ length: 7 }, (_, i) => {
                const d = new Date(); d.setDate(d.getDate() - (6 - i));
                return { day: d.toLocaleDateString('en-US', { weekday: 'short' }), score: 0, hasData: false };
            });
            return { weeklyScores: empty, avgScore: '--', peakDay: null, calmDay: null };
        }
        const ws = buildWeeklyChart(predictions);
        const withData = ws.filter((d) => d.hasData);
        const avg = withData.length ? Math.round(withData.reduce((a, b) => a + b.score, 0) / withData.length * 100) : '--';
        const peak = withData.length ? withData.reduce((a, b) => (a.score > b.score ? a : b)) : null;
        const calm = withData.length ? withData.reduce((a, b) => (a.score < b.score ? a : b)) : null;
        return { weeklyScores: ws, avgScore: avg, peakDay: peak, calmDay: calm };
    }, [predictions]);

    const detectionStats = useMemo(() => {
        if (!predictions || predictions.length === 0) return { episodes: '--', total: '--', confidence: '--' };
        const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const weekPreds = predictions.filter((p) => p.timestamp && new Date(p.timestamp).getTime() > oneWeekAgo);
        const episodes = weekPreds.filter((p) => p.is_anomaly).length;
        const total = weekPreds.length;
        const normalCorrect = weekPreds.filter((p) => !p.is_anomaly && p.stress_score < 0.4).length;
        const confidence = total > 0 ? Math.round((normalCorrect / total) * 100) : '--';
        return { episodes, total, confidence };
    }, [predictions]);

    const zScore = useMemo(() => {
        if (predictions && predictions.length > 0) {
            const withZ = predictions.filter((p) => typeof p.composite_z === 'number');
            if (withZ.length > 0) {
                const latest = withZ[withZ.length - 1];
                return Math.round(latest.composite_z * 100) / 100;
            }
        }
        if (!latestWindow || !baselines) return null;
        const z = computeZ(latestWindow.avg_dwell, baselines.avg_dwell?.mean, baselines.avg_dwell?.std);
        return Math.round(z * 100) / 100;
    }, [predictions, latestWindow, baselines]);

    const zLabel = zScore === null ? 'Pending data' : zScore > 2.0 ? 'Pre-stress alert' : zScore > 1.0 ? 'Drifting' : 'Within baseline';
    const zColor = zScore === null ? t.textMuted : zScore > 2.0 ? COLORS.stress : zScore > 1.0 ? COLORS.warning : COLORS.normal;

    const baselineRows = useMemo(() => {
        if (!baselines) return [
            { feature: 'Dwell Time (Typing)', current: '--', std: '--' },
            { feature: 'Flight Time (Inter-key)', current: '--', std: '--' },
            { feature: 'Scroll Velocity', current: '--', std: '--' },
            { feature: 'Device Tilt Angle', current: '--', std: '--' },
            { feature: 'Typing Speed (CPM)', current: '--', std: '--' },
            { feature: 'App Switching Rate', current: '--', std: '--' },
        ];
        const bl = baselines;
        return [
            { feature: 'Dwell Time (Typing)', current: `${Math.round(bl.avg_dwell?.mean ?? 0)} ms`, std: `±${Math.round(bl.avg_dwell?.std ?? 0)} ms` },
            { feature: 'Flight Time (Inter-key)', current: `${Math.round(bl.avg_flight?.mean ?? 0)} ms`, std: `±${Math.round(bl.avg_flight?.std ?? 0)} ms` },
            { feature: 'Scroll Velocity', current: `${Math.round(bl.scroll_velocity?.mean ?? 0)} px/s`, std: `±${Math.round(bl.scroll_velocity?.std ?? 0)} px/s` },
            { feature: 'Device Tilt Angle', current: `${Math.round(bl.tilt_angle?.mean ?? 0)}°`, std: `±${Math.round(bl.tilt_angle?.std ?? 0)}°` },
            { feature: 'Typing Speed (CPM)', current: `${Math.round(bl.cpm?.mean ?? 0)} cpm`, std: `±${Math.round(bl.cpm?.std ?? 0)} cpm` },
            { feature: 'App Switching Rate', current: `${(bl.app_switch_rate?.mean ?? 0).toFixed(1)} /min`, std: `±${(bl.app_switch_rate?.std ?? 0).toFixed(1)}` },
        ];
    }, [baselines]);

    const signalDeviations = useMemo(() => {
        if (!latestWindow || !baselines) return null;
        const lw = latestWindow, bl = baselines;
        return [
            { signal: '⌨️ Typing Dwell', z: computeZ(lw.avg_dwell, bl.avg_dwell?.mean, bl.avg_dwell?.std), current: `${Math.round(lw.avg_dwell || 0)} ms`, baseline: bl.avg_dwell?.mean ? `${Math.round(bl.avg_dwell.mean)} ms` : '--' },
            { signal: '✈️ Flight Time', z: computeZ(lw.avg_flight, bl.avg_flight?.mean, bl.avg_flight?.std), current: `${Math.round(lw.avg_flight || 0)} ms`, baseline: bl.avg_flight?.mean ? `${Math.round(bl.avg_flight.mean)} ms` : '--' },
            { signal: '📜 Scroll Speed', z: computeZ(lw.scroll_velocity, bl.scroll_velocity?.mean, bl.scroll_velocity?.std), current: `${Math.round(lw.scroll_velocity || 0)} px/s`, baseline: bl.scroll_velocity?.mean ? `${Math.round(bl.scroll_velocity.mean)} px/s` : '--' },
            { signal: '📐 Device Tilt', z: computeZ(lw.tilt_angle, bl.tilt_angle?.mean, bl.tilt_angle?.std), current: `${Math.round(lw.tilt_angle || 0)}°`, baseline: bl.tilt_angle?.mean ? `${Math.round(bl.tilt_angle.mean)}°` : '--' },
            { signal: '🔡 Typing Speed', z: computeZ(lw.cpm, bl.cpm?.mean, bl.cpm?.std), current: `${Math.round(lw.cpm || 0)} cpm`, baseline: bl.cpm?.mean ? `${Math.round(bl.cpm.mean)} cpm` : '--' },
            { signal: '🔀 App Switching', z: computeZ(lw.app_switch_rate, bl.app_switch_rate?.mean, bl.app_switch_rate?.std), current: `${(lw.app_switch_rate || 0).toFixed(1)}/min`, baseline: bl.app_switch_rate?.mean ? `${bl.app_switch_rate.mean.toFixed(1)}/min` : '--' },
        ];
    }, [latestWindow, baselines]);

    return (
        <ScreenBackground edges={['left', 'right']}>
            {/* Header row */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
                    <Icon name={NAMES.back} size={22} color={COLORS.brand} />
                </TouchableOpacity>
                <View style={{ width: 22 }} />
            </View>

            {/* Title & Toggle row */}
            <View style={styles.titleToggleRow}>
                <View style={{ flex: 1 }}>
                    <Text style={[styles.titleText, { color: t.text }]}>Pattern Charts</Text>
                    <Text style={[styles.subTitleText, { color: t.textMuted }]}>Behavioral deviation & dwell dynamics for ui</Text>
                </View>
                <View style={[styles.toggleContainer, { backgroundColor: t.pillBg, borderColor: t.border }]}>
                    <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={() => setTimeRange('7')}
                        style={[styles.toggleBtn, timeRange === '7' && { backgroundColor: COLORS.brand }]}
                    >
                        <Text style={[styles.toggleBtnText, { color: timeRange === '7' ? '#FFF' : t.textMuted }]}>7 Days</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={() => setTimeRange('28')}
                        style={[styles.toggleBtn, timeRange === '28' && { backgroundColor: COLORS.brand }]}
                    >
                        <Text style={[styles.toggleBtnText, { color: timeRange === '28' ? '#FFF' : t.textMuted }]}>28 Days</Text>
                    </TouchableOpacity>
                </View>
            </View>

            <View style={styles.tabRow}>
                {TABS.map((tab) => (
                    <TouchableOpacity
                        key={tab.id}
                        style={[styles.tabBtn, { backgroundColor: activeTab === tab.id ? COLORS.brand : t.surface, borderColor: t.border }]}
                        onPress={() => setActiveTab(tab.id)}
                    >
                        <Text style={{ color: activeTab === tab.id ? '#fff' : t.textMuted, fontSize: 11, fontWeight: '800' }}>{tab.label}</Text>
                    </TouchableOpacity>
                ))}
            </View>

            <ScrollView contentContainerStyle={styles.scroll}>
                {activeTab === 'overview' && (
                    <>
                        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                            <View style={styles.rowBetween}>
                                <Text style={[styles.cardTitle, { color: t.textMuted }]}>Behavioral Stress Pattern</Text>
                                <Text style={[styles.avgBadge, { color: COLORS.brand, backgroundColor: COLORS.brand + '15' }]}>Avg {avgScore}/100</Text>
                            </View>
                            <View style={styles.barChart}>
                                {weeklyScores.map((s, i) => {
                                    const hPct = Math.max(Math.round(s.score * 100), 8);
                                    const color = !s.hasData ? t.textSub : s.score >= 0.6 ? COLORS.stress : s.score >= 0.4 ? COLORS.warning : COLORS.normal;
                                    return (
                                        <View key={i} style={styles.barCol}>
                                            <View style={styles.barTrack}>
                                                <View style={[styles.barFill, { height: `${hPct}%`, backgroundColor: color }]} />
                                            </View>
                                            <Text style={[styles.barLabel, { color: t.textMuted }]}>{s.day}</Text>
                                        </View>
                                    );
                                })}
                            </View>
                        </View>

                        <View style={styles.statsRow}>
                            <View style={[styles.statBox, { backgroundColor: t.surface, borderColor: t.border }]}>
                                <Text style={[styles.statLabel, { color: t.textMuted }]}>Avg Score</Text>
                                <Text style={[styles.statValue, { color: t.text }]}>{avgScore}</Text>
                            </View>
                            <View style={[styles.statBox, { backgroundColor: t.surface, borderColor: t.border }]}>
                                <Text style={[styles.statLabel, { color: t.textMuted }]}>Peak Day</Text>
                                <Text style={[styles.statValue, { color: COLORS.warning, fontSize: 14 }]}>{peakDay?.day || '--'}</Text>
                            </View>
                            <View style={[styles.statBox, { backgroundColor: t.surface, borderColor: t.border }]}>
                                <Text style={[styles.statLabel, { color: t.textMuted }]}>Calmest</Text>
                                <Text style={[styles.statValue, { color: COLORS.normal, fontSize: 14 }]}>{calmDay?.day || '--'}</Text>
                            </View>
                        </View>

                        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                            <Text style={[styles.cardTitle, { color: t.textMuted, marginBottom: 12 }]}>Pre-Stress Detection Summary</Text>
                            <View style={styles.rowBetween}>
                                <View>
                                    <Text style={[styles.hint, { color: t.textMuted }]}>Episodes detected</Text>
                                    <Text style={[styles.statValue, { color: t.text, fontSize: 18 }]}>{detectionStats.episodes}</Text>
                                </View>
                                <View>
                                    <Text style={[styles.hint, { color: t.textMuted }]}>Windows</Text>
                                    <Text style={[styles.statValue, { color: t.text, fontSize: 18 }]}>{detectionStats.total}</Text>
                                </View>
                                <View>
                                    <Text style={[styles.hint, { color: t.textMuted }]}>Confidence</Text>
                                    <Text style={[styles.statValue, { color: COLORS.normal, fontSize: 18 }]}>{detectionStats.confidence}%</Text>
                                </View>
                            </View>
                        </View>
                    </>
                )}

                {activeTab === 'patterns' && (
                    <>
                        {/* Card 1: Dwell Time Trend */}
                        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                            <View style={[styles.rowBetween, { alignItems: 'flex-start', marginBottom: 12 }]}>
                                <View style={{ flex: 1, marginRight: 8 }}>
                                    <Text style={[styles.cardTitle, { color: t.textMuted }]}>
                                        DWELL TIME TREND (LAST {timeRange === '28' ? '40' : '10'} WINDOWS)
                                    </Text>
                                    <Text style={{ fontSize: 11, color: t.textMuted, marginTop: 4 }}>
                                        Your live typing dwell time vs your personal baseline mean
                                    </Text>
                                </View>
                                <View style={{ backgroundColor: COLORS.normalSoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }}>
                                    <Text style={{ fontSize: 9, fontWeight: '950', color: COLORS.normalDark }}>LIVE DATA</Text>
                                </View>
                            </View>

                            {recentWindows.length > 0 ? (
                                <>
                                    <View style={[styles.rowBetween, { marginTop: 10, marginBottom: 15 }]}>
                                        <View>
                                            <Text style={[styles.hint, { color: t.textMuted }]}>Current</Text>
                                            <Text style={[styles.dwellHeaderVal, { color: t.text }]}>
                                                {latestWindow?.avg_dwell ? `${Math.round(latestWindow.avg_dwell)} ms` : 'pending'}
                                            </Text>
                                        </View>
                                        <View>
                                            <Text style={[styles.hint, { color: t.textMuted }]}>Baseline</Text>
                                            <Text style={[styles.dwellHeaderVal, { color: t.text }]}>
                                                {baselines?.avg_dwell?.mean ? `${Math.round(baselines.avg_dwell.mean)} ms` : 'pending'}
                                            </Text>
                                        </View>
                                        <View>
                                            <Text style={[styles.hint, { color: t.textMuted }]}>Z-Score</Text>
                                            <Text style={[styles.dwellHeaderVal, { color: zScore !== null ? zScore : t.textMuted }]}>
                                                {zScore !== null ? zScore.toFixed(2) : 'pending'}
                                            </Text>
                                        </View>
                                    </View>

                                    <View style={{ height: 100, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginVertical: 12 }}>
                                        {recentWindows.map((w, idx) => {
                                            const val = w.data?.avg_dwell;
                                            if (typeof val !== 'number') return null;
                                            const z = computeZ(val, baselines?.avg_dwell?.mean, baselines?.avg_dwell?.std);
                                            const color = z > 2.0 ? COLORS.stress : z > 1.0 ? COLORS.warning : COLORS.normal;
                                            const pctHeight = `${Math.max(15, Math.min(100, (val / maxDwell) * 100))}%`;
                                            return (
                                                <View key={idx} style={{ flex: 1, alignItems: 'center', marginHorizontal: 2 }}>
                                                    <View style={{ width: '100%', height: '100%', backgroundColor: t.pillBg, borderRadius: 4, justifyContent: 'flex-end', overflow: 'hidden' }}>
                                                        <View style={{ width: '100%', height: pctHeight, backgroundColor: color, borderRadius: 4 }} />
                                                    </View>
                                                </View>
                                            );
                                        })}
                                    </View>

                                    <View style={[styles.rowBetween, { marginTop: 8 }]}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.normal }} />
                                            <Text style={{ fontSize: 10, color: t.textMuted, fontWeight: '700' }}>Normal</Text>
                                        </View>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.warning }} />
                                            <Text style={{ fontSize: 10, color: t.textMuted, fontWeight: '700' }}>Elevated</Text>
                                        </View>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.stress }} />
                                            <Text style={{ fontSize: 10, color: t.textMuted, fontWeight: '700' }}>Pre-stress</Text>
                                        </View>
                                    </View>
                                </>
                            ) : (
                                <Text style={[styles.hint, { color: t.textMuted, textAlign: 'center', marginVertical: 36 }]}>
                                    No dwell data yet. Keep typing to see your trend!
                                </Text>
                            )}
                        </View>

                        {/* Card 2: Signal Deviation */}
                        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                            <Text style={[styles.cardTitle, { color: t.textMuted, marginBottom: 16 }]}>Signal Deviation from Baseline</Text>
                            {calibStatus?.isCalibrated === false ? (
                                <View style={{ alignItems: 'center', paddingVertical: 12 }}>
                                    <Text style={{ fontSize: 32, marginBottom: 8 }}>📊</Text>
                                    <Text style={{ fontSize: 15, fontWeight: '800', color: t.text }}>{calibStatus?.title || 'Learning your rhythm'}</Text>
                                    <Text style={{ fontSize: 11.5, color: t.textSub, textAlign: 'center', marginVertical: 8, lineHeight: 17, paddingHorizontal: 16 }}>
                                        {calibStatus?.dayNumber > 7 
                                            ? "Your 7-day calibration window has closed, but we still need more valid behavioral windows to confirm your baseline."
                                            : `${calibStatus?.displayDays || 'Day 1 of 7'} complete — signal deviation bars activate once your baseline is confirmed`
                                        }
                                    </Text>
                                    <View style={{ width: '100%', marginTop: 12, paddingHorizontal: 8 }}>
                                        <View style={[styles.progressTrack, { backgroundColor: t.pillBg, height: 8, borderRadius: 4 }]}>
                                            <View style={[styles.progressFill, { width: `${calibStatus?.progressPct || 0}%`, backgroundColor: COLORS.brand, height: 8, borderRadius: 4 }]} />
                                        </View>
                                        <Text style={{ fontSize: 10, fontWeight: '700', color: t.textMuted, textAlign: 'center', marginTop: 6 }}>
                                            {calibStatus?.progressPct || 0}% of calibration complete
                                        </Text>
                                    </View>
                                </View>
                            ) : signalDeviations ? (
                                <>
                                    {signalDeviations.map((s, i) => {
                                        const pct = Math.round((s.z / 3.0) * 100);
                                        const color = s.z > 2.0 ? COLORS.stress : s.z > 1.0 ? COLORS.warning : COLORS.normal;
                                        return (
                                            <View key={i} style={{ marginBottom: 12 }}>
                                                <View style={styles.rowBetween}>
                                                    <Text style={[styles.signalName, { color: t.text }]}>{s.signal}</Text>
                                                    <Text style={[styles.hint, { color: t.textMuted }]}>{s.current} vs {s.baseline}</Text>
                                                </View>
                                                <View style={[styles.progressTrack, { backgroundColor: t.border }]}>
                                                    <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: color }]} />
                                                </View>
                                            </View>
                                        );
                                    })}
                                </>
                            ) : (
                                <Text style={[styles.hint, { color: t.textMuted, textAlign: 'center', marginTop: 12 }]}>Waiting for baseline data…</Text>
                            )}
                        </View>

                        {/* Card 3: Current Z-Score Deviation */}
                        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                            <Text style={[styles.cardTitle, { color: t.textMuted }]}>Current Z-Score Deviation</Text>
                            {calibStatus?.isCalibrated === false ? (
                                <>
                                    <Text style={[styles.zScoreValue, { color: t.textMuted }]}>--</Text>
                                    <Text style={[styles.hint, { color: t.textMuted, fontWeight: '800' }]}>Awaiting calibration baseline</Text>
                                </>
                            ) : (
                                <>
                                    <Text style={[styles.zScoreValue, { color: zColor }]}>{zScore !== null ? zScore.toFixed(2) : '--'}</Text>
                                    <Text style={[styles.hint, { color: zColor, fontWeight: '800' }]}>{zLabel}</Text>
                                </>
                            )}
                            <Text style={[styles.hint, { color: t.textMuted, marginTop: 4 }]}>Anomaly trigger threshold: Z &gt; 2.0</Text>
                        </View>
                    </>
                )}

                {activeTab === 'baseline' && (
                    <>
                        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                            <Text style={[styles.cardTitle, { color: t.textMuted }]}>Idiographic Baseline (EMA)</Text>
                            <Text style={[styles.hint, { color: t.textMuted, marginBottom: 12 }]}>
                                Your personal baseline adapts using an Exponential Moving Average (α=0.2), updated only
                                during non-anomalous windows.
                            </Text>
                            {baselineRows.map((row, i) => (
                                <View key={i} style={[styles.baselineRow, { borderColor: t.border }]}>
                                    <Text style={[styles.signalName, { color: t.text }]}>{row.feature}</Text>
                                    <Text style={[styles.hint, { color: t.textMuted }]}>{row.current} {row.std}</Text>
                                </View>
                            ))}
                        </View>

                        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                            <Text style={[styles.cardTitle, { color: t.textMuted, marginBottom: 12 }]}>7-Day Calibration Status</Text>
                            
                            <View style={[styles.rowBetween, { marginBottom: 8 }]}>
                                <Text style={[styles.hint, { color: t.textMuted }]}>Monitoring state</Text>
                                <View style={{ 
                                    backgroundColor: zScore === null ? t.border : zScore > 2.0 ? COLORS.stressSoft : zScore > 1.0 ? COLORS.warningSoft : COLORS.normalSoft, 
                                    paddingHorizontal: 8, 
                                    paddingVertical: 3, 
                                    borderRadius: 8 
                                }}>
                                    <Text style={{ 
                                        fontSize: 9, 
                                        fontWeight: '900', 
                                        color: zScore === null ? t.textMuted : zScore > 2.0 ? COLORS.stressDark : zScore > 1.0 ? COLORS.warningDark : COLORS.normalDark 
                                    }}>{zScore === null ? 'PENDING' : zScore > 2.0 ? 'STRESS' : zScore > 1.0 ? 'ELEVATED' : 'NORMAL'}</Text>
                                </View>
                            </View>

                            <View style={[styles.rowBetween, { marginTop: 8 }]}>
                                <Text style={[styles.hint, { color: t.textMuted }]}>Monitoring period</Text>
                                <Text style={[styles.signalName, { color: t.text }]}>{calibStatus?.displayDays || '—'}</Text>
                            </View>
                            
                            <View style={[styles.rowBetween, { marginTop: 8 }]}>
                                <Text style={[styles.hint, { color: t.textMuted }]}>Behavioral windows collected</Text>
                                <Text style={[styles.signalName, { color: t.text }]}>{dataLogCount !== null ? `${dataLogCount} windows` : '-- windows'}</Text>
                            </View>
                            
                            <View style={[styles.rowBetween, { marginTop: 8 }]}>
                                <Text style={[styles.hint, { color: t.textMuted }]}>Inference engine</Text>
                                <Text style={[styles.signalName, { color: t.text }]}>One-Class SVM</Text>
                            </View>
                        </View>
                    </>
                )}
            </ScrollView>
        </ScreenBackground>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    tabRow: { flexDirection: 'row', gap: 6, padding: 16, paddingBottom: 8 },
    tabBtn: { flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1, alignItems: 'center' },
    scroll: { padding: 16, paddingTop: 8, paddingBottom: 40 },
    card: { borderRadius: 18, borderWidth: 1, padding: 16, marginBottom: 14 },
    cardTitle: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    avgBadge: { fontSize: 11, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
    barChart: { flexDirection: 'row', justifyContent: 'space-between', height: 130, marginTop: 16, alignItems: 'flex-end' },
    barCol: { flex: 1, alignItems: 'center' },
    barTrack: { width: 18, height: 100, borderRadius: 8, overflow: 'hidden', justifyContent: 'flex-end', backgroundColor: '#00000010' },
    barFill: { width: '100%', borderRadius: 8 },
    barLabel: { fontSize: 9, fontWeight: '700', marginTop: 6 },
    statsRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
    statBox: { flex: 1, borderRadius: 14, borderWidth: 1, padding: 12, alignItems: 'center' },
    statLabel: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase' },
    statValue: { fontSize: 20, fontWeight: '900', marginTop: 4 },
    hint: { fontSize: 11 },
    zScoreValue: { fontSize: 32, fontWeight: '900', marginTop: 8 },
    signalName: { fontSize: 12, fontWeight: '700' },
    progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 6 },
    progressFill: { height: '100%', borderRadius: 3 },
    baselineRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderTopWidth: 1 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
    backBtn: { padding: 4 },
    headerTitle: { fontSize: 16, fontWeight: '900', letterSpacing: -0.2 },
    
    // Title toggle styling
    titleToggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12 },
    titleText: { fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
    subTitleText: { fontSize: 10.5, marginTop: 2 },
    toggleContainer: { flexDirection: 'row', borderRadius: 20, borderWidth: 1, padding: 2.5, gap: 2, alignItems: 'center' },
    toggleBtn: { paddingHorizontal: 10, paddingVertical: 5.5, borderRadius: 16 },
    toggleBtnText: { fontSize: 10.5, fontWeight: '800' },
    dwellHeaderVal: { fontSize: 15, fontWeight: '850', marginTop: 4 },
});
