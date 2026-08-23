import React, { useState, useEffect, useMemo } from 'react';
import { useTheme } from '../context/ThemeContext';
import { BottomNav } from '../components/BottomNav';
import { SparkChart } from '../components/SparkChart';
import { StatusBadge } from '../components/StatusBadge';
import { AlertTriangle, Brain, Loader2, TrendingUp, Activity, BarChart2 } from 'lucide-react';
import { db } from '../firebase';
import { ref, onValue, get } from 'firebase/database';
import { getUserProfile, getCalibrationStatus } from '../utils/userStorage';

// ─── Constants ──────────────────────────────────────────────────────────────
// Note: CORRELATIONS removed — now computed dynamically from real baselines

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
    const [activeTab, setActiveTab] = useState('overview');
    const [timeRange, setTimeRange] = useState('7d');

    const profile = useMemo(() => getUserProfile(), []);
    const calibStatus = useMemo(() => getCalibrationStatus(profile), [profile]);
    const userId = profile?.userId;

    useEffect(() => {
        if (!userId) navigate('/');
    }, [userId]);

    const [predictions, setPredictions]   = useState(null);
    const [latestWindow, setLatestWindow] = useState(null);
    const [recentWindows, setRecentWindows] = useState([]);
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
        const cached = localStorage.getItem(`cache_analysis_preds_${userId}`);
        if (cached) {
            try { setPredictions(JSON.parse(cached)); setLoading(false); } catch (e) {}
        }

        const unsub = onValue(ref(db, `phenotyping/predictions/${userId}`), snap => {
            const raw = snap.val();
            if (raw) {
                const arr = Object.values(raw);
                setPredictions(arr);
                localStorage.setItem(`cache_analysis_preds_${userId}`, JSON.stringify(arr));
            } else {
                setPredictions([]);
            }
            setLoading(false);
        });
        return () => unsub();
    }, [userId]);

    // ── 2. Fetch baselines + user profile + data logs ─────────────────────
    useEffect(() => {
        const cBase = localStorage.getItem(`cache_analysis_base_${userId}`);
        if (cBase) { try { setBaselines(JSON.parse(cBase)); } catch(e){} }
        
        get(ref(db, `phenotyping/users/${userId}/baselines`))
            .then(s => {
                if (s.exists()) {
                    setBaselines(s.val());
                    localStorage.setItem(`cache_analysis_base_${userId}`, JSON.stringify(s.val()));
                }
            });

        const cProfile = localStorage.getItem(`cache_analysis_prof_${userId}`);
        if (cProfile) { try { setUserProfileDb(JSON.parse(cProfile)); } catch(e){} }

        get(ref(db, `phenotyping/users/${userId}`))
            .then(s => {
                if (s.exists()) {
                    const val = s.val();
                    const p = { createdAt: val.created_at, isCalibrated: val.is_calibrated };
                    setUserProfileDb(p);
                    localStorage.setItem(`cache_analysis_prof_${userId}`, JSON.stringify(p));
                }
            });

        const cLogs = localStorage.getItem(`cache_analysis_logs_${userId}`);
        if (cLogs) {
            try {
                const parsed = JSON.parse(cLogs);
                setDataLogCount(parsed.count);
                setLatestWindow(parsed.latest);
            } catch(e){}
        }

        get(ref(db, `phenotyping/data_logs/${userId}`))
            .then(s => {
                if (s.exists()) {
                    const raw = s.val();
                    const entries = Object.entries(raw).sort((a, b) => a[0].localeCompare(b[0]));
                    setDataLogCount(entries.length);
                    setLatestWindow(entries[entries.length - 1][1]);
                    setRecentWindows(entries.slice(-10).map(e => ({ ts: e[0], data: e[1] })));
                    
                    localStorage.setItem(`cache_analysis_logs_${userId}`, JSON.stringify({
                        count: entries.length,
                        latest: entries[entries.length - 1][1]
                    }));
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
        
        // If we don't have enough data yet, use a baseline algorithmic confidence of 85%
        const confidence = total > 0 ? Math.round((normalCorrect / total) * 100) : '--';
        
        const falseAlarmEst = episodes > 0
            ? Math.round((weekPreds.filter(p => p.is_anomaly && p.stress_score < 0.6).length / episodes) * 100)
            : '--';
            
        return { episodes: episodes || 0, total: total || 0, confidence, falseAlarmEst };
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
                                        {peakDay?.day || '--'}
                                    </p>
                                    <p className={`text-[10px] ${t.textDim}`}>
                                        {peakDay ? `${Math.round(peakDay.score * 100)}/100` : '--'}
                                    </p>
                                </div>
                                <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-4 text-center`}>
                                    <p className={`text-[10px] font-bold uppercase ${t.textMuted} mb-1`}>Calmest</p>
                                    <p className={`text-sm font-bold ${t.successText}`}>
                                        {calmDay?.day || '--'}
                                    </p>
                                    <p className={`text-[10px] ${t.textDim}`}>
                                        {calmDay ? `${Math.round(calmDay.score * 100)}/100` : '--'}
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
                                            Dwell Time Trend (Last 10 Windows)
                                        </h3>
                                        <p className="text-[11px] text-gray-400">Your live typing dwell time vs your personal baseline mean</p>
                                    </div>
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                        LIVE DATA
                                    </span>
                                </div>

                                {/* Real bar chart from last 10 data_log entries */}
                                {(() => {
                                    const recentPreds = (predictions || []).slice(-10);
                                    const baselineMean = baselines?.avg_dwell?.mean;
                                    const baselineStd  = baselines?.avg_dwell?.std;
                                    const latestDwell  = latestWindow?.avg_dwell;

                                    if (!latestDwell) {
                                        return (
                                            <div className={`h-32 flex items-center justify-center text-xs ${t.textMuted}`}>
                                                No dwell data yet. Keep typing to see your trend!
                                            </div>
                                        );
                                    }

                                    // Build bars from actual recent dwell time windows
                                    const bars = recentWindows.map((rw, i) => {
                                        const dwell = rw.data.avg_dwell || 0;
                                        // Normalize dwell so that baselineMean = 30% height, 2x baseline = 60%, etc.
                                        const normalizedScore = baselineMean ? Math.min(dwell / (baselineMean * 2), 1.0) : 0;
                                        const z = baselineStd ? ((dwell - baselineMean) / baselineStd) : 0;
                                        
                                        return {
                                            day: `W${i+1}`,
                                            score: normalizedScore,
                                            zScore: z,
                                            hasData: dwell > 0,
                                            rawVal: Math.round(dwell)
                                        };
                                    });

                                    const currentZ = baselineMean && baselineStd
                                        ? Math.abs((latestDwell - baselineMean) / baselineStd).toFixed(2)
                                        : null;
                                    const isAnomaly = currentZ !== null && parseFloat(currentZ) > 2.0;
                                    const isElevated = currentZ !== null && parseFloat(currentZ) > 1.0;

                                    return (
                                        <>
                                            {/* Live stats row */}
                                            <div className="flex justify-between text-[11px] mb-4 gap-3">
                                                <div className={`flex-1 text-center p-2.5 rounded-xl ${isDark ? 'bg-[#1e1e2e]' : 'bg-[#f0f0f5]'}`}>
                                                    <p className={`${t.textMuted} text-[10px]`}>Current</p>
                                                    <p className={`font-bold text-sm ${t.text}`}>{Math.round(latestDwell)} ms</p>
                                                </div>
                                                <div className={`flex-1 text-center p-2.5 rounded-xl ${isDark ? 'bg-[#1e1e2e]' : 'bg-[#f0f0f5]'}`}>
                                                    <p className={`${t.textMuted} text-[10px]`}>Baseline Mean</p>
                                                    <p className="font-bold text-sm text-[#3b82f6]">{baselineMean ? `${Math.round(baselineMean)} ms` : '--'}</p>
                                                </div>
                                                <div className={`flex-1 text-center p-2.5 rounded-xl ${isDark ? 'bg-[#1e1e2e]' : 'bg-[#f0f0f5]'}`}>
                                                    <p className={`${t.textMuted} text-[10px]`}>Z-Score</p>
                                                    <p className={`font-bold text-sm ${
                                                        isAnomaly ? 'text-red-400' : isElevated ? 'text-orange-400' : 'text-emerald-400'
                                                    }`}>
                                                        {currentZ !== null ? currentZ : '--'}
                                                    </p>
                                                </div>
                                            </div>

                                            {/* Bar chart: Dwell time trend */}
                                            <div className="h-28 flex items-end justify-between gap-1 px-1">
                                                {bars.map((b, i) => {
                                                    const hPct = Math.max(Math.round(b.score * 100), 8);
                                                    const color = !b.hasData ? '#52525b'
                                                        : b.zScore >= 2.0 ? '#ef4444'
                                                        : b.zScore >= 1.0 ? '#f59e0b' : '#10b981';
                                                    return (
                                                        <div key={i} className="flex flex-col items-center flex-1 group relative">
                                                            <div className="absolute -top-6 text-[9px] bg-black/80 px-1 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                                                                {b.rawVal}ms
                                                            </div>
                                                            <div className="w-full bg-zinc-800/50 rounded-t-lg h-20 flex items-end overflow-hidden">
                                                                <div
                                                                    className="w-full rounded-t-lg transition-all duration-700 hover:brightness-125"
                                                                    style={{ height: `${hPct}%`, backgroundColor: color, boxShadow: b.hasData ? `0 0 8px ${color}40` : 'none' }}
                                                                />
                                                            </div>
                                                            <span className="text-[9px] font-bold text-gray-500 mt-1">{b.day}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            {/* Legend */}
                                            <div className="flex justify-between items-center text-[10px] text-gray-400 border-t border-zinc-800 pt-3 mt-3">
                                                <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded bg-emerald-500" /><span>Normal</span></div>
                                                <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded bg-orange-400" /><span>Elevated</span></div>
                                                <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded bg-red-400" /><span>Pre-Stress</span></div>
                                                <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded bg-zinc-600" /><span>No data</span></div>
                                            </div>
                                        </>
                                    );
                                })()}
                            </div>

                            {/* Signal Correlation Bars - computed from live baselines */}
                            <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-5`}>
                                <h3 className={`text-xs font-bold uppercase tracking-widest ${t.textMuted} mb-1`}>
                                    Signal Deviation from Your Baseline
                                </h3>
                                <p className={`text-[11px] ${t.textDim} mb-4`}>
                                    How far each signal is from your personal baseline right now
                                </p>
                                {(() => {
                                    if (!latestWindow || !baselines) {
                                        return (
                                            <p className={`text-xs ${t.textMuted} text-center py-4`}>
                                                Waiting for baseline data...
                                            </p>
                                        );
                                    }

                                    const lw = latestWindow;
                                    const bl = baselines;

                                    const computeZ = (val, mean, std) => {
                                        if (!mean || !std || mean === 0) return 0;
                                        return Math.min(Math.abs((val - mean) / std), 3.0);
                                    };

                                    const signals = [
                                        {
                                            signal: '⌨️ Typing Dwell',
                                            z: computeZ(lw.avg_dwell, bl.avg_dwell?.mean, bl.avg_dwell?.std),
                                            current: `${Math.round(lw.avg_dwell || 0)} ms`,
                                            baseline: bl.avg_dwell?.mean ? `${Math.round(bl.avg_dwell.mean)} ms` : '--',
                                        },
                                        {
                                            signal: '✈️ Flight Time',
                                            z: computeZ(lw.avg_flight, bl.avg_flight?.mean, bl.avg_flight?.std),
                                            current: `${Math.round(lw.avg_flight || 0)} ms`,
                                            baseline: bl.avg_flight?.mean ? `${Math.round(bl.avg_flight.mean)} ms` : '--',
                                        },
                                        {
                                            signal: '📜 Scroll Speed',
                                            z: computeZ(lw.scroll_velocity, bl.scroll_velocity?.mean, bl.scroll_velocity?.std),
                                            current: `${Math.round(lw.scroll_velocity || 0)} px/s`,
                                            baseline: bl.scroll_velocity?.mean ? `${Math.round(bl.scroll_velocity.mean)} px/s` : '--',
                                        },
                                        {
                                            signal: '🔄 App Switching',
                                            z: computeZ(lw.app_switch_rate, bl.app_switch_rate?.mean, bl.app_switch_rate?.std),
                                            current: `${(lw.app_switch_rate || 0).toFixed(1)}/min`,
                                            baseline: bl.app_switch_rate?.mean ? `${bl.app_switch_rate.mean.toFixed(1)}/min` : '--',
                                        },
                                    ];

                                    return (
                                        <div className="space-y-4">
                                            {signals.map((s, i) => {
                                                const pct = Math.round((s.z / 3.0) * 100);
                                                const color = s.z > 2.0 ? '#ef4444' : s.z > 1.0 ? '#f59e0b' : '#10b981';
                                                const strength = s.z > 2.0 ? 'Anomalous' : s.z > 1.0 ? 'Elevated' : 'Normal';
                                                return (
                                                    <div key={i}>
                                                        <div className="flex justify-between items-center mb-1">
                                                            <span className={`text-xs font-semibold ${t.text}`}>{s.signal}</span>
                                                            <div className="text-right">
                                                                <span className="text-[10px] font-bold" style={{ color }}>{strength} (Z={s.z.toFixed(2)})</span>
                                                                <span className={`text-[10px] ${t.textDim} ml-2`}>{s.current} vs {s.baseline}</span>
                                                            </div>
                                                        </div>
                                                        <div className={`w-full h-2 rounded-full ${isDark ? 'bg-[#2a2a38]' : 'bg-[#e5e5ea]'}`}>
                                                            <div
                                                                className="h-full rounded-full transition-all duration-700"
                                                                style={{ width: `${pct}%`, backgroundColor: color }}
                                                            />
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    );
                                })()}
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
