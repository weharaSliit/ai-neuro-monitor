import React, { useState, useEffect, useMemo } from 'react';
import { useTheme } from '../context/ThemeContext';
import { BottomNav } from '../components/BottomNav';
import { SparkChart } from '../components/SparkChart';
import { StatusBadge } from '../components/StatusBadge';
import { AlertTriangle, Brain, Loader2 } from 'lucide-react';
import { db } from '../firebase';
import { ref, onValue, get } from 'firebase/database';
import { PHENOTYPING_USER_ID } from './PhenotypingDashboard';

// ─── Constants ──────────────────────────────────────────────────────────────
// Signal-stress correlations come from the trained OC-SVM model analysis
// (research finding, not per-user data — kept as constants intentionally).
const CORRELATIONS = [
    { signal: '⌨️ Typing pace',       correlation: 0.82, strength: 'Strong'   },
    { signal: '🔔 Notification delay', correlation: 0.74, strength: 'Strong'   },
    { signal: '📱 Screen unlocks',     correlation: 0.65, strength: 'Moderate' },
    { signal: '📜 Scroll speed',       correlation: 0.41, strength: 'Moderate' },
    { signal: '🚶 Activity',           correlation: 0.18, strength: 'Weak'     },
];

// Build a map of day label → average score from Firebase prediction entries
function buildWeeklyChart(predictions) {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    // Initialise last 7 days with empty buckets
    const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(now - (6 - i) * dayMs);
        return {
            day:    d.toLocaleDateString('en-US', { weekday: 'short' }),
            date:   d.toDateString(),
            scores: [],
        };
    });

    // Bucket each prediction into its day
    predictions.forEach(p => {
        if (!p.timestamp) return;
        const ts = new Date(p.timestamp);
        const dateStr = ts.toDateString();
        const bucket = days.find(d => d.date === dateStr);
        if (bucket && typeof p.stress_score === 'number') {
            bucket.scores.push(p.stress_score);
        }
    });

    // Average each bucket; default 0 if no data
    return days.map(d => ({
        day:   d.day,
        score: d.scores.length
            ? d.scores.reduce((a, b) => a + b, 0) / d.scores.length
            : 0,
        hasData: d.scores.length > 0,
    }));
}

// Z-score helper (same formula as Flask ema_service)
function calcZScore(val, mean, std) {
    if (!mean || !std) return 0;
    return Math.abs((val - mean) / (std + 1e-6));
}

// ─── Component ──────────────────────────────────────────────────────────────
export function Analysis() {
    const { t, isDark } = useTheme();
    const [activeTab, setActiveTab] = useState('overview');
    const userId = PHENOTYPING_USER_ID;

    // Firebase state
    const [predictions, setPredictions]   = useState(null);   // all predictions array
    const [latestWindow, setLatestWindow] = useState(null);   // most recent data_log entry
    const [baselines, setBaselines]       = useState(null);   // EMA baselines
    const [userProfile, setUserProfile]   = useState(null);   // { created_at, is_calibrated }
    const [dataLogCount, setDataLogCount] = useState(null);   // total windows logged
    const [loading, setLoading]           = useState(true);

    const tabs = [
        { id: 'overview',  label: 'Overview'  },
        { id: 'patterns',  label: 'Patterns'  },
        { id: 'baseline',  label: 'Baseline'  },
    ];

    // ── 1. Stream all predictions (real-time) ──────────────────────────────
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
    }, []);

    // ── 2. Fetch baselines + user profile + latest data_log (one-off) ─────
    useEffect(() => {
        // Baselines
        get(ref(db, `phenotyping/users/${userId}/baselines`))
            .then(s => s.exists() && setBaselines(s.val()));

        // User profile (created_at, is_calibrated)
        get(ref(db, `phenotyping/users/${userId}`))
            .then(s => {
                if (s.exists()) {
                    const val = s.val();
                    setUserProfile({ createdAt: val.created_at, isCalibrated: val.is_calibrated });
                }
            });

        // Latest behavioral window + count
        get(ref(db, `phenotyping/data_logs/${userId}`))
            .then(s => {
                if (s.exists()) {
                    const raw = s.val();
                    const entries = Object.entries(raw).sort((a, b) => a[0].localeCompare(b[0]));
                    setDataLogCount(entries.length);
                    setLatestWindow(entries[entries.length - 1][1]);
                }
            });
    }, []);

    // ── Derived computations (memoised) ────────────────────────────────────

    // Weekly chart + summary stats
    const { weeklyScores, avgScore, peakDay, calmDay } = useMemo(() => {
        if (!predictions || predictions.length === 0) {
            // Empty fallback — 7 days of zeros
            const empty = Array.from({ length: 7 }, (_, i) => {
                const d = new Date();
                d.setDate(d.getDate() - (6 - i));
                return { day: d.toLocaleDateString('en-US', { weekday: 'short' }), score: 0, hasData: false };
            });
            return { weeklyScores: empty, avgScore: 0, peakDay: empty[6], calmDay: empty[6] };
        }

        const ws = buildWeeklyChart(predictions);
        const withData = ws.filter(d => d.hasData);
        const avg = withData.length
            ? Math.round(withData.reduce((a, b) => a + b.score, 0) / withData.length * 100)
            : 0;
        const peak = ws.reduce((a, b) => a.score > b.score ? a : b);
        const calm = ws.filter(d => d.hasData).reduce(
            (a, b) => a.score < b.score ? a : b,
            ws[0]
        );
        return { weeklyScores: ws, avgScore: avg, peakDay: peak, calmDay: calm };
    }, [predictions]);

    // Pre-stress detection stats (last 7 days)
    const detectionStats = useMemo(() => {
        if (!predictions || predictions.length === 0) return null;
        const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const weekPreds = predictions.filter(p =>
            p.timestamp && new Date(p.timestamp).getTime() > oneWeekAgo
        );
        const episodes = weekPreds.filter(p => p.is_anomaly).length;
        const total    = weekPreds.length;
        // Model confidence: % of non-anomaly windows with low score (true negatives proxy)
        const normalCorrect = weekPreds.filter(p => !p.is_anomaly && p.stress_score < 0.4).length;
        const confidence = total > 0 ? Math.round((normalCorrect / total) * 100) : null;
        // False alarm proxy: anomalous windows with score < 0.6 (borderline detections)
        const falseAlarmEst = episodes > 0
            ? Math.round((weekPreds.filter(p => p.is_anomaly && p.stress_score < 0.6).length / episodes) * 100)
            : 0;
        return { episodes, total: weekPreds.length, confidence, falseAlarmEst };
    }, [predictions]);

    // Live Z-score (dwell time vs baseline)
    const zScore = useMemo(() => {
        if (!latestWindow || !baselines) return null;
        const z = calcZScore(
            latestWindow.avg_dwell,
            baselines.avg_dwell?.mean,
            baselines.avg_dwell?.std
        );
        return Math.round(z * 100) / 100;
    }, [latestWindow, baselines]);

    const zLabel = zScore === null ? null
        : zScore > 2.0 ? 'Stress Alert'
        : zScore > 1.0 ? 'Drifting'
        : 'Within baseline';
    const zColor = zScore === null ? t.textMuted
        : zScore > 2.0 ? t.errorText || 'text-red-400'
        : zScore > 1.0 ? t.warningText
        : t.successText;
    // Cap bar at z=3 for display
    const zBarPct = zScore === null ? 0 : Math.min((zScore / 3) * 100, 100);

    // Baseline metrics table from live baselines
    const baselineRows = useMemo(() => {
        if (!baselines) return null;
        return [
            {
                feature: 'Dwell Time',
                current: `${Math.round(baselines.avg_dwell?.mean ?? 0)} ms`,
                std:     `±${Math.round(baselines.avg_dwell?.std ?? 0)} ms`,
            },
            {
                feature: 'Flight Time',
                current: `${Math.round(baselines.avg_flight?.mean ?? 0)} ms`,
                std:     `±${Math.round(baselines.avg_flight?.std ?? 0)} ms`,
            },
            {
                feature: 'Scroll Velocity',
                current: `${Math.round(baselines.scroll_velocity?.mean ?? 0)} px/s`,
                std:     `±${Math.round(baselines.scroll_velocity?.std ?? 0)} px/s`,
            },
        ];
    }, [baselines]);

    // Calibration status
    const calibration = useMemo(() => {
        const daysMonitored = userProfile?.createdAt
            ? Math.floor((Date.now() - new Date(userProfile.createdAt).getTime()) / (1000 * 60 * 60 * 24))
            : null;
        const frozenWindows = predictions
            ? predictions.filter(p => p.is_anomaly).length
            : null;
        return {
            isCalibrated: userProfile?.isCalibrated ?? false,
            daysMonitored,
            logCount:     dataLogCount,
            frozenWindows,
        };
    }, [userProfile, predictions, dataLogCount]);

    // ─── Loading screen ──────────────────────────────────────────────────────
    if (loading) return (
        <div className={`h-screen ${t.bg} flex flex-col items-center justify-center gap-3`}>
            <Loader2 size={28} className="text-[#7c6bf7] animate-spin" />
            <p className={`text-sm ${t.textMuted}`}>Loading your behavioral analysis…</p>
        </div>
    );

    // ─── Render ──────────────────────────────────────────────────────────────
    return (
        <div className={`h-screen ${t.bg} ${t.text} flex flex-col font-sans pb-24 overflow-y-auto hide-scrollbar max-w-md mx-auto shadow-2xl relative`}>
            {/* Header */}
            <div className="px-5 pt-5 pb-2 animate-fade-in">
                <h1 className={`text-xl font-bold ${t.text} mb-1`}>Analysis</h1>
                <p className={`text-xs ${t.textMuted}`}>AI-powered insights from your behavioral data</p>
            </div>

            {/* Tab Bar */}
            <div className="px-5 mb-4 animate-fade-in">
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

            <div className="px-5 flex-1">

                {/* ═══ OVERVIEW TAB ═══════════════════════════════════════════ */}
                {activeTab === 'overview' && (
                    <div className="animate-fade-in">

                        {/* Weekly Stress Chart */}
                        <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-4 mb-4`}>
                            <h3 className={`text-xs font-bold uppercase tracking-widest ${t.textMuted} mb-3`}>
                                Weekly Stress Pattern
                            </h3>
                            {weeklyScores.some(d => d.hasData) ? (
                                <>
                                    <SparkChart
                                        data={weeklyScores.map((s, i) => ({
                                            val: s.score * 100,
                                            active: i === weeklyScores.length - 1,
                                        }))}
                                        color="#7c6bf7"
                                        height={64}
                                    />
                                    <div className="flex justify-between mt-2">
                                        {weeklyScores.map((s, i) => (
                                            <span
                                                key={i}
                                                className={`text-[9px] font-medium flex-1 text-center ${
                                                    s.hasData
                                                        ? i === weeklyScores.length - 1 ? t.accent : t.textSecondary
                                                        : t.textDim
                                                }`}
                                            >
                                                {s.day}
                                            </span>
                                        ))}
                                    </div>
                                </>
                            ) : (
                                <p className={`text-sm ${t.textMuted} text-center py-4`}>
                                    No predictions yet — start collecting data with the app.
                                </p>
                            )}
                        </div>

                        {/* Summary Stats */}
                        <div className="grid grid-cols-3 gap-2.5 mb-4">
                            <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-3.5 text-center`}>
                                <p className={`text-[10px] font-bold uppercase ${t.textMuted} mb-1`}>Avg Score</p>
                                <p className={`text-2xl font-bold ${t.text}`}>{avgScore || '—'}</p>
                            </div>
                            <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-3.5 text-center`}>
                                <p className={`text-[10px] font-bold uppercase ${t.textMuted} mb-1`}>Peak Day</p>
                                <p className={`text-sm font-bold text-orange-400`}>
                                    {peakDay?.hasData ? peakDay.day : '—'}
                                </p>
                                {peakDay?.hasData && (
                                    <p className={`text-[10px] ${t.textDim}`}>
                                        {Math.round(peakDay.score * 100)}/100
                                    </p>
                                )}
                            </div>
                            <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-3.5 text-center`}>
                                <p className={`text-[10px] font-bold uppercase ${t.textMuted} mb-1`}>Calmest</p>
                                <p className={`text-sm font-bold ${t.successText}`}>
                                    {calmDay?.hasData ? calmDay.day : '—'}
                                </p>
                                {calmDay?.hasData && (
                                    <p className={`text-[10px] ${t.textDim}`}>
                                        {Math.round(calmDay.score * 100)}/100
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Pre-Stress Detection Stats */}
                        <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-4 mb-4`}>
                            <div className="flex items-center gap-2 mb-3">
                                <AlertTriangle size={16} className="text-[#7c6bf7]" />
                                <h3 className={`text-xs font-bold uppercase tracking-widest ${t.textMuted}`}>
                                    Pre-Stress Detection
                                </h3>
                            </div>
                            <div className="space-y-3">
                                <div className="flex justify-between items-center">
                                    <span className={`text-sm ${t.textSecondary}`}>Episodes detected this week</span>
                                    <span className={`text-sm font-bold ${t.text}`}>
                                        {detectionStats ? detectionStats.episodes : '—'}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className={`text-sm ${t.textSecondary}`}>Windows analysed</span>
                                    <span className={`text-sm font-bold ${t.text}`}>
                                        {detectionStats ? detectionStats.total : '—'}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className={`text-sm ${t.textSecondary}`}>Model confidence</span>
                                    <span className={`text-sm font-bold ${t.text}`}>
                                        {detectionStats?.confidence != null
                                            ? `${detectionStats.confidence}%`
                                            : '—'}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className={`text-sm ${t.textSecondary}`}>Borderline detections</span>
                                    <span className={`text-sm font-bold ${t.warningText}`}>
                                        {detectionStats ? `${detectionStats.falseAlarmEst}%` : '—'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* ═══ PATTERNS TAB ════════════════════════════════════════════ */}
                {activeTab === 'patterns' && (
                    <div className="animate-fade-in">

                        {/* Signal Correlation — research constants */}
                        <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-4 mb-4`}>
                            <h3 className={`text-xs font-bold uppercase tracking-widest ${t.textMuted} mb-1`}>
                                Signal-Stress Correlation
                            </h3>
                            <p className={`text-[10px] ${t.textDim} mb-4`}>
                                From OC-SVM model training analysis
                            </p>
                            <div className="space-y-3">
                                {CORRELATIONS.map((c, i) => (
                                    <div key={i}>
                                        <div className="flex justify-between items-center mb-1.5">
                                            <span className={`text-sm ${t.text}`}>{c.signal}</span>
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
                                                className="h-full rounded-full animate-progress transition-all"
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

                        {/* Z-Score Current — LIVE */}
                        <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-4 mb-4`}>
                            <h3 className={`text-xs font-bold uppercase tracking-widest ${t.textMuted} mb-3`}>
                                Current Z-Score Deviation
                            </h3>
                            {zScore !== null ? (
                                <>
                                    <div className="flex items-center gap-4 mb-2">
                                        <span className={`text-3xl font-bold ${t.text}`}>{zScore.toFixed(2)}</span>
                                        <div>
                                            <p className={`text-sm font-medium ${zColor}`}>{zLabel}</p>
                                            <p className={`text-[11px] ${t.textMuted}`}>Threshold: Z &gt; 2.0</p>
                                        </div>
                                    </div>
                                    <div className={`w-full h-3 rounded-full ${isDark ? 'bg-[#2a2a38]' : 'bg-[#e5e5ea]'} relative`}>
                                        {/* Threshold marker at 66% (z=2 out of z=3 max) */}
                                        <div className="absolute top-0 bottom-0 w-[2px] bg-red-500 left-[66%] z-10" />
                                        <div
                                            className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-yellow-500 to-red-500 animate-progress transition-all duration-700"
                                            style={{ width: `${zBarPct}%` }}
                                        />
                                    </div>
                                    <div className="flex justify-between mt-1">
                                        <span className={`text-[9px] ${t.textDim}`}>0.0 Normal</span>
                                        <span className="text-[9px] text-red-400">2.0 Alert</span>
                                        <span className={`text-[9px] ${t.textDim}`}>3.0+</span>
                                    </div>
                                    <p className={`text-[10px] ${t.textDim} mt-2`}>
                                        Based on dwell time vs your EMA baseline
                                    </p>
                                </>
                            ) : (
                                <p className={`text-sm ${t.textMuted} py-2`}>
                                    Waiting for first behavioral window + baseline data…
                                </p>
                            )}
                        </div>
                    </div>
                )}

                {/* ═══ BASELINE TAB ════════════════════════════════════════════ */}
                {activeTab === 'baseline' && (
                    <div className="animate-fade-in">

                        {/* EMA Baseline Table — LIVE */}
                        <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-4 mb-4`}>
                            <div className="flex items-center gap-2 mb-3">
                                <Brain size={16} className="text-[#7c6bf7]" />
                                <h3 className={`text-xs font-bold uppercase tracking-widest ${t.textMuted}`}>
                                    EMA Baseline (Current)
                                </h3>
                            </div>
                            <p className={`text-sm ${t.textSecondary} mb-4 leading-relaxed`}>
                                Your personal baseline adapts via Exponential Moving Average (α=0.2).
                                It updates only during normal behavior — stress windows are excluded to prevent contamination.
                            </p>

                            {baselineRows ? (
                                baselineRows.map((item, i) => (
                                    <div
                                        key={i}
                                        className={`flex items-center justify-between py-3 ${
                                            i < baselineRows.length - 1 ? `border-b ${t.divider}` : ''
                                        }`}
                                    >
                                        <span className={`text-sm ${t.text}`}>{item.feature}</span>
                                        <div className="text-right">
                                            <span className={`text-sm font-bold ${t.text}`}>{item.current}</span>
                                            <span className={`text-[10px] ml-1.5 ${t.textDim}`}>{item.std}</span>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <p className={`text-sm ${t.textMuted} py-2`}>
                                    No baseline yet — waiting for 7-day calibration period.
                                </p>
                            )}
                        </div>

                        {/* Calibration Status — LIVE */}
                        <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-4 mb-4`}>
                            <h3 className={`text-xs font-bold uppercase tracking-widest ${t.textMuted} mb-3`}>
                                Calibration Status
                            </h3>
                            <div className="space-y-3">
                                <div className="flex justify-between items-center">
                                    <span className={`text-sm ${t.textSecondary}`}>Status</span>
                                    <StatusBadge status={calibration.isCalibrated ? 'normal' : 'elevated'} />
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className={`text-sm ${t.textSecondary}`}>Days monitored</span>
                                    <span className={`text-sm font-bold ${t.text}`}>
                                        {calibration.daysMonitored != null ? calibration.daysMonitored : '—'}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className={`text-sm ${t.textSecondary}`}>Behavioral windows logged</span>
                                    <span className={`text-sm font-bold ${t.text}`}>
                                        {calibration.logCount != null ? calibration.logCount : '—'}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className={`text-sm ${t.textSecondary}`}>Frozen windows (stress)</span>
                                    <span className={`text-sm font-bold ${t.warningText}`}>
                                        {calibration.frozenWindows != null ? calibration.frozenWindows : '—'}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className={`text-sm ${t.textSecondary}`}>Model type</span>
                                    <span className={`text-sm font-bold ${t.text}`}>One-Class SVM</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

            </div>

            <BottomNav />
        </div>
    );
}
