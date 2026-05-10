import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import axios from 'axios';
import { API_BASE, USER_ID } from '../config/config';
import { useAppState } from './AppState';

const QUESTIONS = [
  'In the last month, how often have you felt nervous and stressed?',
  'In the last month, how often have you felt unable to control important things in your life?',
  'In the last month, how often have you felt difficulties piling up so high you could not overcome them?',
  'In the last month, how often have you felt confident about your ability to handle personal problems?',
];

const OPTIONS = ['Never', 'Almost\nNever', 'Sometimes', 'Fairly\nOften', 'Very\nOften'];

export default function PSS4Screen() {
  const { lastSessionId } = useAppState();

  const [answers,   setAnswers]   = useState([null, null, null, null]);
  const [submitted, setSubmitted] = useState(false);
  const [result,    setResult]    = useState(null);

  const setAnswer = (qIdx, val) => {
    const newAnswers  = [...answers];
    newAnswers[qIdx]  = val;
    setAnswers(newAnswers);
  };

  const submit = async () => {
    if (answers.some(a => a === null)) {
      Alert.alert('Incomplete', 'Please answer all 4 questions.');
      return;
    }

    const sessionToUse = lastSessionId || 'no_session';

    try {
      const res = await axios.post(`${API_BASE}/pss4`, {
        user_id:    USER_ID,
        session_id: sessionToUse,
        q1:         answers[0],
        q2:         answers[1],
        q3:         answers[2],
        q4:         answers[3],
      });
      setResult(res.data);
      setSubmitted(true);
    } catch (e) {
      // Offline fallback — calculate locally
      const score = answers.reduce((a, b) => a + b, 0);
      const level = score <= 6 ? 'Normal'
                  : score <= 12 ? 'Pre-stress'
                  : 'Stress';
      setResult({ score, level, max_score: 16 });
      setSubmitted(true);
    }
  };

  const reset = () => {
    setAnswers([null, null, null, null]);
    setSubmitted(false);
    setResult(null);
  };

  if (submitted && result) {
    const color =
      result.level === 'Normal'     ? '#22c55e'
    : result.level === 'Pre-stress' ? '#f59e0b'
    : '#ef4444';

    const emoji =
      result.level === 'Normal'     ? '😌'
    : result.level === 'Pre-stress' ? '😰'
    : '😨';

    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.resultContainer}>
          <View style={[styles.resultCard,
            { borderColor: color, borderWidth: 2 }]}>
            <Text style={styles.resultEmoji}>{emoji}</Text>
            <Text style={styles.resultTitle}>PSS-4 Result</Text>
            <Text style={[styles.resultScore, { color }]}>
              {result.score} / {result.max_score || 16}
            </Text>
            <Text style={[styles.resultLevel, { color }]}>
              {result.level}
            </Text>

            <View style={styles.scaleBar}>
              <View style={[styles.scaleFill, {
                width: `${(result.score / 16) * 100}%`,
                backgroundColor: color
              }]} />
            </View>
            <View style={styles.scaleLabels}>
              <Text style={styles.scaleLabel}>Normal</Text>
              <Text style={styles.scaleLabel}>Pre-stress</Text>
              <Text style={styles.scaleLabel}>Stress</Text>
            </View>

            <Text style={styles.resultDesc}>
              {result.level === 'Normal' &&
                'Your perceived stress is within normal range. Continue monitoring.'}
              {result.level === 'Pre-stress' &&
                'You are experiencing moderate stress. Consider taking short breaks.'}
              {result.level === 'Stress' &&
                'High perceived stress detected. Consider stress management techniques.'}
            </Text>

            {lastSessionId && (
              <Text style={styles.sessionNote}>
                Linked to session: {lastSessionId.slice(0, 8)}...
              </Text>
            )}

            <TouchableOpacity style={styles.resetBtn} onPress={reset}>
              <Text style={styles.resetBtnText}>Take Again</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView style={styles.container}>
        <Text style={styles.title}>PSS-4 Questionnaire</Text>
        <Text style={styles.subtitle}>
          Perceived Stress Scale — Cohen et al. 1983
        </Text>
        <Text style={styles.sessionInfo}>
          {lastSessionId
            ? `Linked to current session`
            : `Run a simulation first for best results`}
        </Text>

        {QUESTIONS.map((q, qIdx) => (
          <View key={qIdx} style={styles.questionCard}>
            <Text style={styles.questionNum}>Q{qIdx + 1}</Text>
            <Text style={styles.questionText}>{q}</Text>
            <View style={styles.optionsRow}>
              {OPTIONS.map((opt, val) => (
                <TouchableOpacity
                  key={val}
                  style={[
                    styles.optionBtn,
                    answers[qIdx] === val && styles.optionBtnActive
                  ]}
                  onPress={() => setAnswer(qIdx, val)}
                >
                  <Text style={[
                    styles.optionVal,
                    answers[qIdx] === val && { color: '#fff' }
                  ]}>{val}</Text>
                  <Text style={[
                    styles.optionLabel,
                    answers[qIdx] === val && { color: '#c7d2fe' }
                  ]}>{opt}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        <View style={styles.progressIndicator}>
          <Text style={styles.progressText}>
            {answers.filter(a => a !== null).length} / 4 answered
          </Text>
          <View style={styles.progressBg}>
            <View style={[styles.progressFill, {
              width: `${(answers.filter(a => a !== null).length / 4) * 100}%`
            }]} />
          </View>
        </View>

        <TouchableOpacity
          style={[
            styles.submitBtn,
            answers.some(a => a === null) && styles.submitBtnDisabled
          ]}
          onPress={submit}
        >
          <Text style={styles.submitBtnText}>Submit PSS-4</Text>
        </TouchableOpacity>

        <View style={{ height: 60 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:               { flex: 1, backgroundColor: '#0f172a' },
  container:          { flex: 1, backgroundColor: '#0f172a', padding: 16 },
  title:              { fontSize: 24, fontWeight: 'bold', color: '#f1f5f9', marginTop: 20, marginBottom: 4 },
  subtitle:           { fontSize: 13, color: '#64748b', marginBottom: 6 },
  sessionInfo:        { fontSize: 12, color: '#6366f1', marginBottom: 16, fontStyle: 'italic' },
  questionCard:       { backgroundColor: '#1e293b', borderRadius: 16, padding: 18, marginBottom: 14 },
  questionNum:        { color: '#6366f1', fontWeight: '700', fontSize: 12, marginBottom: 6 },
  questionText:       { color: '#f1f5f9', fontSize: 14, lineHeight: 22, marginBottom: 14 },
  optionsRow:         { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  optionBtn:          { backgroundColor: '#0f172a', borderRadius: 10, padding: 10, alignItems: 'center', width: '18%', borderWidth: 1, borderColor: '#334155' },
  optionBtnActive:    { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  optionVal:          { color: '#f1f5f9', fontWeight: 'bold', fontSize: 16 },
  optionLabel:        { color: '#64748b', fontSize: 9, marginTop: 3, textAlign: 'center' },
  progressIndicator:  { paddingHorizontal: 8, marginBottom: 16 },
  progressText:       { color: '#64748b', fontSize: 13, marginBottom: 8, textAlign: 'center' },
  progressBg:         { height: 6, backgroundColor: '#1e293b', borderRadius: 3 },
  progressFill:       { height: 6, backgroundColor: '#6366f1', borderRadius: 3 },
  submitBtn:          { backgroundColor: '#6366f1', padding: 18, borderRadius: 14, alignItems: 'center', margin: 8 },
  submitBtnDisabled:  { backgroundColor: '#334155' },
  submitBtnText:      { color: '#fff', fontSize: 18, fontWeight: '700' },
  resultContainer:    { flex: 1, backgroundColor: '#0f172a', alignItems: 'center', justifyContent: 'center', padding: 24 },
  resultCard:         { backgroundColor: '#1e293b', borderRadius: 20, padding: 32, alignItems: 'center', width: '100%' },
  resultEmoji:        { fontSize: 80, marginBottom: 16 },
  resultTitle:        { color: '#94a3b8', fontSize: 16, marginBottom: 8 },
  resultScore:        { fontSize: 56, fontWeight: 'bold' },
  resultLevel:        { fontSize: 24, fontWeight: '700', marginTop: 8 },
  scaleBar:           { height: 8, backgroundColor: '#0f172a', borderRadius: 4, width: '100%', marginTop: 20, overflow: 'hidden' },
  scaleFill:          { height: 8, borderRadius: 4 },
  scaleLabels:        { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: 4 },
  scaleLabel:         { color: '#475569', fontSize: 10 },
  resultDesc:         { color: '#64748b', fontSize: 14, textAlign: 'center', marginTop: 16, lineHeight: 22 },
  sessionNote:        { color: '#475569', fontSize: 11, marginTop: 12, fontStyle: 'italic' },
  resetBtn:           { backgroundColor: '#0f172a', padding: 16, borderRadius: 12, marginTop: 20, width: '100%', alignItems: 'center' },
  resetBtnText:       { color: '#f1f5f9', fontSize: 16, fontWeight: '600' },
});