import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
    ChevronLeft, CheckCircle2, Heart, Zap, Sparkles, Send, Edit3, Clock, Calendar, RefreshCw
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { getUserProfile } from '../utils/userStorage';

const FLASK_BASE_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:5002";

const PSS4_QUESTIONS = [
    {
        id: 'control',
        question: "In the last week, how often have you felt that you were unable to control the important things in your life?",
        reverse: false
    },
    {
        id: 'confident',
        question: "In the last week, how often have you felt confident about your ability to handle your personal problems?",
        reverse: true
    },
    {
        id: 'going_way',
        question: "In the last week, how often have you felt that things were going your way?",
        reverse: true
    },
    {
        id: 'difficulties',
        question: "In the last week, how often have you felt difficulties were piling up so high that you could not overcome them?",
        reverse: false
    }
];

const LIKERT_OPTIONS = [
    { label: "Never", value: 0 },
    { label: "Almost Never", value: 1 },
    { label: "Sometimes", value: 2 },
    { label: "Fairly Often", value: 3 },
    { label: "Very Often", value: 4 }
];

export function EmaSurvey() {
    const navigate = useNavigate();
    const location = useLocation();
    const { t } = useTheme();

    const [tab, setTab] = useState('siss'); // 'siss' (Quick Check) or 'pss4' (Weekly Survey)
    const [sissScore, setSissScore] = useState(3);
    const [lastSiss, setLastSiss] = useState(null);

    const [pssAnswers, setPssAnswers] = useState({ 0: 2, 1: 2, 2: 2, 3: 2 });
    const [pss4SavedData, setPss4SavedData] = useState(null);
    const [isEditingPss4, setIsEditingPss4] = useState(true);

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitSuccess, setSubmitSuccess] = useState(null);
    const [pss4NextDate, setPss4NextDate] = useState('');

    const profile = getUserProfile();
    const USER_ID = profile?.userId;

    // Read tab parameter from URL if opened via push notification (e.g. /ema-survey?tab=pss4)
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const urlTab = params.get('tab');
        if (urlTab === 'pss4' || urlTab === 'siss') {
            setTab(urlTab);
        }
    }, [location.search]);

    // Load SISS and PSS-4 local history on mount
    useEffect(() => {
        if (!USER_ID) return;

        // Load SISS last check-in
        const savedSiss = localStorage.getItem(`siss_last_checkin_${USER_ID}`);
        if (savedSiss) {
            try {
                setLastSiss(JSON.parse(savedSiss));
            } catch (e) {
                console.error("Failed to parse SISS history", e);
            }
        }

        // Calculate current week number
        const now = new Date();
        const startOfYear = new Date(now.getFullYear(), 0, 1);
        const currentWeekNum = Math.ceil(((now - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);

        // Calculate next Sunday date string
        const nextSun = new Date();
        nextSun.setDate(nextSun.getDate() + (7 - nextSun.getDay()));
        setPss4NextDate(nextSun.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }));

        // Load PSS-4 saved data for current week
        const savedPss4 = localStorage.getItem(`pss4_saved_data_${USER_ID}`);
        if (savedPss4) {
            try {
                const parsed = JSON.parse(savedPss4);
                if (parsed.weekNum === currentWeekNum) {
                    setPss4SavedData(parsed);
                    if (parsed.answers) {
                        setPssAnswers(parsed.answers);
                    }
                    setIsEditingPss4(false); // Show completed summary card by default if already submitted this week
                }
            } catch (e) {
                console.error("Failed to parse PSS-4 saved data", e);
            }
        }
    }, [USER_ID]);

    // Redirect unregistered users back to onboarding
    useEffect(() => {
        if (!USER_ID) navigate('/');
    }, [USER_ID]);

    // Guard: while redirect is in progress, render nothing
    if (!USER_ID) return null;

    const handleSissSubmit = async () => {
        setIsSubmitting(true);
        setSubmitSuccess(null);
        const nowIso = new Date().toISOString();

        try {
            const response = await fetch(`${FLASK_BASE_URL}/behavior/label`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: USER_ID,
                    type: 'siss',
                    score: sissScore,
                    timestamp: nowIso
                })
            });
            const data = await response.json();
            if (response.ok) {
                const checkinObj = { score: sissScore, timestamp: nowIso };
                localStorage.setItem(`siss_last_checkin_${USER_ID}`, JSON.stringify(checkinObj));
                setLastSiss(checkinObj);
                setSubmitSuccess("SISS Micro-Check Saved!");
                setTimeout(() => navigate('/dashboard'), 1200);
            } else {
                setSubmitSuccess(`Error: ${data.reason || 'Failed'}`);
            }
        } catch (err) {
            console.error("Submission Error:", err);
            const checkinObj = { score: sissScore, timestamp: nowIso };
            localStorage.setItem(`siss_last_checkin_${USER_ID}`, JSON.stringify(checkinObj));
            setLastSiss(checkinObj);
            setSubmitSuccess("Saved locally (Offline Mode)");
            setTimeout(() => navigate('/dashboard'), 1200);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handlePss4Submit = async () => {
        setIsSubmitting(true);
        setSubmitSuccess(null);

        // Calculate total PSS-4 score (0-16)
        let totalScore = 0;
        PSS4_QUESTIONS.forEach((q, idx) => {
            const raw = pssAnswers[idx] ?? 0;
            totalScore += q.reverse ? (4 - raw) : raw;
        });

        const now = new Date();
        const startOfYear = new Date(now.getFullYear(), 0, 1);
        const currentWeekNum = Math.ceil(((now - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
        const nowIso = now.toISOString();

        const pssDataObj = {
            score: totalScore,
            answers: pssAnswers,
            timestamp: nowIso,
            weekNum: currentWeekNum
        };

        try {
            const response = await fetch(`${FLASK_BASE_URL}/behavior/label`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: USER_ID,
                    type: 'pss4',
                    score: totalScore,
                    timestamp: nowIso
                })
            });
            const data = await response.json();
            if (response.ok) {
                localStorage.setItem(`pss4_saved_data_${USER_ID}`, JSON.stringify(pssDataObj));
                localStorage.setItem(`pss4_last_week_${USER_ID}`, currentWeekNum.toString());
                setPss4SavedData(pssDataObj);
                setIsEditingPss4(false);

                setSubmitSuccess(`PSS-4 Survey Saved! Score: ${totalScore}/16 — Thank you!`);
                setTimeout(() => navigate('/dashboard'), 1500);
            } else {
                setSubmitSuccess(`Error: ${data.reason || 'Failed'}`);
            }
        } catch (err) {
            console.error("Submission Error:", err);
            localStorage.setItem(`pss4_saved_data_${USER_ID}`, JSON.stringify(pssDataObj));
            localStorage.setItem(`pss4_last_week_${USER_ID}`, currentWeekNum.toString());
            setPss4SavedData(pssDataObj);
            setIsEditingPss4(false);

            setSubmitSuccess(`Saved locally (Score: ${totalScore}/16)`);
            setTimeout(() => navigate('/dashboard'), 1500);
        } finally {
            setIsSubmitting(false);
        }
    };

    const getStressCategory = (score) => {
        if (score <= 5) return { label: 'Low Stress', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' };
        if (score <= 11) return { label: 'Moderate Stress', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30' };
        return { label: 'High Stress', color: 'text-rose-400', bg: 'bg-rose-500/10 border-rose-500/30' };
    };

    return (
        <div className={`h-screen ${t.bg} flex flex-col font-sans overflow-hidden relative max-w-md mx-auto shadow-2xl`}>
            {/* Header */}
            <div className="p-4 flex items-center justify-between border-b border-white/10 z-10">
                <button
                    onClick={() => navigate('/dashboard')}
                    className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-white/80 transition-colors"
                >
                    <ChevronLeft className="w-5 h-5" />
                </button>
                <div className="text-center">
                    <h1 className="text-lg font-bold text-white flex items-center justify-center gap-2">
                        <Heart className="w-5 h-5 text-rose-400 fill-rose-400/20" />
                        Stress Check-In
                    </h1>
                    <p className="text-xs text-white/50">Ecological Momentary Assessment (EMA)</p>
                </div>
                <div className="w-9" />
            </div>

            {/* Tab Switcher */}
            <div className="px-4 pt-4 flex gap-2">
                <button
                    onClick={() => setTab('siss')}
                    className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                        tab === 'siss'
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-lg shadow-rose-500/10'
                            : 'bg-white/5 text-white/60 hover:bg-white/10'
                    }`}
                >
                    <Zap className="w-4 h-4" />
                    Quick Check (SISS)
                </button>
                <button
                    onClick={() => setTab('pss4')}
                    className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                        tab === 'pss4'
                            ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 shadow-lg shadow-indigo-500/10'
                            : 'bg-white/5 text-white/60 hover:bg-white/10'
                    }`}
                >
                    <Sparkles className="w-4 h-4" />
                    Weekly Survey (PSS-4)
                </button>
            </div>

            {/* Content Container */}
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
                {submitSuccess && (
                    <div className="p-3 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2 animate-fade-in">
                        <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                        {submitSuccess}
                    </div>
                )}

                {tab === 'siss' ? (
                    /* SISS Single-Item Stress Check */
                    <div className="space-y-6 bg-white/5 p-5 rounded-2xl border border-white/10">
                        <div className="space-y-2 text-center">
                            <span className="text-xs uppercase tracking-wider text-rose-400 font-bold">Single-Item Scale</span>
                            <h2 className="text-lg font-semibold text-white">How stressed do you feel right now?</h2>
                            <p className="text-xs text-white/50">Slide or tap to log your momentary stress level anytime.</p>
                        </div>

                        {lastSiss && (
                            <div className="p-3 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between text-xs text-white/70">
                                <div className="flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-rose-400" />
                                    <span>Last Check-In: {new Date(lastSiss.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                                <span className="font-bold text-rose-300">Score: {lastSiss.score}/5</span>
                            </div>
                        )}

                        <div className="space-y-4">
                            <div className="flex justify-between items-center px-2">
                                <span className="text-xs text-emerald-400 font-medium">1 - Calm</span>
                                <span className="text-2xl font-bold text-rose-400">{sissScore} / 5</span>
                                <span className="text-xs text-rose-400 font-medium">5 - High Stress</span>
                            </div>

                            <input
                                type="range"
                                min="1"
                                max="5"
                                step="1"
                                value={sissScore}
                                onChange={(e) => setSissScore(Number(e.target.value))}
                                className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-rose-500"
                            />

                            <div className="grid grid-cols-5 gap-1.5 pt-2">
                                {[1, 2, 3, 4, 5].map((lvl) => (
                                    <button
                                        key={lvl}
                                        onClick={() => setSissScore(lvl)}
                                        className={`py-3 rounded-xl text-xs font-bold transition-all ${
                                            sissScore === lvl
                                                ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/30 scale-105'
                                                : 'bg-white/5 text-white/60 hover:bg-white/10'
                                        }`}
                                    >
                                        {lvl}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <button
                            onClick={handleSissSubmit}
                            disabled={isSubmitting}
                            className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-rose-500 to-indigo-600 text-white font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity shadow-lg shadow-rose-500/20 disabled:opacity-50"
                        >
                            <Send className="w-4 h-4" />
                            {isSubmitting ? "Saving..." : "Submit Instant Check-In"}
                        </button>
                    </div>
                ) : (
                    /* PSS-4 4-Item Survey */
                    <div className="space-y-5">
                        {pss4SavedData && !isEditingPss4 ? (
                            /* Weekly PSS-4 Completed Summary Card */
                            <div className="space-y-5 bg-white/5 p-5 rounded-2xl border border-white/10">
                                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                                    <div className="flex items-center gap-2">
                                        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                                        <span className="text-sm font-bold text-white">This Week's PSS-4 Survey Completed</span>
                                    </div>
                                    <span className="text-[10px] text-emerald-400 font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30">
                                        Submitted
                                    </span>
                                </div>

                                <div className={`p-4 rounded-xl border ${getStressCategory(pss4SavedData.score).bg} flex items-center justify-between`}>
                                    <div>
                                        <p className="text-xs text-white/60">Perceived Stress Score</p>
                                        <p className={`text-xl font-black ${getStressCategory(pss4SavedData.score).color}`}>
                                            {pss4SavedData.score} <span className="text-xs font-normal text-white/50">/ 16</span>
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <span className={`text-xs font-bold ${getStressCategory(pss4SavedData.score).color}`}>
                                            {getStressCategory(pss4SavedData.score).label}
                                        </span>
                                    </div>
                                </div>

                                <div className="space-y-2 text-xs text-white/60">
                                    <div className="flex items-center justify-between">
                                        <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-indigo-400" /> Last Updated:</span>
                                        <span className="text-white/80">{new Date(pss4SavedData.timestamp).toLocaleDateString()} {new Date(pss4SavedData.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5 text-indigo-400" /> Next Scheduled Reminder:</span>
                                        <span className="text-white/80">{pss4NextDate || 'Next Sunday 7:00 PM'}</span>
                                    </div>
                                </div>

                                <button
                                    onClick={() => setIsEditingPss4(true)}
                                    className="w-full py-3 px-4 rounded-xl bg-white/10 hover:bg-white/15 text-white font-semibold text-xs flex items-center justify-center gap-2 transition-all border border-white/10"
                                >
                                    <Edit3 className="w-4 h-4 text-indigo-400" />
                                    Edit / Re-submit Weekly Answers
                                </button>
                            </div>
                        ) : (
                            /* PSS-4 Question Form */
                            <div className="space-y-5">
                                <div className="bg-white/5 p-4 rounded-2xl border border-white/10 flex items-center justify-between">
                                    <div>
                                        <h2 className="text-sm font-semibold text-white">PSS-4 Perceived Stress Survey</h2>
                                        <p className="text-xs text-white/50">Answer all 4 items based on feelings over the last week.</p>
                                    </div>
                                    {pss4SavedData && (
                                        <button
                                            onClick={() => setIsEditingPss4(false)}
                                            className="text-xs text-white/60 hover:text-white flex items-center gap-1 bg-white/5 px-2.5 py-1 rounded-lg border border-white/10"
                                        >
                                            <RotateCcw className="w-3 h-3" /> Cancel Edit
                                        </button>
                                    )}
                                </div>

                                {PSS4_QUESTIONS.map((q, idx) => (
                                    <div key={q.id} className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-3">
                                        <p className="text-xs font-medium text-white/90 leading-relaxed">
                                            <span className="text-indigo-400 font-bold mr-1.5">Q{idx + 1}.</span>
                                            {q.question}
                                        </p>
                                        <div className="grid grid-cols-5 gap-1">
                                            {LIKERT_OPTIONS.map((opt) => (
                                                <button
                                                    key={opt.value}
                                                    onClick={() => setPssAnswers({ ...pssAnswers, [idx]: opt.value })}
                                                    className={`py-2 px-1 rounded-lg text-[10px] font-medium leading-tight text-center transition-all ${
                                                        pssAnswers[idx] === opt.value
                                                            ? 'bg-indigo-500 text-white font-bold shadow-md shadow-indigo-500/30'
                                                            : 'bg-white/5 text-white/60 hover:bg-white/10'
                                                    }`}
                                                >
                                                    {opt.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ))}

                                <button
                                    onClick={handlePss4Submit}
                                    disabled={isSubmitting}
                                    className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity shadow-lg shadow-indigo-500/20 disabled:opacity-50"
                                >
                                    <Send className="w-4 h-4" />
                                    {isSubmitting ? "Saving..." : pss4SavedData ? "Update PSS-4 Survey" : "Submit PSS-4 Survey"}
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export default EmaSurvey;
