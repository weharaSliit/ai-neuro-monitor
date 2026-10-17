import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import ScreenBackground from '../../shared/ScreenBackground';
import Card from '../../shared/Card';
import Icon, { NAMES } from '../../shared/Icon';
import Badge from '../../shared/Badge';
import { COLORS } from '../../physiological/config/theme';
import { TYPE, SPACE, RADIUS } from '../../shared/theme/tokens';
import { useAuth } from '../../../context/AuthContext';
import { fusionKeyToMs } from '../../shared/levels';
import {
  K_ALERT, SIGMA_LOGIT, TASK_SKIP_EEG, eegAligned, lgt, mean, median, num, persistent, plausible, ringAligned, sdOf, sig,
} from '../../shared/limits';
import useMyLimits from '../useMyLimits';
import { alignedOf } from '../config/aligned';

// ============================================================
// MyLimitsScreen -- the user-friendly version of psy_web's
// "Calibration, scores & alerts" dashboard and Fusion engine monitor.
//
// Everything is on one 0-100 scale where each person's OWN limit is 50:
// mind (EEG) and body (ring) are each placed against their own limit, and
// overall is the fusion engine's combination of the two. Numbers come
// from modules/shared/limits.js -- the same rules as the dashboard:
// calm level = median of the rest blocks, limit = midpoint of the calm
// level and the sustained task, "high" = 2 of the last 3 readings over it.
// ============================================================

const PARTS = [
  { key: 'mind', name: 'Mind', what: 'brain activity from the headband', color: COLORS.eeg, icon: NAMES.eeg,
    words: ['Relaxed', 'Focused', 'Overloaded'] },
  { key: 'body', name: 'Body', what: 'heart rhythm and skin response from the ring', color: COLORS.hrv, icon: 'heart-pulse',
    words: ['Calm', 'Active', 'Tense'] },
  { key: 'fused', name: 'Overall', what: 'mind and body together', color: COLORS.brand, icon: 'scale-balance',
    words: ['Calm', 'Building up', 'Stressed'] },
];
const levelIdx = (v) => (v == null ? null : v >= 0.5 ? 2 : v >= 0.38 ? 1 : 0);
const LEVEL_COLORS = [COLORS.normal, COLORS.warning, COLORS.stress];
const pts = (v) => (v == null ? '—' : String(Math.round(v * 100)));
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// ── Current reading of each part from the live fusion windows ────────
function currentState(windows, eegInfo, ringInfo) {
  const mindOf = (w) => alignedOf(w, 'eeg') ?? eegAligned(num(w.prob_eeg), eegInfo);
  const mind = windows.filter((w) => w.prob_eeg != null).map(mindOf);
  const body = windows.filter((w) => w.prob_hrv_gsr != null).map((w) => ringAligned(num(w.prob_hrv_gsr), ringInfo.limit));
  const fusedW = windows.filter((w) => w.fused_probability != null);
  const fused = fusedW.map((w) => num(w.fused_probability));
  const last = (a) => (a.length ? a[a.length - 1] : null);
  const high = (a) => persistent(a.map((v) => (v == null ? null : v >= 0.5)));
  const lastF = last(fusedW);
  return {
    mind: { value: last(mind), high: high(mind) },
    body: { value: last(body), high: high(body) },
    fused: { value: last(fused), high: lastF?.fused_high_persistent ?? high(fused) },
    at: lastF ? fusionKeyToMs(lastF.key) : null,
    message: lastF?.stress_alert_message || null,
  };
}

// Times a part crossed into "high" (2 of the last 3 over the limit), newest first.
function recentAlerts(windows, eegInfo, ringInfo) {
  const out = [];
  const scan = (part, vals) => {
    let was = false;
    vals.forEach(({ t, v }, i) => {
      const h = persistent(vals.slice(Math.max(0, i - 2), i + 1).map((x) => (x.v == null ? null : x.v >= 0.5)));
      if (h && !was) out.push({ part, t });
      was = Boolean(h);
    });
  };
  const at = (w) => fusionKeyToMs(w.key);
  scan('Mind', windows.filter((w) => w.prob_eeg != null).map((w) => ({ t: at(w), v: alignedOf(w, 'eeg') ?? eegAligned(num(w.prob_eeg), eegInfo) })));
  scan('Body', windows.filter((w) => w.prob_hrv_gsr != null).map((w) => ({ t: at(w), v: ringAligned(num(w.prob_hrv_gsr), ringInfo.limit) })));
  scan('Overall', windows.filter((w) => w.fused_probability != null).map((w) => ({ t: at(w), v: num(w.fused_probability) })));
  return out.sort((a, b) => b.t - a.t).slice(0, 5);
}

// ── Chart: rest -> task -> recovery, calm level and limit ─────────────
const CH = 170;
const PAD = { l: 30, r: 8, t: 22, b: 10 };

function PhaseChart({ rest = [], task = [], recovery = [], calm, color }) {
  const [w, setW] = useState(0);
  const vals = [...rest, ...task, ...recovery];
  const n = vals.length;
  let body = null;
  if (w > 0 && n >= 2) {
    const iw = w - PAD.l - PAD.r; const ih = CH - PAD.t - PAD.b;
    const x = (i) => PAD.l + (i / (n - 1)) * iw;
    const y = (v) => PAD.t + (1 - v) * ih;
    const seg = (from, len, label, shade) => {
      if (!len) return null;
      const x0 = from === 0 ? PAD.l : (x(from - 1) + x(from)) / 2;
      const x1 = from + len >= n ? w - PAD.r : (x(from + len - 1) + x(from + len)) / 2;
      return (
        <React.Fragment key={label}>
          {shade && <Rect x={x0} y={PAD.t} width={x1 - x0} height={ih} fill={color} opacity={0.08} />}
          <SvgText x={(x0 + x1) / 2} y={PAD.t - 8} textAnchor="middle" fontSize="10" fontWeight="700" fill={COLORS.light.textMuted}>{label}</SvgText>
        </React.Fragment>
      );
    };
    const d = vals.map((v, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
    body = (
      <Svg width={w} height={CH}>
        {seg(0, rest.length, 'Rest', false)}
        {seg(rest.length, task.length, 'Task', true)}
        {seg(rest.length + task.length, recovery.length, 'Recovery', false)}
        {[0, 50, 100].map((g) => (
          <SvgText key={g} x={PAD.l - 6} y={y(g / 100) + 3} textAnchor="end" fontSize="9" fill={COLORS.light.textMuted}>{g}</SvgText>
        ))}
        <Line x1={PAD.l} x2={w - PAD.r} y1={y(0.5)} y2={y(0.5)} stroke={COLORS.stress} strokeWidth={1.5} />
        <SvgText x={w - PAD.r} y={y(0.5) - 4} textAnchor="end" fontSize="10" fontWeight="800" fill={COLORS.stress}>Your limit</SvgText>
        {calm != null && (<>
          <Line x1={PAD.l} x2={w - PAD.r} y1={y(calm)} y2={y(calm)} stroke={COLORS.normal} strokeWidth={1.5} strokeDasharray="5 4" />
          <SvgText x={w - PAD.r} y={y(calm) + 12} textAnchor="end" fontSize="10" fontWeight="800" fill={COLORS.normalDark || COLORS.normal}>Calm level</SvgText>
        </>)}
        <Path d={d} stroke={color} strokeWidth={2.2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        {vals.map((v, i) => <Circle key={i} cx={x(i)} cy={y(v)} r={2.6} fill={color} />)}
      </Svg>
    );
  }
  return (
    <View onLayout={(e) => setW(Math.floor(e.nativeEvent.layout.width))} style={{ width: '100%', minHeight: CH }}>
      {n < 2 ? <Text style={styles.empty}>Not calibrated yet.</Text> : body}
    </View>
  );
}

// One plain sentence about the calibration.
function story(ph, key) {
  const L = ph.levels;
  if (!ph.task.length || L.task == null) return 'Only your calm level is set. Do the stress limit test to personalise your limit.';
  const rose = L.task > L.rest && L.task >= 0.5;
  const back = L.recovery == null ? null : L.recovery < 0.5;
  if (!rose && key === 'fused') return 'During the task your overall reading stayed below your limit, because mind and body did not both rise.';
  if (!rose) return 'During the task this reading did not rise above your limit, so a standard limit is used. Try the test again with the sensor well fitted.';
  if (back === false) return 'It rose above your limit during the task and was still high afterwards. Take a longer rest before relying on it.';
  return `It rose above your limit during the task${back ? ' and settled back to calm afterwards' : ''}. Your limit is set between the two.`;
}

function CalibrationCard({ part, ph }) {
  return (
    <Card style={styles.block}>
      <View style={styles.cardHead}>
        <View style={[styles.partIcon, { backgroundColor: part.color + '1F' }]}><Icon name={part.icon} size={18} color={part.color} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.blockTitle}>{part.name}</Text>
          <Text style={styles.blockSub}>{part.what}</Text>
        </View>
      </View>
      {!ph ? <Text style={styles.empty}>Not calibrated yet.</Text> : (<>
        <PhaseChart rest={ph.rest} task={ph.task} recovery={ph.recovery} calm={ph.levels.rest} color={part.color} />
        <View style={styles.chips}>
          <View style={styles.chip}><Text style={styles.chipLabel}>Calm level</Text><Text style={[styles.chipValue, { color: COLORS.normal }]}>{pts(ph.levels.rest)}</Text></View>
          <View style={styles.chip}><Text style={styles.chipLabel}>During task</Text><Text style={styles.chipValue}>{pts(ph.levels.task)}</Text></View>
          <View style={styles.chip}><Text style={styles.chipLabel}>Your limit</Text><Text style={[styles.chipValue, { color: COLORS.stress }]}>50</Text></View>
        </View>
        <Text style={styles.story}>{story(ph, part.key)}</Text>
      </>)}
    </Card>
  );
}

// ── Live: a calibration running right now (EEG headband) ─────────────
function liveSettled(rest, task) {
  if (!rest.length) return null;
  const base = median(rest);
  const sd = rest.length < 5 ? SIGMA_LOGIT : Math.max(SIGMA_LOGIT, sdOf(rest));
  const k = Math.min(TASK_SKIP_EEG, Math.floor(task.length / 2));
  const sus = task.length > TASK_SKIP_EEG ? task.slice(k) : [];
  const taskL = sus.length ? mean(sus) : null;
  const thr = taskL != null && taskL - base >= sd ? (base + taskL) / 2 : base + K_ALERT * sd;
  return { base, sd, thr };
}

function LiveCalibration({ recal }) {
  const active = recal && (recal.status === 'capturing' || recal.status === 'saving');
  if (!active) return null;
  const live = (recal.live ? (Array.isArray(recal.live) ? recal.live : Object.values(recal.live)) : []).filter(Boolean);
  const L = (b) => (plausible(num(b.score)) ? lgt(num(b.score)) : null);
  const rest = live.filter((b) => b.phase === 'rest').map(L).filter((v) => v != null);
  const task = live.filter((b) => b.phase === 'task').map(L).filter((v) => v != null);
  const s = liveSettled(rest, task);
  const show = (arr) => arr.map(L).filter((v) => v != null).map((v) => sig(Math.max(-3, Math.min(3, (v - s.thr) / s.sd))));
  const phase = { settle: 'Getting ready', rest: 'Resting', task: 'Focus task', recovery: 'Relaxing again' }[recal.phase] || 'Calibrating';
  return (
    <Card style={styles.block} accentColor={COLORS.brand}>
      <View style={styles.blockHead}>
        <Text style={styles.blockTitle}>Calibrating now</Text>
        <Badge label={`${phase}${recal.blocks_needed ? ` · ${recal.blocks_captured ?? 0}/${recal.blocks_needed}` : ''}`} color={COLORS.brand} size="sm" />
      </View>
      <Text style={styles.blockSub}>Each dot is 25 seconds of headband data. Watch your calm level settle.</Text>
      {s ? (
        <PhaseChart rest={show(live.filter((b) => b.phase === 'rest'))} task={show(live.filter((b) => b.phase === 'task'))}
          recovery={show(live.filter((b) => b.phase === 'recovery'))} calm={sig(Math.max(-3, Math.min(3, (s.base - s.thr) / s.sd)))} color={COLORS.eeg} />
      ) : <Text style={styles.empty}>{recal.phase === 'settle' ? 'Sit comfortably — recording starts in a moment.' : 'Waiting for the first block…'}</Text>}
    </Card>
  );
}

export default function MyLimitsScreen({ navigation }) {
  const { user } = useAuth();
  const data = useMyLimits(user?.userId);
  const now = currentState(data.windows, data.eegInfo, data.ringInfo);
  const alerts = recentAlerts(data.windows, data.eegInfo, data.ringInfo);
  const phaseOf = { mind: data.phases.mind, body: data.phases.body, fused: data.phases.fused };

  return (
    <ScreenBackground>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>
          Your readings are compared with your own calm level and limit. 50 is your limit: below it is normal for you, above it means load or stress.
        </Text>

        {/* ── Right now ── */}
        <Text style={styles.sectionLabel}>Right now</Text>
        <View style={styles.nowRow}>
          {PARTS.map((p) => {
            const s = now[p.key]; const lv = levelIdx(s.value);
            const c = lv == null ? COLORS.light.textMuted : LEVEL_COLORS[lv];
            return (
              <View key={p.key} style={[styles.nowTile, s.high && { borderColor: COLORS.stress }]}>
                <Text style={styles.nowName}>{p.name}</Text>
                <Text style={[styles.nowValue, { color: c }]}>{pts(s.value)}</Text>
                <View style={styles.meter}>
                  <View style={[styles.meterFill, { width: `${Math.round((s.value ?? 0) * 100)}%`, backgroundColor: c }]} />
                  <View style={styles.meterLimit} />
                </View>
                <Text style={[styles.nowWord, { color: c }]}>{lv == null ? 'No reading' : p.words[lv]}</Text>
              </View>
            );
          })}
        </View>
        {(now.fused.high || now.mind.high || now.body.high || now.message) && (
          <TouchableOpacity activeOpacity={0.85} onPress={() => navigation.navigate('RelaxationGuide')}
            style={[styles.alert, { backgroundColor: COLORS.stressSoft, borderColor: COLORS.stress + '40' }]}>
            <Icon name={NAMES.trendUp} size={18} color={COLORS.stressDark} />
            <Text style={[styles.alertText, { color: COLORS.stressDark }]}>
              {now.message || `${[now.mind.high && 'Mind', now.body.high && 'Body', now.fused.high && 'Overall'].filter(Boolean).join(' and ')} above your limit for a while. Try a short breathing break.`}
            </Text>
            <Icon name={NAMES.chevronRight} size={18} color={COLORS.stressDark} />
          </TouchableOpacity>
        )}
        {now.at && <Text style={styles.updated}>Updated {clock(now.at)}</Text>}

        <LiveCalibration recal={data.recal} />

        {/* ── Calibration ── */}
        <Text style={styles.sectionLabel}>How your limits were set</Text>
        {data.loading ? <ActivityIndicator color={COLORS.brand} style={{ marginVertical: SPACE.xl }} />
          : PARTS.map((p) => <CalibrationCard key={p.key} part={p} ph={phaseOf[p.key]} />)}

        {/* ── Alerts ── */}
        <Text style={styles.sectionLabel}>Recent alerts</Text>
        <Card style={styles.block}>
          {!alerts.length ? <Text style={styles.empty}>No alerts this session.</Text> : alerts.map((a) => (
            <View key={`${a.part}-${a.t}`} style={styles.alertRow}>
              <View style={[styles.dot, { backgroundColor: PARTS.find((p) => p.name === a.part)?.color }]} />
              <Text style={styles.alertRowText}>{a.part} went above your limit</Text>
              <Text style={styles.alertRowTime}>{clock(a.t)}</Text>
            </View>
          ))}
        </Card>

        {/* ── Recalibrate ── */}
        <Text style={styles.sectionLabel}>Recalibrate</Text>
        <View style={styles.actions}>
          <TouchableOpacity style={[styles.btn, { backgroundColor: COLORS.brand }]} activeOpacity={0.85} onPress={() => navigation.navigate('Calibration')}>
            <Icon name={NAMES.breathe} size={18} color="#fff" />
            <Text style={styles.btnText}>Reset calm level</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnOutline]} activeOpacity={0.85} onPress={() => navigation.navigate('ThresholdCalibration')}>
            <Icon name={NAMES.calibration} size={18} color={COLORS.brand} />
            <Text style={[styles.btnText, { color: COLORS.brand }]}>Redo limit test</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>Recalibrate after re-fitting the headband or ring, or if the readings feel wrong.</Text>
        <View style={{ height: SPACE.xxl }} />
      </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingTop: SPACE.md, paddingBottom: SPACE.xxxl },
  intro: { ...TYPE.body, color: COLORS.light.textSub, marginHorizontal: SPACE.xl, marginBottom: SPACE.sm, lineHeight: 19 },
  sectionLabel: { ...TYPE.micro, color: COLORS.light.textMuted, marginHorizontal: SPACE.xl, marginTop: SPACE.lg, marginBottom: SPACE.sm },
  block: { marginHorizontal: SPACE.xl, marginBottom: SPACE.md, borderRadius: RADIUS.xl },
  blockHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: SPACE.sm },
  blockTitle: { ...TYPE.title, color: COLORS.light.text },
  blockSub: { fontSize: 12, color: COLORS.light.textMuted, marginTop: 2, marginBottom: SPACE.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, marginBottom: SPACE.xs },
  partIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },

  nowRow: { flexDirection: 'row', gap: SPACE.sm, marginHorizontal: SPACE.xl },
  nowTile: { flex: 1, padding: SPACE.md, borderRadius: RADIUS.lg, backgroundColor: COLORS.light.card, borderWidth: 1.5, borderColor: COLORS.light.border },
  nowName: { fontSize: 12, fontWeight: '700', color: COLORS.light.textSub },
  nowValue: { fontSize: 28, fontWeight: '900', marginTop: 2, letterSpacing: -0.5 },
  meter: { height: 6, borderRadius: 3, backgroundColor: COLORS.light.borderSoft, marginTop: 6, overflow: 'hidden' },
  meterFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 3 },
  meterLimit: { position: 'absolute', left: '50%', top: 0, bottom: 0, width: 2, backgroundColor: COLORS.light.text },
  nowWord: { fontSize: 12, fontWeight: '800', marginTop: 6 },
  updated: { fontSize: 11, color: COLORS.light.textMuted, marginHorizontal: SPACE.xl, marginTop: SPACE.sm },

  alert: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, marginHorizontal: SPACE.xl, marginTop: SPACE.md, padding: 14, borderRadius: RADIUS.md, borderWidth: 1 },
  alertText: { flex: 1, fontSize: 13, fontWeight: '700', lineHeight: 18 },

  chips: { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.sm },
  chip: { flex: 1, paddingVertical: SPACE.sm, borderRadius: RADIUS.sm, backgroundColor: COLORS.light.borderSoft, alignItems: 'center' },
  chipLabel: { fontSize: 11, fontWeight: '600', color: COLORS.light.textMuted },
  chipValue: { fontSize: 18, fontWeight: '900', color: COLORS.light.text, marginTop: 1 },
  story: { ...TYPE.body, color: COLORS.light.textSub, marginTop: SPACE.sm, lineHeight: 19 },
  empty: { fontSize: 13, fontStyle: 'italic', textAlign: 'center', paddingVertical: SPACE.lg, color: COLORS.light.textMuted },

  alertRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingVertical: 7 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  alertRowText: { flex: 1, fontSize: 13, fontWeight: '600', color: COLORS.light.text },
  alertRowTime: { fontSize: 12, color: COLORS.light.textMuted },

  actions: { flexDirection: 'row', gap: SPACE.sm, marginHorizontal: SPACE.xl },
  btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: RADIUS.md },
  btnOutline: { backgroundColor: COLORS.light.card, borderWidth: 1.5, borderColor: COLORS.brand },
  btnText: { fontSize: 14, fontWeight: '800', color: '#fff' },
  hint: { fontSize: 12, color: COLORS.light.textMuted, marginHorizontal: SPACE.xl, marginTop: SPACE.sm },
});
