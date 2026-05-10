import React, { useState } from 'react';
import { useTheme } from '../context/ThemeContext';
import { BottomNav } from '../components/BottomNav';
import { SparkChart } from '../components/SparkChart';
import { StatusBadge } from '../components/StatusBadge';
import { TrendingUp, TrendingDown, AlertTriangle, Activity, Brain, BarChart3 } from 'lucide-react';

// Generate mock weekly stress scores
function generateWeeklyScores() {
    return Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        return {
            day: d.toLocaleDateString('en-US', { weekday: 'short' }),
            score: Math.round((0.3 + Math.random() * 0.5) * 100) / 100,
        };
    });
}

const CORRELATIONS = [
    { signal: '⌨️ Typing pace', correlation: 0.82, strength: 'Strong' },
    { signal: '🔔 Notification delay', correlation: 0.74, strength: 'Strong' },
    { signal: '📱 Screen unlocks', correlation: 0.65, strength: 'Moderate' },
    { signal: '📜 Scroll speed', correlation: 0.41, strength: 'Moderate' },
    { signal: '🚶 Activity', correlation: 0.18, strength: 'Weak' },
];

export function Analysis() {
    const { t, isDark } = useTheme();
    const [activeTab, setActiveTab] = useState('overview');
    const weeklyScores = generateWeeklyScores();

    const avgScore = Math.round(weeklyScores.reduce((a, b) => a + b.score, 0) / weeklyScores.length * 100);
    const peakDay = weeklyScores.reduce((a, b) => a.score > b.score ? a : b);
    const calmDay = weeklyScores.reduce((a, b) => a.score < b.score ? a : b);

    const tabs = [
        { id: 'overview', label: 'Overview' },
        { id: 'patterns', label: 'Patterns' },
        { id: 'baseline', label: 'Baseline' },
    ];

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
                {activeTab === 'overview' && (
                    <div className="animate-fade-in">
                        {/* Weekly Stress Chart */}
                        <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-4 mb-4`}>
                            <h3 className={`text-xs font-bold uppercase tracking-widest ${t.textMuted} mb-3`}>Weekly Stress Pattern</h3>
                            <SparkChart
                                data={weeklyScores.map((s, i) => ({ val: s.score * 100, active: i === weeklyScores.length - 1 }))}
                                color="#7c6bf7"
                                height={64}
                            />
                            <div className="flex justify-between mt-2">
                                {weeklyScores.map((s, i) => (
                                    <span key={i} className={`text-[9px] font-medium flex-1 text-center ${i === weeklyScores.length - 1 ? t.accent : t.textDim}`}>
                                        {s.day}
                                    </span>
                                ))}
                            </div>
                        </div>

                        {/* Summary Stats */}
                        <div className="grid grid-cols-3 gap-2.5 mb-4">
                            <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-3.5 text-center`}>
                                <p className={`text-[10px] font-bold uppercase ${t.textMuted} mb-1`}>Avg Score</p>
                                <p className={`text-2xl font-bold ${t.text}`}>{avgScore}</p>
                            </div>
                            <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-3.5 text-center`}>
                                <p className={`text-[10px] font-bold uppercase ${t.textMuted} mb-1`}>Peak Day</p>
                                <p className={`text-sm font-bold text-orange-400`}>{peakDay.day}</p>
                                <p className={`text-[10px] ${t.textDim}`}>{Math.round(peakDay.score * 100)}/100</p>
                            </div>
                            <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-3.5 text-center`}>
                                <p className={`text-[10px] font-bold uppercase ${t.textMuted} mb-1`}>Calmest</p>
                                <p className={`text-sm font-bold ${t.successText}`}>{calmDay.day}</p>
                                <p className={`text-[10px] ${t.textDim}`}>{Math.round(calmDay.score * 100)}/100</p>
                            </div>
                        </div>

                        {/* Pre-Stress Detection Stats */}
                        <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-4 mb-4`}>
                            <div className="flex items-center gap-2 mb-3">
                                <AlertTriangle size={16} className="text-[#7c6bf7]" />
                                <h3 className={`text-xs font-bold uppercase tracking-widest ${t.textMuted}`}>Pre-Stress Detection</h3>
                            </div>
                            <div className="space-y-3">
                                <div className="flex justify-between items-center">
                                    <span className={`text-sm ${t.textSecondary}`}>Episodes detected this week</span>
                                    <span className={`text-sm font-bold ${t.text}`}>3</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className={`text-sm ${t.textSecondary}`}>Average lead time</span>
                                    <span className={`text-sm font-bold ${t.successText}`}>~45 min</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className={`text-sm ${t.textSecondary}`}>Model confidence</span>
                                    <span className={`text-sm font-bold ${t.text}`}>78%</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className={`text-sm ${t.textSecondary}`}>False alarm rate</span>
                                    <span className={`text-sm font-bold ${t.warningText}`}>22%</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'patterns' && (
                    <div className="animate-fade-in">
                        {/* Signal Correlation */}
                        <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-4 mb-4`}>
                            <h3 className={`text-xs font-bold uppercase tracking-widest ${t.textMuted} mb-4`}>Signal-Stress Correlation</h3>
                            <div className="space-y-3">
                                {CORRELATIONS.map((c, i) => (
                                    <div key={i}>
                                        <div className="flex justify-between items-center mb-1.5">
                                            <span className={`text-sm ${t.text}`}>{c.signal}</span>
                                            <span className={`text-xs font-bold ${c.correlation > 0.6 ? t.warningText : c.correlation > 0.3 ? t.textSecondary : t.textDim}`}>
                                                {c.strength} ({(c.correlation * 100).toFixed(0)}%)
                                            </span>
                                        </div>
                                        <div className={`w-full h-2 rounded-full ${isDark ? 'bg-[#2a2a38]' : 'bg-[#e5e5ea]'}`}>
                                            <div
                                                className="h-full rounded-full animate-progress transition-all"
                                                style={{
                                                    width: `${c.correlation * 100}%`,
                                                    backgroundColor: c.correlation > 0.6 ? '#f59e0b' : c.correlation > 0.3 ? '#7c6bf7' : '#6b6b80',
                                                }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Z-Score Current */}
                        <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-4 mb-4`}>
                            <h3 className={`text-xs font-bold uppercase tracking-widest ${t.textMuted} mb-3`}>Current Z-Score Deviation</h3>
                            <div className="flex items-center gap-4 mb-2">
                                <span className={`text-3xl font-bold ${t.text}`}>1.4</span>
                                <div>
                                    <p className={`text-sm font-medium ${t.warningText}`}>Drifting</p>
                                    <p className={`text-[11px] ${t.textMuted}`}>Threshold: Z &gt; 2.0</p>
                                </div>
                            </div>
                            <div className={`w-full h-3 rounded-full ${isDark ? 'bg-[#2a2a38]' : 'bg-[#e5e5ea]'} relative`}>
                                {/* Threshold marker */}
                                <div className="absolute top-0 bottom-0 w-[2px] bg-red-500 left-[66%] z-10" />
                                <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-yellow-500 to-red-500 animate-progress" style={{ width: '46%' }} />
                            </div>
                            <div className="flex justify-between mt-1">
                                <span className={`text-[9px] ${t.textDim}`}>0.0 Normal</span>
                                <span className={`text-[9px] text-red-400`}>2.0 Alert</span>
                                <span className={`text-[9px] ${t.textDim}`}>3.0+</span>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'baseline' && (
                    <div className="animate-fade-in">
                        {/* Baseline Evolution */}
                        <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-4 mb-4`}>
                            <div className="flex items-center gap-2 mb-3">
                                <Brain size={16} className="text-[#7c6bf7]" />
                                <h3 className={`text-xs font-bold uppercase tracking-widest ${t.textMuted}`}>EMA Baseline Evolution</h3>
                            </div>
                            <p className={`text-sm ${t.textSecondary} mb-4 leading-relaxed`}>
                                Your personal baseline adapts via Exponential Moving Average (α=0.2). It updates only during normal behavior — stress windows are excluded to prevent contamination.
                            </p>

                            {/* Baseline metrics */}
                            {[
                                { feature: 'Dwell Time', initial: '118 ms', current: '124 ms', drift: '+5.1%' },
                                { feature: 'Flight Time', initial: '192 ms', current: '198 ms', drift: '+3.1%' },
                                { feature: 'Scroll Velocity', initial: '35 px/s', current: '38 px/s', drift: '+8.6%' },
                            ].map((item, i) => (
                                <div key={i} className={`flex items-center justify-between py-3 ${i < 2 ? `border-b ${t.divider}` : ''}`}>
                                    <span className={`text-sm ${t.text}`}>{item.feature}</span>
                                    <div className="text-right">
                                        <span className={`text-xs ${t.textMuted}`}>{item.initial} → </span>
                                        <span className={`text-sm font-bold ${t.text}`}>{item.current}</span>
                                        <span className={`text-[10px] ml-1.5 ${t.warningText}`}>{item.drift}</span>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Calibration Status */}
                        <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-4 mb-4`}>
                            <h3 className={`text-xs font-bold uppercase tracking-widest ${t.textMuted} mb-3`}>Calibration Status</h3>
                            <div className="space-y-3">
                                <div className="flex justify-between items-center">
                                    <span className={`text-sm ${t.textSecondary}`}>Status</span>
                                    <StatusBadge status="normal" />
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className={`text-sm ${t.textSecondary}`}>Days monitored</span>
                                    <span className={`text-sm font-bold ${t.text}`}>12</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className={`text-sm ${t.textSecondary}`}>Baseline updates</span>
                                    <span className={`text-sm font-bold ${t.text}`}>47</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className={`text-sm ${t.textSecondary}`}>Frozen windows (stress)</span>
                                    <span className={`text-sm font-bold ${t.warningText}`}>8</span>
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
