import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Alert, Animated
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import axios from 'axios';
import { useTheme } from '../config/ThemeContext';
import { API_BASE, USER_ID } from '../config/config';
import { useAppState } from './AppState';

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
  const [answers,   setAnswers]  = useState([null, null, null, null]);
  const [submitted, setSubmitted]= useState(false);
  const [result,    setResult]   = useState(null);
  const [activeQ,   setActiveQ]  = useState(0);

  const progressAnim = useRef(new Animated.Value(0)).current;

  const bg     = isDark ? '#060d1a' : '#f0f9ff';
  const card   = isDark ? '#0f1f35' : '#ffffff';
  const border = isDark ? '#1e3a5f' : '#e2e8f0';
  const text   = theme.text;
  const muted  = theme.textMuted;

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
    try {
      const res = await axios.post(`${API_BASE}/pss4`, {
        user_id: USER_ID, session_id: sessionToUse,
        q1: answers[0], q2: answers[1], q3: answers[2], q4: answers[3],
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
    const color = result.level === 'Normal' ? '#10b981' : result.level === 'Stress' ? '#f59e0b' : '#ef4444';
    const emoji = result.level === 'Normal' ? '😌' : result.level === 'Stress' ? '😰' : '😨';
    const pct   = (result.score / (result.max_score || 16)) * 100;

    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
        <View style={[styles.resultScreen, { backgroundColor: bg }]}>
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
            <View style={[styles.scoreBar, { backgroundColor: isDark ? '#1e3a5f' : '#e2e8f0' }]}>
              <View style={[styles.scoreBarNormal,     { width: '37.5%' }]} />
              <View style={[styles.scoreBarStress,     { width: '37.5%' }]} />
              <View style={[styles.scoreBarHighStress, { width: '25%'   }]} />
              <View style={[styles.scoreMarker, { left: `${pct}%`, backgroundColor: color }]} />
            </View>
            <View style={styles.scoreLabels}>
              <Text style={[styles.scoreLabel, { color: '#10b981' }]}>Normal</Text>
              <Text style={[styles.scoreLabel, { color: '#f59e0b' }]}>Stress</Text>
              <Text style={[styles.scoreLabel, { color: '#ef4444' }]}>High Stress</Text>
            </View>

            <Text style={[styles.resultDesc, { color: muted }]}>
              {result.level === 'Normal' && 'Your perceived stress is within normal range. Continue monitoring daily.'}
              {result.level === 'Stress' && 'Moderate stress detected. Consider short breaks and relaxation techniques.'}
              {result.level === 'High Stress' && 'High perceived stress. This validates physiological detection — consider stress management.'}
            </Text>

            {lastSessionId && (
              <View style={[styles.sessionNote, { backgroundColor: '#6366f115', borderColor: '#6366f130' }]}>
                <Text style={styles.sessionNoteText}>
                  Linked to session: {lastSessionId.slice(0,10)}...
                </Text>
              </View>
            )}

            <TouchableOpacity style={[styles.resetBtn, { backgroundColor: isDark ? '#162033' : '#f8fafc', borderColor: border }]} onPress={reset}>
              <Text style={[styles.resetBtnText, { color: muted }]}>↺  Take Again</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const progressWidth = progressAnim.interpolate({ inputRange: [0,1], outputRange: ['0%','100%'] });

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
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
            <Text style={[styles.progressPct, { color: '#6366f1' }]}>{Math.round((answered / 4) * 100)}%</Text>
          </View>
          <View style={[styles.progressBg, { backgroundColor: isDark ? '#1e3a5f' : '#e2e8f0' }]}>
            <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
          </View>
          <View style={styles.dotRow}>
            {[0,1,2,3].map(i => (
              <TouchableOpacity key={i} onPress={() => setActiveQ(i)}>
                <View style={[styles.progressDot,
                  answers[i] !== null
                    ? { backgroundColor: '#6366f1', width: 12, height: 12 }
                    : i === activeQ
                    ? { borderColor: '#6366f1', borderWidth: 2, backgroundColor: 'transparent' }
                    : { backgroundColor: isDark ? '#1e3a5f' : '#e2e8f0' }
                ]} />
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Questions */}
        {QUESTIONS.map((q, qIdx) => (
          <View key={qIdx} style={[
            styles.questionCard,
            { backgroundColor: card, borderColor: qIdx === activeQ ? '#6366f1' : border },
            qIdx === activeQ && styles.questionCardActive,
          ]}>
            <View style={styles.questionHeader}>
              <View style={[styles.qNumber, { backgroundColor: qIdx === activeQ ? '#6366f1' : isDark ? '#162033' : '#f8fafc' }]}>
                <Text style={[styles.qNumberText, { color: qIdx === activeQ ? '#fff' : muted }]}>Q{qIdx + 1}</Text>
              </View>
              {q.reverse && (
                <View style={[styles.reverseBadge, { backgroundColor: '#10b98120', borderColor: '#10b98140' }]}>
                  <Text style={styles.reverseText}>Reverse scored</Text>
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
                    { backgroundColor: isDark ? '#162033' : '#f8fafc', borderColor: border },
                    answers[qIdx] === val && {
                      backgroundColor: '#6366f1',
                      borderColor:     '#6366f1',
                      transform:       [{ scale: 1.05 }],
                    },
                  ]}
                  onPress={() => setAnswer(qIdx, val)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.optionEmoji}>{opt.emoji}</Text>
                  <Text style={[styles.optionVal, { color: answers[qIdx] === val ? '#fff' : '#6366f1' }]}>
                    {opt.value}
                  </Text>
                  <Text style={[styles.optionLabel, { color: answers[qIdx] === val ? '#c7d2fe' : muted }]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        {/* Score preview */}
        {answered > 0 && (
          <View style={[styles.previewCard, { backgroundColor: '#6366f110', borderColor: '#6366f130' }]}>
            <Text style={[styles.previewLabel, { color: muted }]}>Current score</Text>
            <Text style={[styles.previewScore, { color: '#818cf8' }]}>
              {answers.filter(a => a !== null).reduce((s, a) => s + a, 0)}
            </Text>
            <Text style={[styles.previewMax, { color: muted }]}>/ 16</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.submitBtn, answered < 4 && { backgroundColor: '#334155' }]}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:              { flex: 1 },
  container:         { flex: 1, padding: 20 },
  header:            { marginBottom: 16 },
  title:             { fontSize: 24, fontWeight: '900' },
  subtitle:          { fontSize: 13, marginTop: 4 },
  progressCard:      { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 16 },
  progressHeader:    { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  progressLabel:     { fontSize: 13, fontWeight: '600' },
  progressPct:       { fontSize: 13, fontWeight: '800' },
  progressBg:        { height: 6, borderRadius: 3, overflow: 'hidden', marginBottom: 12 },
  progressFill:      { height: 6, borderRadius: 3, backgroundColor: '#6366f1' },
  dotRow:            { flexDirection: 'row', gap: 10 },
  progressDot:       { width: 10, height: 10, borderRadius: 5 },
  questionCard:      { borderRadius: 18, borderWidth: 1, padding: 18, marginBottom: 14 },
  questionCardActive:{ shadowColor: '#6366f1', shadowOpacity: 0.2, shadowRadius: 12, elevation: 4 },
  questionHeader:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  qNumber:           { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  qNumberText:       { fontSize: 12, fontWeight: '800' },
  reverseBadge:      { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  reverseText:       { color: '#10b981', fontSize: 10, fontWeight: '700' },
  questionText:      { fontSize: 14, lineHeight: 22, marginBottom: 14 },
  optionsGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  optionBtn:         { width: '18.5%', borderRadius: 12, borderWidth: 1, padding: 8, alignItems: 'center' },
  optionEmoji:       { fontSize: 16, marginBottom: 3 },
  optionVal:         { fontSize: 16, fontWeight: '900' },
  optionLabel:       { fontSize: 8, marginTop: 2, textAlign: 'center' },
  previewCard:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 16 },
  previewLabel:      { fontSize: 13 },
  previewScore:      { fontSize: 32, fontWeight: '900' },
  previewMax:        { fontSize: 16 },
  submitBtn:         { backgroundColor: '#6366f1', padding: 18, borderRadius: 16, alignItems: 'center', marginBottom: 16 },
  submitBtnText:     { color: '#fff', fontSize: 16, fontWeight: '800' },
  resultScreen:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  resultCard:        { width: '100%', borderRadius: 24, padding: 28, alignItems: 'center' },
  resultIconRing:    { width: 110, height: 110, borderRadius: 55, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  resultIconInner:   { width: 90, height: 90, borderRadius: 45, alignItems: 'center', justifyContent: 'center' },
  resultEmoji:       { fontSize: 48 },
  resultTitle:       { fontSize: 14, marginBottom: 8 },
  resultScore:       { fontSize: 64, fontWeight: '900' },
  resultMax:         { fontSize: 18, marginTop: -8, marginBottom: 6 },
  resultLevel:       { fontSize: 26, fontWeight: '900', marginBottom: 16 },
  scoreBar:          { width: '100%', height: 8, borderRadius: 4, overflow: 'hidden', flexDirection: 'row', position: 'relative', marginBottom: 4 },
  scoreBarNormal:     { height: 8, backgroundColor: '#10b981' },
  scoreBarStress:     { height: 8, backgroundColor: '#f59e0b' },
  scoreBarHighStress: { height: 8, backgroundColor: '#ef4444' },
  scoreMarker:       { position: 'absolute', top: -3, width: 4, height: 14, borderRadius: 2 },
  scoreLabels:       { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginBottom: 16 },
  scoreLabel:        { fontSize: 10, fontWeight: '700' },
  resultDesc:        { fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 16 },
  sessionNote:       { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, marginBottom: 14 },
  sessionNoteText:   { color: '#818cf8', fontSize: 11 },
  resetBtn:          { borderRadius: 12, borderWidth: 1, padding: 14, width: '100%', alignItems: 'center' },
  resetBtnText:      { fontSize: 15, fontWeight: '600' },
});