// ============================================================
// PhenotypingValidationScreen.js -- Digital Phenotyping Validation Report.
// Three essentials-only sections for demoing/validating the detector:
//   1. Current Stress Status (the live composite reading, right now)
//   2. Calm -> Stress Escalation (composite Z over recorded windows)
//   3. ROC Curve & Cut-Point (objective composite_z vs. real self-reports)
//
// Ground truth for the ROC curve comes from the SISS/PSS-4 self-reports
// already collected in PhenotypingEmaScreen.js (phenotyping/validation_labels),
// matched by timestamp proximity to the nearest real prediction -- no new
// manual tagging UI needed, this reuses data the app already gathers.
// ============================================================
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import Svg, { Circle as SvgCircle, Line as SvgLine, Polyline } from 'react-native-svg';
import { ref, onValue, off, query, orderByKey, limitToLast } from 'firebase/database';
import { db } from '../firebase';
import ScreenBackground from '../../shared/ScreenBackground';
import Card from '../../shared/Card';
import StatusDot from '../../shared/StatusDot';
import Icon, { NAMES } from '../../shared/Icon';
import LineChart from '../../shared/LineChart';
import { useTheme } from '../../physiological/config/ThemeContext';
import { usePhenotypingDeviceId } from '../utils/deviceIdentity';

// Self-report score at/above which that moment counts as "actually stressed"
// ground truth -- SISS is 1-5 (3 = "Moderate Stress"), PSS-4 is 0-16 (8 = midpoint).
const GROUND_TRUTH_THRESHOLD = { siss: 3, pss4: 8 };

// A self-report only counts as ground truth for a prediction if a real
// reading exists within this many ms of it -- otherwise the match is too
// loose to trust (e.g. matching a Monday self-report to a Friday reading).
const MATCH_WINDOW_MS = 10 * 60 * 1000;

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

// Sweeps composite_z as the classification threshold across a labeled
// {z, label} dataset and returns the ROC curve, AUC (trapezoidal rule),
// and the Youden's-J-optimal cut-point. Returns null if the data doesn't
// contain both a calm AND a stressed self-report -- a ROC curve needs both
// classes to mean anything.
function computeRoc(points) {
    const positives = points.filter((p) => p.label === 1).length;
    const negatives = points.filter((p) => p.label === 0).length;
    if (positives === 0 || negatives === 0) return null;

    const zValues = [...new Set(points.map((p) => p.z))].sort((a, b) => b - a);
    const thresholds = [zValues[0] + 0.5, ...zValues, zValues[zValues.length - 1] - 0.5];

    const roc = thresholds.map((t) => {
        let tp = 0, fp = 0;
        points.forEach((p) => {
            const predictedPositive = p.z > t;
            if (predictedPositive && p.label === 1) tp++;
            if (predictedPositive && p.label === 0) fp++;
        });
        return { t, fpr: fp / negatives, tpr: tp / positives };
    });

    let auc = 0;
    for (let i = 1; i < roc.length; i++) {
        auc += (roc[i].fpr - roc[i - 1].fpr) * (roc[i].tpr + roc[i - 1].tpr) / 2;
    }

    let best = roc[0];
    roc.forEach((pt) => {
        if (pt.tpr - pt.fpr > best.tpr - best.fpr) best = pt;
    });

    return { roc, auc, best, positives, negatives, n: points.length };
}

function StatBlock({ label, value, color, t }) {
    return (
        <View style={{ alignItems: 'center', flex: 1 }}>
            <Text style={{ fontSize: 9.5, fontWeight: '700', color: t.textMuted, textTransform: 'uppercase' }}>{label}</Text>
            <Text style={{ fontSize: 15, fontWeight: '900', color, marginTop: 2 }}>{value}</Text>
        </View>
    );
}

// Plain SVG ROC plot -- no charting library needed, matches the rest of
// this app's hand-rolled SVG chart approach (see LineChart.js).
function RocChart({ roc, best, width, COLORS, t }) {
    const PAD = 24;
    const plotSize = width - PAD * 2;
    const toX = (fpr) => PAD + fpr * plotSize;
    const toY = (tpr) => PAD + (1 - tpr) * plotSize;
    const pathPoints = roc.map((p) => `${toX(p.fpr)},${toY(p.tpr)}`).join(' ');

    return (
        <View>
            <Svg width={width} height={PAD * 2 + plotSize}>
                <SvgLine x1={PAD} y1={PAD} x2={PAD} y2={PAD + plotSize} stroke={t.border} strokeWidth={1} />
                <SvgLine x1={PAD} y1={PAD + plotSize} x2={PAD + plotSize} y2={PAD + plotSize} stroke={t.border} strokeWidth={1} />
                <SvgLine x1={PAD} y1={PAD + plotSize} x2={PAD + plotSize} y2={PAD} stroke={t.textMuted} strokeWidth={1} strokeDasharray="4,4" />
                <Polyline points={pathPoints} fill="none" stroke={COLORS.brand} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
                <SvgCircle cx={toX(best.fpr)} cy={toY(best.tpr)} r={5.5} fill={COLORS.stress} stroke="#fff" strokeWidth={1.5} />
            </Svg>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
                <Text style={{ fontSize: 9, color: t.textMuted }}>0</Text>
                <Text style={{ fontSize: 9.5, color: t.textMuted, fontWeight: '700' }}>False Positive Rate →</Text>
                <Text style={{ fontSize: 9, color: t.textMuted }}>1</Text>
            </View>
        </View>
    );
}

export default function PhenotypingValidationScreen({ navigation, route }) {
    const { theme: t, COLORS } = useTheme();
    const ownDeviceId = usePhenotypingDeviceId();
    const deviceId = route?.params?.userId || route?.params?.deviceId || ownDeviceId;

    const [predictions, setPredictions] = useState([]);
    const [labels, setLabels] = useState([]);
    const [chartWidth, setChartWidth] = useState(280);
    const [rocWidth, setRocWidth] = useState(240);
    const [now, setNow] = useState(() => new Date());

    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 30_000);
        return () => clearInterval(id);
    }, []);

    useEffect(() => {
        if (!deviceId) return;
        const predRef = ref(db, `phenotyping/predictions/${deviceId}`);
        const predQuery = query(predRef, orderByKey(), limitToLast(2000));
        const handler = onValue(predQuery, (snap) => {
            const raw = snap.val();
            setPredictions(raw ? Object.values(raw) : []);
        });
        return () => off(predQuery, 'value', handler);
    }, [deviceId]);

    useEffect(() => {
        if (!deviceId) return;
        const labelsRef = ref(db, `phenotyping/validation_labels/${deviceId}`);
        const handler = onValue(labelsRef, (snap) => {
            const raw = snap.val() || {};
            const all = [];
            Object.entries(raw).forEach(([type, entries]) => {
                Object.values(entries || {}).forEach((e) => {
                    if (e && e.timestamp && typeof e.score === 'number') {
                        all.push({ type, score: e.score, timestamp: e.timestamp });
                    }
                });
            });
            setLabels(all);
        });
        return () => off(labelsRef, 'value', handler);
    }, [deviceId]);

    const validPredictions = useMemo(
        () => predictions
            .filter((p) => p.timestamp && typeof p.composite_z === 'number')
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)),
        [predictions]
    );

    const latestPrediction = validPredictions[validPredictions.length - 1] || null;
    const currentZ = typeof latestPrediction?.composite_z === 'number' ? latestPrediction.composite_z : 0;
    const currentStage = currentZ > 2.0 ? 'stress' : currentZ > 1.0 ? 'drift' : 'normal';
    const currentColor = !latestPrediction ? t.textMuted : currentStage === 'stress' ? COLORS.stress : currentStage === 'drift' ? COLORS.warning : COLORS.normal;
    const currentLabel = !latestPrediction ? 'No Data' : currentStage === 'stress' ? 'Pre-Stress' : currentStage === 'drift' ? 'Elevated Drift' : 'Normal';

    // Freshness of the reading the status card above is showing -- so
    // "Composite Z 0.00" can't be mistaken for a real calm reading when
    // it's actually "no reading exists yet" (see PhenotypingScreen.js's
    // identical predictionFreshness for the dashboard gauge).
    const statusFreshness = useMemo(() => {
        const ts = latestPrediction?.timestamp;
        if (!ts) return { label: null, isFresh: false };
        const updatedAt = new Date(ts);
        if (isNaN(updatedAt.getTime())) return { label: null, isFresh: false };
        const ageMs = now.getTime() - updatedAt.getTime();
        const ageMin = Math.floor(ageMs / 60000);
        let label;
        if (ageMs < 45_000) label = 'just now';
        else if (ageMin < 60) label = `${ageMin}m ago`;
        else label = `${Math.floor(ageMin / 60)}h ago`;
        return { label, isFresh: ageMs >= 0 && ageMs < 90_000 };
    }, [latestPrediction, now]);

    // Calm -> Stress escalation: bucket the full recorded history into a
    // fixed cap so the chart stays compact regardless of how many thousand
    // raw predictions exist (same reasoning as the Patterns tab chart).
    const escalationPoints = useMemo(() => {
        if (validPredictions.length === 0) return [];
        const buckets = bucketize(validPredictions, 24);
        return buckets.map((group) => {
            const avgZ = group.reduce((a, p) => a + p.composite_z, 0) / group.length;
            const pct = Math.min(100, Math.round((avgZ / 3.0) * 100));
            return { value: pct, date: new Date(group[group.length - 1].timestamp), windowCount: group.length };
        });
    }, [validPredictions]);

    // Match each self-report to the nearest real prediction within the
    // match window, and label it "stressed"/"calm" by the self-report's
    // own score -- this is the ground truth the ROC curve is built from.
    const labeledPoints = useMemo(() => {
        if (labels.length === 0 || validPredictions.length === 0) return [];
        return labels.map((lab) => {
            const threshold = GROUND_TRUTH_THRESHOLD[lab.type];
            if (threshold == null) return null;
            const labTime = new Date(lab.timestamp).getTime();
            let nearest = null, nearestDiff = Infinity;
            validPredictions.forEach((p) => {
                const diff = Math.abs(new Date(p.timestamp).getTime() - labTime);
                if (diff < nearestDiff) { nearestDiff = diff; nearest = p; }
            });
            if (!nearest || nearestDiff > MATCH_WINDOW_MS) return null;
            return { z: nearest.composite_z, label: lab.score >= threshold ? 1 : 0 };
        }).filter(Boolean);
    }, [labels, validPredictions]);

    const rocResult = useMemo(() => computeRoc(labeledPoints), [labeledPoints]);

    return (
        <ScreenBackground edges={['left', 'right']}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
                    <Icon name={NAMES.back} size={22} color={COLORS.brand} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: t.text }]}>Digital Phenotyping</Text>
                <View style={{ width: 22 }} />
            </View>

            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
                <Text style={[styles.titleText, { color: t.text }]}>Validation Report</Text>
                <Text style={[styles.subTitleText, { color: t.textMuted }]}>
                    Objective detection compared against your own self-reports
                </Text>

                {/* 1. Current Stress Status */}
                <Card elevated style={styles.card}>
                    <View style={styles.rowBetween}>
                        <Text style={[styles.cardTitle, { color: t.text }]}>Current Stress Status</Text>
                        <View style={[styles.statusPill, { backgroundColor: currentColor + '20' }]}>
                            <StatusDot color={currentColor} active={!!latestPrediction} size={8} />
                            <Text style={[styles.statusPillText, { color: currentColor }]}>{currentLabel}</Text>
                        </View>
                    </View>
                    {latestPrediction ? (
                        <>
                            <Text style={[styles.cardSub, { color: t.textMuted, marginTop: 6 }]}>
                                Composite Z {currentZ.toFixed(2)} · from your most recent real reading
                            </Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 }}>
                                <StatusDot color={statusFreshness.isFresh ? COLORS.normal : t.textMuted} active={statusFreshness.isFresh} size={6} />
                                <Text style={{ fontSize: 10, fontWeight: '700', color: statusFreshness.isFresh ? COLORS.normal : t.textMuted }}>
                                    {statusFreshness.isFresh
                                        ? 'Live · updated just now'
                                        : `As of ${new Date(latestPrediction.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} (${statusFreshness.label})`}
                                </Text>
                            </View>
                        </>
                    ) : (
                        <Text style={[styles.cardSub, { color: t.textMuted, marginTop: 6 }]}>
                            No real predictions recorded yet for this device.
                        </Text>
                    )}
                </Card>

                {/* 2. Calm -> Stress Escalation */}
                <Card elevated style={styles.card}>
                    <Text style={[styles.cardTitle, { color: t.text }]}>Calm → Stress Escalation</Text>
                    <Text style={[styles.cardSub, { color: t.textMuted, marginTop: 4 }]}>
                        Composite deviation across your recorded sessions
                    </Text>
                    {escalationPoints.length > 1 ? (
                        <View
                            style={{ marginTop: 12 }}
                            onLayout={(e) => {
                                const w = Math.round(e.nativeEvent.layout.width);
                                if (w > 0 && Math.abs(w - chartWidth) > 1) setChartWidth(w);
                            }}
                        >
                            <LineChart
                                points={escalationPoints}
                                color={currentColor}
                                width={chartWidth}
                                height={150}
                                maxValue={100}
                                hideValues
                                baselineValue={65}
                                baselineLabel="Pre-stress (Z>2.0)"
                                baselineColor={COLORS.stress}
                                baseline2Value={35}
                                baseline2Label="Drift (Z>1.0)"
                                baseline2Color={COLORS.warning}
                                colorZones
                                fitToWidth
                            />
                        </View>
                    ) : (
                        <Text style={[styles.cardSub, { color: t.textMuted, textAlign: 'center', marginVertical: 24 }]}>
                            Not enough recorded windows yet — keep using your phone normally to build this chart.
                        </Text>
                    )}
                </Card>

                {/* 3. ROC Curve & Cut-Point */}
                <Card elevated style={styles.card}>
                    <Text style={[styles.cardTitle, { color: t.text }]}>ROC Curve & Cut-Point</Text>
                    <Text style={[styles.cardSub, { color: t.textMuted, marginTop: 4, marginBottom: 4 }]}>
                        How well Composite Z separates your calm self-reports from your stressed ones
                    </Text>
                    {rocResult ? (
                        <>
                            <View
                                style={{ alignItems: 'center', marginTop: 8 }}
                                onLayout={(e) => {
                                    const w = Math.min(260, Math.round(e.nativeEvent.layout.width));
                                    if (w > 0 && Math.abs(w - rocWidth) > 1) setRocWidth(w);
                                }}
                            >
                                <RocChart roc={rocResult.roc} best={rocResult.best} width={rocWidth} COLORS={COLORS} t={t} />
                            </View>
                            <View style={{ flexDirection: 'row', marginTop: 12 }}>
                                <StatBlock label="AUC" value={rocResult.auc.toFixed(2)} color={COLORS.brand} t={t} />
                                <StatBlock label="Best Cut-Point" value={`Z > ${rocResult.best.t.toFixed(2)}`} color={COLORS.stress} t={t} />
                                <StatBlock label="Self-Reports Used" value={`${rocResult.n}`} color={t.text} t={t} />
                            </View>
                            <Text style={[styles.cardSub, { color: t.textMuted, marginTop: 12, lineHeight: 16 }]}>
                                At Z {'>'} {rocResult.best.t.toFixed(2)}, this correctly catches{' '}
                                {(rocResult.best.tpr * 100).toFixed(0)}% of your real stressed moments, with a{' '}
                                {(rocResult.best.fpr * 100).toFixed(0)}% false-alarm rate.
                            </Text>
                        </>
                    ) : (
                        <Text style={[styles.cardSub, { color: t.textMuted, textAlign: 'center', marginVertical: 24, lineHeight: 17 }]}>
                            Submit a few SISS/PSS-4 self-reports (EMA Survey) across both calm and stressed moments to
                            unlock this chart — it needs at least one report from each.
                        </Text>
                    )}
                </Card>
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
    scroll: { padding: 16, paddingTop: 6, paddingBottom: 40 },
    titleText: { fontSize: 20, fontWeight: '900', letterSpacing: -0.4, marginTop: 4 },
    subTitleText: { fontSize: 11, marginTop: 2, marginBottom: 10 },
    card: { marginVertical: 6, padding: 16, borderRadius: 20 },
    cardTitle: { fontSize: 12, fontWeight: '850', textTransform: 'uppercase', letterSpacing: 0.4 },
    cardSub: { fontSize: 11.5, lineHeight: 16 },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    statusPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    statusPillText: { fontSize: 11, fontWeight: '800' },
});
