import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Card from '../../shared/Card';
import { COLORS } from '../../physiological/config/theme';
import { SPACE, RADIUS } from '../../shared/theme/tokens';

// Shown on the Fusion hub instead of the dashboard while a calibration is running
// (the website's CalibrationOnboarding): the four phases, which one the person is in,
// what to do now and the progress. The dashboard comes back by itself when it finishes.
// eeg / ring: eeg_recalibration/{sid}, ring_recalibration/{uid}.
const BLOCK_SEC = 25;
const PHASES = [
  { key: 'settle', icon: '🪑', name: 'Settle', what: 'Sit comfortably and keep still while the sensors settle.', len: '2 min' },
  { key: 'rest', icon: '😌', name: 'Rest', what: 'Relax with your eyes open. This sets your personal calm level.', len: '4 min' },
  { key: 'task', icon: '🧩', name: 'Task', what: 'Focus on the task. This shows how your mind and body react to load.', len: '8 min' },
  { key: 'recovery', icon: '🌿', name: 'Recovery', what: 'Relax again. This confirms you come back to calm.', len: '3 min' },
];
const mmss = (sec) => { const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function phaseOf(rec) {
  if (!rec) return null;
  if (rec.status === 'requested') return 'settle';
  return PHASES.some((p) => p.key === rec.phase) ? rec.phase : rec.status === 'saving' ? 'recovery' : null;
}

export default function CalibrationOnboarding({ eeg, ring, now, onShowDashboard, onOpenTask, style }) {
  const phase = phaseOf(eeg) || phaseOf(ring) || 'settle';
  const at = PHASES.findIndex((p) => p.key === phase);
  const cur = PHASES[at];
  const simulated = (eeg?.source || ring?.source) === 'stimulator';
  const saving = eeg?.status === 'saving';
  const need = eeg?.blocks_needed ?? null;
  const got = eeg?.blocks_captured ?? 0;
  const settleLeft = eeg?.settle_until ? eeg.settle_until - now / 1000 : null;
  const left = phase === 'settle' ? settleLeft : need != null ? (need - got) * BLOCK_SEC : null;
  const frac = phase === 'settle' ? (settleLeft == null ? 0 : 1 - Math.max(0, settleLeft) / (eeg?.settle_sec || 120))
    : need ? Math.min(1, got / need) : 0;
  const totalLeft = [
    phase === 'settle' ? Math.max(0, settleLeft ?? 120) : 0,
    at <= 1 ? (phase === 'rest' ? Math.max(0, (need ?? 10) - got) : 10) * BLOCK_SEC : 0,
    at <= 2 ? (phase === 'task' ? Math.max(0, (need ?? 19) - got) : (eeg?.task_blocks_needed ?? 19)) * BLOCK_SEC : 0,
    (phase === 'recovery' ? Math.max(0, (need ?? 7) - got) : (eeg?.recovery_blocks_needed ?? 7)) * BLOCK_SEC,
  ].reduce((a, b) => a + b, 0);

  return (
    <View style={style}>
      <Card style={styles.hero}>
        <Text style={styles.icon}>{cur.icon}</Text>
        <Text style={styles.word}>Calibrating · {cur.name}</Text>
        <Text style={styles.line}>{saving ? 'Saving your personal calm level and limits…' : cur.what}</Text>
        <View style={styles.footRow}>
          <Text style={styles.tip}>{left != null && left > 0 ? `${mmss(left)} left in this step` : 'Almost there'}</Text>
          <Text style={styles.when}>about {Math.max(1, Math.round(totalLeft / 60))} min to go{simulated ? ' · simulated' : ''}</Text>
        </View>
      </Card>

      <Card style={styles.block}>
        {PHASES.map((p, i) => (
          <View key={p.key} style={styles.step}>
            <View style={[styles.dot, i < at && styles.dotDone, i === at && styles.dotNow]}>
              <Text style={styles.dotText}>{i < at ? '✓' : p.icon}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.stepHead}>
                <Text style={[styles.stepName, i === at && { color: COLORS.brandDark }]}>{p.name}</Text>
                <Text style={styles.stepMeta}>{i < at ? 'done' : i === at ? 'now' : p.len}</Text>
              </View>
              {i === at && <View style={styles.bar}><View style={[styles.barFill, { width: `${Math.round(Math.max(0.03, frac) * 100)}%` }]} /></View>}
            </View>
          </View>
        ))}
      </Card>

      {phase === 'task' && !saving && onOpenTask && (
        <TouchableOpacity style={styles.taskBtn} onPress={onOpenTask} activeOpacity={0.85}>
          <Text style={styles.taskBtnText}>Open the calibration task</Text>
        </TouchableOpacity>
      )}

      <View style={styles.pair}>
        <Card style={styles.half}>
          <Text style={styles.cardTitle}>Mind · headband</Text>
          <Text style={styles.body}>{phase === 'settle' ? 'Waiting for the signal to settle.' : need ? `${got} of ${need} readings in this step` : 'Collecting readings…'}</Text>
        </Card>
        <Card style={styles.half}>
          <Text style={styles.cardTitle}>Body · ring</Text>
          <Text style={styles.body}>{!ring || ring.status === 'done' ? 'Ring calibration done.'
            : ring.blocks_needed ? `${ring.blocks_captured ?? 0} of ${ring.blocks_needed} windows in this step` : 'Collecting readings…'}</Text>
        </Card>
      </View>

      <TouchableOpacity onPress={onShowDashboard} style={styles.anyway}>
        <Text style={styles.anywayText}>Show my dashboard anyway →</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { marginHorizontal: SPACE.xl, marginBottom: SPACE.md, padding: SPACE.lg, alignItems: 'flex-start' },
  icon: { fontSize: 34 },
  word: { fontSize: 24, fontWeight: '800', color: '#231F20', marginTop: 6 },
  line: { fontSize: 14.5, color: '#544E50', marginTop: 4, lineHeight: 20 },
  footRow: { marginTop: SPACE.md },
  tip: { fontSize: 14, fontWeight: '800', color: COLORS.brandDark },
  when: { fontSize: 12.5, fontWeight: '600', color: '#989294', marginTop: 2 },
  block: { marginHorizontal: SPACE.xl, marginBottom: SPACE.md },
  step: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingVertical: 6 },
  dot: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#F0ECE4', alignItems: 'center', justifyContent: 'center' },
  dotDone: { backgroundColor: COLORS.normalSoft },
  dotNow: { backgroundColor: COLORS.brandSoft },
  dotText: { fontSize: 15 },
  stepHead: { flexDirection: 'row', justifyContent: 'space-between' },
  stepName: { fontSize: 15, fontWeight: '800', color: '#231F20' },
  stepMeta: { fontSize: 12.5, fontWeight: '700', color: '#989294' },
  bar: { height: 6, borderRadius: 3, backgroundColor: '#F0ECE4', marginTop: 6, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: COLORS.brand },
  taskBtn: { marginHorizontal: SPACE.xl, marginBottom: SPACE.md, backgroundColor: COLORS.brand, borderRadius: RADIUS.md, paddingVertical: 14, alignItems: 'center' },
  taskBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  pair: { flexDirection: 'row', gap: SPACE.md, marginHorizontal: SPACE.xl },
  half: { flex: 1, padding: SPACE.md },
  cardTitle: { fontSize: 14, fontWeight: '800', color: '#231F20' },
  body: { fontSize: 13, color: '#544E50', marginTop: 4, lineHeight: 18 },
  anyway: { alignItems: 'center', paddingVertical: SPACE.lg },
  anywayText: { fontSize: 13.5, fontWeight: '700', color: COLORS.brandDark },
});
