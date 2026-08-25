// ============================================================
// PhenotypingAnalysisScreen.js -- RN port of the standalone app's
// Analysis.jsx. All the real data computation (weekly chart bucketing,
// z-score deviation from personal baseline, pre-stress detection stats)
// is preserved as-is; the chart rendering itself is simplified to plain
// RN Views (width/height-based bars) instead of the original's CSS.
// ============================================================
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ref, onValue, off, get } from 'firebase/database';
import { db } from '../firebase';
import { useTheme } from '../../physiological/config/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
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
        const bucket = days.find((d) => d.date === new Date(p.timestamp).toDateString());
        if (bucket && typeof p.stress_score === 'number') bucket.scores.push(p.stress_score);
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

export default function PhenotypingAnalysisScreen() {
    const { isDark, theme: t, COLORS } = useTheme();
    const { user } = useAuth();
    const userId = user?.userId;

    const [activeTab, setActiveTab] = useState('overview');
    const [predictions, setPredictions] = useState(null);
    const [latestWindow, setLatestWindow] = useState(null);
    const [recentWindows, setRecentWindows] = useState([]);
    const [baselines, setBaselines] = useState(null);
    const [dataLogCount, setDataLogCount] = useState(null);
    const [calibStatus, setCalibStatus] = useState(null);

    useEffect(() => {
        if (!userId) return;
        getCalibrationStatus(userId).then(setCalibStatus);
    }, [userId]);

    useEffect(() => {
        if (!userId) return;
        const predRef = ref(db, `phenotyping/predictions/${userId}`);
        const handler = onValue(predRef, (snap) => {
            const raw = snap.val();
            setPredictions(raw ? Object.values(raw) : []);
        });
        return () => off(predRef, 'value', handler);
    }, [userId]);

    useEffect(() => {
        if (!userId) return;
        get(ref(db, `phenotyping/users/${userId}/baselines`)).then((s) => { if (s.exists()) setBaselines(s.val()); });
        get(ref(db, `phenotyping/data_logs/${userId}`)).then((s) => {
            if (!s.exists()) return;
            const entries = Object.entries(s.val()).sort((a, b) => a[0].localeCompare(b[0]));
            setDataLogCount(entries.length);
            setLatestWindow(entries[entries.length - 1][1]);
            setRecentWindows(entries.slice(-10).map((e) => ({ ts: e[0], data: e[1] })));
        });
    }, [userId]);

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
        if (!latestWindow || !baselines) return null;
        const z = computeZ(latestWindow.avg_dwell, baselines.avg_dwell?.mean, baselines.avg_dwell?.std);
        return Math.round(z * 100) / 100;
    }, [latestWindow, baselines]);
    const zLabel = zScore === null ? 'Pending data' : zScore > 2.0 ? 'Pre-stress alert' : zScore > 1.0 ? 'Drifting' : 'Within baseline';
    const zColor = zScore === null ? t.textMuted : zScore > 2.0 ? COLORS.stress : zScore > 1.0 ? COLORS.warning : COLORS.normal;

    const baselineRows = useMemo(() => {
        if (!baselines) return [
            { feature: 'Dwell Time (Typing)', current: '--', std: '--' },
            { feature: 'Flight Time (Inter-key)', current: '--', std: '--' },
            { feature: 'Scroll Velocity', current: '--', std: '--' },
            { feature: 'App Switching Rate', current: '--', std: '--' },
        ];
        const bl = baselines;
        return [
            { feature: 'Dwell Time (Typing)', current: `${Math.round(bl.avg_dwell?.mean ?? 0)} ms`, std: `±${Math.round(bl.avg_dwell?.std ?? 0)} ms` },
            { feature: 'Flight Time (Inter-key)', current: `${Math.round(bl.avg_flight?.mean ?? 0)} ms`, std: `±${Math.round(bl.avg_flight?.std ?? 0)} ms` },
            { feature: 'Scroll Velocity', current: `${Math.round(bl.scroll_velocity?.mean ?? 0)} px/s`, std: `±${Math.round(bl.scroll_velocity?.std ?? 0)} px/s` },
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
            { signal: '🔀 App Switching', z: computeZ(lw.app_switch_rate, bl.app_switch_rate?.mean, bl.app_switch_rate?.std), current: `${(lw.app_switch_rate || 0).toFixed(1)}/min`, baseline: bl.app_switch_rate?.mean ? `${bl.app_switch_rate.mean.toFixed(1)}/min` : '--' },
        ];
    }, [latestWindow, baselines]);

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: t.bg }]} edges={['left', 'right']}>
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
                                    const color = !s.hasData ? '#8B8478' : s.score >= 0.6 ? COLORS.stress : s.score >= 0.4 ? COLORS.warning : COLORS.normal;
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
                        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                            <Text style={[styles.cardTitle, { color: t.textMuted }]}>Current Z-Score Deviation</Text>
                            <Text style={[styles.zScoreValue, { color: zColor }]}>{zScore !== null ? zScore.toFixed(2) : '--'}</Text>
                            <Text style={[styles.hint, { color: zColor, fontWeight: '800' }]}>{zLabel}</Text>
                            <Text style={[styles.hint, { color: t.textMuted, marginTop: 2 }]}>Anomaly trigger threshold: Z &gt; 2.0</Text>
                        </View>

                        {signalDeviations ? (
                            <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                                <Text style={[styles.cardTitle, { color: t.textMuted, marginBottom: 12 }]}>Signal Deviation from Baseline</Text>
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
                            </View>
                        ) : (
                            <Text style={[styles.hint, { color: t.textMuted, textAlign: 'center', marginTop: 20 }]}>Waiting for baseline data…</Text>
                        )}
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
                            <View style={styles.rowBetween}>
                                <Text style={[styles.hint, { color: t.textMuted }]}>Monitoring period</Text>
                                <Text style={[styles.signalName, { color: t.text }]}>{calibStatus?.displayDays || '—'}</Text>
                            </View>
                            <View style={[styles.rowBetween, { marginTop: 8 }]}>
                                <Text style={[styles.hint, { color: t.textMuted }]}>Windows collected</Text>
                                <Text style={[styles.signalName, { color: t.text }]}>{dataLogCount ?? '--'}</Text>
                            </View>
                            <View style={[styles.rowBetween, { marginTop: 8 }]}>
                                <Text style={[styles.hint, { color: t.textMuted }]}>Inference engine</Text>
                                <Text style={[styles.signalName, { color: t.text }]}>One-Class SVM</Text>
                            </View>
                        </View>
                    </>
                )}
            </ScrollView>
        </SafeAreaView>
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
});
