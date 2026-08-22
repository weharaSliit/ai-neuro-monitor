// Live EEG (wearable02, T7/T8) session screen -- watches
// psychological/{sessionId} in Realtime Database directly (matching
// modules/fusion's and modules/phenotyping's established
// direct-RTDB-read convention) and displays the current task_state_score/
// label/trend/quality as backend/psychological/mqtt_bridge.py's live loop
// writes them.
//
// Does NOT start or stop the wearable02 firmware, the MQTT broker, or
// backend/psychological/mqtt_bridge.py -- those already run independently.
// "Start Session" here only begins watching a session_id; whoever runs the
// bridge script is responsible for using the same id (it prints the id it
// generated on startup).
//
// Naming honesty (see phscycological/results/CURRENT_SYSTEM.md Section 1):
// this screen must say "task load" / "cognitive load", never "stress" --
// this EEG model outputs task_state_score, not a validated subjective-
// stress probability.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    View, Text, StyleSheet, TextInput, Dimensions,
    TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LineChart, BarChart } from 'react-native-gifted-charts';
import { ref, onValue, off, query, orderByChild, limitToLast } from 'firebase/database';
import { db } from '../firebase';
import { useTheme } from '../../physiological/config/ThemeContext';
import { STRESS_COLORS, STRESS_EMOJI, EEG_TREND_LABELS, TASK_STATE_LABELS } from '../config/config';

// A raw block is 6250 samples (25s @ 250Hz, see backend/psychological/
// realtime/resample.py::SOURCE_FS) -- far too many points for a readable
// mobile line chart or to push through re-renders smoothly. Evenly-spaced
// stride decimation down to a fixed point count for DISPLAY only; this
// screen is a live glance at signal shape/amplitude, not a signal-analysis
// tool -- full-resolution data still lands in Firebase (psychological/
// {sessionId}/raw) and the backend's local CSV log (backend/psychological/
// logs/) either way.
const CHART_POINTS = 120;

// Screen width minus ScrollView padding (styles.scroll, 20 each side) and
// card padding (styles.card, 18 each side), minus the y-axis label gutter
// (yAxisLabelWidth below) -- gifted-charts' LineChart sizes itself from
// point spacing by default, not its parent's width, so without an explicit
// width it stays narrower than the card once expanded.
const RAW_CHART_WIDTH = Dimensions.get('window').width - 2 * 20 - 2 * 18 - 60;
const RAW_CHART_HEIGHT = 260;
// A few px taller than RAW_CHART_HEIGHT: gifted-charts' curved line can
// overshoot its own `height` prop slightly at a sharp peak (curve
// smoothing draws past the data point itself) -- clipping at exactly
// RAW_CHART_HEIGHT cut a sliver off the tallest spikes. The clip wrapper
// still exists to cap a genuinely wild block from blowing out to hundreds
// of px (see SignalChart's own comment below), just with headroom for the
// chart's own normal overshoot.
const RAW_CHART_CLIP_HEIGHT = RAW_CHART_HEIGHT + 16;

function downsample(values) {
    if (!values || values.length === 0) return [];
    if (values.length <= CHART_POINTS) return values;
    const stride = values.length / CHART_POINTS;
    const out = [];
    for (let i = 0; i < CHART_POINTS; i++) {
        out.push(values[Math.floor(i * stride)]);
    }
    return out;
}

// The deployed bipolar-only model's full 29-feature set (band power/ratios,
// Hjorth, time-domain, entropy -- all computed from the T7-T8 differential
// signal, see backend/psychological/sam40/features.py::channel_features()).
// Order and keys match backend/psychological/realtime/firebase_sync.py's
// BIPOLAR_FEATURE_SUFFIXES exactly -- this list is display labels only,
// the backend is the source of truth for what's actually in the vector.
const BIPOLAR_FEATURES = [
    { key: 'delta_power', label: 'δ pow' },
    { key: 'delta_rel_power', label: 'δ rel' },
    { key: 'delta_log_power', label: 'δ log' },
    { key: 'theta_power', label: 'θ pow' },
    { key: 'theta_rel_power', label: 'θ rel' },
    { key: 'theta_log_power', label: 'θ log' },
    { key: 'alpha_power', label: 'α pow' },
    { key: 'alpha_rel_power', label: 'α rel' },
    { key: 'alpha_log_power', label: 'α log' },
    { key: 'beta_power', label: 'β pow' },
    { key: 'beta_rel_power', label: 'β rel' },
    { key: 'beta_log_power', label: 'β log' },
    { key: 'gamma_power', label: 'γ pow' },
    { key: 'gamma_rel_power', label: 'γ rel' },
    { key: 'gamma_log_power', label: 'γ log' },
    { key: 'total_power', label: 'total' },
    { key: 'theta_alpha_ratio', label: 'θ/α' },
    { key: 'beta_alpha_ratio', label: 'β/α' },
    { key: 'theta_beta_ratio', label: 'θ/β' },
    { key: 'spectral_entropy', label: 'spec ent' },
    { key: 'spectral_slope', label: 'spec slope' },
    { key: 'hjorth_activity', label: 'H act' },
    { key: 'hjorth_mobility', label: 'H mob' },
    { key: 'hjorth_complexity', label: 'H cplx' },
    { key: 'mean', label: 'mean' },
    { key: 'std', label: 'std' },
    { key: 'rms', label: 'rms' },
    { key: 'ptp', label: 'ptp' },
    { key: 'sample_entropy', label: 'samp ent' },
];
const BIPOLAR_BAR_WIDTH = 16;
const BIPOLAR_BAR_SPACING = 12;

function percentile(sorted, p) {
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
    return sorted[idx];
}

/** Chart-display data + a robust (5th-95th percentile, not raw min/max) Y
 * range. Real electrode readings under poor contact can spike into the
 * thousands of uV against a normally-tens-of-uV signal (see
 * psycological/results/CURRENT_SYSTEM.md's own documented hardware
 * short-input fault); scaling the chart to the raw min/max let a single
 * such spike squash the rest of a block's shape to a flat, invisible line
 * -- clamping both the plotted points AND the axis bounds to the block's
 * OWN percentile range keeps the sparkline readable regardless of how
 * noisy that particular block is, while the numeric readout above it
 * (lastCh1/lastCh2/lastBipolar) stays the real, unclamped last sample. */
function chartRange(values) {
    if (!values || values.length === 0) return { data: [], min: 0, max: 1, plotMax: 1 };
    const sorted = [...values].sort((a, b) => a - b);
    let lo = percentile(sorted, 0.05);
    let hi = percentile(sorted, 0.95);
    if (hi <= lo) { lo -= 1; hi += 1; }
    const clamped = downsample(values).map((v) => Math.min(hi, Math.max(lo, v)));
    // Plotted value is shifted to start at 0 (= lo), NOT the true reading --
    // gifted-charts' LineChart always anchors its own scale to include 0 as
    // a baseline, even for a block whose real range never crosses zero
    // (e.g. an all-negative railed channel sitting at -5452 to -2810uV).
    // Passing the true (negative) min/max left most of the chart's height
    // spanning the empty 0-to-max band, squeezing the actual waveform into
    // a thin sliver near one edge. Shifting so the data's own min sits at 0
    // and passing plotMax = hi-lo as maxValue makes the wave fill the full
    // chart height regardless of the block's absolute offset; min/max
    // (the TRUE values) still drive the y-axis labels below, so what's
    // displayed as the scale is accurate even though the plotted line
    // isn't at its literal value.
    return {
        data: clamped.map((v) => ({ value: v - lo })),
        min: lo,
        max: hi,
        plotMax: hi - lo,
    };
}

// scripts/start_all.sh pins SESSION_ID=live_session_1 for every backend
// component (both wearable bridges + the fusion engine) -- matching that
// here means this screen has real data to show the moment it mounts,
// instead of watching an empty freshly-generated id no process is writing
// under.
const DEFAULT_SESSION_ID = 'live_session_1';

/** Picks the highest numeric window key present in a
 * psychological/{sessionId} snapshot object -- mirrors
 * FusionSessionScreen's latestWindow() / PhenotypingDashboard.jsx's
 * pattern of sorting entries and taking the latest. */
function latestWindow(windowsObj) {
    if (!windowsObj) return null;
    const keys = Object.keys(windowsObj).filter((k) => /^\d+$/.test(k));
    if (keys.length === 0) return null;
    keys.sort((a, b) => Number(a) - Number(b));
    return windowsObj[keys[keys.length - 1]];
}

function SignalChart({ title, lastValue, data, min, max, plotMax, color, t, last }) {
    // noOfSections=4 -> gifted-charts draws 5 y-axis labels (max down to
    // mostNegativeValue) so the chart reads as an actual scale, not a bare
    // sparkline -- this is what was missing before: a jagged or flat line
    // with no reference for what "tall" or "flat" actually means in µV.
    const mid = (min + max) / 2;
    return (
        <View style={[styles.signalBlock, last ? null : { marginBottom: 16 }]}>
            <View style={styles.signalHeaderRow}>
                <Text style={[styles.signalTitle, { color: t.textSub }]}>{title}</Text>
                <Text style={[styles.signalValue, { color: t.text }]}>
                    {lastValue !== undefined && lastValue !== null ? `${lastValue.toFixed(1)} µV` : '—'}
                </Text>
            </View>
            {data.length > 1 ? (
                <>
                    {/* Fixed-height + overflow:hidden wrapper -- real electrode
                    readings can be thousands of uV (e.g. poor skin contact),
                    versus the tens-of-uV range clean signal sits in; gifted-
                    charts' LineChart doesn't clamp its own drawn height to
                    the `height` prop when a spike is this far outside the
                    data range it auto-scaled for, so without this wrapper a
                    single noisy block made the sparkline blow out to
                    several hundred px instead of staying a compact preview. */}
                    <View style={styles.signalChartClip}>
                        <LineChart
                            data={data}
                            width={RAW_CHART_WIDTH}
                            height={RAW_CHART_HEIGHT}
                            color={color}
                            thickness={2}
                            hideDataPoints
                            curved
                            backgroundColor="transparent"
                            initialSpacing={8}
                            endSpacing={8}
                            spacing={Math.max(2, (RAW_CHART_WIDTH - 16) / Math.max(1, data.length - 1))}
                            maxValue={plotMax}
                            mostNegativeValue={0}
                            noOfSections={4}
                            yAxisLabelWidth={56}
                            yAxisTextStyle={{ color: t.textMuted, fontSize: 10 }}
                            yAxisLabelTexts={[
                                `${min.toFixed(0)}`,
                                `${(min + (max - min) * 0.25).toFixed(0)}`,
                                `${mid.toFixed(0)}`,
                                `${(min + (max - min) * 0.75).toFixed(0)}`,
                                `${max.toFixed(0)}`,
                            ]}
                            yAxisColor={t.border}
                            xAxisColor={t.border}
                            rulesColor={t.border}
                            rulesType="dashed"
                        />
                    </View>
                    <Text style={[styles.signalRange, { color: t.textMuted }]}>
                        this block's range: {min.toFixed(1)} to {max.toFixed(1)} µV
                        {(max - min) < 1 ? ' — flat/railed (near-constant reading)' : ''}
                    </Text>
                </>
            ) : (
                <Text style={[styles.waiting, { color: t.textMuted, paddingVertical: 4 }]}>—</Text>
            )}
        </View>
    );
}

export default function EegSessionScreen({ navigation, route }) {
    // Shared between two entry points with different back semantics: the
    // Dashboard's "EEG" Quick Action tile pushes the root Stack's "Eeg"
    // route (has real back history, App.js), while the bottom tab bar's
    // "EEG" tab (PhysiologicalNavigator.js) renders this directly with no
    // push involved. navigation.canGoBack() isn't reliable here -- it
    // bubbles up to ancestor navigators, so it returned true even for the
    // plain tab (some root-level history existed regardless). route.name
    // is deterministic instead: it's exactly the name the screen was
    // registered under in whichever navigator rendered it.
    const showBack = route?.name === 'Eeg';
    const { isDark, theme: t, COLORS } = useTheme();
    const [sessionId, setSessionId] = useState(DEFAULT_SESSION_ID);
    const [watching, setWatching] = useState(false);
    const [latest, setLatest] = useState(null);
    const [hasAnyWindow, setHasAnyWindow] = useState(false);
    const [latestRaw, setLatestRaw] = useState(null);
    const [hasAnyRaw, setHasAnyRaw] = useState(false);
    const listenerRef = useRef(null);
    const rawListenerRef = useRef(null);

    const startWatching = useCallback(() => {
        if (!sessionId.trim()) return;
        setLatest(null);
        setHasAnyWindow(false);
        setLatestRaw(null);
        setHasAnyRaw(false);

        // limitToLast(1): this path accumulates one child per 25s block for
        // the whole session's lifetime (window 0, 1, 2, ...) -- an unbounded
        // query here means Firebase ships the ENTIRE session history before
        // the listener ever fires once, which measured 25-30+ seconds into a
        // session that's been running a while (the actual cause behind "the
        // dashboard shows nothing" -- it wasn't broken, it was still
        // downloading). Only the latest block is ever rendered anyway (see
        // latestWindow()), so only fetch that one.
        //
        // orderByChild('window'), NOT orderByKey(): this path has two other
        // non-numeric siblings alongside the window children -- 'raw' (full-
        // resolution per-block archive) and 'live_raw' (below). Firebase
        // orders numeric-looking keys before string keys under orderByKey(),
        // so limitToLast(1) there actually returned 'raw' or 'live_raw'
        // (whichever sorts last alphabetically), not the latest window --
        // confirmed by this screen falling back to "waiting" even with a
        // live backend. Every real window record carries its own 'window'
        // field (see make_eeg_output_record()); 'raw'/'live_raw' don't have
        // one, so they sort first (undefined orders lowest) and never
        // contend for last place.
        const sessionRef = query(ref(db, `psychological/${sessionId.trim()}`), orderByChild('window'), limitToLast(1));
        const handler = onValue(sessionRef, (snapshot) => {
            const data = snapshot.val();
            setHasAnyWindow(!!data);
            setLatest(latestWindow(data));
        });
        listenerRef.current = sessionRef;

        // Sibling sub-node under the same session root -- see
        // backend/psychological/firebase_service.py::push_live_raw() -- a
        // single ~1s raw-preview snapshot, OVERWRITTEN on every bridge push
        // (not window-keyed like the derived-output windows above), which
        // is what makes this a genuinely live waveform: it updates roughly
        // once a second regardless of the 25s block/quality-gate cycle that
        // gates task_state_score. No latestWindow() lookup needed -- the
        // node itself already IS the latest snapshot.
        const rawRef = ref(db, `psychological/${sessionId.trim()}/live_raw`);
        const rawHandler = onValue(rawRef, (snapshot) => {
            const data = snapshot.val();
            setHasAnyRaw(!!data);
            setLatestRaw(data);
        });
        rawListenerRef.current = rawRef;

        setWatching(true);
    }, [sessionId]);

    const stopWatching = useCallback(() => {
        if (listenerRef.current) {
            off(listenerRef.current);
            listenerRef.current = null;
        }
        if (rawListenerRef.current) {
            off(rawListenerRef.current);
            rawListenerRef.current = null;
        }
        setWatching(false);
    }, []);

    // Auto-watch the default (live) session on mount -- no reason to make
    // the user click "Start Session" just to see data a backend process is
    // already publishing. Runs once; manually editing the session id and
    // pressing Start still works for watching a non-default session.
    useEffect(() => {
        startWatching();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const skipped = latest?.skipped;
    const label = latest?.task_state_label;
    const score = latest?.task_state_score;
    const trend = latest?.task_state_trend;
    const qualityScore = latest?.eeg_quality_score;
    const qualityFlag = latest?.eeg_quality_flag;
    const highLoadAlert = latest?.high_load_alert;
    const microBreak = latest?.micro_break_recommended;
    const fatigueWarning = latest?.fatigue_warning;
    const baselineDegraded = latest?.baseline_degraded;
    const stateColor = label !== undefined && label !== null ? STRESS_COLORS[label] : COLORS.brand;

    const ch1Uv = latestRaw?.ch1_uv;
    const ch2Uv = latestRaw?.ch2_uv;
    // bipolar = T7 - T8, reference-agnostic by construction -- same
    // derivation the deployed model itself uses (see
    // psycological/results/CURRENT_SYSTEM.md Section 3), computed here
    // client-side rather than stored separately since it's fully determined
    // by ch1_uv/ch2_uv already in the raw record.
    const bipolarUv = (ch1Uv && ch2Uv && ch1Uv.length === ch2Uv.length)
        ? ch1Uv.map((v, i) => v - ch2Uv[i])
        : null;
    const ch1Chart = ch1Uv ? chartRange(ch1Uv) : { data: [], min: 0, max: 1, plotMax: 1 };
    const ch2Chart = ch2Uv ? chartRange(ch2Uv) : { data: [], min: 0, max: 1, plotMax: 1 };
    const bipolarChart = bipolarUv ? chartRange(bipolarUv) : { data: [], min: 0, max: 1, plotMax: 1 };
    const lastCh1 = ch1Uv?.[ch1Uv.length - 1];
    const lastCh2 = ch2Uv?.[ch2Uv.length - 1];
    const lastBipolar = bipolarUv?.[bipolarUv.length - 1];

    // 29-feature bipolar (T7-T8) differential vector -- see
    // backend/psychological/realtime/firebase_sync.py::make_eeg_output_record()
    // for what actually populates features_eeg.bipolar. Wildly different
    // scales across power/ratio/entropy features (µV² powers can run into
    // the tens of thousands -- e.g. hjorth_activity -- while ratios/entropy
    // sit under ~5) means a shared LINEAR y-axis squashes every small
    // feature to an invisible sliver next to the largest one. Plotted bar
    // height uses a signed-log transform (sign(v) * log10(1+|v|)) so every
    // feature gets a visible, comparable bar regardless of its raw scale;
    // the REAL unscaled value is still what's printed on top of each bar
    // (and is what the model/backend actually use) -- the log transform is
    // display-only.
    const signedLog = (v) => Math.sign(v) * Math.log10(1 + Math.abs(v));
    const bipolarFeatures = latest?.features_eeg?.bipolar;
    const bipolarBarData = bipolarFeatures
        ? BIPOLAR_FEATURES.map(({ key, label }) => {
              const real = bipolarFeatures[key] ?? 0;
              return {
                  value: signedLog(real),
                  label,
                  frontColor: COLORS.brand,
                  topLabelComponent: () => (
                      <Text style={styles.bipolarBarTopLabel}>
                          {Math.abs(real) >= 1000 ? real.toFixed(0) : real.toFixed(2)}
                      </Text>
                  ),
              };
          })
        : [];

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: t.bg }]} edges={['top', 'left', 'right']}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
                <ScrollView contentContainerStyle={styles.scroll}>
                    <View style={styles.header}>
                        {showBack && (
                            <TouchableOpacity onPress={() => navigation.goBack()}>
                                <Text style={[styles.back, { color: COLORS.brand }]}>{'←'} Back</Text>
                            </TouchableOpacity>
                        )}
                        <Text style={[styles.title, { color: t.text }]}>Live EEG</Text>
                        <Text style={[styles.subtitle, { color: t.textMuted }]}>
                            T7/T8 cognitive-load readings, live (wearable02)
                        </Text>
                    </View>

                    <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                        <Text style={[styles.label, { color: t.textSub }]}>Session ID</Text>
                        <TextInput
                            style={[styles.input, { color: t.text, borderColor: t.border }]}
                            value={sessionId}
                            onChangeText={setSessionId}
                            editable={!watching}
                            autoCapitalize="none"
                            autoCorrect={false}
                            placeholder="session id"
                            placeholderTextColor={t.textMuted}
                        />
                        <Text style={[styles.hint, { color: t.textMuted }]}>
                            Use the SAME session id backend/psychological/mqtt_bridge.py printed on
                            startup (or pass EEG_SESSION_ID to set your own).
                        </Text>

                        {!watching ? (
                            <TouchableOpacity
                                style={[styles.button, { backgroundColor: COLORS.brand }]}
                                onPress={startWatching}
                                activeOpacity={0.85}
                            >
                                <Text style={styles.buttonText}>Start Session (watch live)</Text>
                            </TouchableOpacity>
                        ) : (
                            <TouchableOpacity
                                style={[styles.button, styles.buttonDanger]}
                                onPress={stopWatching}
                                activeOpacity={0.85}
                            >
                                <Text style={styles.buttonText}>Stop Watching</Text>
                            </TouchableOpacity>
                        )}
                    </View>

                    {watching && (
                        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                            {!hasAnyWindow ? (
                                <Text style={[styles.waiting, { color: t.textMuted }]}>
                                    Waiting for first reading… (calibration takes ~75s)
                                </Text>
                            ) : skipped ? (
                                <Text style={[styles.waiting, { color: t.textMuted }]}>
                                    Latest block skipped by the signal-quality gate — check electrode contact.
                                </Text>
                            ) : (
                                <>
                                    <View style={styles.stateRow}>
                                        <Text style={styles.stateEmoji}>
                                            {label !== undefined && label !== null ? STRESS_EMOJI[label] : '…'}
                                        </Text>
                                        <View style={{ flex: 1 }}>
                                            <Text style={[styles.stateLabel, { color: stateColor }]}>
                                                {label !== undefined && label !== null
                                                    ? TASK_STATE_LABELS[label] : 'Scoring…'}
                                            </Text>
                                            <Text style={[styles.stateProb, { color: t.textMuted }]}>
                                                {score !== undefined && score !== null
                                                    ? `${(score * 100).toFixed(0)}% task_state_score` : ''}
                                            </Text>
                                        </View>
                                    </View>

                                    <View style={styles.metaRow}>
                                        <Text style={[styles.metaLabel, { color: t.textSub }]}>Trend</Text>
                                        <Text style={[styles.metaValue, { color: t.text }]}>
                                            {trend ? (EEG_TREND_LABELS[trend] || trend) : '—'}
                                        </Text>
                                    </View>

                                    <View style={styles.metaRow}>
                                        <Text style={[styles.metaLabel, { color: t.textSub }]}>Signal quality</Text>
                                        <Text style={[styles.metaValue, { color: t.text }]}>
                                            {qualityScore !== undefined && qualityScore !== null
                                                ? `${qualityScore.toFixed(0)}${qualityFlag ? ' (trusted)' : ' (untrusted)'}`
                                                : '—'}
                                        </Text>
                                    </View>

                                    {baselineDegraded && (
                                        <Text style={[styles.warningText, { color: '#ef4444' }]}>
                                            ⚠ Baseline degraded — calibration never reached GOOD quality;
                                            scores here are not trustworthy.
                                        </Text>
                                    )}
                                    {highLoadAlert && (
                                        <Text style={[styles.warningText, { color: '#ef4444' }]}>
                                            ⚠ High load alert
                                        </Text>
                                    )}
                                    {microBreak && (
                                        <Text style={[styles.warningText, { color: '#f59e0b' }]}>
                                            ⏸ Micro-break recommended
                                        </Text>
                                    )}
                                    {fatigueWarning && (
                                        <Text style={[styles.warningText, { color: '#f59e0b' }]}>
                                            😴 Fatigue warning
                                        </Text>
                                    )}
                                </>
                            )}
                        </View>
                    )}

                    {watching && (
                        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                            <Text style={[styles.label, { color: t.textSub, marginBottom: 12 }]}>
                                Raw Signal (live, ~1s)
                            </Text>
                            {!hasAnyRaw ? (
                                <Text style={[styles.waiting, { color: t.textMuted }]}>
                                    Waiting for first raw preview…
                                </Text>
                            ) : (
                                <>
                                    <SignalChart
                                        title="Channel 1 (T7)"
                                        lastValue={lastCh1}
                                        data={ch1Chart.data}
                                        min={ch1Chart.min}
                                        max={ch1Chart.max}
                                        plotMax={ch1Chart.plotMax}
                                        color={COLORS.hrv || COLORS.brand}
                                        t={t}
                                    />
                                    <SignalChart
                                        title="Channel 2 (T8)"
                                        lastValue={lastCh2}
                                        data={ch2Chart.data}
                                        min={ch2Chart.min}
                                        max={ch2Chart.max}
                                        plotMax={ch2Chart.plotMax}
                                        color={COLORS.gsr || COLORS.brand}
                                        t={t}
                                    />
                                    <SignalChart
                                        title="Bipolar (T7 − T8)"
                                        lastValue={lastBipolar}
                                        data={bipolarChart.data}
                                        min={bipolarChart.min}
                                        max={bipolarChart.max}
                                        plotMax={bipolarChart.plotMax}
                                        color={stateColor}
                                        t={t}
                                        last
                                    />
                                    <Text style={[styles.hint, { color: t.textMuted, marginTop: 4 }]}>
                                        Decoded µV, updates ~1x/sec straight from the MQTT stream — independent of
                                        the 25s inference block below. Full-resolution per-block samples are
                                        separately stored in Firebase and the backend's raw CSV log either way.
                                    </Text>
                                </>
                            )}
                        </View>
                    )}

                    {watching && bipolarBarData.length > 0 && (
                        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                            <Text style={[styles.label, { color: t.textSub, marginBottom: 4 }]}>
                                Bipolar (T7 − T8) Differential Features
                            </Text>
                            <Text style={[styles.hint, { color: t.textMuted, marginBottom: 12 }]}>
                                All 29 features from this block's T7−T8 differential signal (band
                                power/ratios, Hjorth, time-domain, entropy). Updates every 25s block,
                                the model's own feature window — including blocks the quality gate
                                skips, so this stays live even when task_state_score above doesn't.
                                Bar heights use a log scale so small features stay visible next to
                                large ones (e.g. Hjorth activity) — the number above each bar is
                                always the real, unscaled value.
                            </Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator>
                                <BarChart
                                    data={bipolarBarData}
                                    width={bipolarBarData.length * (BIPOLAR_BAR_WIDTH + BIPOLAR_BAR_SPACING)}
                                    height={170}
                                    barWidth={BIPOLAR_BAR_WIDTH}
                                    spacing={BIPOLAR_BAR_SPACING}
                                    noOfSections={4}
                                    hideYAxisText
                                    yAxisColor={t.border}
                                    xAxisColor={t.border}
                                    xAxisLabelTextStyle={{ color: t.textSub, fontSize: 8 }}
                                    rulesColor={t.border}
                                    rulesType="dashed"
                                    backgroundColor="transparent"
                                    disableScroll
                                />
                            </ScrollView>
                        </View>
                    )}
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container:    { flex: 1 },
    scroll:       { padding: 20, paddingBottom: 40 },
    header:       { marginBottom: 20 },
    back:         { fontSize: 14, fontWeight: '600', marginBottom: 14 },
    title:        { fontSize: 26, fontWeight: '900' },
    subtitle:     { fontSize: 13, marginTop: 4 },
    card:         { borderRadius: 18, borderWidth: 1, padding: 18, marginBottom: 16 },
    label:        { fontSize: 12, fontWeight: '700', marginBottom: 6 },
    input:        { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
    hint:         { fontSize: 11, marginTop: 8, lineHeight: 16 },
    button:       { marginTop: 14, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
    buttonDanger: { backgroundColor: '#ef4444' },
    buttonText:   { color: '#fff', fontSize: 15, fontWeight: '800' },
    waiting:      { fontSize: 13, textAlign: 'center', paddingVertical: 10 },
    stateRow:     { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 18 },
    stateEmoji:   { fontSize: 40 },
    stateLabel:   { fontSize: 22, fontWeight: '900' },
    stateProb:    { fontSize: 13, marginTop: 2 },
    metaRow:      { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
    metaLabel:    { fontSize: 13, fontWeight: '600' },
    metaValue:    { fontSize: 13, fontWeight: '700' },
    warningText:  { fontSize: 13, fontWeight: '700', marginTop: 10 },
    signalBlock:      {},
    signalHeaderRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
    signalTitle:      { fontSize: 12, fontWeight: '700' },
    signalValue:      { fontSize: 13, fontWeight: '800' },
    signalChartClip:  { height: RAW_CHART_CLIP_HEIGHT, overflow: 'hidden' },
    signalRange:      { fontSize: 10, marginTop: 4 },
    bipolarBarTopLabel: { fontSize: 9, color: '#888', marginBottom: 2, fontWeight: '600' },
});
