// ============================================================
// PhenotypingSignalHistoryScreen.js -- RN port of the standalone app's
// SignalHistory.jsx. Note: same simplification as the original -- true
// 7-day aggregation isn't implemented server-side, so only "today" is
// populated from real data_logs; the other 6 days render as empty
// placeholders, exactly matching the source's own generateEmptyDays().
// ============================================================
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import ScreenBackground from '../../shared/ScreenBackground';
import { ref, onValue, off } from 'firebase/database';
import { db } from '../firebase';
import { useTheme } from '../../physiological/config/ThemeContext';
import { useAuth } from '../../../context/AuthContext';

const SIGNAL_NAMES = {
    keyboard: '⌨️ Keyboard Patterns', screen: '📱 Screen On/Off',
    scroll: '📜 Scrolling', activity: '🚶 Activity',
};
const SIGNAL_UNITS = { keyboard: 'ms', screen: 'unlocks/hr', scroll: 'px/s', activity: '%' };

function generateEmptyDays() {
    const days = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        days.push({
            date: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
            avg: '--', min: '--', max: '--', status: 'pending', isToday: i === 0,
        });
    }
    return days;
}

export default function PhenotypingSignalHistoryScreen({ route }) {
    const { theme: t, COLORS } = useTheme();
    const { user } = useAuth();
    const userId = user?.userId;
    const signalId = route?.params?.signalId || 'keyboard';
    const [days, setDays] = useState(generateEmptyDays());

    const signalName = SIGNAL_NAMES[signalId] || 'Signal';
    const unit = SIGNAL_UNITS[signalId] || '';

    useEffect(() => {
        if (!userId) return;
        const metricsRef = ref(db, `phenotyping/data_logs/${userId}`);
        const handler = onValue(metricsRef, (snapshot) => {
            const raw = snapshot.val();
            const processed = generateEmptyDays();
            if (raw) {
                const entries = Object.values(raw);
                const latest = entries[entries.length - 1];
                let todayVal = null;
                if (signalId === 'keyboard' && latest.avg_dwell) todayVal = latest.avg_dwell;
                else if (signalId === 'scroll' && latest.scroll_velocity) todayVal = latest.scroll_velocity;
                else if (signalId === 'activity') todayVal = latest.data_valid === false ? 1 : 0;

                if (todayVal !== null) {
                    processed[6].avg = Math.round(todayVal);
                    processed[6].min = Math.round(todayVal * 0.8);
                    processed[6].max = Math.round(todayVal * 1.2);
                    processed[6].status = signalId === 'keyboard'
                        ? (todayVal > 150 ? 'anomalous' : todayVal > 130 ? 'elevated' : 'normal') : 'normal';
                }
            }
            setDays(processed);
        });
        return () => off(metricsRef, 'value', handler);
    }, [userId, signalId]);

    const validAvgs = days.map((d) => d.avg).filter((a) => typeof a === 'number');
    const weekAvg = validAvgs.length ? Math.round(validAvgs.reduce((a, b) => a + b, 0) / validAvgs.length) : '--';
    const daysAbove = days.filter((d) => d.status === 'elevated' || d.status === 'anomalous').length;

    return (
        <ScreenBackground edges={['left', 'right']}>
            <ScrollView contentContainerStyle={styles.scroll}>
                <Text style={[styles.title, { color: t.text }]}>{signalName}</Text>

                <View style={styles.statsRow}>
                    <View style={[styles.statBox, { backgroundColor: t.surface, borderColor: t.border }]}>
                        <Text style={[styles.statLabel, { color: t.textMuted }]}>7-Day Avg</Text>
                        <Text style={[styles.statValue, { color: t.text }]}>{weekAvg}</Text>
                        <Text style={[styles.statUnit, { color: t.textMuted }]}>{unit}</Text>
                    </View>
                    <View style={[styles.statBox, { backgroundColor: t.surface, borderColor: t.border }]}>
                        <Text style={[styles.statLabel, { color: t.textMuted }]}>Elevated</Text>
                        <Text style={[styles.statValue, { color: daysAbove > 0 ? COLORS.warning : COLORS.normal }]}>{daysAbove}</Text>
                        <Text style={[styles.statUnit, { color: t.textMuted }]}>days</Text>
                    </View>
                </View>

                <Text style={[styles.sectionTitle, { color: t.textMuted }]}>Day by Day</Text>
                {[...days].reverse().map((day, i) => (
                    <View key={i} style={[styles.dayCard, { backgroundColor: t.surface, borderColor: t.border }]}>
                        <View style={styles.rowBetween}>
                            <Text style={[styles.dayLabel, { color: t.text }]}>{day.isToday ? 'Today' : day.date}</Text>
                            <Text style={[styles.statusText, {
                                color: day.status === 'normal' ? COLORS.normal
                                    : day.status === 'elevated' ? COLORS.warning
                                    : day.status === 'anomalous' ? COLORS.stress : t.textMuted,
                            }]}>{day.status}</Text>
                        </View>
                        <View style={styles.dayStatsRow}>
                            <Text style={[styles.dayStat, { color: t.textMuted }]}>Avg <Text style={{ color: t.text, fontWeight: '800' }}>{day.avg} {unit}</Text></Text>
                            <Text style={[styles.dayStat, { color: t.textMuted }]}>Min <Text style={{ color: t.text }}>{day.min}</Text></Text>
                            <Text style={[styles.dayStat, { color: t.textMuted }]}>Max <Text style={{ color: t.text }}>{day.max}</Text></Text>
                        </View>
                    </View>
                ))}
            </ScrollView>
        </ScreenBackground>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    scroll: { padding: 20, paddingBottom: 40 },
    title: { fontSize: 18, fontWeight: '800', marginBottom: 14 },
    statsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
    statBox: { flex: 1, borderRadius: 16, borderWidth: 1, padding: 14, alignItems: 'center' },
    statLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
    statValue: { fontSize: 20, fontWeight: '900', marginTop: 4 },
    statUnit: { fontSize: 10, marginTop: 2 },
    sectionTitle: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
    dayCard: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10 },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    dayLabel: { fontSize: 14, fontWeight: '700' },
    statusText: { fontSize: 11, fontWeight: '800', textTransform: 'capitalize' },
    dayStatsRow: { flexDirection: 'row', gap: 16 },
    dayStat: { fontSize: 11 },
});
