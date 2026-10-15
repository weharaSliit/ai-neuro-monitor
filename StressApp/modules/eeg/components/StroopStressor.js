import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Vibration } from 'react-native';

// Stroop colour-word STRESSOR for the high-load calibration task (protocol
// phase 3). Same settings as web/src/components/StroopStressor.jsx -- keep
// them identical. High conflict (78% incongruent), MIST-style adaptive time
// pressure (3 correct in a row -> window x0.9, 2 misses in a row -> x1.1,
// 0.8-2.5 s), visible failure (countdown bar, red flash + buzz, running
// score). Answer by TAPPING, never speaking: jaw/temporal muscle activity
// would contaminate the T7-T8 EEG and pass for "load".
export const STROOP_SETTINGS = {
  incongruentShare: 0.78,
  startWindowMs: 2000,
  minWindowMs: 800,
  maxWindowMs: 2500,
  speedUpAfterCorrect: 3,
  slowDownAfterMisses: 2,
  step: 0.1,
  fixationMinMs: 300,
  fixationMaxMs: 500,
  errorFlashMs: 450,
  engagedAccuracy: [0.5, 0.85],
};

const COLOR_SETS = {
  standard: [
    { name: 'Red', hex: '#D32F2F' }, { name: 'Green', hex: '#2E7D32' },
    { name: 'Blue', hex: '#1565C0' }, { name: 'Yellow', hex: '#F9A825' },
  ],
  colourSafe: [
    { name: 'Red', hex: '#D32F2F' }, { name: 'Purple', hex: '#7B1FA2' },
    { name: 'Blue', hex: '#1565C0' }, { name: 'Yellow', hex: '#F9A825' },
  ],
};

const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function makeTrial(colors) {
  const ink = pick(colors);
  const congruent = Math.random() >= STROOP_SETTINGS.incongruentShare;
  const word = congruent ? ink : pick(colors.filter((c) => c.name !== ink.name));
  return { word: word.name, ink: ink.name, inkHex: ink.hex, congruent };
}

export function summarizeStroop(trials) {
  const n = trials.length;
  const correct = trials.filter((t) => t.outcome === 'correct').length;
  const rts = trials.filter((t) => t.outcome === 'correct').map((t) => t.rt_ms);
  const incon = trials.filter((t) => !t.congruent);
  const accuracy = n ? correct / n : null;
  const [lo, hi] = STROOP_SETTINGS.engagedAccuracy;
  return {
    n_trials: n,
    accuracy,
    accuracy_incongruent: incon.length ? incon.filter((t) => t.outcome === 'correct').length / incon.length : null,
    timeouts: trials.filter((t) => t.outcome === 'timeout').length,
    mean_rt_ms: rts.length ? Math.round(rts.reduce((a, b) => a + b, 0) / rts.length) : null,
    final_window_ms: n ? trials[n - 1].window_ms : STROOP_SETTINGS.startWindowMs,
    engagement: accuracy == null ? 'no trials' : accuracy > hi ? 'too easy' : accuracy < lo ? 'possibly gave up' : 'engaged',
  };
}

export default function StroopStressor({ durationSec, colourSafe = false, roundLabel, onDone, theme, COLORS }) {
  const colors = colourSafe ? COLOR_SETS.colourSafe : COLOR_SETS.standard;
  const buttons = useRef(colors).current;   // fixed positions for the whole block

  const [endAt] = useState(() => Date.now() + durationSec * 1000);
  const [now, setNow] = useState(Date.now());
  const [stage, setStage] = useState('fixation');   // fixation | trial | error
  const [trial, setTrial] = useState(null);
  const [errorText, setErrorText] = useState('');
  const windowMs = useRef(STROOP_SETTINGS.startWindowMs);
  const shownAt = useRef(0);
  const streak = useRef({ correct: 0, miss: 0 });
  const trials = useRef([]);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const finished = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 50);
    return () => clearInterval(id);
  }, []);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onDone?.({ settings: { ...STROOP_SETTINGS, colours: colors.map((c) => c.name) }, trials: trials.current,
      summary: summarizeStroop(trials.current) });
  }, [onDone, colors]);

  useEffect(() => {
    if (stage !== 'fixation') return undefined;
    if (Date.now() >= endAt) { finish(); return undefined; }
    const id = setTimeout(() => {
      setTrial(makeTrial(colors)); shownAt.current = Date.now(); setStage('trial');
    }, rand(STROOP_SETTINGS.fixationMinMs, STROOP_SETTINGS.fixationMaxMs));
    return () => clearTimeout(id);
  }, [stage, endAt, colors, finish]);

  const record = useCallback((response) => {
    if (!trial) return;
    const rt = Date.now() - shownAt.current;
    const outcome = response == null ? 'timeout' : response === trial.ink ? 'correct' : 'wrong';
    trials.current.push({
      t: shownAt.current, word: trial.word, ink: trial.ink, congruent: trial.congruent,
      response, rt_ms: response == null ? null : rt, outcome, window_ms: Math.round(windowMs.current),
    });
    setScore((s) => ({ correct: s.correct + (outcome === 'correct' ? 1 : 0), total: s.total + 1 }));
    const S = STROOP_SETTINGS;
    if (outcome === 'correct') {
      streak.current = { correct: streak.current.correct + 1, miss: 0 };
      if (streak.current.correct >= S.speedUpAfterCorrect) {
        windowMs.current = Math.max(S.minWindowMs, windowMs.current * (1 - S.step)); streak.current.correct = 0;
      }
      setStage('fixation');
    } else {
      streak.current = { correct: 0, miss: streak.current.miss + 1 };
      if (streak.current.miss >= S.slowDownAfterMisses) {
        windowMs.current = Math.min(S.maxWindowMs, windowMs.current * (1 + S.step)); streak.current.miss = 0;
      }
      Vibration.vibrate(150);
      setErrorText(outcome === 'timeout' ? 'Too slow!' : 'Wrong!');
      setStage('error');
    }
  }, [trial]);

  useEffect(() => {
    if (stage !== 'trial') return undefined;
    const id = setTimeout(() => record(null), windowMs.current);
    return () => clearTimeout(id);
  }, [stage, record]);

  useEffect(() => {
    if (stage !== 'error') return undefined;
    const id = setTimeout(() => setStage('fixation'), STROOP_SETTINGS.errorFlashMs);
    return () => clearTimeout(id);
  }, [stage]);

  const secsLeft = Math.max(0, Math.ceil((endAt - now) / 1000));
  const frac = stage === 'trial' ? Math.max(0, 1 - (now - shownAt.current) / windowMs.current) : 0;
  const acc = score.total ? Math.round((score.correct / score.total) * 100) : null;
  const flash = stage === 'error';
  const brand = COLORS?.brand || '#4F4994';
  const stress = COLORS?.stress || '#D32F2F';

  return (
    <View style={[styles.card, { borderColor: flash ? stress : 'transparent', backgroundColor: theme?.card || '#FFFFFF' }]}>
      <View style={styles.headerRow}>
        <Text style={[styles.secs, { color: secsLeft <= 15 ? stress : brand }]}>{secsLeft}s</Text>
        <Text style={[styles.meta, { color: theme?.textMuted || '#666' }]}>
          {roundLabel} · score {score.correct}/{score.total}{acc != null ? ` (${acc}%)` : ''}
        </Text>
      </View>
      <Text style={[styles.rule, { color: brand }]}>Tap the INK COLOUR. Ignore what the word says.</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${frac * 100}%`, backgroundColor: frac < 0.3 ? stress : brand }]} />
      </View>
      <View style={[styles.stage, { backgroundColor: flash ? '#F8C9C9' : '#BDBDBD' }]}>
        {stage === 'trial' && trial ? (
          <Text style={[styles.word, { color: trial.inkHex }]}>{trial.word.toUpperCase()}</Text>
        ) : stage === 'error' ? (
          <Text style={styles.error}>✗ {errorText}</Text>
        ) : (
          <Text style={styles.fixation}>+</Text>
        )}
      </View>
      <View style={styles.grid}>
        {buttons.map((c) => (
          <TouchableOpacity key={c.name} disabled={stage !== 'trial'} onPress={() => record(c.name)} activeOpacity={0.7}
            style={[styles.btn, { opacity: stage === 'trial' ? 1 : 0.6 }]}>
            <Text style={styles.btnText}>{c.name}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={[styles.hint, { color: theme?.textMuted || '#666' }]}>
        Rest the phone on a table and tap — don’t say the colours out loud.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: 16, borderWidth: 2, marginBottom: 16 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  secs: { fontSize: 28, fontWeight: '900' },
  meta: { fontSize: 12, flexShrink: 1, textAlign: 'right' },
  rule: { fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: '#D7D7D7', overflow: 'hidden' },
  barFill: { height: '100%' },
  stage: { height: 150, marginVertical: 12, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  word: { fontSize: 50, fontWeight: '900', letterSpacing: 2 },
  error: { fontSize: 28, fontWeight: '900', color: '#B71C1C' },
  fixation: { fontSize: 44, color: '#424242' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  btn: { width: '48%', paddingVertical: 18, marginBottom: 10, borderRadius: 12, borderWidth: 2, borderColor: '#9E9E9E',
    backgroundColor: '#FFFFFF', alignItems: 'center' },
  btnText: { color: '#111111', fontWeight: '800', fontSize: 17 },
  hint: { fontSize: 12, textAlign: 'center', marginTop: 4 },
});
