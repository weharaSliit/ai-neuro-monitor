// ============================================================
// PhenotypingOnboardingScreen.js -- Standalone Setup & Onboarding
// Concise visual breadcrumb + interactive sensor toggle + 7-Day Roadmap.
// Matches the app theme design tokens.
// ============================================================
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, NativeModules, Platform, Switch, Linking } from 'react-native';
import ScreenBackground from '../../shared/ScreenBackground';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../physiological/config/ThemeContext';
import { getOrCreateDeviceId } from '../utils/deviceIdentity';
import Icon, { NAMES } from '../../shared/Icon';

const { PhenotypingIdentity } = NativeModules;

export async function markPhenotypingOnboarded(deviceId, data = {}) {
    await AsyncStorage.setItem(`phenotyping_onboarded_${deviceId}`, JSON.stringify({
        completed_at: new Date().toISOString(),
        ...data,
    }));
}

export async function isPhenotypingOnboarded(deviceId) {
    return !!(await AsyncStorage.getItem(`phenotyping_onboarded_${deviceId}`));
}

export default function PhenotypingOnboardingScreen({ navigation }) {
    const { theme: t, COLORS } = useTheme();

    const [step, setStep] = useState(1);
    const [saving, setSaving] = useState(false);

    // ── Sensor verification state
    const [sensorCheckStatus, setSensorCheckStatus] = useState('unknown'); // 'unknown' | 'checking' | 'on' | 'off'

    const checkSensorStatus = useCallback(async () => {
        if (Platform.OS !== 'android' || !PhenotypingIdentity?.isAccessibilityServiceEnabled) {
            setSensorCheckStatus('on');
            return;
        }
        setSensorCheckStatus('checking');
        try {
            const enabled = await PhenotypingIdentity.isAccessibilityServiceEnabled();
            setSensorCheckStatus(enabled ? 'on' : 'off');
        } catch {
            setSensorCheckStatus('off');
        }
    }, []);

    // Check on mount
    useEffect(() => { checkSensorStatus(); }, [checkSensorStatus]);

    const finish = async () => {
        setSaving(true);
        const id = await getOrCreateDeviceId();
        await markPhenotypingOnboarded(id, { sensorEnabled: true });
        setSaving(false);
        navigation.goBack();
    };

    return (
        <ScreenBackground edges={['top', 'left', 'right']}>
            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
                {/* STEP 1: Enable PhenoCare Sensor */}
                {step === 1 && (
                    <View style={[styles.modalCard, { backgroundColor: t.surface, borderColor: t.border }]}>
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
                                    ? t.pillBg
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
                                    onPress={() => {
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
                                backgroundColor: sensorCheckStatus === 'on' ? COLORS.brand : t.pillBg,
                                borderWidth: sensorCheckStatus === 'on' ? 0 : 1.5,
                                borderColor: t.border,
                                marginTop: 14,
                            }]}
                            onPress={() => {
                                if (sensorCheckStatus !== 'on') return;
                                if (Platform.OS === 'android' && PhenotypingIdentity) {
                                    PhenotypingIdentity.scheduleEmaNotifications();
                                }
                                setStep(2);
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

                {/* STEP 2: 7-Day Calibration Path */}
                {step === 2 && (
                    <View style={[styles.modalCard, { backgroundColor: t.surface, borderColor: t.border }]}>
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

                        <View style={{ marginTop: 4 }}>
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
                        </View>

                        <TouchableOpacity
                            style={[styles.modalActionBtn, { backgroundColor: COLORS.brand, marginTop: 12, opacity: saving ? 0.6 : 1 }]}
                            onPress={finish}
                            disabled={saving}
                            activeOpacity={0.8}
                        >
                            <Text style={styles.modalActionBtnText}>{saving ? 'Saving…' : 'Enter PhenoCare Dashboard →'}</Text>
                        </TouchableOpacity>
                    </View>
                )}
            </ScrollView>
        </ScreenBackground>
    );
}

const styles = StyleSheet.create({
    scroll: { padding: 20, paddingBottom: 40 },
    modalCard: {
        width: '100%',
        borderRadius: 24,
        borderWidth: 1.5,
        padding: 20,
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
