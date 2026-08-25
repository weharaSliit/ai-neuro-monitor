import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Wind, Calendar, RefreshCw, ShieldCheck, Activity } from 'lucide-react';
import { db } from '../firebase';
import { ref, onValue, query, limitToLast, get } from 'firebase/database';
import { BottomNav } from '../components/BottomNav';
import { MotionDetectionModal } from '../components/MotionDetectionModal';
import { EmaSurveyModal } from '../components/EmaSurveyModal';
import { SignalDetailCard } from '../components/SignalDetailCard';
import { useTheme } from '../context/ThemeContext';
import { getUserProfile, getCalibrationStatus, markCalibrated } from '../utils/userStorage';

// Same pattern already used for /behavior/label calls in EmaSurvey.jsx / EmaSurveyModal.jsx
const FLASK_BASE_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:5001";

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
    const [recentLogs, setRecentLogs] = useState([]);
    const [baselines, setBaselines] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [showMotionModal, setShowMotionModal] = useState(false);
    const [showEmaModal, setShowEmaModal] = useState(false);
    const [emaInitialTab, setEmaInitialTab] = useState('siss');
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

    // ── 1b. Auto-trigger real calibration once 7 days have passed ──────────
    // FIX: previously NOTHING in the app ever called /behavior/calibrate —
    // the dashboard just claimed "calibrated" once 7 calendar days had
    // elapsed, regardless of whether the backend ever computed a real
    // personal baseline. This effect actually calls the endpoint once real
    // conditions are plausibly met, and only updates the local "calibrated"
    // flag (via markCalibrated()) if the backend confirms it genuinely
    // succeeded — matching the day-count text in the UI to backend reality.
    //
    // Throttled to once per calendar day per user so a user who doesn't yet
    // have enough windows (backend returns "insufficient_data") doesn't get
    // hammered with a retry on every dashboard visit.
    useEffect(() => {
        if (!userId || calibStatus.isCalibrated || calibStatus.dayNumber < 7) return;

        const throttleKey = `calibrate_attempt_${userId}`;
        const today = new Date().toISOString().slice(0, 10);
        if (localStorage.getItem(throttleKey) === today) return;
        localStorage.setItem(throttleKey, today);

        fetch(`${FLASK_BASE_URL}/behavior/calibrate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, name: userName }),
        })
            .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
            .then(({ ok, data }) => {
                if (ok && data.status === 'calibrated') {
                    console.log('[Calibration] Backend confirmed real calibration:', data.window_count, 'windows');
                    const updated = markCalibrated();
                    if (updated) {
                        setUserProfile(updated);
                        setCalibStatus(getCalibrationStatus(updated));
                    }
                } else {
                    console.log('[Calibration] Not ready yet:', data.status || data.message);
                }
            })
            .catch((e) => console.warn('[Calibration] Auto-calibrate request failed (will retry tomorrow):', e));
    }, [userId, userName, calibStatus.isCalibrated, calibStatus.dayNumber]);

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
                setRecentLogs(parsed.recentLogs || []);
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
                const sliced = entries.map(e => e[1]).slice(-10);

                setLiveWindow(latestData);
                setRecentLogs(sliced);
                setLastUpdated(latestKey);

                localStorage.setItem(`cache_logs_${userId}`, JSON.stringify({
                    liveWindow: latestData,
                    recentLogs: sliced,
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

    // ── Compute 4 Digital Signal Cards (Same as Digital Signals page) ───────
    const digitalSignals = useMemo(() => {
        if (!liveWindow || recentLogs.length === 0) {
            const emptyBars = Array(10).fill({ val: 0, active: false });
            return [
                { signalId: 'keyboard', title: '⌨️ Keyboard Patterns', value: '-- ms', subtext: 'Typing rhythm & key press duration', colorClass: 'bg-zinc-600', bars: emptyBars, trend: null, status: 'normal' },
                { signalId: 'screen', title: '📱 Screen Activity', value: '-- /min', subtext: 'App switching rate & multitasking rhythm', colorClass: 'bg-zinc-600', bars: emptyBars, trend: null, status: 'normal' },
                { signalId: 'scroll', title: '📜 Screen Scrolling', value: '-- px/s', subtext: 'Scroll speed & frequency patterns', colorClass: 'bg-zinc-600', bars: emptyBars, trend: null, status: 'normal' },
                { signalId: 'activity', title: '🚶 Activity Context', value: '--', subtext: 'Physical activity detection & noise gate', colorClass: 'bg-zinc-600', bars: emptyBars, trend: null, status: 'normal' },
            ];
        }

        const dwellHistory = recentLogs.map((e, idx) => ({ val: e.avg_dwell || 0, active: idx === recentLogs.length - 1 }));
        const flightHistory = recentLogs.map((e, idx) => ({ val: e.avg_flight || 0, active: idx === recentLogs.length - 1 }));
        const scrollHistory = recentLogs.map((e, idx) => ({ val: e.scroll_velocity || 0, active: idx === recentLogs.length - 1 }));
        const switchHistory = recentLogs.map((e, idx) => ({ val: e.app_switch_rate || 0, active: idx === recentLogs.length - 1 }));
        // FIX: was Math.random()-generated fake bars. Real signal: each
        // window's data_valid flag (false = motion or a distraction app was
        // in the foreground; see KeystrokeCollectorService.java's combined
        // noise gate). Mapped to a magnitude so the chart reads the same way
        // as the other cards (high = clean/stationary, low = noisy window).
        const activityHistory = recentLogs.map((e, idx) => ({ val: e.data_valid === false ? 40 : 100, active: idx === recentLogs.length - 1 }));

        const appSwitchRate = liveWindow.app_switch_rate !== undefined ? Number(liveWindow.app_switch_rate).toFixed(1) : '0.0';

        return [
            {
                signalId: 'keyboard',
                title: '⌨️ Keyboard Patterns',
                value: `${Math.round(liveWindow.avg_dwell || 0)} ms`,
                subtext: 'Typing rhythm & key press duration',
                colorClass: 'bg-emerald-500',
                bars: dwellHistory,
                trend: (liveWindow.avg_dwell || 0) > 130 ? 'up' : 'down',
                status: (liveWindow.avg_dwell || 0) > 150 ? 'anomalous' : (liveWindow.avg_dwell || 0) > 130 ? 'elevated' : 'normal',
            },
            {
                signalId: 'screen',
                title: '📱 Screen Activity: Screen On/Off & App Switching',
                value: `${appSwitchRate} /min`,
                subtext: 'App switching rate & multitasking rhythm',
                colorClass: 'bg-orange-500',
                bars: switchHistory,
                trend: parseFloat(appSwitchRate) > 3.0 ? 'up' : 'down',
                status: parseFloat(appSwitchRate) > 4.0 ? 'anomalous' : parseFloat(appSwitchRate) > 2.5 ? 'elevated' : 'normal',
            },
            {
                signalId: 'scroll',
                title: '📜 Screen Scrolling',
                value: `${Math.round(liveWindow.scroll_velocity || 0)} px/s`,
                subtext: 'Scroll speed & frequency patterns',
                colorClass: 'bg-emerald-500',
                bars: scrollHistory,
                trend: (liveWindow.scroll_velocity || 0) > 50 ? 'up' : 'down',
                status: (liveWindow.scroll_velocity || 0) > 60 ? 'elevated' : 'normal',
            },
            {
                signalId: 'activity',
                title: '🚶 Activity Context',
                value: liveWindow.data_valid === false ? 'In motion' : 'Stationary',
                subtext: liveWindow.data_valid === false
                    ? 'Motion detected — window excluded from baseline'
                    : 'Physical activity detection & noise gate',
                colorClass: liveWindow.data_valid === false ? 'bg-orange-500' : 'bg-emerald-500',
                bars: activityHistory,
                trend: null,
                status: liveWindow.data_valid === false ? 'elevated' : 'normal',
            }
        ];
    }, [liveWindow, recentLogs]);

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
            <div className="w-full max-w-md md:max-w-xl mx-auto flex-1 flex flex-col">

                {/* Header */}
                <header className="px-5 pt-5 pb-3 animate-fade-in flex justify-between items-center">
                    <div>
                        <p className={`text-xs ${t.textMuted} mb-0.5`}>{getDateStr()}</p>
                        <h2 className={`text-xl md:text-2xl font-bold ${t.text}`}>
                            {getGreeting()}, {userName}
                        </h2>
                    </div>
                    {/* EMA Survey Button in Top Right Corner */}
                    <button
                        onClick={() => { setEmaInitialTab('siss'); setShowEmaModal(true); }}
                        className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-[#7c6bf7]/15 hover:bg-[#7c6bf7]/25 border border-[#7c6bf7]/35 text-white active:scale-95 transition-all shadow-sm group cursor-pointer"
                    >
                        <span className="text-base group-hover:scale-110 transition-transform">📝</span>
                        <span className="text-xs font-extrabold text-[#7c6bf7]">EMA Survey</span>
                    </button>
                </header>

                {/* Centered Mood & Stress Gauge (Clean, without box outline or mood icon/text) */}
                <div className="flex flex-col items-center justify-center my-6 animate-fade-in-up">
                    <div className="relative w-48 h-48 flex items-center justify-center">
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
                                    <span className="text-3xl font-extrabold text-[#7c6bf7]">DAY {calibStatus.dayNumber}</span>
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

                {/* Digital Signals Section (Moved under the Circle Gauge) */}
                <div className="px-5 mb-5 animate-fade-in-up">
                    <div className="flex justify-between items-center mb-3">
                        <div>
                            <h3 className={`text-base font-bold ${t.text}`}>Digital Signals</h3>
                            <p className={`text-xs ${t.textMuted}`}>Live behavioral metrics from your device. Tap any card for detailed breakdown.</p>
                        </div>
                    </div>
                    <div className="space-y-3 stagger-children">
                        {digitalSignals.map((s, i) => (
                            <SignalDetailCard key={i} {...s} />
                        ))}
                    </div>
                </div>

                {/* Pre-Stress Alert (if active) */}
                {alerts.filter(a => !a.dismissed).map(alert => (
                    <div key={alert.id} className={`mx-5 mb-5 p-4 rounded-2xl border animate-fade-in-up ${isDark ? 'bg-[#1a1228] border-[#7c6bf7]/30' : 'bg-indigo-50 border-indigo-200'}`}>
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

                {/* Quick Actions */}
                <div className="px-5 mb-6 animate-fade-in-up">
                    <h3 className={`text-xs font-bold uppercase tracking-widest ${t.textMuted} mb-3`}>Quick actions</h3>
                    <div className="grid grid-cols-4 gap-3">
                        {[
                            { emoji: '⚡', label: 'Quick Check', onClick: () => { setEmaInitialTab('siss'); setShowEmaModal(true); } },
                            { emoji: '✨', label: 'Weekly PSS', onClick: () => { setEmaInitialTab('pss4'); setShowEmaModal(true); } },
                            { emoji: '📊', label: 'Analysis', onClick: () => navigate('/analysis') },
                            { emoji: '📈', label: 'Patterns', onClick: () => navigate('/patterns') },
                        ].map((action, i) => (
                            <button
                                key={i}
                                onClick={action.onClick}
                                className={`flex flex-col items-center gap-1.5 py-4 px-2 rounded-2xl border ${t.card} ${t.cardBorder} transition-all active:scale-95 ${t.cardHover} cursor-pointer`}
                            >
                                <span className="text-xl">{action.emoji}</span>
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
            <EmaSurveyModal
                isOpen={showEmaModal}
                onClose={() => setShowEmaModal(false)}
                initialTab={emaInitialTab}
            />
        </div>
    );
}