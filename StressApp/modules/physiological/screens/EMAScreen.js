import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Animated, Dimensions
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenBackground from '../../shared/ScreenBackground';
import api from '../api/client';
import { useTheme } from '../config/ThemeContext';
import { COLORS } from '../config/theme';
import { useAuth } from '../../../context/AuthContext';
import LineChart from '../../shared/LineChart';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DRIFT_CHART_WIDTH = SCREEN_WIDTH - 40 - 36; // screen margins + card padding

// The two most human-readable features to chart drift for -- AVNN/MeanHR
// are the same pair the FeatureRow list always highlights first, and
// unlike SCL_mean/SCR_count/SD1 they need no domain knowledge to read
// ("your resting heart rate baseline has drifted from X to Y bpm").
const DRIFT_FEATURES = [
  { key: 'AVNN',   label: 'Resting AVNN',    unit: 'ms',  color: COLORS.hrv },
  { key: 'MeanHR', label: 'Resting Heart Rate', unit: 'bpm', color: COLORS.stress },
];

function AnimatedCounter({ value, color }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(anim, { toValue: 1, tension: 60, friction: 8, useNativeDriver: true }).start();
  }, [value]);
  return (
    <Animated.Text style={[{ color, fontSize: 22, fontWeight: '900', transform: [{ scale: anim }] }]}>
      {value}
    </Animated.Text>
  );
}

export default function EMAScreen({ navigation }) {
  const { theme }               = useTheme();
  const { user }                = useAuth();
  const [emaData, setEmaData]         = useState(null);
  const [driftHistory, setDriftHistory] = useState([]); // ascending by timestamp, full history
  const [loading, setLoading]         = useState(true);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const insets   = useSafeAreaInsets();

  const userId = user?.userId;

  const bg        = theme.bg;
  const card      = theme.card;
  const border    = theme.border;
  const cardHover = theme.cardHover;
  const text      = theme.text;
  const muted     = theme.textMuted;

  // Entries are now written by calibration_capture.py every time a
  // recalibration blends into an existing baseline (see backend/
  // physiological/calibration_capture.py::save_calibration_windows) --
  // pushed with an auto-generated key, not a session_id, since a
  // recalibration isn't tied to any one ring session. `changes` already
  // carries the real per-feature formula string and `highlight` flag from
  // ema_service.py's build_ema_summary(), and `interpretation` is
  // interpret_ema_change()'s real physiological reading -- both computed
  // once server-side at write time, not reconstructed here.
  const normalizeHistoryEntry = (entry) => {
    if (!entry) return null;
    const changes = entry.changes || {};
    const comparison = Object.entries(changes)
      .filter(([, v]) => v && v.highlight)
      .map(([feature, v]) => ({
        feature, old: v.old, new: v.new, delta: v.delta, formula: v.formula,
      }));
    return { alpha: entry.alpha, comparison,
      interpretation: entry.interpretation?.length
        ? entry.interpretation
        : ['From a real recalibration — a controlled, sit-still measurement, not everyday activity.'],
      timestamp: entry.timestamp };
  };

  const loadHistory = async () => {
    try {
      const res     = await api.get(`/ema/history/${userId}`);
      const history = res.data?.ema_history || {};
      const entries = Object.values(history).filter(Boolean);
      entries.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
      return entries; // ascending -- oldest first, latest last
    } catch { return []; }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      const entries = await loadHistory();
      if (!mounted) return;
      if (entries.length > 0) {
        setDriftHistory(entries);
        setEmaData(normalizeHistoryEntry(entries[entries.length - 1]));
        Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start();
      }
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [userId]);

  // {value, date}[] per drift feature, from every past recalibration --
  // not just the latest one shown in "Baseline Changes" below.
  const driftSeries = (featureKey) =>
    driftHistory
      .filter((e) => e.changes?.[featureKey]?.new !== undefined && e.timestamp)
      .map((e) => ({ value: e.changes[featureKey].new, date: new Date(e.timestamp) }));

  if (!emaData) {
    return (
      <ScreenBackground>
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyIconRing, { borderColor: COLORS.brand + '40' }]}>
            <Text style={styles.emptyEmoji}>🔄</Text>
          </View>
          <Text style={[styles.emptyTitle, { color: text }]}>
            {loading ? 'Loading…' : 'No Baseline Updates Yet'}
          </Text>
          <Text style={[styles.emptyText, { color: muted }]}>
            Your baseline updates automatically each time you recalibrate — a
            real, controlled measurement, not everyday activity.
          </Text>
          {!loading && (
            <TouchableOpacity
              style={[styles.refreshBtn, { backgroundColor: card, borderColor: border, marginTop: 8 }]}
              onPress={() => navigation.navigate('Calibration')}
            >
              <Text style={[styles.refreshBtnText, { color: COLORS.brand }]}>Go to Calibration →</Text>
            </TouchableOpacity>
          )}
          <View style={[styles.emptyBadge, { backgroundColor: COLORS.brand + '15', borderColor: COLORS.brand + '40' }]}>
            <Text style={[styles.emptyBadgeText, { color: COLORS.brandLight }]}>Watching: {userId}</Text>
          </View>
        </View>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
      <Animated.ScrollView
        style={[styles.container, { opacity: fadeAnim }]}
        contentContainerStyle={{ paddingBottom: 16 + insets.bottom + 60 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={[styles.title, { color: text }]}>EMA Baseline Update</Text>
            <Text style={[styles.subtitle, { color: COLORS.brand }]}>Continual Learning</Text>
          </View>
          <View style={[styles.userBadge, { backgroundColor: COLORS.brand + '15', borderColor: COLORS.brand + '40' }]}>
            <Text style={[styles.userBadgeText, { color: COLORS.brandLight }]}>{userId}</Text>
          </View>
        </View>

        {/* Formula card */}
        <View style={[styles.formulaCard, { backgroundColor: cardHover, borderColor: COLORS.brand + '40' }]}>
          <View style={styles.formulaHeader}>
            <Text style={[styles.formulaTitle, { color: COLORS.brandLight }]}>EMA Formula</Text>
            <View style={[styles.alphaBadge, { backgroundColor: COLORS.brand + '20' }]}>
              <Text style={[styles.alphaText, { color: COLORS.brandLight }]}>α = {emaData.alpha}</Text>
            </View>
          </View>

          <View style={[styles.formulaBox, { backgroundColor: card, borderColor: border }]}>
            <Text style={[styles.formulaEq, { color: COLORS.brandLight }]}>
              new = α × new calibration + (1-α) × previous
            </Text>
            <Text style={[styles.formulaEq, { color: text }]}>
              new = {emaData.alpha} × new calibration + {(1 - emaData.alpha).toFixed(1)} × previous
            </Text>
          </View>

          <View style={styles.alphaExplainRow}>
            <View style={[styles.alphaChip, { backgroundColor: COLORS.brand + '20', borderColor: COLORS.brand + '40' }]}>
              <Text style={[styles.alphaChipPct, { color: COLORS.brand }]}>{emaData.alpha * 100}%</Text>
              <Text style={[styles.alphaChipLabel, { color: muted }]}>This calibration</Text>
            </View>
            <Text style={[styles.plusSign, { color: muted }]}>+</Text>
            <View style={[styles.alphaChip, { backgroundColor: COLORS.normal + '20', borderColor: COLORS.normal + '40' }]}>
              <Text style={[styles.alphaChipPct, { color: COLORS.normal }]}>{(1 - emaData.alpha) * 100}%</Text>
              <Text style={[styles.alphaChipLabel, { color: muted }]}>History</Text>
            </View>
            <Text style={[styles.plusSign, { color: muted }]}>=</Text>
            <View style={[styles.alphaChip, { backgroundColor: COLORS.hrv + '20', borderColor: COLORS.hrv + '40' }]}>
              <Text style={[styles.alphaChipPct, { color: COLORS.hrv }]}>New</Text>
              <Text style={[styles.alphaChipLabel, { color: muted }]}>Baseline</Text>
            </View>
          </View>

          <Text style={[styles.formulaNote, { color: muted }]}>
            Adapts gradually with each recalibration (every ~7–30 days), not
            from everyday activity. Stable life = stable baseline.
          </Text>
        </View>

        {/* Baseline drift over time -- every past recalibration, not just
            the latest one (see "Baseline Changes" below for that) */}
        <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
          <Text style={[styles.cardTitle, { color: text }]}>Baseline Drift</Text>
          {driftHistory.length < 2 ? (
            <Text style={[styles.cardSub, { color: muted }]}>
              Not enough recalibrations yet to show a trend — this fills in
              as you recalibrate over time.
            </Text>
          ) : (
            DRIFT_FEATURES.map(({ key, label, unit, color }) => {
              const series = driftSeries(key);
              if (series.length < 2) return null;
              return (
                <View key={key} style={styles.driftBlock}>
                  <Text style={[styles.driftLabel, { color: muted }]}>
                    {label} ({unit})
                  </Text>
                  <LineChart
                    points={series}
                    color={color}
                    width={DRIFT_CHART_WIDTH}
                    height={90}
                  />
                </View>
              );
            })
          )}
        </View>

        {/* Feature changes from this recalibration */}
        <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
          <Text style={[styles.cardTitle, { color: text }]}>
            Baseline Changes
          </Text>
          {emaData.comparison?.map((item, i) => (
            <FeatureRow key={i} item={item} muted={muted} text={text} border={border} />
          ))}
        </View>

        {/* Interpretation */}
        <View style={[styles.interpretCard, { backgroundColor: cardHover, borderColor: COLORS.hrv + '40' }]}>
          <Text style={[styles.interpretTitle, { color: COLORS.hrv }]}>What This Means</Text>
          {emaData.interpretation?.map((msg, i) => (
            <View key={i} style={styles.interpretRow}>
              <Text style={[styles.interpretDot, { color: COLORS.hrv }]}>•</Text>
              <Text style={[styles.interpretText, { color: muted }]}>{msg}</Text>
            </View>
          ))}
          <Text style={[styles.interpretNote, { color: muted }]}>
            Future predictions will use these updated baseline values.
          </Text>
        </View>

        {/* Research significance */}
        <View style={[styles.researchCard, { backgroundColor: card, borderColor: COLORS.brand + '30' }]}>
          <Text style={[styles.researchTitle, { color: text }]}>Research Significance</Text>
          <Text style={[styles.researchText, { color: muted }]}>
            This addresses a gap across the reviewed literature — no existing system adapts its baseline after deployment. Static models degrade as user physiology changes. Blending each real recalibration into your baseline keeps accuracy stable across weeks and months, without letting noisy everyday activity drift it.
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.refreshBtn, { backgroundColor: card, borderColor: border }]}
          onPress={() => navigation.navigate('Calibration')}
        >
          <Text style={[styles.refreshBtnText, { color: COLORS.brand }]}>
            Recalibrate →
          </Text>
        </TouchableOpacity>

      </Animated.ScrollView>
    </ScreenBackground>
  );
}

function FeatureRow({ item, muted, text, border }) {
  const delta   = item.delta;
  const arrow   = delta > 0.001 ? '↑' : delta < -0.001 ? '↓' : '→';
  const color   = delta > 0.001 ? COLORS.stress : delta < -0.001 ? COLORS.normal : muted;
  const units   = { AVNN:'ms', MeanHR:'bpm', SCL_mean:'μS', SCR_count:'/min', SD1:'ms' };
  const unit    = units[item.feature] || '';
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  useEffect(() => {
    Animated.spring(scaleAnim, { toValue: 1, tension: 100, friction: 6, useNativeDriver: true }).start();
  }, []);

  return (
    <Animated.View style={[styles.featureRow, { borderBottomColor: border, transform: [{ scale: scaleAnim }] }]}>
      <View style={styles.featureLeft}>
        <Text style={[styles.featureName, { color: text }]}>{item.feature}</Text>
        <Text style={[styles.featureFormula, { color: muted }]}>
          {item.formula}
        </Text>
      </View>
      <View style={styles.featureRight}>
        <Text style={[styles.featureOld, { color: muted }]}>{item.old}{unit}</Text>
        <View style={[styles.featureArrowBox, { backgroundColor: color + '20' }]}>
          <Text style={[styles.featureArrow, { color }]}>{arrow}</Text>
        </View>
        <Text style={[styles.featureNew, { color }]}>{item.new}{unit}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  safe:              { flex: 1 },
  container:         { flex: 1 },
  emptyContainer:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyIconRing:     { width: 100, height: 100, borderRadius: 50, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  emptyEmoji:        { fontSize: 48 },
  emptyTitle:        { fontSize: 22, fontWeight: '900', marginBottom: 12, textAlign: 'center' },
  emptyText:         { fontSize: 14, textAlign: 'center', lineHeight: 24, marginBottom: 20 },
  emptyBadge:        { borderRadius: 12, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1 },
  emptyBadgeText:    { fontSize: 13, fontWeight: '700' },
  header:            { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 20, paddingBottom: 12 },
  title:             { fontSize: 22, fontWeight: '900' },
  subtitle:          { fontSize: 12, marginTop: 3, fontWeight: '600' },
  userBadge:         { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1 },
  userBadgeText:     { fontSize: 11, fontWeight: '700' },
  formulaCard:       { marginHorizontal: 20, marginBottom: 14, padding: 18, borderRadius: 20, borderWidth: 1 },
  formulaHeader:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  formulaTitle:      { fontSize: 14, fontWeight: '800' },
  alphaBadge:        { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  alphaText:         { fontSize: 12, fontWeight: '800' },
  formulaBox:        { borderRadius: 12, padding: 14, borderWidth: 1, marginBottom: 14, gap: 6 },
  formulaEq:         { fontSize: 13, fontFamily: 'monospace' },
  alphaExplainRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  alphaChip:         { flex: 1, alignItems: 'center', padding: 10, borderRadius: 12, borderWidth: 1 },
  alphaChipPct:      { fontSize: 16, fontWeight: '900' },
  alphaChipLabel:    { fontSize: 10, marginTop: 2 },
  plusSign:          { fontSize: 16, fontWeight: '700' },
  formulaNote:       { fontSize: 12, lineHeight: 18 },
  card:              { marginHorizontal: 20, marginBottom: 14, padding: 18, borderRadius: 20, borderWidth: 1 },
  cardTitle:         { fontSize: 15, fontWeight: '800', marginBottom: 12 },
  cardSub:           { fontSize: 12, lineHeight: 18 },
  driftBlock:        { marginBottom: 14 },
  driftLabel:        { fontSize: 11, fontWeight: '700', marginBottom: 6 },
  featureRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1 },
  featureLeft:       { flex: 1 },
  featureName:       { fontSize: 14, fontWeight: '800' },
  featureFormula:    { fontSize: 10, marginTop: 3, fontFamily: 'monospace' },
  featureRight:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  featureOld:        { fontSize: 13 },
  featureArrowBox:   { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  featureArrow:      { fontSize: 16, fontWeight: '900' },
  featureNew:        { fontSize: 14, fontWeight: '900' },
  interpretCard:     { marginHorizontal: 20, marginBottom: 14, padding: 18, borderRadius: 20, borderWidth: 1 },
  interpretTitle:    { fontSize: 14, fontWeight: '800', marginBottom: 12 },
  interpretRow:      { flexDirection: 'row', gap: 8, marginBottom: 8 },
  interpretDot:      { fontSize: 16 },
  interpretText:     { fontSize: 13, lineHeight: 20, flex: 1 },
  interpretNote:     { fontSize: 12, marginTop: 10, fontStyle: 'italic' },
  researchCard:      { marginHorizontal: 20, marginBottom: 14, padding: 18, borderRadius: 20, borderWidth: 1 },
  researchTitle:     { fontSize: 15, fontWeight: '800', marginBottom: 10 },
  researchText:      { fontSize: 13, lineHeight: 20 },
  refreshBtn:        { marginHorizontal: 20, marginBottom: 14, padding: 16, borderRadius: 14, alignItems: 'center', borderWidth: 1 },
  refreshBtnText:    { fontSize: 15, fontWeight: '700' },
});