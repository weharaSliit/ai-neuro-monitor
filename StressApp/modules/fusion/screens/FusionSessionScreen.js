import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    View, Text, StyleSheet, Dimensions,
    TouchableOpacity, ScrollView,
} from 'react-native';

const CHART_WIDTH = Dimensions.get('window').width - 2 * 20 - 2 * 18 - 40;
import axios from 'axios';
import ScreenBackground from '../../shared/ScreenBackground';
import Card from '../../shared/Card';
import StatusDot from '../../shared/StatusDot';
import Icon, { NAMES } from '../../shared/Icon';
import MoodBadge from '../../shared/MoodBadge';
import AvatarButton from '../../shared/AvatarButton';
import { CalibrationBanner } from '../../shared/CalibrationGate';
import LineChart from '../../shared/LineChart';
import { ref, onValue, off } from 'firebase/database';
import { db } from '../firebase';
import { useTheme } from '../../physiological/config/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import api from '../../physiological/api/client';
import { API_BASE, DEVICE_ID } from '../../physiological/config/config';
import { STRESS_COLORS, STRESS_LABELS, FUSION_TREND_LABELS } from '../config/config';

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

// A section card for one device/module -- Ring, EEG, Phenotyping -- each
// tappable through to its own detail screen. Richer than a plain status
// row: icon, connection state, and a short one-line summary of what's
// there right now, so the hub page reads as full sections rather than a
// thin nav list.
function SectionCard({ icon, iconColor, title, statusText, statusColor, summary, onPress, t }) {
    return (
        <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
            <Card>
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
        if (targetId === sessionId && listenerRef.current) return;  // already watching this session
        setSessionId(targetId);
        setWindows(null);
        setHasAnyWindow(false);

        // Nested under the logged-in user (fusion_en/{userId}/{sessionId}) --
        // a "session" is a login-to-logout span belonging to one user, see
        // backend/psychological/firebase_service.py's EegFirebaseSession and
        // fushion engin/fusion_live_session.py, which write/read this same
        // user-scoped path.
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
        // A live subscription, not a one-time get() -- picks up the current
        // session the instant AuthContext.js writes it (at login) and
        // follows any later rotation automatically, so there's never a
        // manual "Start" step needed. current_session_id itself stays a flat
        // pointer (not user-scoped) -- see AuthContext.js's
        // CURRENT_SESSION_ID_ROOTS.
        const pointerRef = ref(db, 'fusion_en_sessions/current_session_id');
        const handler = onValue(pointerRef, (snapshot) => {
            const liveId = snapshot.val();
            if (liveId) startWatching(liveId);
        });
        return () => off(pointerRef, 'value', handler);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- startWatching is always called
        // with an explicit liveId override here, so its own sessionId-state closure never matters.
    }, [userId]);

    // Ring: real device-status poll. EEG: no equivalent device-status
    // route exists, so "connected" is read as "a live EEG session exists
    // right now" -- same pointer EegSummaryScreen.js watches.
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

    // Fallback for "nothing live yet in this session" (a brand-new session
    // starts empty even while the device is on, and stays empty the whole
    // time if it's actually off) -- last known reading from history, so the
    // screen shows something real instead of a blank waiting state.
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
                // no history yet -- leave lastKnown null, the plain waiting text covers it
            }
        })();
    }, [userId]);

    const latest = useMemo(() => latestWindow(windows), [windows]);
    const { fusedHistory, baselinePercent } = useMemo(() => {
        const keys = sortedWindowKeys(windows);
        // Each window key IS a real wall-clock bucket index (see
        // backend/common/fusion.py's fusion_window_key(): int(time.time() //
        // FUSION_WINDOW_BUCKET_SEC)) -- multiplying back out gives a genuine
        // timestamp per point, not a synthetic sequential index.
        const history = keys
            .map((k) => ({ v: windows[k]?.fused_probability, key: k }))
            .filter(({ v }) => v !== undefined && v !== null)
            .map(({ v, key }) => ({ value: Math.round(v * 100), date: new Date(Number(key) * 60000) }));
        const latestProb = latest?.fused_probability;
        const latestDev = latest?.stress_deviation;
        const baseline = (latestProb !== undefined && latestProb !== null
            && latestDev !== undefined && latestDev !== null)
            ? Math.round((latestProb - latestDev) * 100)
            : null;
        return { fusedHistory: history, baselinePercent: baseline };
    }, [windows, latest]);

    const label = latest?.fused_label;
    const prob = latest?.fused_probability;
    const trend = latest?.stress_trend;
    const stateColor = label !== undefined && label !== null ? STRESS_COLORS[label] : COLORS.brand;

    return (
        <ScreenBackground>
            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
                <View style={styles.header}>
                    <View>
                        <Text style={[styles.dateStr, { color: t.textMuted }]}>{getDateStr()}</Text>
                        <Text style={[styles.greeting, { color: t.text }]}>{getGreeting()}, {userName}</Text>
                        <Text style={[styles.subtitle, { color: t.textMuted }]}>
                            Wear your ring and headband to see your live stress result
                        </Text>
                    </View>
                    <AvatarButton userId={userId} onPress={() => navigation.navigate('Profile')} />
                </View>

                <CalibrationBanner userId={userId} token={token} />

                <Card elevated accentColor={stateColor}>
                    {!hasAnyWindow ? (
                        lastKnown ? (
                            <>
                                <Text style={[styles.hint, { color: t.textMuted, marginBottom: 10 }]}>
                                    No live reading right now — last known state:
                                </Text>
                                <View style={styles.gaugeRow}>
                                    <MoodBadge stressed={lastKnown.label === 'Stress'}
                                        color={lastKnown.label === 'Stress' ? COLORS.stress : COLORS.normal} size={58} />
                                    <View style={{ flex: 1, marginLeft: 14 }}>
                                        <Text style={[styles.stateLabel, { color: lastKnown.label === 'Stress' ? COLORS.stress : COLORS.normal }]}>
                                            {lastKnown.label || '—'}
                                        </Text>
                                        <Text style={[styles.stateProb, { color: t.textMuted }]}>
                                            {lastKnown.timestamp ? new Date(lastKnown.timestamp).toLocaleString() : ''}
                                        </Text>
                                    </View>
                                </View>
                            </>
                        ) : (
                            <View style={styles.emptyState}>
                                <Icon name={NAMES.overview} size={34} color={t.textMuted} />
                                <Text style={[styles.waiting, { color: t.textMuted }]}>
                                    Wear your ring and headband to see your live stress result here.
                                </Text>
                            </View>
                        )
                    ) : (
                        <>
                            <View style={styles.gaugeRow}>
                                {label !== undefined && label !== null ? (
                                    <MoodBadge stressed={label === 1} color={stateColor} size={58} />
                                ) : (
                                    <View style={[styles.stateIconCircle, { backgroundColor: stateColor + '18' }]}>
                                        <Icon name={NAMES.overview} size={26} color={stateColor} />
                                    </View>
                                )}
                                <View style={{ flex: 1, marginLeft: 14 }}>
                                    <Text style={[styles.stateLabel, { color: stateColor }]}>
                                        {label !== undefined && label !== null
                                            ? STRESS_LABELS[label] : 'Scoring…'}
                                    </Text>
                                    <Text style={[styles.stateProb, { color: t.textMuted }]}>
                                        {prob !== undefined && prob !== null
                                            ? `${(prob * 100).toFixed(0)}%` : ''}
                                    </Text>
                                </View>
                                {trend && TREND_ICON[trend] && (
                                    <View style={styles.trendChip}>
                                        <Icon name={TREND_ICON[trend]} size={16} color={t.textSub} />
                                        <Text style={[styles.trendChipText, { color: t.textSub }]}>
                                            {FUSION_TREND_LABELS[trend] || trend}
                                        </Text>
                                    </View>
                                )}
                            </View>

                            {fusedHistory.length > 1 && (
                                <View style={styles.trendBlock}>
                                    <Text style={[styles.hint, { color: t.textMuted, marginBottom: 10 }]}>
                                        Trend this session
                                        {baselinePercent !== null ? ` · baseline ${baselinePercent}%` : ''}
                                    </Text>
                                    <LineChart
                                        points={fusedHistory}
                                        color={stateColor}
                                        width={CHART_WIDTH}
                                        height={150}
                                        maxValue={100}
                                        suffix="%"
                                        fallback={<Text style={[styles.waiting, { color: t.textMuted }]}>Loading chart…</Text>}
                                    />
                                </View>
                            )}
                        </>
                    )}
                </Card>

                <Text style={[styles.sectionsLabel, { color: t.textSub }]}>Devices & Tracking</Text>

                <SectionCard
                    icon={NAMES.my} iconColor={COLORS.brand} title="My Ring"
                    statusText={ringConnected ? 'Connected' : 'Off'}
                    statusColor={ringConnected ? COLORS.normal : t.border}
                    summary={ringConnected ? 'Streaming HRV & GSR readings' : 'Put the ring on to start streaming'}
                    onPress={() => navigation.navigate('RingSummary')} t={t}
                />
                <SectionCard
                    icon={NAMES.eeg} iconColor={COLORS.warning} title="EEG Headband"
                    statusText={eegConnected ? 'Connected' : 'Off'}
                    statusColor={eegConnected ? COLORS.normal : t.border}
                    summary={eegConnected ? 'Reading cognitive load live' : 'Put the headband on to start a session'}
                    onPress={() => navigation.navigate('EegSummary')} t={t}
                />
                <SectionCard
                    icon={NAMES.phenotyping} iconColor={COLORS.gsr} title="Phone Statistics"
                    statusText="Always on" statusColor={COLORS.gsr}
                    summary="Typing rhythm, screen activity & app-switching patterns"
                    onPress={() => navigation.navigate('Phenotyping')} t={t}
                />

                <View style={{ height: 20 }} />
            </ScrollView>
        </ScreenBackground>
    );
}

const styles = StyleSheet.create({
    scroll:       { padding: 20, paddingBottom: 40 },
    header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 },
    dateStr:      { fontSize: 12, fontWeight: '600', marginBottom: 2 },
    greeting:     { fontSize: 24, fontWeight: '900' },
    subtitle:     { fontSize: 12, marginTop: 6, maxWidth: 240, lineHeight: 17 },
    hint:         { fontSize: 11, lineHeight: 16 },
    waiting:      { fontSize: 13, textAlign: 'center', marginTop: 10 },
    emptyState:   { alignItems: 'center', paddingVertical: 16 },
    gaugeRow:     { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
    stateIconCircle: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
    stateLabel:   { fontSize: 22, fontWeight: '900' },
    stateProb:    { fontSize: 13, marginTop: 2 },
    trendChip:    { flexDirection: 'row', alignItems: 'center', gap: 4 },
    trendChipText:{ fontSize: 11, fontWeight: '700', maxWidth: 70 },
    trendBlock:   { marginBottom: 4 },
    sectionsLabel:{ fontSize: 12, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 6, marginBottom: 10 },
    sectionRow:   { flexDirection: 'row', alignItems: 'center' },
    sectionIconCircle: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
    sectionTopRow:{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    sectionTitle: { fontSize: 15, fontWeight: '800' },
    sectionStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    sectionStatusText: { fontSize: 11, fontWeight: '700' },
    sectionSummary: { fontSize: 12, marginTop: 3 },
});
