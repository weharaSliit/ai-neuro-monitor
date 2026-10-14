import { getContentWidth } from '../../shared/theme/layout';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    View, Text, StyleSheet, Dimensions,
    TouchableOpacity, ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import ScreenBackground from '../../shared/ScreenBackground';
import Card from '../../shared/Card';
import StatusDot from '../../shared/StatusDot';
import Icon, { NAMES } from '../../shared/Icon';
import Badge from '../../shared/Badge';
import AvatarButton from '../../shared/AvatarButton';
import BalanceRing from '../../shared/BalanceRing';
import LevelSlider from '../../shared/LevelSlider';
import ActionTile from '../../shared/ActionTile';
import { useCalibrationSummary, useDeviceStatus } from '../../shared/CalibrationGate';
import LineChart from '../../shared/LineChart';
import BaselineDriftCard from '../../shared/BaselineDriftCard';
import {
    levelOf, LEVEL_COLOR, MIND_WORDS, BODY_WORDS, OVERALL_WORDS, sliderPosition,
    DEFAULT_RING_THRESHOLD, DEFAULT_EEG_THRESHOLD, fusionKeyToMs,
} from '../../shared/levels';
import { TYPE, SPACE, RADIUS } from '../../shared/theme/tokens';
import { ref, onValue, off, get } from 'firebase/database';
import { db } from '../firebase';
import { useTheme } from '../../physiological/config/ThemeContext';
import { COLORS } from '../../physiological/config/theme';
import { useAuth } from '../../../context/AuthContext';
import api from '../../physiological/api/client';
import { STRESS_DECISION_THRESHOLD_PERCENT } from '../../physiological/config/config';

const CHART_WIDTH = Math.max(260, getContentWidth() - 2 * SPACE.xl - 2 * 18);
// A window older than this is "last reading", not "live".
const LIVE_WINDOW_MS = 3 * 60 * 1000;

// Plain-language hero copy -- what a non-technical user actually needs
// to know, instead of probabilities/thresholds.
const HERO = {
    calm:   { word: 'Calm',          line: 'Your mind and body are settled.',                     tip: 'All good — keep going',        icon: 'emoticon-happy-outline' },
    rising: { word: 'Rising',        line: 'Stress is building up a little.',                     tip: 'A short pause would help',     icon: 'emoticon-neutral-outline' },
    high:   { word: 'Stressed',      line: 'Your body and mind are under strain right now.',      tip: 'Try a 1-minute breathing break', icon: 'emoticon-sad-outline' },
    stale:  { word: 'Recalibrate',   line: 'Your skin signal is far from your saved calm level, so the stress reading can’t be trusted.', tip: 'Recalibrate to fix this', icon: 'refresh' },
    idle:   { word: 'Not connected', line: 'Put on your ring or headband to see how you’re doing.', tip: 'Waiting for devices',  icon: 'power-plug-off-outline' },
};

function timeAgo(ms) {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h ago`;
    return new Date(ms).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}
// Same cross-session reasoning as RingSummaryScreen.js/EegSummaryScreen.js:
// a session is one login-to-logout span, not "how far back these charts
// should remember" -- backfills this many of the user's own PRIOR sessions
// alongside whatever's currently live/last-known.
const RECENT_SESSIONS_FOR_CHART = 4;
const CHART_POINTS_MAX = 160;

function getGreeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
}

function getDateStr() {
    return new Date().toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
}

function sortedWindowKeys(windowsObj) {
    if (!windowsObj) return [];
    return Object.keys(windowsObj)
        .filter((k) => /^\d+$/.test(k))
        .sort((a, b) => Number(a) - Number(b));
}

// Newest window satisfying `ok`. A new minute's window is created the moment
// the FIRST device reports (prob_eeg or prob_hrv_gsr), and the fusion engine
// only adds fused_label/fused_probability a moment later -- reading the raw
// newest window in that gap made the hero fall back to "calm" for a second
// and then jump back. So every reading is taken from the newest window that
// actually HAS that reading.
function latestWindowWith(windowsObj, ok) {
    const keys = sortedWindowKeys(windowsObj);
    for (let i = keys.length - 1; i >= 0; i -= 1) {
        const w = windowsObj[keys[i]];
        if (w && ok(w)) return w;
    }
    return null;
}

function latestWindow(windowsObj) {
    const keys = sortedWindowKeys(windowsObj);
    return keys.length ? windowsObj[keys[keys.length - 1]] : null;
}

// Compact device tile: icon, name, online/offline -- tap for that
// device's own detail screen.
function DeviceChip({ icon, tint, name, online, onPress }) {
    return (
        <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={styles.deviceChip}>
            <View style={[styles.deviceIcon, { backgroundColor: tint + '18' }]}>
                <Icon name={icon} size={20} color={tint} />
            </View>
            <Text style={styles.deviceName} numberOfLines={1}>{name}</Text>
            <View style={styles.deviceStatusRow}>
                <StatusDot color={online ? COLORS.normal : COLORS.light.textMuted} active={online} size={6} />
                <Text style={[styles.deviceStatus, { color: online ? COLORS.normalDark : COLORS.light.textMuted }]}>
                    {online ? 'Live' : 'Off'}
                </Text>
            </View>
        </TouchableOpacity>
    );
}

export default function FusionSessionScreen({ navigation, route }) {
    // Same screen is mounted inside the Admin stack as "AdminFusion" --
    // the clinical view keeps the technical extras (thresholds, the
    // 3-series modality chart) that the user-facing hub deliberately hides.
    const isAdminView = route?.name === 'AdminFusion';
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
    const [historicalWindows, setHistoricalWindows] = useState({});
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

    // One-time backfill of this user's own PRIOR fusion_en sessions, merged
    // alongside whatever fusion_en_sessions/current_session_id is live right
    // now -- so the charts below don't reset to empty every new session.
    // fusion_window_key() (backend/common/fusion.py) buckets by ABSOLUTE
    // epoch time, not session-relative index, so window keys from different
    // sessions never collide and can just be merged directly, no
    // renumbering needed. Re-runs when sessionId changes so a just-ended
    // live session gets folded into history once a new one starts.
    useEffect(() => {
        if (!userId) return;
        let cancelled = false;
        get(ref(db, `fusion_en/${userId}`)).then((snapshot) => {
            if (cancelled) return;
            const all = snapshot.val() || {};
            const sids = Object.keys(all)
                .filter((k) => all[k] && typeof all[k] === 'object' && k !== sessionId)
                .sort();
            const priorSids = sids.slice(-RECENT_SESSIONS_FOR_CHART);
            const merged = {};
            priorSids.forEach((sid) => Object.assign(merged, all[sid]));
            setHistoricalWindows(merged);
        }).catch(() => {});
        return () => { cancelled = true; };
    }, [userId, sessionId]);

    const combinedWindows = useMemo(
        () => ({ ...historicalWindows, ...(windows || {}) }),
        [historicalWindows, windows]
    );

    // Fully fused window (falls back to the raw newest only if none is fused yet).
    const latest = useMemo(
        () => latestWindowWith(windows, (w) => w.fused_label != null && w.fused_probability != null)
            || latestWindow(windows),
        [windows]
    );
    const latestMind = useMemo(() => latestWindowWith(windows, (w) => w.prob_eeg != null), [windows]);
    const latestBody = useMemo(() => latestWindowWith(windows, (w) => w.prob_hrv_gsr != null), [windows]);
    const fusedHistory = useMemo(() => {
        const keys = sortedWindowKeys(combinedWindows);
        return keys
            .map((k) => ({ v: combinedWindows[k]?.fused_probability, key: k }))
            .filter(({ v }) => v !== undefined && v !== null)
            .map(({ v, key }) => ({ value: Math.round(v * 100), date: new Date(fusionKeyToMs(key)) }))
            .slice(-CHART_POINTS_MAX);
    }, [combinedWindows]);

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
        const keys = sortedWindowKeys(combinedWindows).slice(-CHART_POINTS_MAX);
        return keys.map((k) => {
            const w = combinedWindows[k] || {};
            return {
                date: new Date(fusionKeyToMs(k)),
                values: [
                    w.prob_eeg != null ? Math.round(w.prob_eeg * 100) : null,
                    w.prob_hrv_gsr != null ? Math.round(w.prob_hrv_gsr * 100) : null,
                    w.fused_probability != null ? Math.round(w.fused_probability * 100) : null,
                ],
            };
        });
    }, [combinedWindows]);
    const hasMultiSeriesData = multiSeriesPoints.filter((p) => p.values.some((v) => v != null)).length > 1;

    // ── Live freshness -- re-evaluated every 20s so "just now" ages
    // honestly even when no new window arrives. ─────────────────────────
    const [, setTick] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setTick((n) => n + 1), 20000);
        return () => clearInterval(id);
    }, []);
    const latestKey = useMemo(() => {
        const keys = sortedWindowKeys(windows);
        return keys.length ? Number(keys[keys.length - 1]) : null;
    }, [windows]);
    const lastUpdateMs = latestKey != null ? fusionKeyToMs(latestKey) : null;
    const isLive = lastUpdateMs != null && Date.now() - lastUpdateMs < LIVE_WINDOW_MS;

    // ── Overall state (fused) ───────────────────────────────────────────
    const label = latest?.fused_label;
    const trend = latest?.stress_trend;
    const stressPhase = latest?.stress_phase;
    const stressAlertMessage = latest?.stress_alert_message;

    let heroKey;
    if (hasAnyWindow && latest) {
        if (label === 1) heroKey = 'high';
        else if (trend === 'increasing' || stressPhase === 'trending_towards_stress') heroKey = 'rising';
        else heroKey = 'calm';
    } else if (lastKnown) {
        heroKey = lastKnown.label === 'Stress' ? 'high' : 'calm';
    } else {
        heroKey = ringConnected || eegConnected ? 'calm' : 'idle';
    }
    // Ring reading far from the saved baseline: the label can't be trusted.
    const baselineStale = (latestBody?.baseline_stale ?? lastKnown?.baseline_stale) === true;
    if (baselineStale && heroKey !== 'idle') heroKey = 'stale';
    const hero = HERO[heroKey];
    const heroColor = heroKey === 'stale' ? COLORS.warning
        : heroKey === 'high' ? COLORS.stress
        : heroKey === 'rising' ? COLORS.warning
        : heroKey === 'idle' ? COLORS.light.textMuted
        : COLORS.normal;
    const heroWhen = isLive ? 'Live · updated just now'
        : lastUpdateMs ? `Last reading ${timeAgo(lastUpdateMs)}`
        : lastKnown?.timestamp ? `Last reading ${timeAgo(new Date(lastKnown.timestamp).getTime())}`
        : 'No readings yet';

    // ── Mind (EEG) / Body (HRV+GSR) rings, each judged against that
    // person's OWN threshold the backend already stamps on the window. ──
    const mindP = latestMind?.prob_eeg ?? null;
    const mindThr = latestMind?.threshold_eeg ?? latest?.threshold_eeg ?? eegCalibration?.personal_high_load_p ?? DEFAULT_EEG_THRESHOLD;
    const mindLevel = levelOf(mindP, mindThr);

    const bodyP = latestBody?.prob_hrv_gsr ?? (hasAnyWindow ? null : lastKnown?.prob_stress ?? null);
    const bodyThr = latestBody?.threshold_hrv_gsr ?? latest?.threshold_hrv_gsr ?? ringCalibration?.personal_stress_threshold ?? DEFAULT_RING_THRESHOLD;
    const bodyLevel = levelOf(bodyP, bodyThr);

    const fusedP = latest?.fused_probability ?? null;
    const fusedThr = latest?.fused_threshold ?? DEFAULT_RING_THRESHOLD;
    const fusedLevel = levelOf(fusedP, fusedThr);
    const fusedLimitPct = latest?.fused_threshold != null
        ? Math.round(latest.fused_threshold * 100) : STRESS_DECISION_THRESHOLD_PERCENT;

    const firstName = (userName || '').split(/[\s_.]/)[0];
    const displayName = firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1) : 'there';

    return (
        <ScreenBackground>
            {/* Soft state-tinted glow behind the top of the screen. */}
            <LinearGradient
                colors={[heroColor + '26', heroColor + '00']}
                style={styles.topGlow}
                pointerEvents="none"
            />
            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
                {/* ── Greeting ── */}
                <View style={styles.topHeader}>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.hey}>
                            Hey, <Text style={styles.heyName}>{displayName}</Text>
                        </Text>
                        <Text style={styles.howAreYou}>How are you doing today?</Text>
                    </View>
                    <AvatarButton userId={userId} onPress={() => navigation.navigate('Profile')} />
                </View>

                {/* ── State hero ── */}
                <View style={styles.heroCard}>
                    <View style={[styles.heroOrb, { backgroundColor: heroColor + '1F', borderColor: heroColor + '40' }]}>
                        <Icon name={hero.icon} size={38} color={heroColor} />
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.heroCaption}>Right now you feel</Text>
                        <Text style={[styles.heroWord, { color: heroKey === 'idle' ? COLORS.light.textSub : COLORS.light.text }]}>
                            {hero.word}
                        </Text>
                        <Text style={styles.heroLine}>{hero.line}</Text>
                        <View style={styles.heroFooter}>
                            <TouchableOpacity
                                activeOpacity={heroKey === 'high' || heroKey === 'rising' ? 0.8 : 1}
                                onPress={heroKey === 'high' || heroKey === 'rising'
                                    ? () => navigation.navigate('RelaxationGuide') : undefined}
                            >
                                <Badge label={hero.tip} color={heroColor} size="sm" />
                            </TouchableOpacity>
                        </View>
                        <View style={styles.heroWhenRow}>
                            {isLive && <StatusDot color={COLORS.normal} active size={6} />}
                            <Text style={styles.heroWhen}>{heroWhen}</Text>
                        </View>
                    </View>
                </View>

                {stressPhase === 'increasing_stress_alert' && stressAlertMessage && (
                    <TouchableOpacity
                        activeOpacity={0.85}
                        onPress={() => navigation.navigate('RelaxationGuide')}
                        style={[styles.alertBanner, { backgroundColor: COLORS.stressSoft, borderColor: COLORS.stress + '40' }]}
                    >
                        <Icon name={NAMES.trendUp} size={18} color={COLORS.stressDark} />
                        <Text style={[styles.alertBannerText, { color: COLORS.stressDark }]}>{stressAlertMessage}</Text>
                        <Icon name={NAMES.chevronRight} size={18} color={COLORS.stressDark} />
                    </TouchableOpacity>
                )}

                {/* ── Balance: Mind / Body rings + overall slider ── */}
                <Card style={styles.block}>
                    <View style={styles.blockHead}>
                        <Text style={styles.blockTitle}>Your balance</Text>
                        {isLive ? <Badge label="Live" color={COLORS.normal} size="sm" /> : null}
                    </View>
                    <View style={styles.ringRow}>
                        <BalanceRing
                            title="Mind"
                            value={mindP != null ? mindP * 100 : null}
                            word={mindLevel ? MIND_WORDS[mindLevel] : ''}
                            color={mindLevel ? LEVEL_COLOR[mindLevel] : COLORS.eeg}
                        />
                        <View style={styles.ringDivider} />
                        <BalanceRing
                            title="Body"
                            value={bodyP != null ? bodyP * 100 : null}
                            word={bodyLevel ? BODY_WORDS[bodyLevel] : ''}
                            color={bodyLevel ? LEVEL_COLOR[bodyLevel] : COLORS.hrv}
                        />
                    </View>
                    <View style={styles.sliderWrap}>
                        <LevelSlider
                            title="Overall stress"
                            position={sliderPosition(fusedP, fusedThr)}
                            word={fusedLevel ? OVERALL_WORDS[fusedLevel] : ''}
                            color={fusedLevel ? LEVEL_COLOR[fusedLevel] : COLORS.brand}
                        />
                    </View>
                </Card>

                {/* ── Quick actions ── */}
                <View style={styles.actionRow}>
                    <ActionTile
                        lead="Breathe in, " bold="breathe out" tail=" for calm"
                        caption="Guided relaxation"
                        icon={NAMES.breathe} tint={COLORS.brand}
                        onPress={() => navigation.navigate('RelaxationGuide')}
                    />
                    <View style={{ width: SPACE.md }} />
                    <ActionTile
                        lead="How are you " bold="feeling" tail="?"
                        caption="30-second check-in"
                        icon={NAMES.pss4} tint={COLORS.secondary}
                        onPress={() => navigation.navigate('PSS4')}
                    />
                </View>
                {/* Phone tracking + its quick check-in -- moved here from Profile. */}
                <View style={[styles.actionRow, { marginTop: SPACE.md }]}>
                    <ActionTile
                        lead="Your " bold="phone habits" tail=""
                        caption="Typing & scrolling"
                        icon={NAMES.phenotyping} tint={COLORS.gsr}
                        onPress={() => navigation.navigate('Phenotyping')}
                        style={{ minHeight: 0 }}
                    />
                </View>

                {/* ── Today's rhythm ── */}
                {fusedHistory.length > 1 && (
                    <Card style={styles.block}>
                        <Text style={styles.blockTitle}>Your stress rhythm</Text>
                        <Text style={styles.blockSub}>Higher means more stress · dashed line is your limit</Text>
                        <View style={{ marginTop: SPACE.md }}>
                            <LineChart
                                points={fusedHistory}
                                color={heroKey === 'idle' ? COLORS.brand : heroColor}
                                width={CHART_WIDTH}
                                height={150}
                                maxValue={100}
                                hideValues
                                baselineValue={fusedLimitPct}
                                baselineLabel="Your limit"
                                colorZones
                                fallback={<Text style={styles.waiting}>Loading chart…</Text>}
                            />
                        </View>
                    </Card>
                )}

                {/* ── Devices ── */}
                {/* Moved here from Profile -- same card as the website's main page. */}
                <BaselineDriftCard userId={userId} ring={ringCalibration} style={styles.block} />

                <Text style={styles.sectionLabel}>Your devices</Text>
                <View style={styles.deviceRow}>
                    <DeviceChip icon={NAMES.my} tint={COLORS.hrv} name="Ring"
                        online={ringConnected} onPress={() => navigation.navigate('RingSummary')} />
                    <DeviceChip icon={NAMES.eeg} tint={COLORS.warning} name="Headband"
                        online={eegConnected} onPress={() => navigation.navigate('EegSummary')} />
                    <DeviceChip icon={NAMES.phenotyping} tint={COLORS.gsr} name="Phone"
                        online onPress={() => navigation.navigate('Phenotyping')} />
                </View>

                {/* ── Clinical extras: only in the Admin stack's view ── */}
                {isAdminView && (personalEegPct != null || personalRingPct != null) && (
                    <Card style={styles.block}>
                        <Text style={styles.blockTitle}>Personal thresholds</Text>
                        <View style={styles.thresholdRow}>
                            <Text style={styles.thresholdLabel}>EEG high-load</Text>
                            <Text style={styles.thresholdValue}>{personalEegPct != null ? `${personalEegPct}%` : 'Population'}</Text>
                        </View>
                        <View style={styles.thresholdRow}>
                            <Text style={styles.thresholdLabel}>Ring stress</Text>
                            <Text style={styles.thresholdValue}>{personalRingPct != null ? `${personalRingPct}%` : 'Population'}</Text>
                        </View>
                    </Card>
                )}
                {isAdminView && hasMultiSeriesData && (
                    <Card style={styles.block}>
                        <Text style={styles.blockTitle}>Modality curves</Text>
                        <Text style={styles.blockSub}>Cognitive load (EEG), autonomic arousal (HRV/GSR) & fused probability</Text>
                        <View style={{ marginTop: SPACE.md }}>
                            <LineChart
                                points={multiSeriesPoints}
                                multiLine
                                seriesColors={[COLORS.eeg, COLORS.hrv, COLORS.brand]}
                                seriesLabels={['EEG', 'HRV/GSR', 'Fused']}
                                width={CHART_WIDTH}
                                height={160}
                                maxValue={100}
                                baselineValue={fusedLimitPct}
                                baselineLabel="Fused limit"
                                fallback={<Text style={styles.waiting}>Loading chart…</Text>}
                            />
                        </View>
                    </Card>
                )}

                <View style={{ height: SPACE.xxl }} />
            </ScrollView>
        </ScreenBackground>
    );
}

const styles = StyleSheet.create({
    scroll: { paddingBottom: SPACE.xxxl },
    topGlow: { position: 'absolute', top: 0, left: 0, right: 0, height: 340 },

    topHeader: {
        flexDirection: 'row', alignItems: 'flex-start',
        paddingHorizontal: SPACE.xl, paddingTop: SPACE.md, paddingBottom: SPACE.lg,
    },
    hey: { fontSize: 28, fontWeight: '400', color: COLORS.light.text, letterSpacing: -0.5 },
    heyName: { fontWeight: '800' },
    howAreYou: { fontSize: 20, fontWeight: '400', color: COLORS.light.textSub, marginTop: 2, letterSpacing: -0.3 },

    heroCard: {
        flexDirection: 'row', alignItems: 'center',
        marginHorizontal: SPACE.xl, marginBottom: SPACE.md,
        padding: SPACE.lg, borderRadius: RADIUS.xl,
        backgroundColor: '#FFFFFFE6', borderWidth: 1, borderColor: '#FFFFFF',
        shadowColor: '#1E293B', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.06, shadowRadius: 18, elevation: 3,
    },
    heroOrb: {
        width: 76, height: 76, borderRadius: 38, borderWidth: 1,
        alignItems: 'center', justifyContent: 'center', marginRight: SPACE.lg,
    },
    heroCaption: { ...TYPE.caption, color: COLORS.light.textMuted },
    heroWord: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5, marginTop: 1 },
    heroLine: { ...TYPE.body, color: COLORS.light.textSub, marginTop: 2 },
    heroFooter: { flexDirection: 'row', marginTop: SPACE.sm },
    heroWhenRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: SPACE.sm },
    heroWhen: { fontSize: 11, fontWeight: '600', color: COLORS.light.textMuted },

    alertBanner: {
        flexDirection: 'row', alignItems: 'center', gap: SPACE.sm,
        marginHorizontal: SPACE.xl, marginBottom: SPACE.md,
        padding: 14, borderRadius: RADIUS.md, borderWidth: 1,
    },
    alertBannerText: { flex: 1, fontSize: 13, fontWeight: '700', lineHeight: 18 },

    block: { marginHorizontal: SPACE.xl, marginBottom: SPACE.md, borderRadius: RADIUS.xl },
    blockHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    blockTitle: { ...TYPE.title, color: COLORS.light.text },
    blockSub: { fontSize: 12, color: COLORS.light.textMuted, marginTop: 3 },
    ringRow: { flexDirection: 'row', alignItems: 'center', marginTop: SPACE.lg },
    ringDivider: { width: 1, height: 90, backgroundColor: COLORS.light.borderSoft },
    sliderWrap: {
        marginTop: SPACE.lg, paddingTop: SPACE.lg,
        borderTopWidth: 1, borderTopColor: COLORS.light.borderSoft,
    },

    actionRow: { flexDirection: 'row', marginHorizontal: SPACE.xl, marginBottom: SPACE.md },

    sectionLabel: {
        ...TYPE.micro, color: COLORS.light.textMuted,
        marginHorizontal: SPACE.xl, marginTop: SPACE.sm, marginBottom: SPACE.sm,
    },
    deviceRow: { flexDirection: 'row', gap: SPACE.sm, marginHorizontal: SPACE.xl, marginBottom: SPACE.md },
    deviceChip: {
        flex: 1, alignItems: 'flex-start', padding: SPACE.md, borderRadius: RADIUS.lg,
        backgroundColor: COLORS.light.card, borderWidth: 1, borderColor: COLORS.light.border,
    },
    deviceIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginBottom: SPACE.sm },
    deviceName: { fontSize: 13, fontWeight: '700', color: COLORS.light.text },
    deviceStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
    deviceStatus: { fontSize: 11, fontWeight: '700' },

    thresholdRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, marginTop: 4 },
    thresholdLabel: { fontSize: 13, fontWeight: '600', color: COLORS.light.textSub },
    thresholdValue: { fontSize: 14, fontWeight: '800', color: COLORS.light.text },

    waiting: { fontSize: 13, fontStyle: 'italic', textAlign: 'center', paddingVertical: 20, color: COLORS.light.textMuted },
});
