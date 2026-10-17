// ============================================================
// PhenotypingEmaScreen.js
// Highly Interactive Stress Check-In (EMA) & Usability Feedback Screen.
// Features:
// 1. SISS Instant Feeling: Dynamic emoji focus card, 5-level selector,
//    and 1-tap instant check-in.
// 2. Weekly PSS-4 Survey: 4 categorized question cards with 5-emoji
//    horizontal Likert tiles, submit button, and next reminder pill.
// 3. Feedback Mode: App usability & acceptance survey.
// ============================================================
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput } from 'react-native';
import ScreenBackground from '../../shared/ScreenBackground';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../physiological/config/ThemeContext';
import { COLORS as STATIC_COLORS } from '../../physiological/config/theme';
import Icon, { NAMES } from '../../shared/Icon';
import { usePhenotypingDeviceId } from '../utils/deviceIdentity';
import { API_BASE } from '../config/config';

const SISS_LEVELS = [
    { score: 1, emoji: '😌', title: 'Very Calm', desc: 'Relaxed & centered · Score 1/5', color: '#10B981' },
    { score: 2, emoji: '😊', title: 'Calm & Normal', desc: 'Standard baseline state · Score 2/5', color: '#34D399' },
    { score: 3, emoji: '😐', title: 'Moderate Stress', desc: 'Noticeable stress load · Score 3/5', color: '#FBBF24' },
    { score: 4, emoji: '😟', title: 'High Stress', desc: 'Tense & strained · Score 4/5', color: '#FB7185' },
    { score: 5, emoji: '😫', title: 'Very High Stress', desc: 'Overwhelmed & fatigued · Score 5/5', color: '#F43F5E' },
];

const PSS4_QUESTIONS = [
    {
        id: 'control',
        badge: 'Q1',
        category: 'CONTROL & OVERWHELM',
        question: 'In the last week, how often have you felt that you were unable to control the important things in your life?',
        reverse: false,
    },
    {
        id: 'confident',
        badge: 'Q2',
        category: 'CONFIDENCE & COPING',
        question: 'In the last week, how often have you felt confident about your ability to handle your personal problems?',
        reverse: true,
    },
    {
        id: 'going_way',
        badge: 'Q3',
        category: 'LIFE DIRECTION',
        question: 'In the last week, how often have you felt that things were going your way?',
        reverse: true,
    },
    {
        id: 'difficulties',
        badge: 'Q4',
        category: 'OVERWHELMING DIFFICULTIES',
        question: 'In the last week, how often have you felt difficulties were piling up so high that you could not overcome them?',
        reverse: false,
    },
];

const PSS4_OPTIONS = [
    { label: 'Never', value: 0, emoji: '🟢' },
    { label: 'Almost Never', value: 1, emoji: '🟡' },
    { label: 'Sometimes', value: 2, emoji: '🟠' },
    { label: 'Fairly Often', value: 3, emoji: '🔴' },
    { label: 'Very Often', value: 4, emoji: '🟣' },
];

const FEEDBACK_ITEMS = [
    { id: 'ease_nav', section: 'Ease of Use', question: 'The phenotyping screens (dashboard, history, alerts) were easy to navigate.' },
    { id: 'ease_understand', section: 'Ease of Use', question: 'I understood what the stress score/alerts meant without needing help.' },
    { id: 'ease_learn', section: 'Ease of Use', question: 'Learning to use the passive monitoring feature was easy.' },
    { id: 'use_value', section: 'Usefulness', question: 'The stress insights from this app are useful to me.' },
    { id: 'use_notice', section: 'Usefulness', question: "This app helps me notice stress patterns I wouldn't otherwise notice." },
    { id: 'use_recommend', section: 'Usefulness', question: 'I would recommend this feature to someone who wants to track their stress.' },
    { id: 'trust_match', section: 'Trust & Accuracy', question: 'The stress alerts matched how I actually felt at the time.' },
    { id: 'trust_confidence', section: 'Trust & Accuracy', question: "I trust the app's stress detection to be reasonably accurate." },
    { id: 'privacy_comfort', section: 'Privacy & Comfort', question: 'I feel comfortable with the app passively monitoring my typing/touch behavior in the background.' },
    { id: 'privacy_understand', section: 'Privacy & Comfort', question: 'I understand what data is being collected and why.' },
    { id: 'overall_satisfied', section: 'Overall', question: 'Overall, I am satisfied with the digital phenotyping feature.' },
    { id: 'overall_continue', section: 'Overall', question: 'I intend to keep this feature enabled going forward.' },
];

const LIKERT5_OPTIONS = [
    { label: 'Strongly Disagree', value: 1 },
    { label: 'Disagree', value: 2 },
    { label: 'Neutral', value: 3 },
    { label: 'Agree', value: 4 },
    { label: 'Strongly Agree', value: 5 },
];

function currentWeekNum() {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    return Math.ceil(((now - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
}

function getNextSundayStr() {
    const d = new Date();
    d.setDate(d.getDate() + (7 - d.getDay()) % 7 || 7);
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function stressCategory(score) {
    if (score <= 5) return { label: 'Low Stress', color: STATIC_COLORS.normal };
    if (score <= 11) return { label: 'Moderate Stress', color: STATIC_COLORS.warning };
    return { label: 'High Stress', color: STATIC_COLORS.stress };
}

export default function PhenotypingEmaScreen({ navigation, route }) {
    const { theme: t, COLORS } = useTheme();
    const deviceId = usePhenotypingDeviceId();

    const isFeedbackMode = route?.params?.mode === 'feedback' || route?.params?.initialTab === 'feedback';

    const initialTab = isFeedbackMode ? 'feedback' : (route?.params?.initialTab === 'pss4' ? 'pss4' : 'siss');
    const [tab, setTab] = useState(initialTab);
    const [sissScore, setSissScore] = useState(3);
    const [lastSiss, setLastSiss] = useState(null);

    const [pssAnswers, setPssAnswers] = useState({ 0: 2, 1: 2, 2: 2, 3: 2 });
    const [pss4Saved, setPss4Saved] = useState(null);
    const [editingPss4, setEditingPss4] = useState(true);

    const [feedbackAnswers, setFeedbackAnswers] = useState(
        Object.fromEntries(FEEDBACK_ITEMS.map((item) => [item.id, 3]))
    );
    const [feedbackComment, setFeedbackComment] = useState('');
    const [feedbackSaved, setFeedbackSaved] = useState(null);
    const [editingFeedback, setEditingFeedback] = useState(true);

    const [submitting, setSubmitting] = useState(false);
    const [message, setMessage] = useState(null);

    useEffect(() => {
        if (!deviceId) return;
        (async () => {
            const savedSiss = await AsyncStorage.getItem(`siss_last_checkin_${deviceId}`);
            if (savedSiss) { try { setLastSiss(JSON.parse(savedSiss)); } catch {} }

            const savedPss4 = await AsyncStorage.getItem(`pss4_saved_data_${deviceId}`);
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

            const savedFeedback = await AsyncStorage.getItem(`app_feedback_saved_${deviceId}`);
            if (savedFeedback) {
                try {
                    const parsed = JSON.parse(savedFeedback);
                    setFeedbackSaved(parsed);
                    if (parsed.answers) setFeedbackAnswers(parsed.answers);
                    if (parsed.comment) setFeedbackComment(parsed.comment);
                    setEditingFeedback(false);
                } catch {}
            }
        })();
    }, [deviceId]);

    const submitSiss = async () => {
        setSubmitting(true);
        setMessage(null);
        const nowIso = new Date().toISOString();
        try {
            const res = await fetch(`${API_BASE}/behavior/label`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: deviceId, type: 'siss', score: sissScore, timestamp: nowIso }),
            });
            const checkin = { score: sissScore, timestamp: nowIso };
            await AsyncStorage.setItem(`siss_last_checkin_${deviceId}`, JSON.stringify(checkin));
            setLastSiss(checkin);
            setMessage('✓ Instant feeling logged!');
            setTimeout(() => navigation.goBack(), 900);
        } catch {
            const checkin = { score: sissScore, timestamp: nowIso };
            await AsyncStorage.setItem(`siss_last_checkin_${deviceId}`, JSON.stringify(checkin));
            setLastSiss(checkin);
            setMessage('✓ Saved locally (offline)');
            setTimeout(() => navigation.goBack(), 900);
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
                body: JSON.stringify({ user_id: deviceId, type: 'pss4', score: totalScore, timestamp: nowIso }),
            });
            await AsyncStorage.setItem(`pss4_saved_data_${deviceId}`, JSON.stringify(dataObj));
            setPss4Saved(dataObj);
            setEditingPss4(false);
            setMessage(`✓ PSS-4 Survey logged! Score: ${totalScore}/16`);
            setTimeout(() => navigation.goBack(), 1100);
        } catch {
            await AsyncStorage.setItem(`pss4_saved_data_${deviceId}`, JSON.stringify(dataObj));
            setPss4Saved(dataObj);
            setEditingPss4(false);
            setMessage(`✓ Saved locally (Score: ${totalScore}/16)`);
            setTimeout(() => navigation.goBack(), 1100);
        } finally {
            setSubmitting(false);
        }
    };

    const submitFeedback = async () => {
        setSubmitting(true);
        setMessage(null);

        const sections = [...new Set(FEEDBACK_ITEMS.map((item) => item.section))];
        const subscales = {};
        sections.forEach((section) => {
            const ids = FEEDBACK_ITEMS.filter((item) => item.section === section).map((item) => item.id);
            const vals = ids.map((id) => feedbackAnswers[id] ?? 3);
            subscales[section] = Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2));
        });
        const overallScore = subscales['Overall'] || 3.0;

        const nowIso = new Date().toISOString();
        const dataObj = { answers: feedbackAnswers, comment: feedbackComment, subscales, overallScore, timestamp: nowIso };

        try {
            const res = await fetch(`${API_BASE}/behavior/feedback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: deviceId,
                    answers: feedbackAnswers,
                    subscales,
                    overall_score: overallScore,
                    comment: feedbackComment,
                    timestamp: nowIso,
                }),
            });
            await AsyncStorage.setItem(`app_feedback_saved_${deviceId}`, JSON.stringify(dataObj));
            setFeedbackSaved(dataObj);
            setEditingFeedback(false);
            setMessage('✓ Feedback submitted — thank you!');
            setTimeout(() => navigation.goBack(), 1100);
        } catch {
            await AsyncStorage.setItem(`app_feedback_saved_${deviceId}`, JSON.stringify(dataObj));
            setFeedbackSaved(dataObj);
            setEditingFeedback(false);
            setMessage('✓ Feedback saved locally (offline)');
            setTimeout(() => navigation.goBack(), 1100);
        } finally {
            setSubmitting(false);
        }
    };

    const currentLevel = SISS_LEVELS.find((l) => l.score === sissScore) || SISS_LEVELS[2];
    const feedbackSections = [...new Set(FEEDBACK_ITEMS.map((item) => item.section))];

    return (
        <ScreenBackground edges={['top', 'left', 'right']}>
            {/* Top Modal-Style Header Bar */}
            <View style={styles.topHeader}>
                <View style={styles.headerLeft}>
                    <View style={[styles.heartBadge, { backgroundColor: `${COLORS.brand}15` }]}>
                        <Icon name="pulse" size={18} color={COLORS.brand} />
                    </View>
                    <View>
                        <Text style={[styles.mainHeaderTitle, { color: t.text }]}>
                            {isFeedbackMode ? 'App Usability Feedback' : 'Stress Check-In'}
                        </Text>
                        <Text style={[styles.mainHeaderSub, { color: t.textMuted }]}>
                            {isFeedbackMode ? 'Research evaluation' : 'Ecological Momentary Assessment (EMA)'}
                        </Text>
                    </View>
                </View>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeBtn} activeOpacity={0.7}>
                    <Icon name="close" size={20} color={t.textMuted} />
                </TouchableOpacity>
            </View>

            {/* Quick Check (Daily) vs Weekly Survey Tabs */}
            {!isFeedbackMode && (
                <View style={styles.tabRowContainer}>
                    <TouchableOpacity
                        style={[
                            styles.dualTabBtn,
                            {
                                backgroundColor: tab === 'siss' ? `${COLORS.brand}15` : t.surface,
                                borderColor: tab === 'siss' ? COLORS.brand : t.border,
                            },
                        ]}
                        onPress={() => setTab('siss')}
                        activeOpacity={0.85}
                    >
                        <View style={styles.tabTitleRow}>
                            <Text style={{ fontSize: 13, marginRight: 5 }}>⚡</Text>
                            <Text style={[styles.tabTitleText, { color: tab === 'siss' ? COLORS.brand : t.text }]}>Quick Check</Text>
                        </View>
                        <Text style={[styles.tabSubText, { color: tab === 'siss' ? COLORS.brand : t.textMuted }]}>Right Now (SISS)</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[
                            styles.dualTabBtn,
                            {
                                backgroundColor: tab === 'pss4' ? `${COLORS.brand}15` : t.surface,
                                borderColor: tab === 'pss4' ? COLORS.brand : t.border,
                            },
                        ]}
                        onPress={() => setTab('pss4')}
                        activeOpacity={0.85}
                    >
                        <View style={styles.tabTitleRow}>
                            <Text style={{ fontSize: 13, marginRight: 5 }}>📋</Text>
                            <Text style={[styles.tabTitleText, { color: tab === 'pss4' ? COLORS.brand : t.text }]}>Weekly Survey</Text>
                        </View>
                        <Text style={[styles.tabSubText, { color: tab === 'pss4' ? COLORS.brand : t.textMuted }]}>Past 7 Days (PSS-4)</Text>
                    </TouchableOpacity>
                </View>
            )}

            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
                {message && (
                    <View style={[styles.messageBox, { backgroundColor: '#10B98120', borderColor: '#10B98150' }]}>
                        <Text style={{ color: '#10B981', fontSize: 12, fontWeight: '800' }}>{message}</Text>
                    </View>
                )}

                {/* ═════════════════════════════════════════════════════════════ */}
                {/* 1. SISS INSTANT FEELING                                       */}
                {/* ═════════════════════════════════════════════════════════════ */}
                {!isFeedbackMode && tab === 'siss' && (
                    <View style={{ marginTop: 6 }}>
                        <Text style={[styles.screenHeroTitle, { color: t.text }]}>How do you feel right now?</Text>
                        <Text style={[styles.screenHeroSub, { color: t.textMuted }]}>
                            Select your current feeling to verify passive detection
                        </Text>

                        {/* Large Interactive Focus Box */}
                        <View style={[styles.sissFocusBox, { backgroundColor: t.surface, borderColor: currentLevel.color + '60' }]}>
                            <Text style={styles.hugeEmoji}>{currentLevel.emoji}</Text>
                            <Text style={[styles.focusTitle, { color: currentLevel.color }]}>{currentLevel.title}</Text>
                            <Text style={[styles.focusDesc, { color: t.textMuted }]}>{currentLevel.desc}</Text>
                        </View>

                        {/* 5-Level Selector Tiles */}
                        <Text style={[styles.selectorLabel, { color: t.textMuted }]}>SELECT LEVEL (1 = CALM, 5 = HIGH STRESS)</Text>
                        <View style={styles.emojiTilesRow}>
                            {SISS_LEVELS.map((item) => {
                                const selected = sissScore === item.score;
                                return (
                                    <TouchableOpacity
                                        key={item.score}
                                        style={[
                                            styles.emojiTile,
                                            {
                                                backgroundColor: selected ? item.color : t.surface,
                                                borderColor: selected ? item.color : t.border,
                                            },
                                        ]}
                                        onPress={() => setSissScore(item.score)}
                                        activeOpacity={0.8}
                                    >
                                        <Text style={styles.tileEmoji}>{item.emoji}</Text>
                                        <Text style={[styles.tileScore, { color: selected ? '#FFF' : t.textMuted }]}>
                                            {item.score}
                                        </Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>

                        {/* Instant Check-in Action Button */}
                        <TouchableOpacity
                            style={[styles.gradientBtn, { backgroundColor: COLORS.brand, opacity: submitting ? 0.6 : 1 }]}
                            onPress={submitSiss}
                            disabled={submitting}
                            activeOpacity={0.85}
                        >
                            <Text style={styles.gradientBtnText}>
                                {submitting ? 'Saving…' : '✓ Record Stress Check-In'}
                            </Text>
                        </TouchableOpacity>
                    </View>
                )}

                {/* ═════════════════════════════════════════════════════════════ */}
                {/* 2. PSS-4 WEEKLY SURVEY (Matching Screenshot 2)               */}
                {/* ═════════════════════════════════════════════════════════════ */}
                {!isFeedbackMode && tab === 'pss4' && (
                    <View style={{ marginTop: 6 }}>
                        {pss4Saved && !editingPss4 ? (
                            <View style={[styles.savedCard, { backgroundColor: t.surface, borderColor: t.border }]}>
                                <Text style={[styles.savedTitle, { color: t.text }]}>Completed for Week {pss4Saved.weekNum}</Text>
                                <Text style={[styles.savedScore, { color: stressCategory(pss4Saved.score).color }]}>
                                    {pss4Saved.score} / 16
                                </Text>
                                <Text style={[styles.savedCategory, { color: stressCategory(pss4Saved.score).color }]}>
                                    {stressCategory(pss4Saved.score).label}
                                </Text>
                                <TouchableOpacity
                                    style={[styles.retakeBtn, { borderColor: t.border, backgroundColor: t.pillBg }]}
                                    onPress={() => setEditingPss4(true)}
                                    activeOpacity={0.8}
                                >
                                    <Text style={{ fontSize: 12, fontWeight: '800', color: COLORS.brand }}>Retake Survey</Text>
                                </TouchableOpacity>
                            </View>
                        ) : (
                            <>
                                {PSS4_QUESTIONS.map((q, idx) => (
                                    <View key={q.id} style={[styles.pss4Card, { backgroundColor: t.surface, borderColor: t.border }]}>
                                        <View style={styles.pss4HeaderRow}>
                                            <View style={[styles.qBadge, { backgroundColor: '#6366F125' }]}>
                                                <Text style={[styles.qBadgeText, { color: '#818CF8' }]}>{q.badge}</Text>
                                            </View>
                                            <Text style={[styles.qCategory, { color: '#818CF8' }]}>{q.category}</Text>
                                        </View>

                                        <Text style={[styles.pss4QuestionText, { color: t.text }]}>{q.question}</Text>

                                        {/* 5 Horizontal Options per question */}
                                        <View style={styles.pss4OptionRow}>
                                            {PSS4_OPTIONS.map((opt) => {
                                                const selected = pssAnswers[idx] === opt.value;
                                                return (
                                                    <TouchableOpacity
                                                        key={opt.value}
                                                        style={[
                                                            styles.pss4OptionBtn,
                                                            {
                                                                backgroundColor: selected ? '#6366F1' : t.pillBg,
                                                                borderColor: selected ? '#6366F1' : t.border,
                                                            },
                                                        ]}
                                                        onPress={() => setPssAnswers((prev) => ({ ...prev, [idx]: opt.value }))}
                                                        activeOpacity={0.8}
                                                    >
                                                        <Text style={styles.pss4OptEmoji}>{opt.emoji}</Text>
                                                        <Text
                                                            style={[
                                                                styles.pss4OptLabel,
                                                                { color: selected ? '#FFF' : t.textMuted, fontWeight: selected ? '850' : '650' },
                                                            ]}
                                                            numberOfLines={1}
                                                        >
                                                            {opt.label}
                                                        </Text>
                                                    </TouchableOpacity>
                                                );
                                            })}
                                        </View>
                                    </View>
                                ))}

                                {/* Submit Weekly PSS-4 Button */}
                                <TouchableOpacity
                                    style={[styles.gradientBtn, { backgroundColor: '#6366F1', opacity: submitting ? 0.6 : 1 }]}
                                    onPress={submitPss4}
                                    disabled={submitting}
                                    activeOpacity={0.85}
                                >
                                    <Text style={styles.gradientBtnText}>
                                        {submitting ? 'Recording…' : '✈️ Submit Weekly PSS-4 Survey'}
                                    </Text>
                                </TouchableOpacity>

                                {/* Next Scheduled Reminder Pill */}
                                <View style={[styles.reminderPill, { backgroundColor: t.surface, borderColor: t.border }]}>
                                    <View style={styles.reminderLeft}>
                                        <View style={[styles.calendarIconBox, { backgroundColor: '#6366F120' }]}>
                                            <Text style={{ fontSize: 14 }}>📅</Text>
                                        </View>
                                        <View>
                                            <Text style={[styles.reminderLabel, { color: t.textMuted }]}>NEXT SCHEDULED REMINDER</Text>
                                            <Text style={[styles.reminderDate, { color: t.text }]}>{getNextSundayStr()}</Text>
                                        </View>
                                    </View>
                                    <View style={[styles.reminderBadge, { backgroundColor: '#6366F120' }]}>
                                        <Text style={[styles.reminderBadgeText, { color: '#818CF8' }]}>Weekly</Text>
                                    </View>
                                </View>
                            </>
                        )}
                    </View>
                )}

                {/* ═════════════════════════════════════════════════════════════ */}
                {/* 3. FEEDBACK FORM (Clean & Focused Research Evaluation)        */}
                {/* ═════════════════════════════════════════════════════════════ */}
                {isFeedbackMode && (
                    <View style={{ paddingHorizontal: 16, paddingBottom: 24 }}>
                        {feedbackSaved && !editingFeedback ? (
                            <View style={[styles.feedbackCard, { backgroundColor: t.surface, borderColor: t.border, alignItems: 'center', padding: 20 }]}>
                                <Text style={{ fontSize: 24, marginBottom: 6 }}>✨</Text>
                                <Text style={{ fontSize: 15, fontWeight: '850', color: t.text }}>Thank You for Your Feedback</Text>
                                <Text style={{ fontSize: 12, color: t.textMuted, marginTop: 4, textAlign: 'center' }}>
                                    Your response helps evaluate and validate the digital phenotyping model.
                                </Text>
                                <TouchableOpacity
                                    style={[styles.retakeBtn, { borderColor: t.border, marginTop: 14, backgroundColor: t.pillBg }]}
                                    onPress={() => setEditingFeedback(true)}
                                >
                                    <Text style={{ fontSize: 12, fontWeight: '800', color: COLORS.brand }}>Edit Responses</Text>
                                </TouchableOpacity>
                            </View>
                        ) : (
                            <>
                                {feedbackSections.map((sec, sIdx) => {
                                    const meta = {
                                        'Ease of Use': { icon: '📱', color: '#6366F1' },
                                        'Usefulness': { icon: '💡', color: '#F59E0B' },
                                        'Trust & Accuracy': { icon: '🎯', color: '#10B981' },
                                        'Privacy & Comfort': { icon: '🔒', color: '#8B5CF6' },
                                        'Overall': { icon: '⭐', color: '#EC4899' },
                                    }[sec] || { icon: '📋', color: COLORS.brand };

                                    return (
                                        <View
                                            key={sec}
                                            style={[
                                                styles.feedbackCard,
                                                {
                                                    backgroundColor: t.surface,
                                                    borderColor: t.border,
                                                    marginBottom: 12,
                                                },
                                            ]}
                                        >
                                            {/* Section Header */}
                                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                                                <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: `${meta.color}15`, alignItems: 'center', justifyContent: 'center' }}>
                                                    <Text style={{ fontSize: 13 }}>{meta.icon}</Text>
                                                </View>
                                                <Text style={{ fontSize: 12.5, fontWeight: '900', color: t.text, letterSpacing: 0.3 }}>
                                                    {sec.toUpperCase()}
                                                </Text>
                                            </View>

                                            {/* Questions in this section */}
                                            {FEEDBACK_ITEMS.filter((item) => item.section === sec).map((item, qIdx) => (
                                                <View
                                                    key={item.id}
                                                    style={{
                                                        marginTop: qIdx > 0 ? 12 : 0,
                                                        paddingTop: qIdx > 0 ? 12 : 0,
                                                        borderTopWidth: qIdx > 0 ? 1 : 0,
                                                        borderTopColor: t.border,
                                                    }}
                                                >
                                                    <Text style={[styles.feedbackQuestionText, { color: t.text }]}>
                                                        {item.question}
                                                    </Text>

                                                    {/* Likert 1-5 Row */}
                                                    <View style={styles.likert5Row}>
                                                        {LIKERT5_OPTIONS.map((opt) => {
                                                            const isSelected = feedbackAnswers[item.id] === opt.value;
                                                            return (
                                                                <TouchableOpacity
                                                                    key={opt.value}
                                                                    style={[
                                                                        styles.likert5Btn,
                                                                        {
                                                                            backgroundColor: isSelected ? COLORS.brand : t.pillBg,
                                                                            borderColor: isSelected ? COLORS.brand : t.border,
                                                                        },
                                                                    ]}
                                                                    onPress={() => setFeedbackAnswers((prev) => ({ ...prev, [item.id]: opt.value }))}
                                                                    activeOpacity={0.8}
                                                                >
                                                                    <Text
                                                                        style={{
                                                                            fontSize: 11,
                                                                            fontWeight: isSelected ? '900' : '700',
                                                                            color: isSelected ? '#FFFFFF' : t.textMuted,
                                                                        }}
                                                                    >
                                                                        {opt.value}
                                                                    </Text>
                                                                </TouchableOpacity>
                                                            );
                                                        })}
                                                    </View>
                                                    <View style={styles.rowBetween}>
                                                        <Text style={{ fontSize: 9, color: t.textMuted }}>1 · Disagree</Text>
                                                        <Text style={{ fontSize: 9, color: t.textMuted }}>5 · Agree</Text>
                                                    </View>
                                                </View>
                                            ))}
                                        </View>
                                    );
                                })}

                                {/* Additional Comments Box */}
                                <View style={[styles.feedbackCard, { backgroundColor: t.surface, borderColor: t.border, marginBottom: 14 }]}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                        <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: '#6366F115', alignItems: 'center', justifyContent: 'center' }}>
                                            <Text style={{ fontSize: 13 }}>💬</Text>
                                        </View>
                                        <Text style={{ fontSize: 12.5, fontWeight: '900', color: t.text }}>COMMENTS (OPTIONAL)</Text>
                                    </View>
                                    <TextInput
                                        style={[styles.textArea, { backgroundColor: t.pillBg, borderColor: t.border, color: t.text }]}
                                        placeholder="Any observations, suggestions, or comments…"
                                        placeholderTextColor={t.textMuted}
                                        multiline
                                        numberOfLines={3}
                                        value={feedbackComment}
                                        onChangeText={setFeedbackComment}
                                    />
                                </View>

                                {/* Submit Button */}
                                <TouchableOpacity
                                    style={[styles.gradientBtn, { backgroundColor: COLORS.brand, opacity: submitting ? 0.6 : 1 }]}
                                    onPress={submitFeedback}
                                    disabled={submitting}
                                    activeOpacity={0.85}
                                >
                                    <Text style={styles.gradientBtnText}>{submitting ? 'Submitting…' : 'Submit Feedback →'}</Text>
                                </TouchableOpacity>
                            </>
                        )}
                    </View>
                )}
            </ScrollView>
        </ScreenBackground>
    );
}

const styles = StyleSheet.create({
    topHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingTop: 10,
        paddingBottom: 10,
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    heartBadge: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
    },
    mainHeaderTitle: {
        fontSize: 16,
        fontWeight: '900',
        letterSpacing: -0.2,
    },
    mainHeaderSub: {
        fontSize: 11,
        marginTop: 1,
    },
    closeBtn: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    tabRowContainer: {
        flexDirection: 'row',
        gap: 10,
        paddingHorizontal: 20,
        marginBottom: 8,
    },
    dualTabBtn: {
        flex: 1,
        borderRadius: 16,
        borderWidth: 1.5,
        paddingVertical: 10,
        paddingHorizontal: 12,
        alignItems: 'center',
    },
    tabTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    tabTitleText: {
        fontSize: 13,
        fontWeight: '850',
    },
    tabSubText: {
        fontSize: 10,
        marginTop: 2,
        fontWeight: '600',
    },
    scroll: {
        paddingHorizontal: 20,
        paddingBottom: 60,
    },
    sectionLabelPink: {
        fontSize: 10.5,
        fontWeight: '900',
        letterSpacing: 1,
        color: '#FB7185',
        textAlign: 'center',
        marginBottom: 4,
    },
    screenHeroTitle: {
        fontSize: 18,
        fontWeight: '900',
        textAlign: 'center',
        letterSpacing: -0.3,
        marginBottom: 4,
    },
    screenHeroSub: {
        fontSize: 11.5,
        textAlign: 'center',
        marginBottom: 16,
    },
    sissFocusBox: {
        borderRadius: 22,
        borderWidth: 1.5,
        paddingVertical: 20,
        alignItems: 'center',
        marginBottom: 18,
    },
    hugeEmoji: {
        fontSize: 54,
        marginBottom: 8,
    },
    focusTitle: {
        fontSize: 17,
        fontWeight: '900',
        marginBottom: 4,
    },
    focusDesc: {
        fontSize: 11.5,
        fontWeight: '600',
    },
    selectorLabel: {
        fontSize: 10,
        fontWeight: '900',
        letterSpacing: 0.8,
        marginBottom: 10,
    },
    emojiTilesRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 8,
        marginBottom: 20,
    },
    emojiTile: {
        flex: 1,
        aspectRatio: 0.95,
        borderRadius: 16,
        borderWidth: 1.5,
        alignItems: 'center',
        justifyContent: 'center',
    },
    tileEmoji: {
        fontSize: 22,
        marginBottom: 4,
    },
    tileScore: {
        fontSize: 11,
        fontWeight: '850',
    },
    gradientBtn: {
        borderRadius: 16,
        paddingVertical: 14,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 6,
        elevation: 4,
    },
    gradientBtnText: {
        color: '#FFF',
        fontSize: 13.5,
        fontWeight: '900',
        letterSpacing: 0.2,
    },
    pss4Card: {
        borderRadius: 20,
        borderWidth: 1,
        padding: 14,
        marginBottom: 12,
    },
    pss4HeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 8,
    },
    qBadge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
    },
    qBadgeText: {
        fontSize: 9.5,
        fontWeight: '900',
    },
    qCategory: {
        fontSize: 9.5,
        fontWeight: '900',
        letterSpacing: 0.5,
    },
    pss4QuestionText: {
        fontSize: 12,
        fontWeight: '750',
        lineHeight: 17,
        marginBottom: 12,
    },
    pss4OptionRow: {
        flexDirection: 'row',
        gap: 6,
    },
    pss4OptionBtn: {
        flex: 1,
        borderRadius: 12,
        borderWidth: 1,
        paddingVertical: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    pss4OptEmoji: {
        fontSize: 14,
        marginBottom: 2,
    },
    pss4OptLabel: {
        fontSize: 8.5,
    },
    reminderPill: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderRadius: 18,
        borderWidth: 1,
        padding: 12,
        marginTop: 14,
    },
    reminderLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    calendarIconBox: {
        width: 32,
        height: 32,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    reminderLabel: {
        fontSize: 9,
        fontWeight: '900',
        letterSpacing: 0.5,
    },
    reminderDate: {
        fontSize: 12,
        fontWeight: '800',
        marginTop: 1,
    },
    reminderBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 8,
    },
    reminderBadgeText: {
        fontSize: 10,
        fontWeight: '850',
    },
    savedCard: {
        borderRadius: 20,
        borderWidth: 1,
        padding: 18,
        alignItems: 'center',
    },
    savedTitle: {
        fontSize: 13,
        fontWeight: '800',
    },
    savedScore: {
        fontSize: 28,
        fontWeight: '900',
        marginVertical: 6,
    },
    savedCategory: {
        fontSize: 13,
        fontWeight: '800',
    },
    retakeBtn: {
        borderRadius: 12,
        borderWidth: 1,
        paddingVertical: 8,
        paddingHorizontal: 16,
        marginTop: 12,
    },
    feedbackCard: {
        borderRadius: 20,
        borderWidth: 1,
        padding: 16,
    },
    sectionHeading: {
        fontSize: 11.5,
        fontWeight: '900',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 4,
    },
    feedbackQuestionText: {
        fontSize: 11.5,
        fontWeight: '750',
        lineHeight: 16,
    },
    likert5Row: {
        flexDirection: 'row',
        gap: 6,
        marginVertical: 6,
    },
    likert5Btn: {
        flex: 1,
        height: 32,
        borderRadius: 8,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    textArea: {
        borderRadius: 12,
        borderWidth: 1,
        padding: 10,
        fontSize: 11.5,
        textAlignVertical: 'top',
        minHeight: 65,
        marginTop: 6,
    },
    messageBox: {
        borderRadius: 12,
        borderWidth: 1,
        padding: 10,
        marginBottom: 12,
        alignItems: 'center',
    },
    rowBetween: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
});
