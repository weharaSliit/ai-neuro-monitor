// ============================================================
// PhenotypingEmaScreen.js -- RN port of the standalone phenotyping app's
// EmaSurvey.jsx. Two tabs: SISS (single-item quick check) and PSS-4
// (weekly 4-question survey) -- both POST to the same
// backend/phenotyping_behavior/app.py's /behavior/label route the
// original used, unchanged. Local "already submitted this week" state
// uses AsyncStorage instead of localStorage, namespaced per real userId.
// ============================================================
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../physiological/config/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { API_BASE } from '../config/config';

const PSS4_QUESTIONS = [
    { id: 'control', question: 'In the last week, how often have you felt that you were unable to control the important things in your life?', reverse: false },
    { id: 'confident', question: 'In the last week, how often have you felt confident about your ability to handle your personal problems?', reverse: true },
    { id: 'going_way', question: 'In the last week, how often have you felt that things were going your way?', reverse: true },
    { id: 'difficulties', question: 'In the last week, how often have you felt difficulties were piling up so high that you could not overcome them?', reverse: false },
];

const LIKERT_OPTIONS = [
    { label: 'Never', value: 0 },
    { label: 'Almost Never', value: 1 },
    { label: 'Sometimes', value: 2 },
    { label: 'Fairly Often', value: 3 },
    { label: 'Very Often', value: 4 },
];

function currentWeekNum() {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    return Math.ceil(((now - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
}

function stressCategory(score) {
    if (score <= 5) return { label: 'Low Stress', color: '#7FB596' };
    if (score <= 11) return { label: 'Moderate Stress', color: '#E0A458' };
    return { label: 'High Stress', color: '#D97A76' };
}

export default function PhenotypingEmaScreen({ navigation, route }) {
    const { theme: t, COLORS } = useTheme();
    const { user } = useAuth();
    const userId = user?.userId;

    const [tab, setTab] = useState(route?.params?.initialTab === 'pss4' ? 'pss4' : 'siss');
    const [sissScore, setSissScore] = useState(3);
    const [lastSiss, setLastSiss] = useState(null);

    const [pssAnswers, setPssAnswers] = useState({ 0: 2, 1: 2, 2: 2, 3: 2 });
    const [pss4Saved, setPss4Saved] = useState(null);
    const [editingPss4, setEditingPss4] = useState(true);

    const [submitting, setSubmitting] = useState(false);
    const [message, setMessage] = useState(null);

    useEffect(() => {
        if (!userId) return;
        (async () => {
            const savedSiss = await AsyncStorage.getItem(`siss_last_checkin_${userId}`);
            if (savedSiss) { try { setLastSiss(JSON.parse(savedSiss)); } catch {} }

            const savedPss4 = await AsyncStorage.getItem(`pss4_saved_data_${userId}`);
            if (savedPss4) {
                try {
                    const parsed = JSON.parse(savedPss4);
                    if (parsed.weekNum === currentWeekNum()) {
                        setPss4Saved(parsed);
                        if (parsed.answers) setPssAnswers(parsed.answers);
                        setEditingPss4(false);
                    }
                } catch {}
            }
        })();
    }, [userId]);

    const submitSiss = async () => {
        setSubmitting(true);
        setMessage(null);
        const nowIso = new Date().toISOString();
        try {
            const res = await fetch(`${API_BASE}/behavior/label`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: userId, type: 'siss', score: sissScore, timestamp: nowIso }),
            });
            const data = await res.json();
            const checkin = { score: sissScore, timestamp: nowIso };
            await AsyncStorage.setItem(`siss_last_checkin_${userId}`, JSON.stringify(checkin));
            setLastSiss(checkin);
            setMessage(res.ok ? 'SISS check-in saved!' : `Error: ${data.reason || 'Failed'}`);
            if (res.ok) setTimeout(() => navigation.goBack(), 1000);
        } catch {
            const checkin = { score: sissScore, timestamp: nowIso };
            await AsyncStorage.setItem(`siss_last_checkin_${userId}`, JSON.stringify(checkin));
            setLastSiss(checkin);
            setMessage('Saved locally (offline)');
            setTimeout(() => navigation.goBack(), 1000);
        } finally {
            setSubmitting(false);
        }
    };

    const submitPss4 = async () => {
        setSubmitting(true);
        setMessage(null);
        let totalScore = 0;
        PSS4_QUESTIONS.forEach((q, idx) => {
            const raw = pssAnswers[idx] ?? 0;
            totalScore += q.reverse ? (4 - raw) : raw;
        });
        const nowIso = new Date().toISOString();
        const weekNum = currentWeekNum();
        const dataObj = { score: totalScore, answers: pssAnswers, timestamp: nowIso, weekNum };

        try {
            const res = await fetch(`${API_BASE}/behavior/label`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: userId, type: 'pss4', score: totalScore, timestamp: nowIso }),
            });
            const data = await res.json();
            await AsyncStorage.setItem(`pss4_saved_data_${userId}`, JSON.stringify(dataObj));
            setPss4Saved(dataObj);
            setEditingPss4(false);
            setMessage(res.ok ? `PSS-4 saved! Score: ${totalScore}/16` : `Error: ${data.reason || 'Failed'}`);
            if (res.ok) setTimeout(() => navigation.goBack(), 1200);
        } catch {
            await AsyncStorage.setItem(`pss4_saved_data_${userId}`, JSON.stringify(dataObj));
            setPss4Saved(dataObj);
            setEditingPss4(false);
            setMessage(`Saved locally (Score: ${totalScore}/16)`);
            setTimeout(() => navigation.goBack(), 1200);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: t.bg }]} edges={['top', 'left', 'right']}>
            <View style={styles.tabRow}>
                <TouchableOpacity
                    style={[styles.tabBtn, { backgroundColor: tab === 'siss' ? COLORS.stress + '20' : t.surface, borderColor: tab === 'siss' ? COLORS.stress + '50' : t.border }]}
                    onPress={() => setTab('siss')}
                >
                    <Text style={[styles.tabBtnText, { color: tab === 'siss' ? COLORS.stress : t.textMuted }]}>⚡ Quick Check</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.tabBtn, { backgroundColor: tab === 'pss4' ? COLORS.brand + '20' : t.surface, borderColor: tab === 'pss4' ? COLORS.brand + '50' : t.border }]}
                    onPress={() => setTab('pss4')}
                >
                    <Text style={[styles.tabBtnText, { color: tab === 'pss4' ? COLORS.brand : t.textMuted }]}>✨ Weekly PSS-4</Text>
                </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.scroll}>
                {message && (
                    <View style={[styles.messageBox, { backgroundColor: COLORS.normal + '20', borderColor: COLORS.normal + '40' }]}>
                        <Text style={{ color: COLORS.normal, fontSize: 12, fontWeight: '700' }}>{message}</Text>
                    </View>
                )}

                {tab === 'siss' ? (
                    <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                        <Text style={[styles.cardTitle, { color: t.text }]}>How stressed do you feel right now?</Text>
                        <Text style={[styles.cardSub, { color: t.textMuted }]}>Tap to log your momentary stress level.</Text>

                        {lastSiss && (
                            <Text style={[styles.hint, { color: t.textMuted, marginTop: 10 }]}>
                                Last check-in: {new Date(lastSiss.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · score {lastSiss.score}/5
                            </Text>
                        )}

                        <Text style={[styles.bigScore, { color: COLORS.stress }]}>{sissScore} / 5</Text>
                        <View style={styles.likertRow}>
                            {[1, 2, 3, 4, 5].map((lvl) => (
                                <TouchableOpacity
                                    key={lvl}
                                    onPress={() => setSissScore(lvl)}
                                    style={[styles.likertBtn, {
                                        backgroundColor: sissScore === lvl ? COLORS.stress : t.card,
                                        borderColor: sissScore === lvl ? COLORS.stress : t.border,
                                    }]}
                                >
                                    <Text style={{ color: sissScore === lvl ? '#fff' : t.textMuted, fontWeight: '800' }}>{lvl}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        <TouchableOpacity
                            style={[styles.submitBtn, { backgroundColor: COLORS.stress, opacity: submitting ? 0.6 : 1 }]}
                            onPress={submitSiss}
                            disabled={submitting}
                        >
                            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Submit Check-In</Text>}
                        </TouchableOpacity>
                    </View>
                ) : pss4Saved && !editingPss4 ? (
                    <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                        <Text style={[styles.cardTitle, { color: t.text }]}>This week's PSS-4 is submitted ✓</Text>
                        <View style={[styles.scoreRow, { borderColor: stressCategory(pss4Saved.score).color + '40', backgroundColor: stressCategory(pss4Saved.score).color + '15' }]}>
                            <Text style={[styles.bigScore, { color: stressCategory(pss4Saved.score).color, marginTop: 0 }]}>{pss4Saved.score}/16</Text>
                            <Text style={{ color: stressCategory(pss4Saved.score).color, fontWeight: '800' }}>{stressCategory(pss4Saved.score).label}</Text>
                        </View>
                        <Text style={[styles.hint, { color: t.textMuted, marginTop: 10 }]}>
                            Last updated: {new Date(pss4Saved.timestamp).toLocaleString()}
                        </Text>
                        <TouchableOpacity style={[styles.editBtn, { borderColor: t.border }]} onPress={() => setEditingPss4(true)}>
                            <Text style={{ color: t.text, fontWeight: '700' }}>Edit / Re-submit</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <View>
                        {PSS4_QUESTIONS.map((q, idx) => (
                            <View key={q.id} style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                                <Text style={[styles.question, { color: t.text }]}>
                                    <Text style={{ color: COLORS.brand, fontWeight: '900' }}>Q{idx + 1}. </Text>{q.question}
                                </Text>
                                <View style={styles.optionsGrid}>
                                    {LIKERT_OPTIONS.map((opt) => (
                                        <TouchableOpacity
                                            key={opt.value}
                                            onPress={() => setPssAnswers({ ...pssAnswers, [idx]: opt.value })}
                                            style={[styles.optionBtn, {
                                                backgroundColor: pssAnswers[idx] === opt.value ? COLORS.brand : t.card,
                                                borderColor: pssAnswers[idx] === opt.value ? COLORS.brand : t.border,
                                            }]}
                                        >
                                            <Text style={{
                                                color: pssAnswers[idx] === opt.value ? '#fff' : t.textMuted,
                                                fontSize: 10, fontWeight: '700', textAlign: 'center',
                                            }}>{opt.label}</Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            </View>
                        ))}
                        <TouchableOpacity
                            style={[styles.submitBtn, { backgroundColor: COLORS.brand, opacity: submitting ? 0.6 : 1 }]}
                            onPress={submitPss4}
                            disabled={submitting}
                        >
                            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>
                                {pss4Saved ? 'Update PSS-4 Survey' : 'Submit PSS-4 Survey'}
                            </Text>}
                        </TouchableOpacity>
                    </View>
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    tabRow: { flexDirection: 'row', gap: 8, padding: 16, paddingBottom: 8 },
    tabBtn: { flex: 1, paddingVertical: 12, borderRadius: 14, borderWidth: 1, alignItems: 'center' },
    tabBtnText: { fontSize: 12, fontWeight: '800' },
    scroll: { padding: 16, paddingTop: 8, paddingBottom: 40 },
    messageBox: { padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 12 },
    card: { borderRadius: 18, borderWidth: 1, padding: 18, marginBottom: 14 },
    cardTitle: { fontSize: 16, fontWeight: '800' },
    cardSub: { fontSize: 12, marginTop: 4 },
    hint: { fontSize: 11 },
    bigScore: { fontSize: 32, fontWeight: '900', textAlign: 'center', marginTop: 16, marginBottom: 12 },
    likertRow: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
    likertBtn: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    submitBtn: { marginTop: 18, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
    submitBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
    scoreRow: { borderRadius: 14, borderWidth: 1, padding: 14, alignItems: 'center', marginTop: 12 },
    editBtn: { marginTop: 14, borderRadius: 12, borderWidth: 1, paddingVertical: 12, alignItems: 'center' },
    question: { fontSize: 13, lineHeight: 19, marginBottom: 12 },
    optionsGrid: { flexDirection: 'row', gap: 4 },
    optionBtn: { flex: 1, paddingVertical: 8, paddingHorizontal: 2, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
});
