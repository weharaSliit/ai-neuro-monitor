// ============================================================
// PhenotypingAlertDetailScreen.js -- Digital Phenotyping alert breakdown.
// Previously a static screen (TRIGGERS was never wired to real data, see
// git history). Now reads the device's most recent prediction from
// Firebase and shows exactly which of the 5 real per-feature z-scores
// (z_dwell/z_flight/z_scroll/z_tilt/z_cpm, computed by predictor.py)
// pushed it into Drift/Pre-Stress, sorted by how much each contributed --
// same real fields that power the "How Your Signals Combine" section on
// the Patterns tab, so the two screens tell a consistent, honest story.
// ============================================================
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { ref, onValue, off, query, orderByKey, limitToLast } from 'firebase/database';
import { db } from '../firebase';
import ScreenBackground from '../../shared/ScreenBackground';
import { useTheme } from '../../physiological/config/ThemeContext';
import { usePhenotypingDeviceId } from '../utils/deviceIdentity';

const FEATURE_META = {
    z_dwell: { icon: '⌨️', name: 'Dwell Time', signalId: 'keyboard', hint: 'holding keys longer than usual' },
    z_flight: { icon: '✈️', name: 'Flight Time', signalId: 'keyboard', hint: 'slower gaps between key presses' },
    z_scroll: { icon: '📜', name: 'Scroll Speed', signalId: 'scroll', hint: 'faster/more erratic scrolling' },
    z_tilt: { icon: '📐', name: 'Device Tilt', signalId: 'tilt', hint: 'holding the phone at an unusual angle' },
    z_cpm: { icon: '🔡', name: 'Typing Speed', signalId: 'cpm', hint: 'a drop in typing throughput' },
};

export default function PhenotypingAlertDetailScreen({ navigation, route }) {
    const { theme: t, COLORS } = useTheme();
    const ownDeviceId = usePhenotypingDeviceId();
    const deviceId = route?.params?.userId || route?.params?.deviceId || ownDeviceId;

    const [latest, setLatest] = useState(null);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        if (!deviceId) return;
        const predQ = query(ref(db, `phenotyping/predictions/${deviceId}`), orderByKey(), limitToLast(50));
        const handler = onValue(predQ, (snap) => {
            const raw = snap.val();
            if (raw) {
                const preds = Object.values(raw).sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
                setLatest(preds[preds.length - 1] || null);
            } else {
                setLatest(null);
            }
            setLoaded(true);
        }, () => setLoaded(true));
        return () => off(ref(db, `phenotyping/predictions/${deviceId}`), 'value', handler);
    }, [deviceId]);

    const compositeZ = typeof latest?.composite_z === 'number' ? latest.composite_z : 0;
    const isActive = !!latest && (latest.is_anomaly || compositeZ > 1.0);
    const severity = compositeZ > 2.0 ? 'stress' : compositeZ > 1.0 ? 'drift' : 'normal';

    const severityColor = severity === 'stress' ? COLORS.stress : severity === 'drift' ? COLORS.warning : COLORS.normal;
    const severityBg = severity === 'stress' ? (COLORS.stressSoft || COLORS.stress + '18') : severity === 'drift' ? (COLORS.warningSoft || COLORS.warning + '18') : (COLORS.normalSoft || COLORS.normal + '18');
    const severityBorder = severityColor + '40';

    // Real contributing signals -- every z_* field above the Drift threshold
    // (Z > 1.0), ranked by magnitude, so the strongest driver shows first.
    const triggeringFeatures = useMemo(() => {
        if (!latest) return [];
        return Object.keys(FEATURE_META)
            .map((key) => ({ key, z: typeof latest[key] === 'number' ? latest[key] : 0, meta: FEATURE_META[key] }))
            .filter((f) => f.z > 1.0)
            .sort((a, b) => b.z - a.z);
    }, [latest]);

    const title = severity === 'stress'
        ? '⚠️ Pre-stress pattern detected'
        : severity === 'drift'
            ? '📈 Elevated drift detected'
            : '✅ No active alert';

    const body = severity === 'stress'
        ? "Your behavior has deviated significantly from your personal baseline, and the anomaly model agrees this looks unusual for you."
        : severity === 'drift'
            ? "A few signals are trending above your normal range. This isn't confirmed as pre-stress yet, but it's worth a check-in."
            : "Your most recent reading is within your normal baseline range — nothing to flag right now.";

    if (!loaded) {
        return (
            <ScreenBackground edges={['left', 'right']}>
                <View style={styles.centerFill}>
                    <ActivityIndicator color={COLORS.brand} />
                </View>
            </ScreenBackground>
        );
    }

    return (
        <ScreenBackground edges={['left', 'right']}>
            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
                <View style={[styles.alertBox, { backgroundColor: severityBg, borderColor: severityBorder }]}>
                    <Text style={[styles.alertTitle, { color: t.text }]}>{title}</Text>
                    <Text style={[styles.alertBody, { color: t.textMuted }]}>{body}</Text>
                    {latest && (
                        <Text style={[styles.alertMeta, { color: severityColor }]}>
                            Composite Z {compositeZ.toFixed(2)}
                            {latest.timestamp ? ` · ${new Date(latest.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}
                        </Text>
                    )}
                </View>

                {isActive && triggeringFeatures.length > 0 && (
                    <>
                        <Text style={[styles.sectionTitle, { color: t.textMuted }]}>What triggered this</Text>
                        {triggeringFeatures.map((f) => (
                            <TouchableOpacity
                                key={f.key}
                                style={[styles.triggerRow, { backgroundColor: t.surface, borderColor: t.border }]}
                                activeOpacity={0.8}
                                onPress={() => navigation.navigate('PhenotypingSignalHistory', { signalId: f.meta.signalId })}
                            >
                                <Text style={{ fontSize: 20 }}>{f.meta.icon}</Text>
                                <View style={{ flex: 1 }}>
                                    <Text style={[styles.triggerTitle, { color: t.text }]}>{f.meta.name}</Text>
                                    <Text style={[styles.triggerSub, { color: t.textMuted }]}>{f.meta.hint}</Text>
                                </View>
                                <View style={[styles.triggerBadge, { backgroundColor: (f.z > 2.0 ? COLORS.stress : COLORS.warning) + '20' }]}>
                                    <Text style={[styles.triggerBadgeText, { color: f.z > 2.0 ? COLORS.stress : COLORS.warning }]}>Z {f.z.toFixed(1)}</Text>
                                </View>
                            </TouchableOpacity>
                        ))}
                    </>
                )}

                <Text style={[styles.sectionTitle, { color: t.textMuted, marginTop: 16 }]}>What you can do</Text>
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
            </ScrollView>
        </ScreenBackground>
    );
}

const styles = StyleSheet.create({
    centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    scroll: { padding: 20, paddingBottom: 40 },
    alertBox: { borderRadius: 20, borderWidth: 1, padding: 18, marginBottom: 20 },
    alertTitle: { fontSize: 15, fontWeight: '800', marginBottom: 8 },
    alertBody: { fontSize: 12, lineHeight: 18 },
    alertMeta: { fontSize: 10.5, fontWeight: '800', marginTop: 10 },
    sectionTitle: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
    triggerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: 1, padding: 12, marginBottom: 8 },
    triggerTitle: { fontSize: 13, fontWeight: '800' },
    triggerSub: { fontSize: 10.5, marginTop: 1 },
    triggerBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
    triggerBadgeText: { fontSize: 10.5, fontWeight: '900' },
    actionRow: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 16, borderWidth: 1, padding: 16 },
    actionTitle: { fontSize: 14, fontWeight: '700' },
    actionSub: { fontSize: 11, marginTop: 2 },
});
