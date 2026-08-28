// ============================================================
// PhenotypingOnboardingScreen.js -- consolidated RN port of the standalone
// app's welcome.jsx + BaselineSurvey.jsx + permissions.jsx + SetupComplete.jsx.
// Identity/registration (the original's first survey question, "what's your
// name") is dropped entirely -- StressApp's real login already provides
// that (see the "Bring Phenotyping Into StressApp" plan's identity
// decision). What's kept: the 5 real lifestyle-context questions (stored
// for research purposes, not consumed by the prediction model itself),
// the Accessibility Settings instructions (this grant genuinely can't be
// triggered by any app, Android requires manual Settings navigation), and
// the runtime permission requests the original app's MainActivity used to
// fire on launch (now via PhenotypingIdentityModule.requestRuntimePermissions()
// -- see that file).
// ============================================================
import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, NativeModules, Platform } from 'react-native';
import ScreenBackground from '../../shared/ScreenBackground';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../physiological/config/ThemeContext';
import { useAuth } from '../../../context/AuthContext';

const { PhenotypingIdentity } = NativeModules;

const SURVEY_QUESTIONS = [
    { id: 'sleep', icon: '🌙', question: 'On most nights, how many hours do you sleep?',
      options: ['Less than 5 hours', '5-6 hours', '7-8 hours', '9+ hours'] },
    { id: 'stress_freq', icon: '⚡', question: 'On a typical week, how many days do you feel stressed?',
      options: ['0-1 day', '2-3 days', '4-5 days', 'Every day'] },
    { id: 'activity', icon: '🏃', question: 'How physically active are you on a typical day?',
      options: ['Not at all', 'Lightly active', 'Moderately active', 'Very active'] },
    { id: 'schedule', icon: '📅', question: 'What does your typical daily schedule look like?',
      options: ['Fixed (9-5)', 'Flexible/Remote', 'Irregular/Shift', 'Student/Study'] },
    { id: 'reason', icon: '❤️', question: 'What is your main reason for using this feature?',
      options: ['Stress awareness', 'Research study', 'Improve focus', 'Health tracking'] },
];

export async function markPhenotypingOnboarded(userId, answers) {
    await AsyncStorage.setItem(`phenotyping_onboarded_${userId}`, JSON.stringify({
        completed_at: new Date().toISOString(), survey_answers: answers,
    }));
}

export async function isPhenotypingOnboarded(userId) {
    return !!(await AsyncStorage.getItem(`phenotyping_onboarded_${userId}`));
}

export default function PhenotypingOnboardingScreen({ navigation }) {
    const { theme: t, COLORS } = useTheme();
    const { user } = useAuth();
    const userId = user?.userId;

    const [answers, setAnswers] = useState({});
    const [permissionsRequested, setPermissionsRequested] = useState(false);
    const [saving, setSaving] = useState(false);

    const selectAnswer = (qId, option) => setAnswers((prev) => ({ ...prev, [qId]: option }));
    const allAnswered = SURVEY_QUESTIONS.every((q) => answers[q.id]);

    const grantPermissions = async () => {
        if (Platform.OS === 'android' && PhenotypingIdentity) {
            await PhenotypingIdentity.requestRuntimePermissions();
            PhenotypingIdentity.scheduleEmaNotifications();
        }
        setPermissionsRequested(true);
    };

    const finish = async () => {
        setSaving(true);
        await markPhenotypingOnboarded(userId, answers);
        setSaving(false);
        navigation.goBack();
    };

    return (
        <ScreenBackground edges={['left', 'right']}>
            <ScrollView contentContainerStyle={styles.scroll}>
                <Text style={[styles.title, { color: t.text }]}>Set up behavioral tracking</Text>
                <Text style={[styles.subtitle, { color: t.textMuted }]}>
                    Passive monitoring only — no text content, messages, or calls are ever read.
                </Text>

                {SURVEY_QUESTIONS.map((q) => (
                    <View key={q.id} style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                        <Text style={[styles.question, { color: t.text }]}>{q.icon} {q.question}</Text>
                        <View style={styles.optionsWrap}>
                            {q.options.map((opt) => {
                                const selected = answers[q.id] === opt;
                                return (
                                    <TouchableOpacity
                                        key={opt}
                                        onPress={() => selectAnswer(q.id, opt)}
                                        style={[styles.optionBtn, {
                                            backgroundColor: selected ? COLORS.brand + '20' : t.card,
                                            borderColor: selected ? COLORS.brand : t.border,
                                        }]}
                                    >
                                        <Text style={{ color: selected ? COLORS.brand : t.textMuted, fontSize: 12, fontWeight: '700' }}>{opt}</Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                    </View>
                ))}

                <View style={[styles.card, { backgroundColor: COLORS.brand + '10', borderColor: COLORS.brand + '30' }]}>
                    <Text style={[styles.question, { color: t.text }]}>⚠️ One more step — Accessibility permission</Text>
                    <Text style={[styles.hint, { color: t.textMuted, marginBottom: 12 }]}>
                        Keystroke timing and app-switching capture requires manually enabling this in your phone's
                        settings — no app can do this automatically:
                    </Text>
                    <Text style={[styles.stepText, { color: t.textMuted }]}>1. Open Settings → Accessibility</Text>
                    <Text style={[styles.stepText, { color: t.textMuted }]}>2. Find "PhenoCare Sensor"</Text>
                    <Text style={[styles.stepText, { color: t.textMuted }]}>3. Toggle it On</Text>

                    <TouchableOpacity
                        style={[styles.grantBtn, { backgroundColor: permissionsRequested ? COLORS.normal : COLORS.brand }]}
                        onPress={grantPermissions}
                    >
                        <Text style={styles.grantBtnText}>
                            {permissionsRequested ? '✓ Requested' : 'Grant motion & notification permissions'}
                        </Text>
                    </TouchableOpacity>
                </View>

                <TouchableOpacity
                    style={[styles.finishBtn, { backgroundColor: allAnswered ? COLORS.brand : t.border, opacity: saving ? 0.6 : 1 }]}
                    onPress={finish}
                    disabled={!allAnswered || saving}
                >
                    <Text style={styles.finishBtnText}>{allAnswered ? "I'm all set →" : `Answer ${SURVEY_QUESTIONS.length - Object.keys(answers).length} more to continue`}</Text>
                </TouchableOpacity>
            </ScrollView>
        </ScreenBackground>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    scroll: { padding: 20, paddingBottom: 40 },
    title: { fontSize: 20, fontWeight: '900', marginBottom: 6 },
    subtitle: { fontSize: 12, marginBottom: 20, lineHeight: 18 },
    card: { borderRadius: 18, borderWidth: 1, padding: 16, marginBottom: 14 },
    question: { fontSize: 13, fontWeight: '700', marginBottom: 12 },
    hint: { fontSize: 11, lineHeight: 17 },
    stepText: { fontSize: 12, marginBottom: 4 },
    optionsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    optionBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1 },
    grantBtn: { marginTop: 14, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
    grantBtnText: { color: '#fff', fontSize: 12, fontWeight: '800' },
    finishBtn: { borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
    finishBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
});
