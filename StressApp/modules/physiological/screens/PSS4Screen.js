import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Alert, Animated
} from 'react-native';
import ScreenBackground from '../../shared/ScreenBackground';
import { ref, query, orderByKey, limitToLast, get as dbGet } from 'firebase/database';
import { useTheme } from '../config/ThemeContext';
import { COLORS } from '../config/theme';
import api from '../api/client';
import { useAppState } from './AppState';
import { useAuth } from '../../../context/AuthContext';
import { db } from '../../../firebase';

// This is the one shared self-report check-in for both modalities (EEG has
// no survey of its own, see the "Unified Calibration + EMA" plan section 2)
// -- reads whichever of Ring/EEG has a recent reading and tags the
// submission with it, working fine with only one, both, or neither present.
async function fetchRingProbStress(userId) {
  if (!userId) return null;
  try {
    const h = await api.get(`/history/${userId}`);
    const sessionIds = Object.keys(h.data?.sessions || {});
    const latestId = sessionIds[sessionIds.length - 1];
    if (!latestId) return null;
    const s = await api.get(`/history/${userId}/${latestId}`);
    const predictions = Object.values(s.data?.predictions || {})
      .sort((a, b) => (b.window_idx ?? 0) - (a.window_idx ?? 0));
    return predictions[0]?.prob_stress ?? null;
  } catch {
    return null;
  }
}

// EEG has no HTTP route for "latest reading" -- read fusion_en directly,
// same path EegFirebaseSession.push() writes to
// (backend/psychological/firebase_service.py:52-67, prob_eeg field per
// make_eeg_fusion_record()).
async function fetchEegProbStress(userId, sessionId) {
  if (!userId || !sessionId) return null;
  try {
    const q = query(ref(db, `fusion_en/${userId}/${sessionId}`), orderByKey(), limitToLast(1));
    const snap = await dbGet(q);
    if (!snap.exists()) return null;
    const [latest] = Object.values(snap.val());
    return latest?.prob_eeg ?? null;
  } catch {
    return null;
  }
}

const QUESTIONS = [
  { q: 'In the last month, how often have you felt nervous and stressed?', reverse: false },
  { q: 'In the last month, how often have you felt unable to control important things in your life?', reverse: false },
  { q: 'In the last month, how often have you felt difficulties piling up so high you could not overcome them?', reverse: false },
  { q: 'In the last month, how often have you felt confident about your ability to handle personal problems?', reverse: true },
];

const OPTIONS = [
  { label: 'Never',        value: 0, emoji: '😌' },
  { label: 'Almost Never', value: 1, emoji: '🙂' },
  { label: 'Sometimes',    value: 2, emoji: '😐' },
  { label: 'Fairly Often', value: 3, emoji: '😟' },
  { label: 'Very Often',   value: 4, emoji: '😨' },
];

export default function PSS4Screen() {
  const { isDark, theme }        = useTheme();
  const { lastSessionId }        = useAppState();
  const { user, sessionId }      = useAuth();
  const [answers,   setAnswers]  = useState([null, null, null, null]);
  const [submitted, setSubmitted]= useState(false);
  const [result,    setResult]   = useState(null);
  const [activeQ,   setActiveQ]  = useState(0);

  const progressAnim = useRef(new Animated.Value(0)).current;

  const bg        = theme.bg;
  const card      = theme.card;
  const border    = theme.border;
  const cardHover = theme.cardHover;
  const text      = theme.text;
  const muted     = theme.textMuted;

  const answered = answers.filter(a => a !== null).length;

  const setAnswer = (qIdx, val) => {
    const newAnswers  = [...answers];
    newAnswers[qIdx]  = val;
    setAnswers(newAnswers);
    Animated.timing(progressAnim, {
      toValue: (newAnswers.filter(a => a !== null).length) / 4,
      duration: 300, useNativeDriver: false,
    }).start();
    if (qIdx < 3) setActiveQ(qIdx + 1);
  };

  const submit = async () => {
    if (answers.some(a => a === null)) { Alert.alert('Incomplete', 'Please answer all 4 questions.'); return; }
    const sessionToUse = lastSessionId || 'no_session';
    const [ringProbStress, eegProbStress] = await Promise.all([
      fetchRingProbStress(user?.userId),
      fetchEegProbStress(user?.userId, sessionId),
    ]);
    try {
      const res = await api.post('/pss4', {
        session_id: sessionToUse,
        q1: answers[0], q2: answers[1], q3: answers[2], q4: answers[3],
        ring_prob_stress: ringProbStress,
        eeg_prob_stress: eegProbStress,
      });
      setResult(res.data); setSubmitted(true);
    } catch {
      const score = answers.reduce((a, b) => a + b, 0);
      const level = score <= 6 ? 'Normal' : score <= 12 ? 'Stress' : 'High Stress';
      setResult({ score, level, max_score: 16 });
      setSubmitted(true);
    }
  };

  const reset = () => { setAnswers([null,null,null,null]); setSubmitted(false); setResult(null); setActiveQ(0); progressAnim.setValue(0); };

  if (submitted && result) {
    const color = result.level === 'Normal' ? COLORS.normal : result.level === 'Stress' ? COLORS.warning : COLORS.stress;
    const emoji = result.level === 'Normal' ? '😌' : result.level === 'Stress' ? '😰' : '😨';
    const pct   = (result.score / (result.max_score || 16)) * 100;

    return (
      <ScreenBackground>
        <View style={styles.resultScreen}>
          <View style={[styles.resultCard, { backgroundColor: card, borderColor: color + '60', borderWidth: 2 }]}>

            <View style={[styles.resultIconRing, { borderColor: color + '60' }]}>
              <View style={[styles.resultIconInner, { backgroundColor: color + '20' }]}>
                <Text style={styles.resultEmoji}>{emoji}</Text>
              </View>
            </View>

            <Text style={[styles.resultTitle, { color: muted }]}>PSS-4 Result</Text>
            <Text style={[styles.resultScore, { color }]}>{result.score}</Text>
            <Text style={[styles.resultMax, { color: muted }]}>/ {result.max_score || 16}</Text>
            <Text style={[styles.resultLevel, { color }]}>{result.level}</Text>

            {/* Score bar */}
            <View style={[styles.scoreBar, { backgroundColor: border }]}>
              <View style={[styles.scoreBarNormal,     { width: '37.5%' }]} />
              <View style={[styles.scoreBarStress,     { width: '37.5%' }]} />
              <View style={[styles.scoreBarHighStress, { width: '25%'   }]} />
              <View style={[styles.scoreMarker, { left: `${pct}%`, backgroundColor: color }]} />
            </View>
            <View style={styles.scoreLabels}>
              <Text style={[styles.scoreLabel, { color: COLORS.normal }]}>Normal</Text>
              <Text style={[styles.scoreLabel, { color: COLORS.warning }]}>Stress</Text>
              <Text style={[styles.scoreLabel, { color: COLORS.stress }]}>High Stress</Text>
            </View>

            <Text style={[styles.resultDesc, { color: muted }]}>
              {result.level === 'Normal' && 'Your perceived stress is within normal range. Continue monitoring daily.'}
              {result.level === 'Stress' && 'Moderate stress detected. Consider short breaks and relaxation techniques.'}
              {result.level === 'High Stress' && 'High perceived stress. This validates physiological detection — consider stress management.'}
            </Text>

            {lastSessionId && (
              <View style={[styles.sessionNote, { backgroundColor: COLORS.brand + '15', borderColor: COLORS.brand + '30' }]}>
                <Text style={[styles.sessionNoteText, { color: COLORS.brandLight }]}>
                  Linked to session: {lastSessionId.slice(0,10)}...
                </Text>
              </View>
            )}

            <TouchableOpacity style={[styles.resetBtn, { backgroundColor: cardHover, borderColor: border }]} onPress={reset}>
              <Text style={[styles.resetBtnText, { color: muted }]}>↺  Take Again</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScreenBackground>
    );
  }

  const progressWidth = progressAnim.interpolate({ inputRange: [0,1], outputRange: ['0%','100%'] });

  return (
    <ScreenBackground>
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: text }]}>PSS-4 Questionnaire</Text>
          <Text style={[styles.subtitle, { color: muted }]}>Cohen et al. 1983 · Perceived Stress Scale</Text>
        </View>

        {/* Progress */}
        <View style={[styles.progressCard, { backgroundColor: card, borderColor: border }]}>
          <View style={styles.progressHeader}>
            <Text style={[styles.progressLabel, { color: muted }]}>{answered} of 4 answered</Text>
            <Text style={[styles.progressPct, { color: COLORS.brand }]}>{Math.round((answered / 4) * 100)}%</Text>
          </View>
          <View style={[styles.progressBg, { backgroundColor: border }]}>
            <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
          </View>
          <View style={styles.dotRow}>
            {[0,1,2,3].map(i => (
              <TouchableOpacity key={i} onPress={() => setActiveQ(i)}>
                <View style={[styles.progressDot,
                  answers[i] !== null
                    ? { backgroundColor: COLORS.brand, width: 12, height: 12 }
                    : i === activeQ
                    ? { borderColor: COLORS.brand, borderWidth: 2, backgroundColor: 'transparent' }
                    : { backgroundColor: border }
                ]} />
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Questions */}
        {QUESTIONS.map((q, qIdx) => (
          <View key={qIdx} style={[
            styles.questionCard,
            { backgroundColor: card, borderColor: qIdx === activeQ ? COLORS.brand : border },
            qIdx === activeQ && styles.questionCardActive,
          ]}>
            <View style={styles.questionHeader}>
              <View style={[styles.qNumber, { backgroundColor: qIdx === activeQ ? COLORS.brand : cardHover }]}>
                <Text style={[styles.qNumberText, { color: qIdx === activeQ ? '#fff' : muted }]}>Q{qIdx + 1}</Text>
              </View>
              {q.reverse && (
                <View style={[styles.reverseBadge, { backgroundColor: COLORS.normal + '20', borderColor: COLORS.normal + '40' }]}>
                  <Text style={[styles.reverseText, { color: COLORS.normal }]}>Reverse scored</Text>
                </View>
              )}
            </View>
            <Text style={[styles.questionText, { color: text }]}>{q.q}</Text>

            <View style={styles.optionsGrid}>
              {OPTIONS.map((opt, val) => (
                <TouchableOpacity
                  key={val}
                  style={[
                    styles.optionBtn,
                    { backgroundColor: cardHover, borderColor: border },
                    answers[qIdx] === val && {
                      backgroundColor: COLORS.brand,
                      borderColor:     COLORS.brand,
                      transform:       [{ scale: 1.05 }],
                    },
                  ]}
                  onPress={() => setAnswer(qIdx, val)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.optionEmoji}>{opt.emoji}</Text>
                  <Text style={[styles.optionVal, { color: answers[qIdx] === val ? '#fff' : COLORS.brand }]}>
                    {opt.value}
                  </Text>
                  <Text style={[styles.optionLabel, { color: answers[qIdx] === val ? '#fff' : muted }]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        {/* Score preview */}
        {answered > 0 && (
          <View style={[styles.previewCard, { backgroundColor: COLORS.brand + '10', borderColor: COLORS.brand + '30' }]}>
            <Text style={[styles.previewLabel, { color: muted }]}>Current score</Text>
            <Text style={[styles.previewScore, { color: COLORS.brandLight }]}>
              {answers.filter(a => a !== null).reduce((s, a) => s + a, 0)}
            </Text>
            <Text style={[styles.previewMax, { color: muted }]}>/ 16</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.submitBtn, answered < 4 && { backgroundColor: theme.textMuted }]}
          onPress={submit}
          disabled={answered < 4}
          activeOpacity={0.85}
        >
          <Text style={styles.submitBtnText}>
            {answered < 4 ? `Answer ${4 - answered} more question${4 - answered !== 1 ? 's' : ''}` : 'Submit PSS-4 →'}
          </Text>
        </TouchableOpacity>

        <View style={{ height: 80 }} />
      </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  safe:              { flex: 1 },
  container:         { flex: 1, padding: 20, paddingTop: 16 },
  header:            { marginBottom: 16 },
  title:             { fontSize: 24, fontWeight: '900', letterSpacing: -0.3 },
  subtitle:          { fontSize: 13, marginTop: 4 },
  progressCard:      { borderRadius: 20, borderWidth: 1, padding: 16, marginBottom: 16 },
  progressHeader:    { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  progressLabel:     { fontSize: 13, fontWeight: '700' },
  progressPct:       { fontSize: 13, fontWeight: '800' },
  progressBg:        { height: 6, borderRadius: 3, overflow: 'hidden', marginBottom: 12 },
  progressFill:      { height: 6, borderRadius: 3, backgroundColor: COLORS.brand },
  dotRow:            { flexDirection: 'row', gap: 10 },
  progressDot:       { width: 10, height: 10, borderRadius: 5 },
  questionCard:      { borderRadius: 22, borderWidth: 1, padding: 20, marginBottom: 14 },
  questionCardActive:{ shadowColor: COLORS.brandDark, shadowOpacity: 0.1, shadowRadius: 14, elevation: 3 },
  questionHeader:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  qNumber:           { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  qNumberText:       { fontSize: 12, fontWeight: '800' },
  reverseBadge:      { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  reverseText:       { fontSize: 10, fontWeight: '700' },
  questionText:      { fontSize: 14, lineHeight: 22, marginBottom: 14, fontWeight: '600' },
  optionsGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  optionBtn:         { width: '18.5%', borderRadius: 14, borderWidth: 1, padding: 8, alignItems: 'center' },
  optionEmoji:       { fontSize: 16, marginBottom: 3 },
  optionVal:         { fontSize: 16, fontWeight: '900' },
  optionLabel:       { fontSize: 8, marginTop: 2, textAlign: 'center', fontWeight: '700' },
  previewCard:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 16 },
  previewLabel:      { fontSize: 13, fontWeight: '700' },
  previewScore:      { fontSize: 32, fontWeight: '900' },
  previewMax:        { fontSize: 16 },
  submitBtn:         { backgroundColor: COLORS.brand, padding: 16, borderRadius: 28, alignItems: 'center', marginBottom: 16, shadowColor: COLORS.brandDark, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 3 },
  submitBtnText:     { color: '#fff', fontSize: 15, fontWeight: '800' },
  resultScreen:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  resultCard:        { width: '100%', borderRadius: 26, padding: 28, alignItems: 'center' },
  resultIconRing:    { width: 110, height: 110, borderRadius: 55, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  resultIconInner:   { width: 90, height: 90, borderRadius: 45, alignItems: 'center', justifyContent: 'center' },
  resultEmoji:       { fontSize: 48 },
  resultTitle:       { fontSize: 14, marginBottom: 8, fontWeight: '700' },
  resultScore:       { fontSize: 64, fontWeight: '900', letterSpacing: -2 },
  resultMax:         { fontSize: 18, marginTop: -8, marginBottom: 6 },
  resultLevel:       { fontSize: 24, fontWeight: '900', marginBottom: 16 },
  scoreBar:          { width: '100%', height: 8, borderRadius: 4, overflow: 'hidden', flexDirection: 'row', position: 'relative', marginBottom: 4 },
  scoreBarNormal:     { height: 8, backgroundColor: COLORS.normal },
  scoreBarStress:     { height: 8, backgroundColor: COLORS.warning },
  scoreBarHighStress: { height: 8, backgroundColor: COLORS.stress },
  scoreMarker:       { position: 'absolute', top: -3, width: 4, height: 14, borderRadius: 2 },
  scoreLabels:       { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginBottom: 16 },
  scoreLabel:        { fontSize: 10, fontWeight: '800' },
  resultDesc:        { fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 16 },
  sessionNote:       { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, marginBottom: 14 },
  sessionNoteText:   { fontSize: 11, fontWeight: '700' },
  resetBtn:          { borderRadius: 28, borderWidth: 1, padding: 14, width: '100%', alignItems: 'center' },
  resetBtnText:      { fontSize: 14, fontWeight: '800' },
});