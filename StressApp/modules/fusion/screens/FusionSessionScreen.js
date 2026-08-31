import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    View, Text, StyleSheet, Dimensions,
    TouchableOpacity, ScrollView,
} from 'react-native';
import ScreenBackground from '../../shared/ScreenBackground';
import Card from '../../shared/Card';
import StatusDot from '../../shared/StatusDot';
import Icon, { NAMES } from '../../shared/Icon';
import MoodBadge from '../../shared/MoodBadge';
import AvatarButton from '../../shared/AvatarButton';
import { useCalibrationSummary, useDeviceStatus } from '../../shared/CalibrationGate';
import LineChart from '../../shared/LineChart';
import FreudHeroBanner from '../../shared/FreudHeroBanner';
import { ref, onValue, off } from 'firebase/database';
import { db } from '../firebase';
import { useTheme } from '../../physiological/config/ThemeContext';
import { COLORS } from '../../physiological/config/theme';
import { useAuth } from '../../../context/AuthContext';
import api from '../../physiological/api/client';
import { STRESS_DECISION_THRESHOLD_PERCENT } from '../../physiological/config/config';
import { FUSION_TREND_LABELS } from '../config/config';

const CHART_WIDTH = Math.max(260, Dimensions.get('window').width - 80);

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

    // Calibration itself (the "Calibrate -- Calm Breathing" trigger, the
    // staleness/drift warning banner, and the Threshold Test retry) all
    // live on the Profile screen now -- this screen keeps only a
    // read-only summary of the personalized thresholds those produce,
    // reused (not re-fetched) from the same GET /baseline/{userId} + GET
    // /calibration/status Profile's own CalibrationBanner calls.
    const { ring: ringCalibration, eeg: eegCalibration } = useCalibrationSummary(userId, token);
    const personalEegPct = eegCalibration?.personal_high_load_p != null
        ? Math.round(eegCalibration.personal_high_load_p * 100) : null;
    const personalRingPct = ringCalibration?.personal_stress_threshold != null
        ? Math.round(ringCalibration.personal_stress_threshold * 100) : null;
    const userName = user?.name || userId;
    const [sessionId, setSessionId] = useState('');
    const [watching, setWatching] = useState(false);
    const [windows, setWindows] = useState(null);
    const [hasAnyWindow, setHasAnyWindow] = useState(false);
    // ringOnline/eegOnline: shared with AccountSetupScreen.js/
    // CalibrateBreathingCard.js/EegSummaryScreen.js's device-status row --
    // was previously TWO separate local implementations here (a duplicate
    // ring-status poll, and an EEG live_raw-based check keyed off a field
    // the backend stopped writing entirely once EEG liveness moved to the
    // latest per-block record's own timestamp -- see useDeviceStatus()'s
    // own docstring). That dead EEG effect meant eegConnected was
    // permanently stuck false, so this screen's "Hardware & Sensor Stream"
    // row always showed the EEG headband as "Offline" regardless of
    // whether it was actually streaming.
    const { ringOnline: ringConnected, eegOnline: eegConnected } = useDeviceStatus(userId, db);
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

    // Cognitive load (EEG), autonomic arousal (HRV/GSR), and the fused
    // probability -- all three already live on the SAME fusion_en/{window}
    // record (prob_eeg/prob_hrv_gsr are written directly by each backend's
    // own /predict route, fused_probability is fusion_live_session.py's
    // reliability-weighted combination of them -- see backend/common/fusion.py
    // and fushion engin/fusion_live_session.py), so one shared window-key
    // timeline covers all three with no separate alignment needed. null
    // where a given window has no reading for that series (e.g. only one
    // modality reported that block) -- MultiLineChart breaks the line there
    // instead of interpolating across missing data.
    const multiSeriesPoints = useMemo(() => {
        const keys = sortedWindowKeys(windows);
        return keys.map((k) => {
            const w = windows[k] || {};
            return {
                date: new Date(Number(k) * 60000),
                values: [
                    w.prob_eeg != null ? Math.round(w.prob_eeg * 100) : null,
                    w.prob_hrv_gsr != null ? Math.round(w.prob_hrv_gsr * 100) : null,
                    w.fused_probability != null ? Math.round(w.fused_probability * 100) : null,
                ],
            };
        });
    }, [windows]);
    const hasMultiSeriesData = multiSeriesPoints.filter((p) => p.values.some((v) => v != null)).length > 1;

    const label = latest?.fused_label;
    const trend = latest?.stress_trend;
    const stateColor = label === 1
        ? COLORS.stress
        : trend === 'increasing' ? COLORS.warning : COLORS.normal;

    const heroStateLabel = hasAnyWindow
        ? (label === 1 ? 'Stress' : trend === 'increasing' ? 'Trending' : 'Calm')
        : (lastKnown ? (lastKnown.label === 'Stress' ? 'Stress' : 'Calm') : 'Calm');

    // stress_phase/stress_alert_message: fusion_live_session.py's
    // _compute_stress_phase() -- ADDITIVE to fused_label/heroStateLabel
    // above, not a replacement. Recomputed fresh every window server-side
    // (not sticky), so this banner disappears on its own the moment
    // stress_phase stops being 'increasing_stress_alert', with no extra
    // client-side state to clear it.
    const stressPhase = latest?.stress_phase;
    const stressAlertMessage = latest?.stress_alert_message;

    // fused_relative_index: comparable-across-modalities/users alternative
    // to fused_probability (see fusion_engin.py's compute_realtime_
    // multimodal_fusion() docstring) -- 0 = exactly at this window's
    // combined personal threshold, so unlike fused_probability's raw 0-100%
    // (which has no fixed meaning: EEG's and Ring's own population
    // thresholds differ, before any personal calibration adds more spread
    // on top), this number means the same thing for every user. Shown as
    // "X% above/below your personal baseline" -- *100 turns "1.0 index
    // unit" (as elevated as the biggest shift either modality's own
    // calibration considers meaningful) into a familiar percent-style
    // figure, not a literal fraction of anything. ADDITIVE -- every other
    // field on this screen (heroStateLabel, fusedHistory, multiSeriesPoints)
    // keeps reading fused_probability/fused_label exactly as before.
    const relativeIndex = latest?.fused_relative_index;
    const relativePct = relativeIndex != null ? Math.round(relativeIndex * 100) : null;
    const relativeElevated = relativeIndex != null && relativeIndex >= 0;

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

                {/* increasing_stress_alert: at/above threshold AND still
                    rising -- distinct from heroStateLabel's plain "Stress"
                    (which fires on being above threshold regardless of
                    direction). Gone on its own the next window trend stops
                    increasing -- see stress_phase's own comment above. */}
                {stressPhase === 'increasing_stress_alert' && stressAlertMessage && (
                    <View style={[styles.alertBanner, { backgroundColor: COLORS.stressSoft, borderColor: COLORS.stress + '40' }]}>
                        <Icon name={NAMES.trendUp} size={18} color={COLORS.stressDark} />
                        <Text style={[styles.alertBannerText, { color: COLORS.stressDark }]}>{stressAlertMessage}</Text>
                    </View>
                )}
                {stressPhase === 'trending_towards_stress' && (
                    <View style={[styles.alertBanner, { backgroundColor: COLORS.warningSoft, borderColor: COLORS.warning + '40' }]}>
                        <Icon name={NAMES.trendUp} size={18} color={COLORS.warningDark} />
                        <Text style={[styles.alertBannerText, { color: COLORS.warningDark }]}>
                            Trending toward your high-load threshold — worth a moment to check in.
                        </Text>
                    </View>
                )}

                {/* Personalized thresholds: only rendered once at least one
                    side has actually separated Rest from Task (see
                    _baseline_response()/get_calibration_status() above) --
                    a user who's only done resting-baseline calibration
                    still sees nothing here rather than a premature
                    "Standard" placeholder for a task they haven't run yet. */}
                {(personalEegPct != null || personalRingPct != null) && (
                    <Card style={styles.thresholdCard} accentColor={COLORS.brand}>
                        <Text style={[styles.cardTitle, { color: t.text }]}>Your Personalized Thresholds</Text>
                        <View style={styles.thresholdRow}>
                            <Text style={[styles.thresholdLabel, { color: t.textMuted }]}>EEG high-load</Text>
                            <Text style={[styles.thresholdValue, { color: t.text }]}>
                                {personalEegPct != null ? `${personalEegPct}%` : 'Standard'}
                            </Text>
                        </View>
                        <View style={styles.thresholdRow}>
                            <Text style={[styles.thresholdLabel, { color: t.textMuted }]}>Ring stress</Text>
                            <Text style={[styles.thresholdValue, { color: t.text }]}>
                                {personalRingPct != null ? `${personalRingPct}%` : 'Standard'}
                            </Text>
                        </View>
                    </Card>
                )}

                {/* Session Progression Line Chart */}
                {fusedHistory.length > 1 && (
                    <Card elevated style={styles.chartCard}>
                        <View style={styles.chartHeader}>
                            <View style={styles.chartHeaderLeft}>
                                <Text style={[styles.chartTitle, { color: t.text }]} numberOfLines={1}>Real-Time Stress Progression</Text>
                                <Text style={[styles.chartSub, { color: t.textMuted }]}>
                                    {fusedHistory.length} live fusion readings
                                </Text>
                            </View>
                            {trend && TREND_ICON[trend] && (
                                <View style={[styles.trendChip, { backgroundColor: COLORS.light.pillBg }]}>
                                    <Icon name={TREND_ICON[trend]} size={13} color={t.textSub} />
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

                {/* Multi-modal physiological curve */}
                {hasMultiSeriesData && (
                    <Card elevated style={styles.chartCard}>
                        <Text style={[styles.chartTitle, { color: t.text }]}>Multi-Modal Physiological Curve</Text>
                        <Text style={[styles.chartSub, { color: t.textMuted, marginBottom: 10 }]}>
                            Synchronized cognitive load (EEG), autonomic arousal (HRV/GSR) & fused stress
                        </Text>
                        <LineChart
                            points={multiSeriesPoints}
                            multiLine
                            seriesColors={[COLORS.eeg, COLORS.hrv, COLORS.brand]}
                            seriesLabels={['Cognitive load (EEG)', 'Autonomic arousal (HRV/GSR)', 'Fused probability']}
                            width={CHART_WIDTH}
                            height={160}
                            maxValue={100}
                            baselineValue={STRESS_DECISION_THRESHOLD_PERCENT}
                            baselineLabel="Stress threshold"
                            fallback={<Text style={[styles.waiting, { color: t.textMuted }]}>Loading chart…</Text>}
                        />
                    </Card>
                )}

                {/* Quick PSS-4 self check-in */}
                <Card style={styles.pss4Card} accentColor={COLORS.brand}>
                    <Text style={[styles.cardTitle, { color: t.text }]}>How are you feeling?</Text>
                    <Text style={[styles.cardSub, { color: t.textMuted, marginTop: 4 }]}>
                        Take 30 seconds for a quick self check-in
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

                <View style={{ height: 24 }} />
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
        marginVertical: 6,
    },
    chartHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
        gap: 8,
    },
    chartHeaderLeft: {
        flex: 1,
        marginRight: 6,
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
        flexShrink: 0,
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
    alertBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginHorizontal: 20,
        marginTop: 10,
        padding: 14,
        borderRadius: 16,
        borderWidth: 1,
    },
    alertBannerText: {
        flex: 1,
        fontSize: 13,
        fontWeight: '700',
        lineHeight: 18,
    },
    thresholdCard: {
        marginHorizontal: 20,
        marginVertical: 10,
        padding: 18,
        borderRadius: 22,
    },
    thresholdRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 6,
    },
    thresholdLabel: {
        fontSize: 13,
        fontWeight: '700',
    },
    thresholdValue: {
        fontSize: 14,
        fontWeight: '900',
    },
    relativeCard: {
        marginHorizontal: 20,
        marginVertical: 10,
        padding: 18,
        borderRadius: 22,
    },
    relativeValue: {
        fontSize: 28,
        fontWeight: '900',
        letterSpacing: -0.3,
    },
    relativeCaption: {
        fontSize: 12,
        fontWeight: '600',
        marginTop: 2,
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
});

