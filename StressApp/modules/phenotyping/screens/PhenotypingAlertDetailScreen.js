// ============================================================
// PhenotypingAlertDetailScreen.js -- RN port of the standalone app's
// AlertDetail.jsx. Note: same as the source -- TRIGGERS is intentionally
// empty (never wired to real per-trigger data upstream either, see
// PhenotypingScreen.js's alert list which is likewise never populated),
// so this stays a mostly-static informational screen with one real
// action (jump to the EMA survey), matching the original exactly.
// ============================================================
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../physiological/config/ThemeContext';

export default function PhenotypingAlertDetailScreen({ navigation }) {
    const { theme: t, COLORS } = useTheme();

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: t.bg }]} edges={['left', 'right']}>
            <View style={styles.scroll}>
                <View style={[styles.alertBox, { backgroundColor: COLORS.brand + '15', borderColor: COLORS.brand + '40' }]}>
                    <Text style={[styles.alertTitle, { color: t.text }]}>⚠️ Pre-stress alert triggered</Text>
                    <Text style={[styles.alertBody, { color: t.textMuted }]}>
                        Your behavior has deviated from your baseline pattern. Several monitored signals show unusual
                        activity in the last few hours.
                    </Text>
                </View>

                <Text style={[styles.sectionTitle, { color: t.textMuted }]}>What you can do</Text>
                <TouchableOpacity
                    style={[styles.actionRow, { backgroundColor: t.surface, borderColor: t.border }]}
                    onPress={() => navigation.navigate('PhenotypingEma', { initialTab: 'siss' })}
                    activeOpacity={0.85}
                >
                    <Text style={{ fontSize: 22 }}>📝</Text>
                    <View style={{ flex: 1 }}>
                        <Text style={[styles.actionTitle, { color: t.text }]}>Log how you feel</Text>
                        <Text style={[styles.actionSub, { color: t.textMuted }]}>Track your mood to find patterns</Text>
                    </View>
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    scroll: { padding: 20 },
    alertBox: { borderRadius: 20, borderWidth: 1, padding: 18, marginBottom: 20 },
    alertTitle: { fontSize: 15, fontWeight: '800', marginBottom: 8 },
    alertBody: { fontSize: 12, lineHeight: 18 },
    sectionTitle: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
    actionRow: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 16, borderWidth: 1, padding: 16 },
    actionTitle: { fontSize: 14, fontWeight: '700' },
    actionSub: { fontSize: 11, marginTop: 2 },
});
