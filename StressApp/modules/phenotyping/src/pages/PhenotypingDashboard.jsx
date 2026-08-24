import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Wind, Calendar, RefreshCw, ShieldCheck, Activity } from 'lucide-react';
import { db } from '../firebase';
import { ref, onValue, query, limitToLast, get } from 'firebase/database';
import { BottomNav } from '../components/BottomNav';
import { MotionDetectionModal } from '../components/MotionDetectionModal';
import { useTheme } from '../context/ThemeContext';
import { getUserProfile, getCalibrationStatus } from '../utils/userStorage';



/**
 * Computes how far a live value is from a baseline mean.
 * Returns { pct: number, status: 'normal'|'elevated'|'anomalous', label: string }
 */
function computeDeviation(liveVal, baselineMean, baselineStd, higherIsBad = true) {
    if (!baselineMean || baselineMean === 0) return { pct: 0, status: 'normal', label: 'No baseline' };
    const pct = Math.round(((liveVal - baselineMean) / baselineMean) * 100);
    const zScore = Math.abs((liveVal - baselineMean) / (baselineStd || 1));
    let status = 'normal';
    if (zScore > 2.0) status = 'anomalous';
    else if (zScore > 1.0) status = 'elevated';
    const sign = pct > 0 ? '+' : '';
    const label = Math.abs(pct) < 3 ? 'Normal range' : `${sign}${pct}% vs baseline`;
    return { pct, zScore, status, label };
}

const MOOD_EMOJIS = {
    'Normal': { emoji: '😊', label: 'Feeling good' },
    'Low': { emoji: '😌', label: 'Slight tension' },
    'Moderate': { emoji: '😟', label: 'Moderate stress' },
    'High': { emoji: '😰', label: 'High stress' },
    'Calibrating': { emoji: '📊', label: 'Building baseline' },
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

function getGaugeColor(score, isCalibrating = false) {
    if (isCalibrating) return '#7c6bf7';
    if (score < 0.3) return '#10b981';
    if (score < 0.6) return '#f59e0b';
    return '#ef4444';
}

export default function PhenotypingDashboard() {
    const navigate = useNavigate();
    const { t, isDark } = useTheme();
    const [userProfile, setUserProfile] = useState(() => getUserProfile());
    const [calibStatus, setCalibStatus] = useState(() => getCalibrationStatus(userProfile));

    const [stressData, setStressData] = useState({ score: 0, label: 'Waiting for data' });
    const [prevScore, setPrevScore] = useState(null);
    const [liveWindow, setLiveWindow] = useState(null);
    const [baselines, setBaselines] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [showMotionModal, setShowMotionModal] = useState(false);
    const [alerts, setAlerts] = useState([]);

    const userId = userProfile?.userId;
    const userName = userProfile?.name || 'Participant';

    useEffect(() => {
        if (!userId) navigate('/');
    }, [userId]);

    useEffect(() => {
        const p = getUserProfile();
        setUserProfile(p);
        setCalibStatus(getCalibrationStatus(p));
    }, []);

    // ── 1. Live stress score from predictions ──────────────────────────────
    useEffect(() => {
        // Load from cache first for offline support
        const cached = localStorage.getItem(`cache_predictions_${userId}`);
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                setStressData(parsed.stressData);
                setPrevScore(parsed.prevScore);
            } catch (e) { console.error('Cache read error', e); }
        }

        const predictionsRef = query(ref(db, `phenotyping/predictions/${userId}`), limitToLast(2));
        const unsubscribe = onValue(predictionsRef, (snapshot) => {
            const val = snapshot.val();
            if (val) {
                const entries = Object.values(val);
                const latest = entries[entries.length - 1];

                let newPrevScore = null;
                if (entries.length >= 2) {
                    newPrevScore = entries[entries.length - 2].stress_score;
                }
                const newStressData = { score: latest.stress_score, label: latest.label };

                setPrevScore(newPrevScore);
                setStressData(newStressData);

                // Save to cache for offline support
                localStorage.setItem(`cache_predictions_${userId}`, JSON.stringify({
                    stressData: newStressData,
                    prevScore: newPrevScore
                }));
            }
        });
        return () => unsubscribe();
    }, [userId]);

    // ── 2. Live behavioral window + user baselines ─────────────────────────
    useEffect(() => {
        // Load logs from cache first
        const cachedLogs = localStorage.getItem(`cache_logs_${userId}`);
        if (cachedLogs) {
            try {
                const parsed = JSON.parse(cachedLogs);
                setLiveWindow(parsed.liveWindow);
                setLastUpdated(parsed.lastUpdated);
            } catch (e) { }
        }

        const logsRef = ref(db, `phenotyping/data_logs/${userId}`);
        const unsubLogs = onValue(logsRef, (snapshot) => {
            const raw = snapshot.val();
            if (raw) {
                const entries = Object.entries(raw);
                entries.sort((a, b) => a[0].localeCompare(b[0]));
                const [latestKey, latestData] = entries[entries.length - 1];

                setLiveWindow(latestData);
                setLastUpdated(latestKey);

                localStorage.setItem(`cache_logs_${userId}`, JSON.stringify({
                    liveWindow: latestData,
                    lastUpdated: latestKey
                }));
            }
        });

        // Load baselines from cache first
        const cachedBaselines = localStorage.getItem(`cache_baselines_${userId}`);
        if (cachedBaselines) {
            try { setBaselines(JSON.parse(cachedBaselines)); } catch (e) { }
        }

        const baselinesRef = ref(db, `phenotyping/users/${userId}/baselines`);
        get(baselinesRef).then((snap) => {
            if (snap.exists()) {
                const val = snap.val();
                setBaselines(val);
                localStorage.setItem(`cache_baselines_${userId}`, JSON.stringify(val));
            }
        });

        return () => unsubLogs();
    }, [userId]);

    const moodKey = calibStatus.phase === 'calibration' ? 'Calibrating' : (stressData.label || 'Normal');
    const mood = MOOD_EMOJIS[moodKey] || MOOD_EMOJIS['Normal'];
    const gaugeColor = getGaugeColor(stressData.score, calibStatus.phase === 'calibration');
    const scorePercent = Math.round(stressData.score * 100);

    // ── Compute live signal cards from Firebase data ───────────────────────
    const signals = useMemo(() => {
        const STATUS_COLOR = { normal: '#10b981', elevated: '#f59e0b', anomalous: '#ef4444' };

        if (!liveWindow) {
            return [
                { title: 'Typing pace', value: 'Syncing…', status: 'normal', color: '#6b7280' },
                { title: 'Flight time', value: 'Syncing…', status: 'normal', color: '#6b7280' },
                { title: 'Scroll speed', value: 'Syncing…', status: 'normal', color: '#6b7280' },
                { title: 'App switching', value: 'Syncing…', status: 'normal', color: '#6b7280' },
            ];
        }

        const bl = baselines || {};

        const dwell = computeDeviation(
            liveWindow.avg_dwell,
            bl.avg_dwell?.mean,
            bl.avg_dwell?.std,
            true
        );
        const dwellLabel = bl.avg_dwell
            ? dwell.label
            : `${Math.round(liveWindow.avg_dwell)} ms dwell`;

        const flight = computeDeviation(
            liveWindow.avg_flight,
            bl.avg_flight?.mean,
            bl.avg_flight?.std,
            true
        );
        const flightLabel = bl.avg_flight
            ? flight.label
            : `${Math.round(liveWindow.avg_flight)} ms flight`;

        const scroll = computeDeviation(
            liveWindow.scroll_velocity,
            bl.scroll_velocity?.mean,
            bl.scroll_velocity?.std,
            false
        );
        const scrollLabel = bl.scroll_velocity
            ? scroll.label
            : `${Math.round(liveWindow.scroll_velocity)} px/s`;

        const appSwitch = liveWindow.app_switch_rate ?? 0;
        const appDev = computeDeviation(appSwitch, bl.app_switch_rate?.mean, bl.app_switch_rate?.std, true);
        const appLabel = bl.app_switch_rate
            ? appDev.label
            : `${appSwitch.toFixed(1)} switches/min`;

        return [
            { title: 'Typing pace', value: dwellLabel, status: dwell.status, color: STATUS_COLOR[dwell.status] },
            { title: 'Flight time', value: flightLabel, status: flight.status, color: STATUS_COLOR[flight.status] },
            { title: 'Scroll speed', value: scrollLabel, status: scroll.status, color: STATUS_COLOR[scroll.status] },
            { title: 'App switching', value: appLabel, status: appDev.status, color: STATUS_COLOR[appDev.status] },
        ];
    }, [liveWindow, baselines]);

    const scoreDelta = prevScore !== null ? Math.round((stressData.score - prevScore) * 100) : null;
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

    function formatLastUpdated(key) {
        if (!key) return 'waiting for data…';
        try {
            const [, timePart] = key.split('_');
            const hh = timePart.slice(0, 2), mm = timePart.slice(2, 4);
            return `updated ${hh}:${mm}`;
        } catch { return 'updated recently'; }
    }

    const dismissAlert = (id) => {
        setAlerts(prev => prev.map(a => a.id === id ? { ...a, dismissed: true } : a));
    };

    return (
        <div className={`min-h-screen overflow-y-auto hide-scrollbar ${t.bg} ${t.text} flex flex-col font-sans pb-24 relative`}>
            {/* Main responsive container */}
            <div className="w-full max-w-5xl mx-auto flex-1 flex flex-col">

                {/* Header */}
                <header className="px-5 pt-5 pb-3 animate-fade-in flex justify-between items-start">
                    <div>
                        <p className={`text-xs ${t.textMuted} mb-0.5`}>{getDateStr()}</p>
                        <h2 className={`text-xl md:text-2xl font-bold ${t.text}`}>
                            {getGreeting()}, {userName}
                        </h2>
                    </div>
                    <button className="relative p-2 rounded-xl active:scale-90 transition-transform">
                        <Bell size={22} className={t.textMuted} />
                        {alerts.filter(a => !a.dismissed).length > 0 && (
                            <div className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-red-500 rounded-full border-2" style={{ borderColor: isDark ? '#0f0f14' : '#f5f5f7' }} />
                        )}
                    </button>
                </header>

                {/* Calibration vs Active Phase Banner */}
                <div className="px-5 mb-4 animate-fade-in">
                    {calibStatus.phase === 'calibration' ? (
                        <div className="p-4 rounded-2xl bg-[#7c6bf7]/10 border border-[#7c6bf7]/30 flex flex-col gap-2">
                            <div className="flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                    <Activity size={18} className="text-[#7c6bf7]" />
                                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                                        7-Day Calibration Path — {calibStatus.displayDays}
                                    </span>
                                </div>
                                <span className="text-xs font-bold text-[#7c6bf7]">{calibStatus.progressPct}%</span>
                            </div>
                            <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-[#7c6bf7] rounded-full transition-all duration-500"
                                    style={{ width: `${calibStatus.progressPct}%` }}
                                />
                            </div>
                            <p className="text-[11px] text-gray-400 leading-tight mt-0.5">
                                {calibStatus.title}. PhenoCare is gathering your behavioral baseline before predictions begin.
                            </p>
                        </div>
                    ) : (
                        <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                                <ShieldCheck size={18} className="text-emerald-400" />
                                <div>
                                    <p className="text-xs font-bold text-white">Active Monitoring (Day 8+)</p>
                                    <p className="text-[11px] text-emerald-400/90">Baseline calibrated — real-time pre-stress active</p>
                                </div>
                            </div>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 uppercase">
                                CALIBRATED
                            </span>
                        </div>
                    )}
                </div>

                {/* Dashboard Grid Layout (Responsive Desktop vs Mobile) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-5 mb-4">

                    {/* Left Column: Mood & Stress Gauge */}
                    <div className={`${t.card} border ${t.cardBorder} rounded-3xl p-6 flex flex-col items-center justify-center animate-fade-in-up`}>
                        <div className="text-4xl mb-2 animate-float">{mood.emoji}</div>
                        <p className={`text-xs font-medium ${t.textSecondary} mb-4`}>{mood.label}</p>

                        <div className="relative w-44 h-44 flex items-center justify-center">
                            <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 160 160">
                                <circle cx="80" cy="80" r="68" fill="transparent" stroke={isDark ? '#1e1e2e' : '#e5e5ea'} strokeWidth="10" />
                                <circle
                                    cx="80" cy="80" r="68" fill="transparent"
                                    stroke={gaugeColor}
                                    strokeWidth="10"
                                    strokeDasharray="427"
                                    strokeDashoffset={427 - (427 * (calibStatus.phase === 'calibration' ? 0.35 : stressData.score))}
                                    strokeLinecap="round"
                                    className="animate-gauge transition-all duration-1000"
                                    style={{ filter: `drop-shadow(0 0 8px ${gaugeColor}40)` }}
                                />
                            </svg>
                            <div className="text-center z-10">
                                {calibStatus.phase === 'calibration' ? (
                                    <>
                                        <span className={`text-3xl font-extrabold text-[#7c6bf7]`}>DAY {calibStatus.dayNumber}</span>
                                        <p className={`text-[9px] uppercase font-bold tracking-[0.2em] ${t.textMuted} mt-1`}>CALIBRATING</p>
                                        <p className="text-[11px] font-bold mt-0.5 text-gray-400">Baseline Phase</p>
                                    </>
                                ) : (
                                    <>
                                        <span className={`text-5xl font-extrabold tracking-tighter ${t.text}`}>{scorePercent}</span>
                                        <p className={`text-[9px] uppercase font-bold tracking-[0.2em] ${t.textMuted} mt-1`}>STRESS INDEX</p>
                                        <p className="text-xs font-bold mt-0.5" style={{ color: gaugeColor }}>{stressData.label}</p>
                                    </>
                                )}
                            </div>
                        </div>

                        {deltaText && calibStatus.phase !== 'calibration' && (
                            <p className="text-[11px] font-bold mt-3" style={{ color: deltaColor }}>{deltaText}</p>
                        )}
                    </div>

                    {/* Right Column: Live Signal Mini Cards */}
                    <div className="flex flex-col justify-between space-y-3">
                        <div className="flex justify-between items-center">
                            <h3 className={`text-xs font-bold uppercase tracking-widest ${t.textMuted}`}>Live signals</h3>
                            <button onClick={() => navigate('/signals')} className="text-[11px] font-bold text-[#7c6bf7]">
                                View all →
                            </button>
                        </div>

                        <div className="grid grid-cols-2 gap-2.5">
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
                                        className={`${t.card} border ${t.cardBorder} rounded-2xl p-4 text-left transition-all active:scale-[0.97] ${t.cardHover}`}
                                    >
                                        <div className="flex items-center gap-1.5 mb-2">
                                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: sc.dot }} />
                                            <span className={`text-[11px] font-semibold ${t.text}`}>{sig.title}</span>
                                        </div>
                                        <p className="text-xs font-bold" style={{ color: sig.color }}>{sig.value}</p>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Pre-Stress Alert (if active) */}
                        {alerts.filter(a => !a.dismissed).map(alert => (
                            <div key={alert.id} className={`p-4 rounded-2xl border animate-fade-in-up ${isDark ? 'bg-[#1a1228] border-[#7c6bf7]/30' : 'bg-indigo-50 border-indigo-200'}`}>
                                <div className="flex justify-between items-start mb-1">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm">⚠️</span>
                                        <span className={`text-xs font-bold ${isDark ? 'text-[#c0c0d8]' : 'text-indigo-800'}`}>Pre-stress alert</span>
                                    </div>
                                    <span className={`text-[10px] font-bold ${t.textDim}`}>{alert.time}</span>
                                </div>
                                <p className={`text-[11px] leading-relaxed mb-3 ${isDark ? 'text-gray-400' : 'text-indigo-700/80'}`}>
                                    {alert.message}
                                </p>
                                <div className="flex items-center gap-3">
                                    <button onClick={() => navigate('/alert-detail')} className="text-[11px] font-bold text-[#7c6bf7]">
                                        See triggers →
                                    </button>
                                    <span className={`text-[11px] ${t.textDim}`}>|</span>
                                    <button onClick={() => dismissAlert(alert.id)} className={`text-[11px] font-bold ${t.textDim}`}>
                                        Dismiss
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Quick Actions */}
                <div className="px-5 mb-6 animate-fade-in-up">
                    <h3 className={`text-xs font-bold uppercase tracking-widest ${t.textMuted} mb-3`}>Quick actions</h3>
                    <div className="grid grid-cols-4 gap-3">
                        {[
                            { emoji: '📝', label: 'EMA Survey', path: '/ema-survey' },
                            { emoji: '📊', label: 'History', path: '/analysis' },
                        ].map((action, i) => (
                            <button
                                key={i}
                                onClick={() => navigate(action.path)}
                                className={`flex flex-col items-center gap-1.5 py-4 px-2 rounded-2xl border ${t.card} ${t.cardBorder} transition-all active:scale-95 ${t.cardHover}`}
                            >
                                {action.emoji ? (
                                    <span className="text-xl">{action.emoji}</span>
                                ) : (
                                    <action.icon size={20} className="text-[#7c6bf7]" />
                                )}
                                <span className={`text-xs font-bold ${t.textSecondary} text-center`}>{action.label}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <p className={`text-center text-[10px] ${t.textDim} font-bold uppercase tracking-widest pb-4`}>
                    {liveWindow ? formatLastUpdated(lastUpdated) : 'waiting for first reading…'}
                </p>

            </div>

            <BottomNav />
            <MotionDetectionModal
                isOpen={showMotionModal}
                onClose={() => setShowMotionModal(false)}
                onConfirm={(val) => console.log('Motion:', val)}
            />
        </div>
    );
}