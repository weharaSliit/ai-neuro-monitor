import React, { useState, useEffect, useRef } from 'react';
import { useTheme } from '../context/ThemeContext';
import { BottomNav } from '../components/BottomNav';
import { Wind, BookOpen, Lightbulb, ChevronRight, Pause, Play, RotateCcw, AlertTriangle } from 'lucide-react';
import { db } from '../firebase';
import { ref, onValue, query, limitToLast } from 'firebase/database';
import { PHENOTYPING_USER_ID } from './PhenotypingDashboard';

const DID_YOU_KNOW = [
    { emoji: '⌨️', fact: 'Your typing speed drops 15–20% before you consciously feel stressed (Gjoreski et al., 2017).' },
    { emoji: '🧠', fact: 'Pre-stress detection gives you a 30–60 minute early warning before peak stress hits.' },
    { emoji: '📱', fact: 'People unlock their phones 2–3× more when anxious — even without any reason to check.' },
    { emoji: '🔔', fact: 'Notification response delay increases by 400% during pre-stress episodes.' },
    { emoji: '🧬', fact: 'Your behavioral baseline adapts to you over time using Exponential Moving Average — it never goes stale.' },
    { emoji: '🛡️', fact: 'PhenoCare freezes your baseline during stress episodes to prevent data contamination.' },
];

const MOOD_OPTIONS = [
    { emoji: '😊', label: 'Great', value: 5 },
    { emoji: '😌', label: 'Good', value: 4 },
    { emoji: '😐', label: 'Okay', value: 3 },
    { emoji: '😟', label: 'Stressed', value: 2 },
    { emoji: '😰', label: 'Very stressed', value: 1 },
];

export function Toolkit() {
    const { t, isDark } = useTheme();
    const [activeSection, setActiveSection] = useState(null);
    const [moodSelected, setMoodSelected] = useState(null);
    const [moodSaved, setMoodSaved] = useState(false);
    const [breathPhase, setBreathPhase] = useState('idle');
    const [breathTimer, setBreathTimer] = useState(0);
    const [breathRunning, setBreathRunning] = useState(false);
    const [factIndex, setFactIndex] = useState(0);
    const breathRef = useRef(null);

    // T7-B: Live stress state from Firebase → auto-suggest guidance
    const [stressAlert, setStressAlert] = useState(null); // null | { score, label, action }
    const [alertDismissed, setAlertDismissed] = useState(false);

    useEffect(() => {
        const predictionsRef = query(
            ref(db, `phenotyping/predictions/${PHENOTYPING_USER_ID}`),
            limitToLast(1)
        );
        const unsub = onValue(predictionsRef, (snap) => {
            const val = snap.val();
            if (!val) return;
            const latest = Object.values(val)[0];
            const score = latest?.stress_score ?? 0;

            if (score > 0.5) {
                const action = score >= 0.7 ? 'mindfulness' : 'breathing';
                setStressAlert({ score, label: latest.label, action });
                setAlertDismissed(false); // reset so banner re-shows on new spike
            } else {
                setStressAlert(null);
            }
        });
        return () => unsub();
    }, []);

    // Breathing exercise logic
    useEffect(() => {
        if (!breathRunning) return;

        const phases = [
            { name: 'inhale', duration: 4, label: 'Breathe in...' },
            { name: 'hold', duration: 4, label: 'Hold...' },
            { name: 'exhale', duration: 4, label: 'Breathe out...' },
        ];

        let elapsed = 0;
        let phaseIdx = 0;
        setBreathPhase(phases[0].name);

        breathRef.current = setInterval(() => {
            elapsed++;
            setBreathTimer(elapsed);

            // Determine current phase
            const cycleTime = elapsed % 12;
            if (cycleTime < 4) {
                phaseIdx = 0;
            } else if (cycleTime < 8) {
                phaseIdx = 1;
            } else {
                phaseIdx = 2;
            }
            setBreathPhase(phases[phaseIdx].name);
        }, 1000);

        return () => clearInterval(breathRef.current);
    }, [breathRunning]);

    const stopBreathing = () => {
        setBreathRunning(false);
        setBreathPhase('idle');
        setBreathTimer(0);
        clearInterval(breathRef.current);
    };

    const getBreathLabel = () => {
        if (breathPhase === 'inhale') return 'Breathe in...';
        if (breathPhase === 'hold') return 'Hold...';
        if (breathPhase === 'exhale') return 'Breathe out...';
        return 'Tap to start';
    };

    const getBreathScale = () => {
        if (breathPhase === 'inhale') return 'scale-[1.4]';
        if (breathPhase === 'hold') return 'scale-[1.4]';
        if (breathPhase === 'exhale') return 'scale-[1.0]';
        return 'scale-[1.0]';
    };

    const saveMood = () => {
        setMoodSaved(true);
        setTimeout(() => setMoodSaved(false), 2000);
    };

    return (
        <div className={`h-screen ${t.bg} ${t.text} flex flex-col font-sans pb-24 overflow-y-auto hide-scrollbar max-w-md mx-auto shadow-2xl relative`}>
            {/* Header */}
            <div className="px-5 pt-5 pb-2 animate-fade-in">
                <h1 className={`text-xl font-bold ${t.text} mb-1`}>Toolkit</h1>
                <p className={`text-xs ${t.textMuted}`}>Self-care tools and stress management</p>
            </div>

            {/* T7-B: Stress-triggered guidance banner */}
            {stressAlert && !alertDismissed && (
                <div
                    className={`mx-5 mb-3 p-4 rounded-2xl border animate-fade-in-up ${
                        isDark ? 'bg-[#1a1228] border-[#7c6bf7]/40' : 'bg-indigo-50 border-indigo-300'
                    }`}
                    style={{ boxShadow: isDark ? '0 0 24px rgba(124,107,247,0.12)' : 'none' }}
                >
                    <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                            <AlertTriangle size={15} className="text-[#f59e0b] shrink-0 mt-0.5" />
                            <span className={`text-xs font-bold ${
                                isDark ? 'text-[#c0c0d8]' : 'text-indigo-800'
                            }`}>
                                Pre-stress detected by PhenoCare
                            </span>
                        </div>
                        <button
                            onClick={() => setAlertDismissed(true)}
                            className={`text-[10px] font-bold ${t.textDim} shrink-0`}
                        >
                            ✕
                        </button>
                    </div>
                    <p className={`text-[11px] leading-relaxed mb-3 ${
                        isDark ? 'text-gray-400' : 'text-indigo-700/80'
                    }`}>
                        Your behavioral signals show stress score&nbsp;
                        <strong>{Math.round(stressAlert.score * 100)}/100</strong>.
                        {stressAlert.action === 'breathing'
                            ? ' A short breathing exercise can help reset your focus.'
                            : ' Consider a mindfulness break — your readings are significantly elevated.'}
                    </p>
                    <button
                        onClick={() => {
                            setAlertDismissed(true);
                            setBreathRunning(true); // auto-start breathing exercise
                        }}
                        className="flex items-center gap-1.5 text-[11px] font-bold text-[#7c6bf7] active:opacity-70"
                    >
                        <Wind size={13} />
                        Start breathing exercise now →
                    </button>
                </div>
            )}

            <div className="px-5 flex-1 stagger-children">
                {/* Breathing Exercise */}
                <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-5 mb-3`}>
                    <div className="flex items-center gap-2 mb-4">
                        <Wind size={18} className="text-[#7c6bf7]" />
                        <h3 className={`text-sm font-bold ${t.text}`}>Box Breathing</h3>
                        <span className={`text-[10px] ${t.textMuted}`}>4-4-4 pattern</span>
                    </div>

                    {/* Breathing Circle */}
                    <div className="flex flex-col items-center py-4">
                        <div className={`w-28 h-28 rounded-full border-4 flex items-center justify-center transition-all duration-[4000ms] ease-in-out ${getBreathScale()} ${isDark ? 'border-[#7c6bf7]/40 bg-[#7c6bf7]/10' : 'border-indigo-300 bg-indigo-50'}`}
                            style={breathRunning ? { boxShadow: `0 0 40px rgba(124,107,247,0.2)` } : {}}
                        >
                            <span className={`text-sm font-bold ${t.accent}`}>{getBreathLabel()}</span>
                        </div>

                        {breathRunning && (
                            <p className={`text-xs ${t.textMuted} mt-3`}>
                                {Math.floor(breathTimer / 60)}:{(breathTimer % 60).toString().padStart(2, '0')} elapsed
                            </p>
                        )}

                        <div className="flex gap-3 mt-4">
                            <button
                                onClick={() => breathRunning ? setBreathRunning(false) : setBreathRunning(true)}
                                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#7c6bf7] text-white text-sm font-bold active:scale-95 transition-transform"
                            >
                                {breathRunning ? <Pause size={16} /> : <Play size={16} />}
                                {breathRunning ? 'Pause' : 'Start'}
                            </button>
                            {breathTimer > 0 && (
                                <button onClick={stopBreathing} className={`p-2.5 rounded-xl ${t.card} border ${t.cardBorder}`}>
                                    <RotateCcw size={16} className={t.textMuted} />
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Quick Mood Log */}
                <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-5 mb-3`}>
                    <h3 className={`text-sm font-bold ${t.text} mb-1`}>How are you feeling right now?</h3>
                    <p className={`text-[11px] ${t.textMuted} mb-4`}>Your mood helps validate stress predictions</p>

                    <div className="flex justify-between mb-4">
                        {MOOD_OPTIONS.map((m) => (
                            <button
                                key={m.value}
                                onClick={() => setMoodSelected(m.value)}
                                className={`flex flex-col items-center gap-1.5 p-2.5 rounded-xl transition-all active:scale-90 ${moodSelected === m.value
                                    ? `${isDark ? 'bg-[#7c6bf7]/15 ring-2 ring-[#7c6bf7]/40' : 'bg-indigo-50 ring-2 ring-indigo-300'}`
                                    : ''}`}
                            >
                                <span className="text-2xl">{m.emoji}</span>
                                <span className={`text-[9px] font-bold ${moodSelected === m.value ? t.accent : t.textDim}`}>{m.label}</span>
                            </button>
                        ))}
                    </div>

                    {moodSelected && (
                        <button
                            onClick={saveMood}
                            className={`w-full py-3 rounded-xl text-sm font-bold transition-all active:scale-[0.98] ${moodSaved
                                ? `${t.successBg} ${t.successText}`
                                : 'bg-[#7c6bf7] text-white'}`}
                        >
                            {moodSaved ? '✓ Saved!' : 'Save mood'}
                        </button>
                    )}
                </div>

                {/* Weekly Summary */}
                <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-5 mb-3`}>
                    <div className="flex items-center gap-2 mb-3">
                        <BookOpen size={18} className="text-[#7c6bf7]" />
                        <h3 className={`text-sm font-bold ${t.text}`}>Weekly Summary</h3>
                    </div>
                    <div className="space-y-2.5">
                        {[
                            { label: 'Most stressful day', value: 'Wednesday', emoji: '😟' },
                            { label: 'Calmest day', value: 'Sunday', emoji: '😊' },
                            { label: 'Pre-stress alerts', value: '3 this week', emoji: '⚠️' },
                            { label: 'Mood logs', value: '5 of 7 days', emoji: '📝' },
                        ].map((item, i) => (
                            <div key={i} className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span>{item.emoji}</span>
                                    <span className={`text-sm ${t.textSecondary}`}>{item.label}</span>
                                </div>
                                <span className={`text-sm font-bold ${t.text}`}>{item.value}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Did You Know? */}
                <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-5 mb-3`}>
                    <div className="flex items-center gap-2 mb-3">
                        <Lightbulb size={18} className="text-yellow-400" />
                        <h3 className={`text-sm font-bold ${t.text}`}>Did You Know?</h3>
                    </div>
                    <div className={`p-4 rounded-xl ${isDark ? 'bg-[#0f0f14]' : 'bg-[#f2f2f7]'}`}>
                        <span className="text-2xl block mb-2">{DID_YOU_KNOW[factIndex].emoji}</span>
                        <p className={`text-sm leading-relaxed ${t.textSecondary}`}>
                            {DID_YOU_KNOW[factIndex].fact}
                        </p>
                    </div>
                    <button
                        onClick={() => setFactIndex((factIndex + 1) % DID_YOU_KNOW.length)}
                        className="flex items-center gap-1 mt-3 text-[11px] font-bold text-[#7c6bf7] active:opacity-70"
                    >
                        Next fact <ChevronRight size={14} />
                    </button>
                </div>
            </div>

            <BottomNav />
        </div>
    );
}
