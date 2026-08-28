import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    View, Text, StyleSheet, Dimensions,
    TouchableOpacity, ScrollView,
} from 'react-native';
import axios from 'axios';
import ScreenBackground from '../../shared/ScreenBackground';
import Card from '../../shared/Card';
import StatusDot from '../../shared/StatusDot';
import Icon, { NAMES } from '../../shared/Icon';
import MoodBadge from '../../shared/MoodBadge';
import AvatarButton from '../../shared/AvatarButton';
import { CalibrationBanner } from '../../shared/CalibrationGate';
import LineChart from '../../shared/LineChart';
import FreudHeroBanner from '../../shared/FreudHeroBanner';
import CalibrateBreathingCard from '../../shared/CalibrateBreathingCard';
import { ref, onValue, off } from 'firebase/database';
import { db } from '../firebase';
import { useTheme } from '../../physiological/config/ThemeContext';
import { COLORS } from '../../physiological/config/theme';
import { useAuth } from '../../../context/AuthContext';
import api from '../../physiological/api/client';
import { API_BASE, DEVICE_ID, STRESS_DECISION_THRESHOLD_PERCENT } from '../../physiological/config/config';
import { FUSION_TREND_LABELS } from '../config/config';

const CHART_WIDTH = Dimensions.get('window').width - 2 * 20 - 2 * 18 - 10;
const DEVICE_POLL_MS = 8000;

function getGreeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
}

function getDateStr() {
    return new Date().toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
}

const TREND_ICON = { increasing: NAMES.trendUp, decreasing: NAMES.trendDown, stable: NAMES.trendFlat };

function sortedWindowKeys(windowsObj) {
    if (!windowsObj) return [];
    return Object.keys(windowsObj)
        .filter((k) => /^\d+$/.test(k))
        .sort((a, b) => Number(a) - Number(b));
}

function latestWindow(windowsObj) {
    const keys = sortedWindowKeys(windowsObj);
    return keys.length ? windowsObj[keys[keys.length - 1]] : null;
}

function SectionCard({ icon, iconColor, title, statusText, statusColor, summary, onPress, t }) {
    return (
        <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
            <Card style={styles.sectionCard}>
                <View style={styles.sectionRow}>
                    <View style={[styles.sectionIconCircle, { backgroundColor: iconColor + '18' }]}>
                        <Icon name={icon} size={22} color={iconColor} />
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                        <View style={styles.sectionTopRow}>
                            <Text style={[styles.sectionTitle, { color: t.text }]}>{title}</Text>
                            <View style={styles.sectionStatusRow}>
                                <StatusDot color={statusColor} active={statusColor !== t.border} size={7} />
                                <Text style={[styles.sectionStatusText, { color: statusColor }]}>{statusText}</Text>
                            </View>
                        </View>
                        <Text style={[styles.sectionSummary, { color: t.textMuted }]} numberOfLines={1}>
                            {summary}
                        </Text>
                    </View>
                    <Icon name={NAMES.chevronRight} size={18} color={t.textMuted} />
                </View>
            </Card>
        </TouchableOpacity>
    );
}

export default function FusionSessionScreen({ navigation }) {
    const { theme: t, COLORS } = useTheme();
    const { user, token } = useAuth();
    const userId = user?.userId;
    const userName = user?.name || userId;
    const [sessionId, setSessionId] = useState('');
    const [watching, setWatching] = useState(false);
    const [windows, setWindows] = useState(null);
    const [hasAnyWindow, setHasAnyWindow] = useState(false);
    const [ringConnected, setRingConnected] = useState(false);
    const [eegConnected, setEegConnected] = useState(false);
    const [lastKnown, setLastKnown] = useState(null);
    const listenerRef = useRef(null);

    const startWatching = useCallback((idOverride) => {
        if (!userId) return;
        const targetId = (idOverride ?? sessionId).trim();
        if (!targetId) return;
        if (targetId === sessionId && listenerRef.current) return;
        setSessionId(targetId);
        setWindows(null);
        setHasAnyWindow(false);

        const sessionRef = ref(db, `fusion_en/${userId}/${targetId}`);
        const handler = onValue(sessionRef, (snapshot) => {
            const data = snapshot.val();
            setHasAnyWindow(!!data);
            setWindows(data);
        });
        listenerRef.current = { sessionRef, handler };
        setWatching(true);
    }, [sessionId, userId]);

    useEffect(() => {
        if (!userId) return;
        const pointerRef = ref(db, 'fusion_en_sessions/current_session_id');
        const handler = onValue(pointerRef, (snapshot) => {
            const liveId = snapshot.val();
            if (liveId) startWatching(liveId);
        });
        return () => off(pointerRef, 'value', handler);
    }, [userId]);

    useEffect(() => {
        let ringTimer;
        const pollRing = async () => {
            try {
                const res = await axios.get(`${API_BASE}/devices/${DEVICE_ID}/status`);
                setRingConnected((res.data?.status || 'offline') === 'online');
            } catch {
                setRingConnected(false);
            }
        };
        pollRing();
        ringTimer = setInterval(pollRing, DEVICE_POLL_MS);

        const eegPointerRef = ref(db, 'psychological/current_session_id');
        const eegHandler = onValue(eegPointerRef, (snap) => setEegConnected(!!snap.val()));

        return () => {
            clearInterval(ringTimer);
            off(eegPointerRef, 'value', eegHandler);
        };
    }, []);

    useEffect(() => {
        if (!userId) return;
        (async () => {
            try {
                const h = await api.get(`/history/${userId}`);
                const sessionIds = Object.keys(h.data?.sessions || {});
                const latestId = sessionIds[sessionIds.length - 1];
                if (!latestId) return;
                const s = await api.get(`/history/${userId}/${latestId}`);
                const preds = Object.values(s.data?.predictions || {})
                    .sort((a, b) => (b.window_idx ?? 0) - (a.window_idx ?? 0));
                if (preds[0]) setLastKnown(preds[0]);
            } catch {
                // no history yet
            }
        })();
    }, [userId]);

    const latest = useMemo(() => latestWindow(windows), [windows]);
    const fusedHistory = useMemo(() => {
        const keys = sortedWindowKeys(windows);
        return keys
            .map((k) => ({ v: windows[k]?.fused_probability, key: k }))
            .filter(({ v }) => v !== undefined && v !== null)
            .map(({ v, key }) => ({ value: Math.round(v * 100), date: new Date(Number(key) * 60000) }));
    }, [windows]);

    const label = latest?.fused_label;
    const trend = latest?.stress_trend;
    const stateColor = label === 1
        ? COLORS.stress
        : trend === 'increasing' ? COLORS.warning : COLORS.normal;

    const heroStateLabel = hasAnyWindow
        ? (label === 1 ? 'Stress' : trend === 'increasing' ? 'Trending' : 'Calm')
        : (lastKnown ? (lastKnown.label === 'Stress' ? 'Stress' : 'Calm') : 'Calm');

    return (
        <ScreenBackground>
            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
                {/* Top Profile / Greeting Bar */}
                <View style={styles.topHeader}>
                    <View>
                        <Text style={[styles.dateStr, { color: t.textMuted }]}>{getDateStr()}</Text>
                        <Text style={[styles.greeting, { color: t.text }]}>{getGreeting()}, {userName}</Text>
                    </View>
                    <AvatarButton userId={userId} onPress={() => navigation.navigate('Profile')} />
                </View>

                {/* Freud v2 Signature Curved Organic Hero Banner */}
                <FreudHeroBanner
                    stateLabel={heroStateLabel}
                    color={stateColor}
                />

                {/* Prominent Relaxation Guide Hero Button */}
                <TouchableOpacity onPress={() => navigation.navigate('RelaxationGuide')} activeOpacity={0.85}>
                    <Card style={styles.relaxationGuideCard} accentColor="#10B981">
                        <View style={styles.relaxationHeroRow}>
                            <View style={styles.relaxationIconCircle}>
                                <Text style={{ fontSize: 24 }}>🧠</Text>
                            </View>
                            <View style={{ flex: 1, marginLeft: 14 }}>
                                <Text style={[styles.cardTitle, { color: t.text, fontSize: 16, fontWeight: '900' }]}>
                                    Relaxation Guide
                                </Text>
                                <Text style={[styles.cardSub, { color: t.textMuted, marginTop: 2 }]} numberOfLines={1}>
                                    Personalized AI relaxation techniques & breathing
                                </Text>
                            </View>
                            <View style={styles.openPill}>
                                <Text style={styles.openPillText}>Open →</Text>
                            </View>
                        </View>
                    </Card>
                </TouchableOpacity>

                <CalibrationBanner userId={userId} token={token} />

                {/* Calibrate -- Calm Breathing: always visible (not tucked
                    behind a hidden button) -- a plain breathe-in/breathe-out
                    visual while real Ring+EEG calibration runs in the
                    background, right here on the Fusion page. */}
                <Card style={styles.calibrateCard} accentColor={COLORS.brand}>
                    <Text style={[styles.cardTitle, { color: t.text }]}>Calibrate — Calm Breathing</Text>
                    <CalibrateBreathingCard
                        userId={userId}
                        token={token}
                        ringOnline={ringConnected}
                        eegDb={db}
                    />
                </Card>

                {/* Session Progression Line Chart */}
                {fusedHistory.length > 1 && (
                    <Card elevated style={styles.chartCard}>
                        <View style={styles.chartHeader}>
                            <View>
                                <Text style={[styles.chartTitle, { color: t.text }]}>Real-Time Stress Progression</Text>
                                <Text style={[styles.chartSub, { color: t.textMuted }]}>
                                    Live multi-modal fusion curve ({fusedHistory.length} readings)
                                </Text>
                            </View>
                            {trend && TREND_ICON[trend] && (
                                <View style={[styles.trendChip, { backgroundColor: COLORS.light.pillBg }]}>
                                    <Icon name={TREND_ICON[trend]} size={14} color={t.textSub} />
                                    <Text style={[styles.trendChipText, { color: t.textSub }]}>
                                        {FUSION_TREND_LABELS[trend] || trend}
                                    </Text>
                                </View>
                            )}
                        </View>
                        <LineChart
                            points={fusedHistory}
                            color={stateColor}
                            width={CHART_WIDTH}
                            height={145}
                            maxValue={100}
                            hideValues
                            baselineValue={STRESS_DECISION_THRESHOLD_PERCENT}
                            baselineLabel="Stress threshold"
                            colorZones
                            fallback={<Text style={[styles.waiting, { color: t.textMuted }]}>Loading chart…</Text>}
                        />
                    </Card>
                )}

                {/* Quick PSS-4 self check-in */}
                <Card style={styles.pss4Card} accentColor={COLORS.brand}>
                    <Text style={[styles.cardTitle, { color: t.text }]}>How are you feeling?</Text>
                    <Text style={[styles.cardSub, { color: t.textMuted, marginTop: 4 }]}>
                        Take 30 seconds for a quick self check-in.
                    </Text>
                    <TouchableOpacity onPress={() => navigation.navigate('PSS4')} activeOpacity={0.85} style={{ marginTop: 10 }}>
                        <View style={[styles.actionTile, { backgroundColor: COLORS.brandSoft, borderColor: COLORS.brand + '30' }]}>
                            <Text style={{ color: COLORS.brandDark, fontWeight: '800' }}>Fill in PSS-4 →</Text>
                        </View>
                    </TouchableOpacity>
                </Card>

                {/* Connected Devices Section */}
                <Text style={[styles.sectionsLabel, { color: t.textSub }]}>Hardware & Sensor Stream</Text>

                <SectionCard
                    icon={NAMES.my} iconColor={COLORS.brand} title="Smart Ring Telemetry"
                    statusText={ringConnected ? 'Streaming' : 'Offline'}
                    statusColor={ringConnected ? COLORS.normal : t.border}
                    summary={ringConnected ? 'Streaming continuous HRV & GSR readings' : 'Slip on your ring to stream telemetry'}
                    onPress={() => navigation.navigate('RingSummary')} t={t}
                />
                <SectionCard
                    icon={NAMES.eeg} iconColor={COLORS.warning} title="EEG Neural Headband"
                    statusText={eegConnected ? 'Streaming' : 'Offline'}
                    statusColor={eegConnected ? COLORS.normal : t.border}
                    summary={eegConnected ? 'Reading cognitive workload live' : 'Wear the headband to measure mental load'}
                    onPress={() => navigation.navigate('EegSummary')} t={t}
                />
                <SectionCard
                    icon={NAMES.phenotyping} iconColor={COLORS.gsr} title="Digital Phenotyping"
                    statusText="Active" statusColor={COLORS.normal}
                    summary="Passive smartphone keystroke & interaction cadence"
                    onPress={() => navigation.navigate('Phenotyping')} t={t}
                />

                <View style={{ height: 20 }} />
            </ScrollView>
        </ScreenBackground>
    );
}

const styles = StyleSheet.create({
    scroll: {
        paddingBottom: 40,
    },
    topHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: 10,
    },
    dateStr: {
        fontSize: 12,
        fontWeight: '700',
    },
    greeting: {
        fontSize: 22,
        fontWeight: '900',
        letterSpacing: -0.3,
    },
    chartCard: {
        marginHorizontal: 20,
        marginVertical: 10,
        padding: 18,
        borderRadius: 24,
    },
    chartHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 12,
    },
    chartTitle: {
        fontSize: 15,
        fontWeight: '800',
        letterSpacing: -0.2,
    },
    chartSub: {
        fontSize: 11,
        marginTop: 2,
    },
    trendChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 10,
    },
    trendChipText: {
        fontSize: 11,
        fontWeight: '700',
    },
    waiting: {
        fontSize: 13,
        fontStyle: 'italic',
        textAlign: 'center',
        paddingVertical: 20,
    },
    calibrateCard: {
        marginHorizontal: 20,
        marginVertical: 10,
        padding: 18,
        borderRadius: 24,
    },
    pss4Card: {
        marginHorizontal: 20,
        marginVertical: 8,
        padding: 18,
        borderRadius: 22,
    },
    cardTitle: {
        fontSize: 15,
        fontWeight: '800',
    },
    cardSub: {
        fontSize: 12,
    },
    actionTile: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 16,
        borderWidth: 1,
        padding: 14,
    },
    sectionsLabel: {
        fontSize: 12,
        fontWeight: '800',
        letterSpacing: 0.5,
        textTransform: 'uppercase',
        marginHorizontal: 20,
        marginTop: 14,
        marginBottom: 10,
    },
    sectionCard: {
        marginHorizontal: 20,
        padding: 16,
        borderRadius: 22,
        marginBottom: 10,
    },
    sectionRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    sectionIconCircle: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
    },
    sectionTopRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    sectionTitle: {
        fontSize: 15,
        fontWeight: '800',
    },
    sectionStatusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    sectionStatusText: {
        fontSize: 11,
        fontWeight: '700',
    },
    sectionSummary: {
        fontSize: 12,
        marginTop: 3,
    },
    relaxationGuideCard: {
        marginHorizontal: 20,
        marginVertical: 10,
        padding: 16,
        borderRadius: 22,
        backgroundColor: '#FFFFFF',
    },
    relaxationHeroRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    relaxationIconCircle: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: 'rgba(16,185,129,0.12)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    openPill: {
        backgroundColor: '#8B87C4',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 14,
        marginLeft: 8,
    },
    openPillText: {
        color: '#FFFFFF',
        fontWeight: '800',
        fontSize: 12,
    },
});

