import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Wind, BookOpen, Clock } from 'lucide-react';
import { db } from '../firebase';
import { ref, onValue, query, limitToLast, get } from 'firebase/database';
import { BottomNav } from '../components/BottomNav';
import { MotionDetectionModal } from '../components/MotionDetectionModal';
import { useTheme } from '../context/ThemeContext';

// ─── Shared user ID — must match Android KeystrokeCollectorService ───
export const PHENOTYPING_USER_ID = 'chathurika_001';

/**
 * Computes how far a live value is from a baseline mean.
 * Returns { pct: number, status: 'normal'|'elevated'|'anomalous', label: string }
 */
function computeDeviation(liveVal, baselineMean, baselineStd, higherIsBad = true) {
    if (!baselineMean || baselineMean === 0) return { pct: 0, status: 'normal', label: 'No baseline' };
    const pct = Math.round(((liveVal - baselineMean) / baselineMean) * 100);
    const zScore = Math.abs((liveVal - baselineMean) / (baselineStd || 1));
    const isHigh = higherIsBad ? liveVal > baselineMean : liveVal < baselineMean;
    let status = 'normal';
    if (zScore > 2.0) status = 'anomalous';
    else if (zScore > 1.0) status = 'elevated';
    const sign = pct > 0 ? '+' : '';
    const label = Math.abs(pct) < 3 ? 'Normal range' : `${sign}${pct}% vs baseline`;
    return { pct, zScore, status, label, isHigh };
}

const MOOD_EMOJIS = {
    'Normal': { emoji: '😊', label: 'Feeling good' },
    'Low': { emoji: '😌', label: 'Slight tension' },
    'Moderate': { emoji: '😟', label: 'Moderate stress' },
    'High': { emoji: '😰', label: 'High stress' },
};

function getGreeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
}

function getDateStr() {
    return new Date().toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
}

function getGaugeColor(score) {
    if (score < 0.3) return '#10b981';
    if (score < 0.6) return '#f59e0b';
    return '#ef4444';
}

export default function PhenotypingDashboard() {
    const navigate = useNavigate();
    const { t, isDark } = useTheme();
    const [stressData, setStressData] = useState({ score: 0.64, label: 'Moderate' });
    const [prevScore, setPrevScore] = useState(null);       // for delta text
    const [liveWindow, setLiveWindow] = useState(null);     // latest data_log entry
    const [baselines, setBaselines] = useState(null);       // user EMA baselines
    const [lastUpdated, setLastUpdated] = useState(null);   // timestamp of last window
    const [showMotionModal, setShowMotionModal] = useState(false);
    const [alerts, setAlerts] = useState([
        {
            id: 1,
            message: 'Your behavior is outside your usual pattern — 3 signals are elevated.',
            time: '2h ago',
            dismissed: false,
        }
    ]);
    const userId = PHENOTYPING_USER_ID;

    // ── 1. Live stress score from predictions ──────────────────────────────
    useEffect(() => {
        const predictionsRef = query(ref(db, `phenotyping/predictions/${userId}`), limitToLast(2));
        const unsubscribe = onValue(predictionsRef, (snapshot) => {
            const val = snapshot.val();
            if (val) {
                const entries = Object.values(val);
                const latest = entries[entries.length - 1];
                if (entries.length >= 2) {
                    setPrevScore(entries[entries.length - 2].stress_score);
                }
                setStressData({ score: latest.stress_score, label: latest.label });
            }
        });
        return () => unsubscribe();
    }, []);

    // ── 2. Live behavioral window + user baselines ─────────────────────────
    useEffect(() => {
        // Subscribe to latest data_log entry (real-time)
        const logsRef = ref(db, `phenotyping/data_logs/${userId}`);
        const unsubLogs = onValue(logsRef, (snapshot) => {
            const raw = snapshot.val();
            if (raw) {
                const entries = Object.entries(raw); // [[timestamp, data], ...]
                // Sort by key (timestamp string YYYYMMDD_HHMMSS sorts lexicographically)
                entries.sort((a, b) => a[0].localeCompare(b[0]));
                const [latestKey, latestData] = entries[entries.length - 1];
                setLiveWindow(latestData);
                setLastUpdated(latestKey);
            }
        });

        // Fetch baselines once (they update slowly via EMA, no need to stream)
        const baselinesRef = ref(db, `phenotyping/users/${userId}/baselines`);
        get(baselinesRef).then((snap) => {
            if (snap.exists()) setBaselines(snap.val());
        });

        return () => unsubLogs();
    }, []);

    const mood = MOOD_EMOJIS[stressData.label] || MOOD_EMOJIS['Normal'];
    const gaugeColor = getGaugeColor(stressData.score);
    const scorePercent = Math.round(stressData.score * 100);

    // ── Compute live signal cards from Firebase data ───────────────────────
    const signals = React.useMemo(() => {
        const STATUS_COLOR = { normal: '#10b981', elevated: '#f59e0b', anomalous: '#ef4444' };

        if (!liveWindow) {
            // Pre-data fallback — clearly marked as awaiting sync
            return [
                { title: 'Typing pace', value: 'Syncing…', status: 'normal', color: '#6b7280' },
                { title: 'Flight time', value: 'Syncing…', status: 'normal', color: '#6b7280' },
                { title: 'Scroll speed', value: 'Syncing…', status: 'normal', color: '#6b7280' },
                { title: 'Interaction rate', value: 'Syncing…', status: 'normal', color: '#6b7280' },
            ];
        }

        const bl = baselines || {}; // may be null if user not calibrated yet

        // --- Card 1: Dwell time (typing pace) ---
        const dwell = computeDeviation(
            liveWindow.avg_dwell,
            bl.avg_dwell?.mean,
            bl.avg_dwell?.std,
            true // slower dwell = more stress
        );
        const dwellLabel = bl.avg_dwell
            ? dwell.label
            : `${Math.round(liveWindow.avg_dwell)} ms dwell`;

        // --- Card 2: Flight time (inter-key interval) ---
        const flight = computeDeviation(
            liveWindow.avg_flight,
            bl.avg_flight?.mean,
            bl.avg_flight?.std,
            true
        );
        const flightLabel = bl.avg_flight
            ? flight.label
            : `${Math.round(liveWindow.avg_flight)} ms flight`;

        // --- Card 3: Scroll velocity ---
        const scroll = computeDeviation(
            liveWindow.scroll_velocity,
            bl.scroll_velocity?.mean,
            bl.scroll_velocity?.std,
            false // slower scroll = potentially stressed
        );
        const scrollLabel = bl.scroll_velocity
            ? scroll.label
            : `${Math.round(liveWindow.scroll_velocity)} px/s`;

        // --- Card 4: Interaction rate ---
        const intRate = liveWindow.interaction_rate ?? 0;
        const intBaselineMean = bl.interaction_rate?.mean;
        const intDev = computeDeviation(intRate, intBaselineMean, bl.interaction_rate?.std, false);
        const intLabel = intBaselineMean
            ? intDev.label
            : `${intRate.toFixed(1)} evt/s`;

        return [
            { title: 'Typing pace',     value: dwellLabel,  status: dwell.status,  color: STATUS_COLOR[dwell.status]  },
            { title: 'Flight time',     value: flightLabel, status: flight.status, color: STATUS_COLOR[flight.status] },
            { title: 'Scroll speed',    value: scrollLabel, status: scroll.status, color: STATUS_COLOR[scroll.status] },
            { title: 'Interaction rate',value: intLabel,    status: intDev.status, color: STATUS_COLOR[intDev.status] },
        ];
    }, [liveWindow, baselines]);

    // ── Score delta vs previous prediction ────────────────────────────────
    const scoreDelta = prevScore !== null
        ? Math.round((stressData.score - prevScore) * 100)
        : null;
    const deltaText = scoreDelta === null
        ? null
        : scoreDelta === 0
            ? 'No change since last reading'
            : scoreDelta > 0
                ? `↑ ${scoreDelta} pts since last reading`
                : `↓ ${Math.abs(scoreDelta)} pts since last reading`;
    const deltaColor = scoreDelta === null || scoreDelta === 0
        ? '#6b7280'
        : scoreDelta > 0 ? '#ef4444' : '#10b981';

    // ── Format last-updated timestamp ─────────────────────────────────────
    function formatLastUpdated(key) {
        if (!key) return 'waiting for data…';
        // Key format: YYYYMMDD_HHMMSS
        try {
            const [datePart, timePart] = key.split('_');
            const hh = timePart.slice(0, 2), mm = timePart.slice(2, 4);
            return `updated ${hh}:${mm}`;
        } catch { return 'updated recently'; }
    }

    const dismissAlert = (id) => {
        setAlerts(prev => prev.map(a => a.id === id ? { ...a, dismissed: true } : a));
    };

    return (
        <div className={`h-screen overflow-y-auto hide-scrollbar ${t.bg} ${t.text} flex flex-col font-sans pb-24 max-w-md mx-auto shadow-2xl relative`}>
            {/* Header */}
            <header className="px-5 pt-5 pb-3 animate-fade-in">
                <div className="flex justify-between items-start">
                    <div>
                        <p className={`text-xs ${t.textMuted} mb-0.5`}>{getDateStr()}</p>
                        <h2 className={`text-xl font-bold ${t.text}`}>
                            {getGreeting()}, Chathurika
                        </h2>
                    </div>
                    <button className="relative p-2 rounded-xl active:scale-90 transition-transform">
                        <Bell size={22} className={t.textMuted} />
                        {alerts.filter(a => !a.dismissed).length > 0 && (
                            <div className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-red-500 rounded-full border-2" style={{ borderColor: isDark ? '#0f0f14' : '#f5f5f7' }} />
                        )}
                    </button>
                </div>
            </header>

            {/* Mood + Stress Gauge */}
            <div className="flex flex-col items-center py-4 animate-fade-in-up">
                {/* Emoji mood indicator */}
                <div className="text-4xl mb-2 animate-float">{mood.emoji}</div>
                <p className={`text-xs font-medium ${t.textSecondary} mb-5`}>{mood.label}</p>

                {/* Circular Gauge */}
                <div className="relative w-44 h-44 flex items-center justify-center">
                    <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 160 160">
                        <circle cx="80" cy="80" r="68" fill="transparent" stroke={isDark ? '#1e1e2e' : '#e5e5ea'} strokeWidth="10" />
                        <circle
                            cx="80" cy="80" r="68" fill="transparent"
                            stroke={gaugeColor}
                            strokeWidth="10"
                            strokeDasharray="427"
                            strokeDashoffset={427 - (427 * stressData.score)}
                            strokeLinecap="round"
                            className="animate-gauge transition-all duration-1000"
                            style={{ filter: `drop-shadow(0 0 8px ${gaugeColor}40)` }}
                        />
                    </svg>
                    {/* Pulsing glow ring */}
                    {stressData.score > 0.5 && (
                        <div className="absolute inset-0 rounded-full animate-pulse-glow" style={{ boxShadow: `0 0 30px ${gaugeColor}20` }} />
                    )}
                    <div className="text-center z-10">
                        <span className={`text-5xl font-extrabold tracking-tighter ${t.text}`}>{scorePercent}</span>
                        <p className={`text-[9px] uppercase font-bold tracking-[0.2em] ${t.textMuted} mt-1`}>stress index</p>
                        <p className="text-xs font-bold mt-0.5" style={{ color: gaugeColor }}>{stressData.label}</p>
                    </div>
                </div>
                {deltaText && (
                    <p className="text-[11px] font-bold mt-3" style={{ color: deltaColor }}>{deltaText}</p>
                )}
            </div>

            {/* Today's Signals (mini cards) */}
            <div className="px-5 mb-4 animate-fade-in-up">
                <div className="flex justify-between items-center mb-3">
                    <h3 className={`text-xs font-bold uppercase tracking-widest ${t.textMuted}`}>Today's signals</h3>
                    <button onClick={() => navigate('/signals')} className="text-[11px] font-bold text-[#7c6bf7]">
                        View all →
                    </button>
                </div>
                <div className="grid grid-cols-2 gap-2.5 stagger-children">
                    {signals.map((sig, i) => {
                        const statusColors = {
                            normal: { bg: isDark ? 'rgba(16,185,129,0.08)' : 'rgba(16,185,129,0.06)', dot: '#10b981' },
                            elevated: { bg: isDark ? 'rgba(245,158,11,0.08)' : 'rgba(245,158,11,0.06)', dot: '#f59e0b' },
                            anomalous: { bg: isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.06)', dot: '#ef4444' },
                        };
                        const sc = statusColors[sig.status] || statusColors.normal;

                        return (
                            <button
                                key={i}
                                onClick={() => navigate('/signals')}
                                className={`${t.card} border ${t.cardBorder} rounded-2xl p-3.5 text-left transition-all active:scale-[0.97] ${t.cardHover}`}
                            >
                                <div className="flex items-center gap-1.5 mb-2">
                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: sc.dot }} />
                                    <span className={`text-[11px] font-semibold ${t.text}`}>{sig.title}</span>
                                </div>
                                <p className="text-[11px] font-bold" style={{ color: sig.color }}>{sig.value}</p>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Pre-Stress Alert */}
            {alerts.filter(a => !a.dismissed).map(alert => (
                <div key={alert.id} className={`mx-5 mb-4 p-5 rounded-3xl border animate-fade-in-up ${isDark ? 'bg-[#1a1228] border-[#7c6bf7]/30' : 'bg-indigo-50 border-indigo-200'}`}
                    style={{ boxShadow: isDark ? '0 0 30px rgba(124,107,247,0.08)' : 'none' }}>
                    <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                            <span className="text-sm">⚠️</span>
                            <span className={`text-xs font-bold ${isDark ? 'text-[#c0c0d8]' : 'text-indigo-800'}`}>Pre-stress alert</span>
                        </div>
                        <span className={`text-[10px] font-bold ${t.textDim}`}>{alert.time}</span>
                    </div>
                    <p className={`text-xs leading-relaxed mb-4 ${isDark ? 'text-gray-400' : 'text-indigo-700/80'}`}>
                        {alert.message}
                    </p>
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => navigate('/alert-detail')}
                            className="text-[11px] font-bold text-[#7c6bf7] active:opacity-70"
                        >
                            See what triggered it →
                        </button>
                        <span className={`text-[11px] ${t.textDim}`}>|</span>
                        <button
                            onClick={() => dismissAlert(alert.id)}
                            className={`text-[11px] font-bold ${t.textDim} active:opacity-70`}
                        >
                            I'm fine, dismiss
                        </button>
                    </div>
                </div>
            ))}

            {/* Quick Actions */}
            <div className="px-5 mb-6 animate-fade-in-up">
                <h3 className={`text-xs font-bold uppercase tracking-widest ${t.textMuted} mb-3`}>Quick actions</h3>
                <div className="grid grid-cols-4 gap-2">
                    {[
                        { emoji: '📝', label: 'EMA Survey', path: '/ema-survey' },
                        { emoji: '💡', label: 'Log mood', path: '/toolkit' },
                        { emoji: '📊', label: 'History', path: '/analysis' },
                        { icon: Wind, label: 'Breathe', path: '/toolkit' },
                    ].map((action, i) => (
                        <button
                            key={i}
                            onClick={() => navigate(action.path)}
                            className={`flex flex-col items-center gap-1.5 py-3.5 px-1 rounded-2xl border ${t.card} ${t.cardBorder} transition-all active:scale-95 ${t.cardHover}`}
                        >
                            {action.emoji ? (
                                <span className="text-xl">{action.emoji}</span>
                            ) : (
                                <action.icon size={20} className="text-[#7c6bf7]" />
                            )}
                            <span className={`text-[10px] font-bold ${t.textSecondary} text-center`}>{action.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            <p className={`text-center text-[10px] ${t.textDim} font-bold uppercase tracking-widest pb-4`}>
                {liveWindow ? formatLastUpdated(lastUpdated) : 'waiting for first reading…'}
            </p>

            <BottomNav />
            <MotionDetectionModal
                isOpen={showMotionModal}
                onClose={() => setShowMotionModal(false)}
                onConfirm={(val) => console.log('Motion:', val)}
            />
        </div>
    );
}