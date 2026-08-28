// ============================================================
// PhenotypingSignalHistoryScreen.js -- Mockup-matching history screen.
// ============================================================
import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import ScreenBackground from '../../shared/ScreenBackground';
import Card from '../../shared/Card';
import { ref, onValue, off, get } from 'firebase/database';
import { db } from '../firebase';
import { useTheme } from '../../physiological/config/ThemeContext';
import Icon, { NAMES } from '../../shared/Icon';
import { usePhenotypingDeviceId } from '../utils/deviceIdentity';

const SIGNAL_DETAILS_CONFIG = {
    keyboard: {
        title: '⌨️ Keyboard Patterns',
        unit: 'ms',
        measures: [
            { id: 'avg_dwell', name: 'Dwell Time', unit: 'ms', baselineKey: 'avg_dwell', fallbackBaseline: 120, colorZone: 'keyboard', explanation: "Dwell time is how long you hold each key down when typing. When you're stressed, your fingers tend to press keys for longer because muscle tension increases and fine motor control becomes less precise." },
            { id: 'avg_flight', name: 'Flight Time', unit: 'ms', baselineKey: 'avg_flight', fallbackBaseline: 195, colorZone: 'flight', explanation: "Flight time is the gap between releasing one key and pressing the next. Longer flight times suggest slower cognitive processing, often linked to distraction or mental fatigue." }
        ]
    },
    scroll: {
        title: '📜 Screen Scrolling',
        unit: 'px/s',
        measures: [
            { id: 'scroll_velocity', name: 'Scroll Velocity', unit: 'px/s', baselineKey: 'scroll_velocity', fallbackBaseline: 922, colorZone: 'scroll', explanation: "How fast you scroll through content. Faster scrolling than usual can indicate impatience, frustration, or difficulty focusing — a subtle pre-stress marker." }
        ]
    },
    tilt: {
        title: '📐 Device Tilt',
        unit: '°',
        measures: [
            { id: 'tilt_angle', name: 'Tilt Angle', unit: '°', baselineKey: 'tilt_angle', fallbackBaseline: 59, colorZone: 'tilt', explanation: "The angle at which you hold your phone, measured by the accelerometer. Studies show people hunch over their phone (higher tilt angle) when stressed or anxious. Population mean ≈59° when calm." }
        ]
    },
    cpm: {
        title: '🔡 Typing Speed',
        unit: 'cpm',
        measures: [
            { id: 'cpm', name: 'Typing Speed', unit: 'cpm', baselineKey: 'cpm', fallbackBaseline: 39, colorZone: 'cpm', explanation: "How fast you type in this window. A significant drop in typing speed compared to your personal baseline can signal cognitive fatigue or mental overload, even before you consciously feel it." }
        ]
    },
    app_switch: {
        title: '📱 Screen Activity',
        unit: '/min',
        measures: [
            { id: 'app_switch_rate', name: 'Switch Rate', unit: '/min', baselineKey: 'app_switch_rate', fallbackBaseline: 2, colorZone: 'app_switch', explanation: "How often you switch between apps. High switching indicates multitasking, fragmented attention, or anxiety-driven checking behaviors." }
        ]
    },
    activity: {
        title: '🚶 Activity Context',
        unit: '',
        measures: [
            { id: 'motion', name: 'Physical Motion', unit: '', baselineKey: 'data_valid', fallbackBaseline: 0, colorZone: 'activity', explanation: "Whether significant physical motion (like walking) is detected. Active motion invalidates baseline timing signals to prevent noise." }
        ]
    }
};

function parseDbKeyToDate(key) {
    try {
        const parts = key.split('_');
        if (parts.length < 1) return null;
        const dateStr = parts[0];
        const yr = parseInt(dateStr.slice(0, 4), 10);
        const mo = parseInt(dateStr.slice(4, 6), 10) - 1;
        const dy = parseInt(dateStr.slice(6, 8), 10);
        if (parts.length > 1) {
            const timeStr = parts[1];
            const hr = parseInt(timeStr.slice(0, 2), 10);
            const mn = parseInt(timeStr.slice(2, 4), 10);
            const sc = parseInt(timeStr.slice(4, 6), 10);
            return new Date(yr, mo, dy, hr, mn, sc);
        }
        return new Date(yr, mo, dy);
    } catch {
        return null;
    }
}

function getEntryDate(entry) {
    if (entry && entry.timestamp) return new Date(entry.timestamp);
    if (entry && entry.dbKey) return parseDbKeyToDate(entry.dbKey);
    return null;
}

function getLogValue(log, measureId) {
    if (!log) return null;
    if (measureId === 'motion') {
        return log.data_valid === false ? 1 : 0;
    }
    const val = log[measureId];
    return typeof val === 'number' ? val : null;
}

function getDayStatus(signalId, avgValue, bl, config) {
    if (avgValue === null) return 'pending';
    const primaryMeasure = config.measures[0];
    const mean = bl?.[primaryMeasure.baselineKey]?.mean || primaryMeasure.fallbackBaseline;
    
    if (signalId === 'keyboard') {
        if (avgValue > mean * 1.3) return 'stress';
        if (avgValue > mean * 1.15) return 'pre-stress';
    } else if (signalId === 'cpm') {
        if (avgValue < mean * 0.6) return 'stress';
        if (avgValue < mean * 0.75) return 'pre-stress';
    } else if (signalId === 'scroll') {
        if (avgValue > mean * 1.3) return 'stress';
        if (avgValue > mean * 1.15) return 'pre-stress';
    } else if (signalId === 'tilt') {
        if (avgValue > mean * 1.3) return 'stress';
        if (avgValue > mean * 1.15) return 'pre-stress';
    } else if (signalId === 'app_switch') {
        if (avgValue > mean * 1.5) return 'stress';
        if (avgValue > mean * 1.25) return 'pre-stress';
    }
    return 'normal';
}

function SparkChart({ data = [], color, height = 30, maxLimit, selectedIndex, onSelect, signalType, COLORS, t }) {
    const validValues = data.filter((v) => typeof v === 'number' && !isNaN(v));
    const maxVal = maxLimit || (validValues.length ? Math.max(...validValues) : 100);
    const trackBgColor = t.pillBg || '#F0ECE4';

    return (
        <View style={[styles.chartContainer, { height }]}>
            {data.map((val, idx) => {
                const isSelected = idx === selectedIndex;
                
                // Determine bar color dynamically based on its value/status
                let barColor = color || '#6E68B2';
                if (typeof val === 'number') {
                    if (signalType === 'keyboard' || signalType === 'weekly') {
                        barColor = val > 150 ? COLORS.stress : val > 130 ? COLORS.warning : COLORS.normal;
                    } else if (signalType === 'flight') {
                        barColor = val > 250 ? COLORS.stress : val > 210 ? COLORS.warning : COLORS.normal;
                    } else if (signalType === 'scroll') {
                        barColor = val > 1200 ? COLORS.stress : val > 1000 ? COLORS.warning : COLORS.normal;
                    } else if (signalType === 'tilt') {
                        barColor = val > 80 ? COLORS.stress : val > 70 ? COLORS.warning : COLORS.normal;
                    } else if (signalType === 'cpm') {
                        barColor = val < 25 ? COLORS.stress : val < 32 ? COLORS.warning : COLORS.normal;
                    }
                }
                
                if (isSelected) {
                    barColor = '#6E68B2';
                }
                
                let barHeightPct = '0%';
                if (typeof val === 'number' && maxVal > 0) {
                    barHeightPct = `${Math.max(15, Math.min(Math.round((val / maxVal) * 100), 100))}%`;
                }

                return (
                    <TouchableOpacity
                        key={idx}
                        style={styles.chartCol}
                        activeOpacity={0.7}
                        onPress={() => onSelect && onSelect(idx)}
                    >
                        <View style={[styles.chartColTrack, { backgroundColor: trackBgColor }]}>
                            {typeof val === 'number' && (
                                <View style={[styles.chartColFill, { height: barHeightPct, backgroundColor: barColor }]} />
                            )}
                        </View>
                        
                        {/* Selected Chevron indicator */}
                        {isSelected && typeof val === 'number' && (
                            <View style={styles.selectorOverlay}>
                                <Text style={[styles.selectorChevron, { color: '#6E68B2' }]}>◀</Text>
                                <View style={[styles.selectorCircle, { borderColor: '#FFF', backgroundColor: '#6E68B2' }]} />
                                <Text style={[styles.selectorChevron, { color: '#6E68B2' }]}>▶</Text>
                            </View>
                        )}

                        {/* Interactive Tooltip Bubble */}
                        {isSelected && typeof val === 'number' && (
                            <View style={styles.tooltipBubble}>
                                <Text style={styles.tooltipText}>{val} {signalType === 'weekly' ? 'avg' : ''}</Text>
                            </View>
                        )}
                    </TouchableOpacity>
                );
            })}
        </View>
    );
}

export default function PhenotypingSignalHistoryScreen({ navigation, route }) {
    const { theme: t, COLORS } = useTheme();
    const deviceId = usePhenotypingDeviceId();
    const signalId = route?.params?.signalId || 'keyboard';
    const config = SIGNAL_DETAILS_CONFIG[signalId] || SIGNAL_DETAILS_CONFIG.keyboard;
    const hasSecondaryMeasure = config.measures.length > 1;

    const [logs, setLogs] = useState([]);
    const [baselines, setBaselines] = useState(null);
    const [expanded, setExpanded] = useState(false);
    const [loading, setLoading] = useState(true);

    // Selection states
    const [selectedWeeklyIdx, setSelectedWeeklyIdx] = useState(6); // default today
    const [selectedPrimaryIdx, setSelectedPrimaryIdx] = useState(null);
    const [selectedSecondaryIdx, setSelectedSecondaryIdx] = useState(null);

    // Reset selection indexes when selected day changes
    useEffect(() => {
        setSelectedPrimaryIdx(null);
        setSelectedSecondaryIdx(null);
    }, [selectedWeeklyIdx]);

    useEffect(() => {
        if (!deviceId) return;
        const blRef = ref(db, `phenotyping/users/${deviceId}/baselines`);
        get(blRef).then((snap) => {
            if (snap.exists()) setBaselines(snap.val());
        });
    }, [deviceId]);

    useEffect(() => {
        if (!deviceId) return;
        setLoading(true);
        const logsRef = ref(db, `phenotyping/data_logs/${deviceId}`);
        const handler = onValue(logsRef, (snapshot) => {
            const raw = snapshot.val();
            if (raw) {
                const entries = Object.entries(raw).map(([key, value]) => ({
                    ...value,
                    dbKey: key,
                }));
                setLogs(entries);
            }
            setLoading(false);
        }, () => setLoading(false));
        return () => off(logsRef, 'value', handler);
    }, [deviceId]);

    const processedDays = useMemo(() => {
        const now = new Date();
        const dayMs = 24 * 60 * 60 * 1000;
        
        const days = Array.from({ length: 7 }, (_, i) => {
            const d = new Date(now.getTime() - (6 - i) * dayMs);
            return {
                dateStr: d.toDateString(),
                label: i === 6 ? 'Today' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
                dayOfWeek: d.toLocaleDateString('en-US', { weekday: 'short' }),
                entries: [],
                avg: null,
                min: null,
                max: null,
                status: 'pending',
                primaryVals: [],
                secondaryVals: [],
            };
        });

        logs.forEach((log) => {
            const logDate = getEntryDate(log);
            if (!logDate) return;
            const logDateStr = logDate.toDateString();
            const bucket = days.find((b) => b.dateStr === logDateStr);
            if (bucket) {
                bucket.entries.push(log);
            }
        });

        const primaryId = config.measures[0].id;
        const secondaryId = config.measures[1]?.id;

        days.forEach((day) => {
            const dayPrimary = day.entries.map((e) => getLogValue(e, primaryId)).filter((v) => typeof v === 'number');
            const daySecondary = secondaryId ? day.entries.map((e) => getLogValue(e, secondaryId)).filter((v) => typeof v === 'number') : [];
            
            day.primaryVals = dayPrimary;
            day.secondaryVals = daySecondary;

            if (dayPrimary.length > 0) {
                day.avg = Math.round(dayPrimary.reduce((a, b) => a + b, 0) / dayPrimary.length);
                day.min = Math.round(Math.min(...dayPrimary));
                day.max = Math.round(Math.max(...dayPrimary));
                day.status = getDayStatus(signalId, day.avg, baselines, config);
            }
        });

        return days;
    }, [logs, baselines, config, signalId]);

    const weekAvg = useMemo(() => {
        const validDays = processedDays.filter((d) => d.avg !== null);
        return validDays.length ? Math.round(validDays.reduce((a, b) => a + b.avg, 0) / validDays.length) : null;
    }, [processedDays]);

    const trend = useMemo(() => {
        let tr = 'Stable';
        const firstHalf = processedDays.slice(0, 4).filter((d) => d.avg !== null);
        const secondHalf = processedDays.slice(4, 7).filter((d) => d.avg !== null);
        if (firstHalf.length > 0 && secondHalf.length > 0) {
            const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
            const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
            if (secondAvg > firstAvg * 1.1) tr = 'Increasing';
            else if (secondAvg < firstAvg * 0.9) tr = 'Decreasing';
        }
        return tr;
    }, [processedDays]);

    const elevatedDays = useMemo(() => {
        return processedDays.filter((d) => d.status === 'stress' || d.status === 'pre-stress').length;
    }, [processedDays]);

    const activeDay = processedDays[selectedWeeklyIdx] || processedDays[6];

    // Primary calculations for active day
    const activePrimaryVals = activeDay.primaryVals;
    const activePrimaryChartData = useMemo(() => {
        return Array.from({ length: 12 }, (_, i) => {
            const offset = 12 - activePrimaryVals.length;
            return i >= offset ? activePrimaryVals[i - offset] : null;
        });
    }, [activePrimaryVals]);

    const primaryIndexToUse = selectedPrimaryIdx !== null ? selectedPrimaryIdx : (activePrimaryVals.length ? activePrimaryVals.length - 1 : null);
    const chartPrimarySelectedIndex = primaryIndexToUse !== null ? primaryIndexToUse + (12 - activePrimaryVals.length) : null;

    const handlePrimarySelect = (chartIdx) => {
        const offset = 12 - activePrimaryVals.length;
        const originalIdx = chartIdx - offset;
        if (originalIdx >= 0 && originalIdx < activePrimaryVals.length) {
            setSelectedPrimaryIdx(originalIdx);
        }
    };

    const displayPrimaryVal = useMemo(() => {
        const selectedVal = primaryIndexToUse !== null ? activePrimaryVals[primaryIndexToUse] : null;
        return selectedVal !== null ? `${Math.round(selectedVal)} ${config.measures[0].unit}` : 'pending';
    }, [primaryIndexToUse, activePrimaryVals, config]);

    // Secondary calculations for active day
    const activeSecondaryVals = activeDay.secondaryVals;
    const activeSecondaryChartData = useMemo(() => {
        return Array.from({ length: 12 }, (_, i) => {
            const offset = 12 - activeSecondaryVals.length;
            return i >= offset ? activeSecondaryVals[i - offset] : null;
        });
    }, [activeSecondaryVals]);

    const secondaryIndexToUse = selectedSecondaryIdx !== null ? selectedSecondaryIdx : (activeSecondaryVals.length ? activeSecondaryVals.length - 1 : null);
    const chartSecondarySelectedIndex = secondaryIndexToUse !== null ? secondaryIndexToUse + (12 - activeSecondaryVals.length) : null;

    const handleSecondarySelect = (chartIdx) => {
        const offset = 12 - activeSecondaryVals.length;
        const originalIdx = chartIdx - offset;
        if (originalIdx >= 0 && originalIdx < activeSecondaryVals.length) {
            setSelectedSecondaryIdx(originalIdx);
        }
    };

    const displaySecondaryVal = useMemo(() => {
        const selectedVal = secondaryIndexToUse !== null ? activeSecondaryVals[secondaryIndexToUse] : null;
        return selectedVal !== null ? `${Math.round(selectedVal)} ${config.measures[1]?.unit || ''}` : 'pending';
    }, [secondaryIndexToUse, activeSecondaryVals, config]);

    const formattedBaseline = (key, unit, fallback) => {
        const mean = baselines?.[key]?.mean;
        if (mean != null && mean > 0) {
            return `${Math.round(mean)} ${unit}`;
        }
        return 'pending';
    };

    if (loading) {
        return (
            <ScreenBackground>
                <View style={styles.loadingCenter}>
                    <ActivityIndicator size="large" color={COLORS.brand} />
                </View>
            </ScreenBackground>
        );
    }

    return (
        <ScreenBackground edges={['left', 'right']}>
            {/* Header row */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
                    <Icon name={NAMES.back} size={22} color={COLORS.brand} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: t.text }]}>7-Day History</Text>
                <View style={{ width: 22 }} />
            </View>

            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
                <Text style={[styles.signalTitle, { color: t.text }]}>
                    {config.title}
                </Text>

                {/* Top Statistics Cards Row */}
                <View style={styles.statsRow}>
                    <View style={[styles.statBox, { backgroundColor: t.surface, borderColor: t.border }]}>
                        <Text style={[styles.statLabel, { color: t.textMuted }]}>7-DAY AVG</Text>
                        <Text style={[
                            styles.statValue,
                            { color: weekAvg !== null ? t.text : t.textMuted },
                            weekAvg === null && { fontSize: 13, textTransform: 'capitalize' }
                        ]}>
                            {weekAvg !== null ? `${weekAvg} ${config.unit}` : 'pending'}
                        </Text>
                    </View>
                    <View style={[styles.statBox, { backgroundColor: t.surface, borderColor: t.border }]}>
                        <Text style={[styles.statLabel, { color: t.textMuted }]}>TREND</Text>
                        <Text style={[
                            styles.statValue,
                            { color: trend === 'Increasing' ? COLORS.stress : trend === 'Decreasing' ? COLORS.normal : (trend === 'pending' ? t.textMuted : t.text) },
                            trend === 'pending' && { fontSize: 13, textTransform: 'capitalize' }
                        ]}>
                            {trend}
                        </Text>
                    </View>
                    <View style={[styles.statBox, { backgroundColor: t.surface, borderColor: t.border }]}>
                        <Text style={[styles.statLabel, { color: t.textMuted }]}>ELEVATED</Text>
                        <Text style={[styles.statValue, { color: elevatedDays > 0 ? COLORS.warning : COLORS.normal }]}>
                            {elevatedDays}
                        </Text>
                        <Text style={[styles.statUnit, { color: t.textMuted }]}>days</Text>
                    </View>
                </View>

                {/* Weekly Overview Card */}
                <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                    <Text style={[styles.cardTitle, { color: t.textMuted }]}>Weekly Overview</Text>
                    <SparkChart
                        data={processedDays.map((d) => d.avg)}
                        color={COLORS.brandLight}
                        height={40}
                        selectedIndex={selectedWeeklyIdx}
                        onSelect={setSelectedWeeklyIdx}
                        signalType="weekly"
                        COLORS={COLORS}
                        t={t}
                    />
                    <View style={styles.weeklyLabelsRow}>
                        {processedDays.map((day, idx) => {
                            const isSelected = idx === selectedWeeklyIdx;
                            return (
                                <Text
                                    key={idx}
                                    style={[
                                        styles.weeklyLabel,
                                        { color: t.textSub },
                                        isSelected && { fontWeight: '900', color: COLORS.brand }
                                    ]}
                                >
                                    {day.dayOfWeek}
                                </Text>
                            );
                        })}
                    </View>
                </View>

                {/* Detailed Measures Section */}
                <Text style={[styles.sectionTitle, { color: t.textMuted }]}>
                    DETAILED MEASURES <Text style={{ fontSize: 10, fontWeight: '400' }}>({config.measures.length} measure{hasSecondaryMeasure ? 's' : ''} tracked)</Text>
                </Text>

                {config.measures.map((measure, idx) => {
                    const isPrimary = idx === 0;
                    const vals = isPrimary ? activePrimaryVals : activeSecondaryVals;
                    const chartData = isPrimary ? activePrimaryChartData : activeSecondaryChartData;
                    
                    const selectedIdx = isPrimary ? selectedPrimaryIdx : selectedSecondaryIdx;
                    const indexToUse = selectedIdx !== null ? selectedIdx : (vals.length ? vals.length - 1 : null);
                    const chartSelectedIndex = indexToUse !== null ? indexToUse + (12 - vals.length) : null;
                    
                    const handleSelect = (chartIdx) => {
                        const offset = 12 - vals.length;
                        const originalIdx = chartIdx - offset;
                        if (originalIdx >= 0 && originalIdx < vals.length) {
                            if (isPrimary) setSelectedPrimaryIdx(originalIdx);
                            else setSelectedSecondaryIdx(originalIdx);
                        }
                    };

                    const displayVal = isPrimary ? displayPrimaryVal : displaySecondaryVal;

                    return (
                        <View key={measure.id} style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                            <View style={styles.rowBetween}>
                                <Text style={[styles.measureName, { color: t.text }]}>{measure.name}</Text>
                                <Text style={[styles.measureValue, { color: COLORS.brand }]}>
                                    {displayVal}
                                </Text>
                            </View>
                            <View style={styles.measureSubRow}>
                                <Text style={[styles.baselineText, { color: t.textMuted }]}>
                                    Baseline: {formattedBaseline(measure.baselineKey, measure.unit, measure.fallbackBaseline)}
                                </Text>
                                <View style={[styles.statusBadge, { backgroundColor: COLORS.normalSoft }]}>
                                    <Text style={[styles.statusBadgeText, { color: COLORS.normalDark }]}>NORMAL</Text>
                                </View>
                            </View>
                            <View style={styles.measureChartWrap}>
                                <SparkChart
                                    data={chartData}
                                    color={measure.colorZone === 'flight' ? COLORS.normal : COLORS.warning}
                                    height={20}
                                    selectedIndex={chartSelectedIndex}
                                    onSelect={handleSelect}
                                    signalType={measure.colorZone}
                                    COLORS={COLORS}
                                    t={t}
                                />
                            </View>
                            <View style={[styles.explainBox, { backgroundColor: t.pillBg }]}>
                                <Icon name="information-outline" size={16} color={t.textMuted} style={{ marginTop: 2 }} />
                                <Text style={[styles.explainText, { color: t.textSub }]}>
                                    {measure.explanation}
                                </Text>
                            </View>
                        </View>
                    );
                })}

                {/* Today's Overview Section */}
                <Text style={[styles.sectionTitle, { color: t.textMuted }]}>
                    {selectedWeeklyIdx === 6 ? "TODAY'S OVERVIEW" : `${activeDay.label.toUpperCase()}'S OVERVIEW`}
                </Text>
                <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                    <View style={styles.rowBetween}>
                        <Text style={[styles.todayTitle, { color: t.text }]}>
                            {selectedWeeklyIdx === 6 ? "Today • Live" : `${activeDay.label} • Overview`}
                        </Text>
                        <View style={[styles.statusBadge, { backgroundColor: COLORS.normalSoft }]}>
                            <Text style={[styles.statusBadgeText, { color: COLORS.normalDark }]}>NORMAL</Text>
                        </View>
                    </View>
                    <View style={styles.todayChartWrap}>
                        <SparkChart
                            data={activePrimaryChartData}
                            color={COLORS.brandLight}
                            height={20}
                            selectedIndex={chartPrimarySelectedIndex}
                            onSelect={handlePrimarySelect}
                            signalType={config.measures[0].colorZone}
                            COLORS={COLORS}
                            t={t}
                        />
                    </View>
                    <View style={styles.todaySubrow}>
                        {config.measures.map((measure, idx) => {
                            const isPrimary = idx === 0;
                            const displayVal = isPrimary ? displayPrimaryVal : displaySecondaryVal;

                            return (
                                <View key={measure.id} style={[styles.todaySubCard, { backgroundColor: t.pillBg }]}>
                                    <Text style={[styles.todaySubLabel, { color: t.textMuted }]}>{measure.name.toUpperCase()}</Text>
                                    <Text style={[styles.todaySubVal, { color: t.text }]}>
                                        {displayVal.includes('pending') ? 'pending' : displayVal}
                                    </Text>
                                </View>
                            );
                        })}
                    </View>
                    <Text style={[styles.todaySummaryText, { color: t.textSub }]}>
                        Avg: <Text style={{ color: t.text, fontWeight: '800' }}>{activeDay.avg !== null ? `${activeDay.avg} ${config.unit}` : <Text style={{ color: t.textMuted, fontSize: 11 }}>pending</Text>}</Text>  •  Min: <Text style={{ color: t.text }}>{activeDay.min !== null ? activeDay.min : <Text style={{ color: t.textMuted, fontSize: 11 }}>pending</Text>}</Text>  •  Max: <Text style={{ color: t.text }}>{activeDay.max !== null ? activeDay.max : <Text style={{ color: t.textMuted, fontSize: 11 }}>pending</Text>}</Text>
                    </Text>
                </View>

                {/* Collapsible Accordion */}
                <TouchableOpacity
                    style={[styles.collapsibleHeader, { backgroundColor: t.surface, borderColor: t.border }]}
                    onPress={() => setExpanded(!expanded)}
                    activeOpacity={0.8}
                >
                    <View style={styles.collapsibleTitleRow}>
                        <Text style={[styles.collapsibleTitle, { color: t.text }]}>DAY BY DAY HISTORY</Text>
                        <View style={[styles.collapsibleBadge, { backgroundColor: COLORS.brandSoft }]}>
                            <Text style={{ fontSize: 10, fontWeight: '800', color: COLORS.brand }}>Past 6 Days</Text>
                        </View>
                    </View>
                    <View style={styles.rowStart}>
                        <Text style={{ fontSize: 12, fontWeight: '800', color: COLORS.brand, marginRight: 4 }}>
                            {expanded ? 'Hide' : 'Show'}
                        </Text>
                        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.brand} />
                    </View>
                </TouchableOpacity>

                {expanded && (
                    <View style={{ marginTop: 8 }}>
                        {processedDays.slice(0, 6).reverse().map((day, idx) => {
                            const dayPrimary = day.primaryVals;
                            const dayChartData = Array.from({ length: 12 }, (_, i) => {
                                const offset = 12 - dayPrimary.length;
                                return i >= offset ? dayPrimary[i - offset] : null;
                            });
                            
                            return (
                                <View key={idx} style={[styles.dayCard, { backgroundColor: t.surface, borderColor: t.border }]}>
                                    <View style={styles.rowBetween}>
                                        <Text style={[styles.dayDateLabel, { color: t.text }]}>{day.label}</Text>
                                        <View style={[styles.statusBadge, { backgroundColor: COLORS.normalSoft }]}>
                                            <Text style={[styles.statusBadgeText, { color: COLORS.normalDark }]}>NORMAL</Text>
                                        </View>
                                    </View>
                                    <View style={styles.dayChartWrap}>
                                        <SparkChart
                                            data={dayChartData}
                                            color={COLORS.brandLight}
                                            height={15}
                                            signalType={config.measures[0].colorZone}
                                            COLORS={COLORS}
                                            t={t}
                                        />
                                    </View>
                                    <View style={styles.dayStatsGrid}>
                                        <Text style={[styles.dayGridStatText, { color: t.textMuted }]}>
                                            Avg <Text style={{ color: t.text, fontWeight: '800' }}>{day.avg !== null ? `${day.avg} ${config.unit}` : 'pending'}</Text>
                                        </Text>
                                        <Text style={[styles.dayGridStatText, { color: t.textMuted }]}>
                                            Min <Text style={{ color: t.text }}>{day.min !== null ? day.min : 'pending'}</Text>
                                        </Text>
                                        <Text style={[styles.dayGridStatText, { color: t.textMuted }]}>
                                            Max <Text style={{ color: t.text }}>{day.max !== null ? day.max : 'pending'}</Text>
                                        </Text>
                                    </View>
                                </View>
                            );
                        })}
                    </View>
                )}

                <View style={{ height: 20 }} />
            </ScrollView>
        </ScreenBackground>
    );
}

const styles = StyleSheet.create({
    loadingCenter: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    scroll: { padding: 20, paddingBottom: 40 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 },
    backBtn: { padding: 4 },
    headerTitle: { fontSize: 16, fontWeight: '900', letterSpacing: -0.2 },
    signalTitle: { fontSize: 20, fontWeight: '900', letterSpacing: -0.3, marginBottom: 16 },
    
    // Top Stats Row
    statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
    statBox: { flex: 1, borderRadius: 18, borderWidth: 1.5, padding: 14, alignItems: 'center' },
    statLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.3 },
    statValue: { fontSize: 20, fontWeight: '900', marginTop: 4 },
    statUnit: { fontSize: 10, fontWeight: '700', marginTop: 2 },
    
    // Cards
    card: { borderRadius: 22, borderWidth: 1.5, padding: 18, marginBottom: 14 },
    cardTitle: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 12 },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    rowStart: { flexDirection: 'row', alignItems: 'center' },
    
    // Weekly Overview Chart labels
    weeklyLabelsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
    weeklyLabel: { fontSize: 10, fontWeight: '800', textAlign: 'center', flex: 1 },

    // Detailed Measures
    sectionTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 8, marginBottom: 12 },
    measureName: { fontSize: 15, fontWeight: '850' },
    measureValue: { fontSize: 16, fontWeight: '900' },
    measureSubRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, marginBottom: 12 },
    baselineText: { fontSize: 11, fontWeight: '600' },
    statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
    statusBadgeText: { fontSize: 9, fontWeight: '800' },
    measureChartWrap: { marginVertical: 12 },
    explainBox: { borderRadius: 14, padding: 12, flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
    explainText: { fontSize: 11.5, lineHeight: 17, flex: 1 },

    // Today Overview
    todayTitle: { fontSize: 15, fontWeight: '850' },
    todayChartWrap: { marginVertical: 12 },
    todaySubrow: { flexDirection: 'row', gap: 10, marginTop: 14, marginBottom: 12 },
    todaySubCard: { flex: 1, borderRadius: 14, padding: 12 },
    todaySubLabel: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
    todaySubVal: { fontSize: 14, fontWeight: '900', marginTop: 4 },
    todaySummaryText: { fontSize: 11, fontWeight: '600', marginTop: 2, textAlign: 'center' },

    // Collapsible Accordion
    collapsibleHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderRadius: 18, borderWidth: 1.5, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 8 },
    collapsibleTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    collapsibleTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
    collapsibleBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
    dayCard: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8 },
    dayDateLabel: { fontSize: 13, fontWeight: '800' },
    dayChartWrap: { marginVertical: 10 },
    dayStatsGrid: { flexDirection: 'row', gap: 16, marginTop: 6 },
    dayGridStatText: { fontSize: 11, fontWeight: '600' },

    // SparkChart styles
    chartContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', width: '100%' },
    chartCol: { flex: 1, height: '100%', alignItems: 'center', marginHorizontal: 2, position: 'relative' },
    chartColTrack: { width: '100%', height: '100%', borderRadius: 4, overflow: 'hidden', justifyContent: 'flex-end' },
    chartColFill: { width: '100%', borderRadius: 4 },

    // Interactive selector overlay
    selectorOverlay: {
        position: 'absolute',
        top: -16,
        left: -12,
        right: -12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
    },
    selectorChevron: {
        fontSize: 8,
        fontWeight: '900',
    },
    selectorCircle: {
        width: 8,
        height: 8,
        borderRadius: 4,
        borderWidth: 1.5,
    },

    // Interactive Tooltip Bubble styles
    tooltipBubble: {
        position: 'absolute',
        top: -24,
        backgroundColor: '#6E68B2',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.15,
        shadowRadius: 1,
        elevation: 2,
        zIndex: 10,
    },
    tooltipText: {
        color: '#FFF',
        fontSize: 8,
        fontWeight: '800',
    },
});
