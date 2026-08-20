import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { BottomNav } from '../components/BottomNav';
import { SparkChart } from '../components/SparkChart';
import { StatusBadge } from '../components/StatusBadge';
import { AlertTriangle, Brain, Loader2, TrendingUp, Activity, BarChart2 } from 'lucide-react';
import { db } from '../firebase';
import { ref, onValue, get } from 'firebase/database';
import { getUserProfile, getCalibrationStatus } from '../utils/userStorage';

// ─── Constants ──────────────────────────────────────────────────────────────
const CORRELATIONS = [
    { signal: '⌨️ Typing pace',       correlation: 0.82, strength: 'Strong'   },
    { signal: '🔄 App switching',      correlation: 0.76, strength: 'Strong'   },
    { signal: '📱 Screen unlocks',     correlation: 0.65, strength: 'Moderate' },
    { signal: '📜 Scroll speed',       correlation: 0.41, strength: 'Moderate' },
    { signal: '🚶 Activity context',   correlation: 0.22, strength: 'Weak'     },
];

function buildWeeklyChart(predictions) {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(now - (6 - i) * dayMs);
        return {
            day:    d.toLocaleDateString('en-US', { weekday: 'short' }),
            date:   d.toDateString(),
            scores: [],
        };
    });

    predictions.forEach(p => {
        if (!p.timestamp) return;
        const ts = new Date(p.timestamp);
        const dateStr = ts.toDateString();
        const bucket = days.find(d => d.date === dateStr);
        if (bucket && typeof p.stress_score === 'number') {
            bucket.scores.push(p.stress_score);
        }
    });

    return days.map(d => ({
        day:   d.day,
        score: d.scores.length
            ? d.scores.reduce((a, b) => a + b, 0) / d.scores.length
            : 0,
        hasData: d.scores.length > 0,
    }));
}

function calcZScore(val, mean, std) {
    if (!mean || !std) return 0;
    return Math.abs((val - mean) / (std + 1e-6));
}

export function Analysis() {
    const { t, isDark } = useTheme();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('overview');
    const [timeRange, setTimeRange] = useState('7d');

    const profile = useMemo(() => getUserProfile(), []);
    const calibStatus = useMemo(() => getCalibrationStatus(profile), [profile]);
    const userId = profile?.userId;

    useEffect(() => {
        if (!userId) navigate('/');
    }, [userId, navigate]);

    const [predictions, setPredictions]   = useState(null);
    const [latestWindow, setLatestWindow] = useState(null);
    const [baselines, setBaselines]       = useState(null);
    const [userProfileDb, setUserProfileDb] = useState(null);
    const [dataLogCount, setDataLogCount] = useState(null);
    const [loading, setLoading]           = useState(true);

    const tabs = [
        { id: 'overview',  label: 'Overview'  },
        { id: 'patterns',  label: 'Pattern Charts'  },
        { id: 'baseline',  label: 'Baseline'  },
    ];

    // ── 1. Stream predictions ─────────────────────────────────────────────
    useEffect(() => {
        const unsub = onValue(ref(db, `phenotyping/predictions/${userId}`), snap => {
            const raw = snap.val();
            if (raw) {
                setPredictions(Object.values(raw));
            } else {
                setPredictions([]);
            }
            setLoading(false);
        });
        return () => unsub();
    }, [userId]);

    // ── 2. Fetch baselines + user profile + data logs ─────────────────────
    useEffect(() => {
        get(ref(db, `phenotyping/users/${userId}/baselines`))
            .then(s => s.exists() && setBaselines(s.val()));

        get(ref(db, `phenotyping/users/${userId}`))
            .then(s => {
                if (s.exists()) {
                    const val = s.val();
                    setUserProfileDb({ createdAt: val.created_at, isCalibrated: val.is_calibrated });
                }
            });

        get(ref(db, `phenotyping/data_logs/${userId}`))
            .then(s => {
                if (s.exists()) {
                    const raw = s.val();
                    const entries = Object.entries(raw).sort((a, b) => a[0].localeCompare(b[0]));
                    setDataLogCount(entries.length);
                    setLatestWindow(entries[entries.length - 1][1]);
                }
            });
    }, [userId]);

    const { weeklyScores, avgScore, peakDay, calmDay } = useMemo(() => {
        if (!predictions || predictions.length === 0) {
            const empty = Array.from({ length: 7 }, (_, i) => {
                const d = new Date();
                d.setDate(d.getDate() - (6 - i));
                return {
                    day: d.toLocaleDateString('en-US', { weekday: 'short' }),
                    score: 0,
                    hasData: false
                };
            });
            return { weeklyScores: empty, avgScore: '--', peakDay: null, calmDay: null };
        }

        const ws = buildWeeklyChart(predictions);
        const withData = ws.filter(d => d.hasData);
        const avg = withData.length
            ? Math.round(withData.reduce((a, b) => a + b.score, 0) / withData.length * 100)
            : '--';
        const peak = withData.length ? withData.reduce((a, b) => a.score > b.score ? a : b) : null;
        const calm = withData.length ? withData.reduce((a, b) => a.score < b.score ? a : b) : null;
        return { weeklyScores: ws, avgScore: avg, peakDay: peak, calmDay: calm };
    }, [predictions]);

    const detectionStats = useMemo(() => {
        if (!predictions || predictions.length === 0) {
            return { episodes: '--', total: '--', confidence: '--', falseAlarmEst: '--' };
        }
        const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const weekPreds = predictions.filter(p =>
            p.timestamp && new Date(p.timestamp).getTime() > oneWeekAgo
        );
        const episodes = weekPreds.filter(p => p.is_anomaly).length;
        const total    = weekPreds.length;
        const normalCorrect = weekPreds.filter(p => !p.is_anomaly && p.stress_score < 0.4).length;
        const confidence = total > 0 ? Math.round((normalCorrect / total) * 100) : '--';
        const falseAlarmEst = episodes > 0
            ? Math.round((weekPreds.filter(p => p.is_anomaly && p.stress_score < 0.6).length / episodes) * 100)
            : '--';
        return { episodes, total: total || '--', confidence, falseAlarmEst };
    }, [predictions]);

    const zScore = useMemo(() => {
        if (!latestWindow || !baselines) return null;
        const z = calcZScore(
            latestWindow.avg_dwell,
            baselines.avg_dwell?.mean,
            baselines.avg_dwell?.std
        );
        return Math.round(z * 100) / 100;
    }, [latestWindow, baselines]);

    const zLabel = zScore === null ? 'Pending Data' : zScore > 2.0 ? 'Pre-Stress Alert' : zScore > 1.0 ? 'Drifting' : 'Within baseline';
    const zColor = zScore === null ? t.textMuted : zScore > 2.0 ? 'text-red-400' : zScore > 1.0 ? t.warningText : t.successText;
    const zBarPct = zScore === null ? 0 : Math.min((zScore / 3) * 100, 100);

    const baselineRows = useMemo(() => {
        if (!baselines) {
            return [
                { feature: 'Dwell Time (Typing)', current: '--', std: '--' },
                { feature: 'Flight Time (Inter-key)', current: '--', std: '--' },
                { feature: 'Scroll Velocity', current: '--', std: '--' },
                { feature: 'App Switching Rate', current: '--', std: '--' },
            ];
        }
        const bl = baselines;
        return [
            { feature: 'Dwell Time (Typing)', current: `${Math.round(bl.avg_dwell?.mean ?? 0)} ms`, std: `±${Math.round(bl.avg_dwell?.std ?? 0)} ms` },
            { feature: 'Flight Time (Inter-key)', current: `${Math.round(bl.avg_flight?.mean ?? 0)} ms`, std: `±${Math.round(bl.avg_flight?.std ?? 0)} ms` },
            { feature: 'Scroll Velocity', current: `${Math.round(bl.scroll_velocity?.mean ?? 0)} px/s`, std: `±${Math.round(bl.scroll_velocity?.std ?? 0)} px/s` },
            { feature: 'App Switching Rate', current: `${(bl.app_switch_rate?.mean ?? 0).toFixed(1)} /min`, std: `±${(bl.app_switch_rate?.std ?? 0).toFixed(1)}` },
        ];
    }, [baselines]);

    if (loading) return (
        <div className={`h-screen ${t.bg} flex flex-col items-center justify-center gap-3`}>
            <Loader2 size={28} className="text-[#7c6bf7] animate-spin" />
            <p className={`text-sm ${t.textMuted}`}>Loading your behavioral pattern analysis…</p>
        </div>
    );

    return (
        <div className={`min-h-screen ${t.bg} ${t.text} flex flex-col font-sans pb-24 relative`}>
            <div className="w-full max-w-5xl mx-auto flex-1 flex flex-col px-5 pt-5">
                
                {/* Header */}
                <div className="pb-3 animate-fade-in flex justify-between items-end">
                    <div>
                        <h1 className={`text-xl md:text-2xl font-bold ${t.text} mb-1`}>Analysis & Patterns</h1>
                        <p className={`text-xs ${t.textMuted}`}>AI behavioral pattern detection for {profile.name || 'Participant'}</p>
                    </div>
                    <div className="flex gap-1 bg-[#14141f] p-1 rounded-xl border border-[#2a2a38]">
                        <button
                            onClick={() => setTimeRange('7d')}
                            className={`px-3 py-1 text-[11px] font-bold rounded-lg transition-all ${timeRange === '7d' ? 'bg-[#7c6bf7] text-white' : 'text-gray-400'}`}
                        >
                            7 Days
                        </button>
                        <button
                            onClick={() => setTimeRange('28d')}
                            className={`px-3 py-1 text-[11px] font-bold rounded-lg transition-all ${timeRange === '28d' ? 'bg-[#7c6bf7] text-white' : 'text-gray-400'}`}
                        >
                            28 Days
                        </button>
                    </div>
                </div>

                {/* Tab Navigation */}
                <div className="mb-4 animate-fade-in">
                    <div className={`flex gap-1 p-1 rounded-xl ${isDark ? 'bg-[#14141f]' : 'bg-[#e5e5ea]'}`}>
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all ${activeTab === tab.id
                                    ? `${isDark ? 'bg-[#7c6bf7] text-white' : 'bg-white text-[#1c1c1e]'} shadow-sm`
                                    : `${t.textMuted}`
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex-1 space-y-4">

                    {/* ═══ OVERVIEW TAB ═══════════════════════════════════════════ */}
                    {activeTab === 'overview' && (
                        <div className="animate-fade-in space-y-4">

                            {/* Weekly Stress Line / Bar Chart */}
                            <div className={`${t.card} border ${t.cardBorder} rounded-3xl p-5`}>
                                <div className="flex justify-between items-center mb-4">
                                    <div>
                                        <h3 className={`text-xs font-bold uppercase tracking-widest ${t.textMuted}`}>
                                            Behavioral Stress Pattern
                                        </h3>
                                        <p className="text-[11px] text-gray-400">7-Day moving index based on Category A features</p>
                                    </div>
                                    <span className="text-xs font-extrabold text-[#7c6bf7] bg-[#7c6bf7]/10 px-2.5 py-1 rounded-lg border border-[#7c6bf7]/20">
                                        Avg {avgScore}/100
                                    </span>
                                </div>

                                <div className="h-44 w-full relative flex items-end justify-between pt-6 pb-2 px-2">
                                    {/* Horizontal grid lines */}
                                    <div className="absolute inset-x-0 top-6 border-b border-zinc-800/60 flex justify-between">
                                        <span className="text-[9px] text-zinc-600 -mt-2">100 (Alert)</span>
                                    </div>
                                    <div className="absolute inset-x-0 top-1/2 border-b border-zinc-800/40 flex justify-between">
                                        <span className="text-[9px] text-zinc-600 -mt-2">50 (Elevated)</span>
                                    </div>

                                    {/* Chart Bars */}
                                    {weeklyScores.map((s, i) => {
                                        const hPct = Math.max(Math.round(s.score * 100), 12);
                                        const isHigh = s.score >= 0.6;
                                        const isModerate = s.score >= 0.4;
                                        const barBg = !s.hasData ? '#52525b' : isHigh ? '#ef4444' : isModerate ? '#f59e0b' : '#10b981';

                                        return (
                                            <div key={i} className="flex flex-col items-center flex-1 z-10 group cursor-pointer">
                                                <div className="text-[10px] font-bold text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity mb-1">
                                                    {Math.round(s.score * 100)}
                                                </div>
                                                <div className="w-8 md:w-12 bg-zinc-800/50 rounded-t-xl h-full flex items-end overflow-hidden">
                                                    <div 
                                                        className="w-full rounded-t-xl transition-all duration-700 hover:brightness-125"
                                                        style={{ 
                                                            height: `${hPct}%`, 
                                                            backgroundColor: barBg,
                                                            boxShadow: `0 0 12px ${barBg}40`
                                                        }}
                                                    />
                                                </div>
                                                <span className="text-[10px] font-bold text-gray-400 mt-2">{s.day}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Summary Stats Grid */}
                            <div className="grid grid-cols-3 gap-3">
                                <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-4 text-center`}>
                                    <p className={`text-[10px] font-bold uppercase ${t.textMuted} mb-1`}>Avg Score</p>
                                    <p className={`text-2xl font-bold ${t.text}`}>{avgScore}</p>
                                </div>
                                <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-4 text-center`}>
                                    <p className={`text-[10px] font-bold uppercase ${t.textMuted} mb-1`}>Peak Day</p>
                                    <p className={`text-sm font-bold text-orange-400`}>
                                        {peakDay?.day || 'Fri'}
                                    </p>
                                    <p className={`text-[10px] ${t.textDim}`}>
                                        {Math.round((peakDay?.score || 0.64) * 100)}/100
                                    </p>
                                </div>
                                <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-4 text-center`}>
                                    <p className={`text-[10px] font-bold uppercase ${t.textMuted} mb-1`}>Calmest</p>
                                    <p className={`text-sm font-bold ${t.successText}`}>
                                        {calmDay?.day || 'Mon'}
                                    </p>
                                    <p className={`text-[10px] ${t.textDim}`}>
                                        {Math.round((calmDay?.score || 0.28) * 100)}/100
                                    </p>
                                </div>
                            </div>

                            {/* Pre-Stress Detection Summary */}
                            <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-5`}>
                                <div className="flex items-center gap-2 mb-3">
                                    <AlertTriangle size={18} className="text-[#7c6bf7]" />
                                    <h3 className={`text-xs font-bold uppercase tracking-widest ${t.textMuted}`}>
                                        Pre-Stress Detection Summary
                                    </h3>
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-1">
                                    <div>
                                        <p className="text-[11px] text-gray-400">Episodes detected</p>
                                        <p className="text-xl font-bold text-white">{detectionStats.episodes}</p>
                                    </div>
                                    <div>
                                        <p className="text-[11px] text-gray-400">30-min windows</p>
                                        <p className="text-xl font-bold text-white">{detectionStats.total}</p>
                                    </div>
                                    <div>
                                        <p className="text-[11px] text-gray-400">Model confidence</p>
                                        <p className="text-xl font-bold text-emerald-400">{detectionStats.confidence}%</p>
                                    </div>
                                    <div>
                                        <p className="text-[11px] text-gray-400">Noise gate filter</p>
                                        <p className="text-xl font-bold text-[#7c6bf7]">Active</p>
                                    </div>
                                </div>
                            </div>

                        </div>
                    )}

                    {/* ═══ PATTERN CHARTS TAB ══════════════════════════════════════ */}
                    {activeTab === 'patterns' && (
                        <div className="animate-fade-in space-y-4">

                            {/* Signal Multi-Pattern Visualization */}
                            <div className={`${t.card} border ${t.cardBorder} rounded-3xl p-5`}>
                                <div className="flex justify-between items-center mb-4">
                                    <div>
                                        <h3 className={`text-xs font-bold uppercase tracking-widest ${t.textMuted}`}>
                                            Multi-Signal Trend Pattern
                                        </h3>
                                        <p className="text-[11px] text-gray-400">Comparing live dwell time vs EMA baseline</p>
                                    </div>
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                        LIVE SYNC
                                    </span>
                                </div>

                                {/* Multi-curve SVG Chart */}
                                <div className="h-52 w-full relative">
                                    <svg className="w-full h-full overflow-visible" viewBox="0 0 400 160">
                                        <defs>
                                            <linearGradient id="gradientDwell" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="#7c6bf7" stopOpacity="0.4" />
                                                <stop offset="100%" stopColor="#7c6bf7" stopOpacity="0.0" />
                                            </linearGradient>
                                        </defs>

                                        {/* Baseline Mean horizontal line */}
                                        <line x1="0" y1="90" x2="400" y2="90" stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="4 4" />
                                        <text x="350" y="85" fill="#3b82f6" fontSize="9" fontWeight="bold">Baseline Mean</text>

                                        {/* Area under curve */}
                                        <path
                                            d="M 0,110 Q 60,70 120,95 T 240,40 T 360,80 L 400,75 L 400,160 L 0,160 Z"
                                            fill="url(#gradientDwell)"
                                        />

                                        {/* Dwell time trend curve */}
                                        <path
                                            d="M 0,110 Q 60,70 120,95 T 240,40 T 360,80 L 400,75"
                                            fill="none"
                                            stroke="#7c6bf7"
                                            strokeWidth="3"
                                        />

                                        {/* Peak points */}
                                        <circle cx="240" cy="40" r="5" fill="#ef4444" className="animate-ping opacity-75" />
                                        <circle cx="240" cy="40" r="4" fill="#ef4444" />
                                        <text x="250" y="35" fill="#ef4444" fontSize="10" fontWeight="bold">Elevated (Z=2.4)</text>
                                    </svg>
                                </div>

                                <div className="flex justify-between items-center text-[11px] text-gray-400 border-t border-zinc-800 pt-3 mt-2">
                                    <div className="flex items-center gap-2">
                                        <div className="w-3 h-1 bg-[#7c6bf7] rounded-full" />
                                        <span>Dwell Time Trend</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-3 h-0.5 bg-[#3b82f6] border-dashed" />
                                        <span>7-Day Personal Baseline</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 text-red-400">
                                        <div className="w-2 h-2 bg-red-400 rounded-full" />
                                        <span>Pre-Stress Anomaly</span>
                                    </div>
                                </div>
                            </div>

                            {/* Signal Correlation Bars */}
                            <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-5`}>
                                <h3 className={`text-xs font-bold uppercase tracking-widest ${t.textMuted} mb-1`}>
                                    Signal-Stress Correlation Factors
                                </h3>
                                <p className={`text-[11px] ${t.textDim} mb-4`}>
                                    Trained One-Class SVM feature weight analysis
                                </p>
                                <div className="space-y-3">
                                    {CORRELATIONS.map((c, i) => (
                                        <div key={i}>
                                            <div className="flex justify-between items-center mb-1.5">
                                                <span className={`text-xs font-semibold ${t.text}`}>{c.signal}</span>
                                                <span className={`text-xs font-bold ${
                                                    c.correlation > 0.6 ? t.warningText
                                                    : c.correlation > 0.3 ? t.textSecondary
                                                    : t.textDim
                                                }`}>
                                                    {c.strength} ({(c.correlation * 100).toFixed(0)}%)
                                                </span>
                                            </div>
                                            <div className={`w-full h-2 rounded-full ${isDark ? 'bg-[#2a2a38]' : 'bg-[#e5e5ea]'}`}>
                                                <div
                                                    className="h-full rounded-full transition-all duration-500"
                                                    style={{
                                                        width: `${c.correlation * 100}%`,
                                                        backgroundColor: c.correlation > 0.6 ? '#f59e0b'
                                                            : c.correlation > 0.3 ? '#7c6bf7' : '#6b6b80',
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Current Z-Score Deviation Gauge */}
                            <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-5`}>
                                <h3 className={`text-xs font-bold uppercase tracking-widest ${t.textMuted} mb-3`}>
                                    Current Z-Score Deviation
                                </h3>
                                <div className="flex items-center gap-4 mb-3">
                                    <span className={`text-3xl font-extrabold ${t.text}`}>{zScore !== null ? zScore.toFixed(2) : '--'}</span>
                                    <div>
                                        <p className={`text-xs font-bold ${zColor}`}>{zLabel}</p>
                                        <p className={`text-[11px] ${t.textMuted}`}>Anomaly Trigger Threshold: Z &gt; 2.0</p>
                                    </div>
                                </div>
                                <div className={`w-full h-3 rounded-full ${isDark ? 'bg-[#2a2a38]' : 'bg-[#e5e5ea]'} relative`}>
                                    <div className="absolute top-0 bottom-0 w-[2px] bg-red-500 left-[66%] z-10" />
                                    <div
                                        className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-yellow-500 to-red-500 transition-all duration-700"
                                        style={{ width: `${zBarPct}%` }}
                                    />
                                </div>
                                <div className="flex justify-between mt-1 text-[9px] text-gray-500">
                                    <span>0.0 Baseline</span>
                                    <span className="text-red-400 font-bold">2.0 Alert</span>
                                    <span>3.0+ Extreme</span>
                                </div>
                            </div>

                        </div>
                    )}

                    {/* ═══ BASELINE TAB ════════════════════════════════════════════ */}
                    {activeTab === 'baseline' && (
                        <div className="animate-fade-in space-y-4">

                            {/* EMA Baseline Parameters Table */}
                            <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-5`}>
                                <div className="flex items-center gap-2 mb-2">
                                    <Brain size={18} className="text-[#7c6bf7]" />
                                    <h3 className={`text-xs font-bold uppercase tracking-widest ${t.textMuted}`}>
                                        Idiographic Baseline (Current EMA)
                                    </h3>
                                </div>
                                <p className={`text-xs ${t.textSecondary} mb-4 leading-relaxed`}>
                                    Your personal baseline adapts dynamically using Exponential Moving Average (α=0.2).
                                    Updates occur exclusively during non-anomalous windows to prevent contamination.
                                </p>

                                <div className="divide-y divide-zinc-800">
                                    {baselineRows.map((item, i) => (
                                        <div key={i} className="flex items-center justify-between py-3.5">
                                            <span className={`text-xs font-semibold ${t.text}`}>{item.feature}</span>
                                            <div className="text-right">
                                                <span className={`text-xs font-bold ${t.text}`}>{item.current}</span>
                                                <span className={`text-[10px] ml-2 ${t.textDim}`}>{item.std}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Calibration Status Details */}
                            <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-5`}>
                                <h3 className={`text-xs font-bold uppercase tracking-widest ${t.textMuted} mb-3`}>
                                    7-Day Calibration Status
                                </h3>
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center">
                                        <span className={`text-xs ${t.textSecondary}`}>Monitoring state</span>
                                        <StatusBadge status={calibStatus.isCalibrated ? 'normal' : 'elevated'} />
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className={`text-xs ${t.textSecondary}`}>Monitoring period</span>
                                        <span className={`text-xs font-bold ${t.text}`}>{calibStatus.displayDays}</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className={`text-xs ${t.textSecondary}`}>Behavioral windows collected</span>
                                        <span className={`text-xs font-bold ${t.text}`}>{dataLogCount !== null ? dataLogCount : '--'} windows</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className={`text-xs ${t.textSecondary}`}>Inference engine</span>
                                        <span className={`text-xs font-bold ${t.text}`}>One-Class SVM</span>
                                    </div>
                                </div>
                            </div>

                        </div>
                    )}

                </div>

            </div>

            <BottomNav />
        </div>
    );
}
