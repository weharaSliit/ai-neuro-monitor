import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import axios from 'axios';
import { API_BASE, USER_ID } from '../config/config';

const QUESTIONS = [
  'In the last month, how often have you felt nervous and stressed?',
  'In the last month, how often have you felt that you were unable to control important things in your life?',
  'In the last month, how often have you felt difficulties were piling up so high that you could not overcome them?',
  'In the last month, how often have you felt confident about your ability to handle your personal problems?',
];

const OPTIONS = ['Never', 'Almost Never', 'Sometimes', 'Fairly Often', 'Very Often'];

export default function PSS4Screen() {
  const [answers, setAnswers] = useState([null, null, null, null]);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState(null);

  const setAnswer = (qIdx, val) => {
    const newAnswers = [...answers];
    newAnswers[qIdx] = val;
    setAnswers(newAnswers);
  };

  const submit = async () => {
    if (answers.some(a => a === null)) {
      Alert.alert('Please answer all 4 questions');
      return;
    }

    try {
      const res = await axios.post(`${API_BASE}/pss4`, {
        user_id: USER_ID,
        session_id: 'latest',
        q1: answers[0], q2: answers[1],
        q3: answers[2], q4: answers[3],
      });
      setResult(res.data);
      setSubmitted(true);
    } catch (e) {
      const score = answers.reduce((a, b) => a + b, 0);
      const level = score <= 6 ? 'Normal' : score <= 12 ? 'Pre-stress' : 'Stress';
      setResult({ score, level });
      setSubmitted(true);
    }
  };

  const reset = () => {
    setAnswers([null, null, null, null]);
    setSubmitted(false);
    setResult(null);
  };

  if (submitted && result) {
    const color = result.level === 'Normal' ? '#22c55e'
      : result.level === 'Pre-stress' ? '#f59e0b' : '#ef4444';
    return (
      <View style={styles.container}>
        <View style={styles.resultCard}>
          <Text style={styles.resultEmoji}>
            {result.level === 'Normal' ? '😌' : result.level === 'Pre-stress' ? '😰' : '😨'}
          </Text>
          <Text style={styles.resultTitle}>PSS-4 Result</Text>
          <Text style={[styles.resultScore, { color }]}>{result.score} / 16</Text>
          <Text style={[styles.resultLevel, { color }]}>{result.level}</Text>
          <Text style={styles.resultDesc}>
            {result.level === 'Normal' && 'Your perceived stress is within normal range.'}
            {result.level === 'Pre-stress' && 'You are experiencing moderate stress. Monitor closely.'}
            {result.level === 'Stress' && 'High perceived stress detected. Consider stress management.'}
          </Text>
          <TouchableOpacity style={styles.resetBtn} onPress={reset}>
            <Text style={styles.resetBtnText}>Take Again</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>PSS-4 Questionnaire</Text>
      <Text style={styles.subtitle}>Perceived Stress Scale — Cohen et al. 1983</Text>

      {QUESTIONS.map((q, qIdx) => (
        <View key={qIdx} style={styles.questionCard}>
          <Text style={styles.questionText}>Q{qIdx + 1}. {q}</Text>
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

      <TouchableOpacity style={styles.submitBtn} onPress={submit}>
        <Text style={styles.submitBtnText}>Submit PSS-4</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', padding: 16 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#f1f5f9', marginTop: 20, marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#64748b', marginBottom: 20 },
  questionCard: { backgroundColor: '#1e293b', borderRadius: 16, padding: 18, marginBottom: 14 },
  questionText: { color: '#f1f5f9', fontSize: 14, lineHeight: 22, marginBottom: 14 },
  optionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionBtn: {
    backgroundColor: '#0f172a', borderRadius: 10,
    padding: 10, alignItems: 'center', width: '18%',
    borderWidth: 1, borderColor: '#334155',
  },
  optionBtnActive: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  optionVal: { color: '#f1f5f9', fontWeight: 'bold', fontSize: 16 },
  optionLabel: { color: '#64748b', fontSize: 9, marginTop: 3, textAlign: 'center' },
  submitBtn: { backgroundColor: '#6366f1', padding: 18, borderRadius: 14, alignItems: 'center', margin: 8 },
  submitBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  resultCard: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  resultEmoji: { fontSize: 80, marginBottom: 20 },
  resultTitle: { color: '#94a3b8', fontSize: 18, marginBottom: 10 },
  resultScore: { fontSize: 56, fontWeight: 'bold' },
  resultLevel: { fontSize: 24, fontWeight: '700', marginTop: 8 },
  resultDesc: { color: '#64748b', fontSize: 14, textAlign: 'center', marginTop: 16, lineHeight: 22 },
  resetBtn: { backgroundColor: '#1e293b', padding: 16, borderRadius: 12, marginTop: 30 },
  resetBtnText: { color: '#f1f5f9', fontSize: 16, fontWeight: '600' },
});