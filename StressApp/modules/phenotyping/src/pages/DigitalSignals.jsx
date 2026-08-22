import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { ref, onValue } from 'firebase/database';
import { SignalDetailCard } from '../components/SignalDetailCard';
import { BottomNav } from '../components/BottomNav';
import { useTheme } from '../context/ThemeContext';
import { Loader2 } from 'lucide-react';
import { getUserProfile } from '../utils/userStorage';

export function DigitalSignals() {
    const navigate = useNavigate();
    const { t, isDark } = useTheme();
    const [metrics, setMetrics] = useState(null);
    const [loading, setLoading] = useState(true);

    const profile = getUserProfile();
    const userId = profile?.userId;

    // Redirect unregistered users back to onboarding
    useEffect(() => {
        if (!userId) navigate('/');
    }, [userId]);

    useEffect(() => {
        if (!userId) return;

        const cached = localStorage.getItem(`cache_digital_signals_${userId}`);
        if (cached) {
            try {
                setMetrics(JSON.parse(cached));
                setLoading(false);
            } catch (e) {}
        }

        const metricsRef = ref(db, `phenotyping/data_logs/${userId}`);
        const unsubscribe = onValue(metricsRef, (snapshot) => {
            const rawData = snapshot.val();
            const formattedSignals = [];

            if (rawData) {
                const entries = Object.values(rawData);
                const latest = entries[entries.length - 1];
                const recentEntries = entries.slice(-10);

                const dwellHistory = recentEntries.map((e, idx) => ({ val: e.avg_dwell, active: idx === recentEntries.length - 1 }));
                const scrollHistory = recentEntries.map((e, idx) => ({ val: e.scroll_velocity, active: idx === recentEntries.length - 1 }));
                const unlockHistory = recentEntries.map((e, idx) => ({ val: e.unlocks_count || 0, active: idx === recentEntries.length - 1 }));

                formattedSignals.push(
                    {
                        signalId: 'keyboard',
                        title: '⌨️ Keyboard Patterns',
                        value: `${Math.round(latest.avg_dwell)} ms`,
                        subtext: 'Typing rhythm & key press duration',
                        colorClass: 'bg-emerald-500',
                        bars: dwellHistory,
                        trend: latest.avg_dwell > 130 ? 'up' : 'down',
                        status: latest.avg_dwell > 150 ? 'anomalous' : latest.avg_dwell > 130 ? 'elevated' : 'normal',
                    },
                    {
                        signalId: 'screen',
                        title: '📱 Screen On/Off Times',
                        value: `${latest.unlocks_count || 0} unlocks`,
                        subtext: 'Unlock frequency & session duration',
                        colorClass: 'bg-orange-500',
                        bars: unlockHistory,
                        trend: (latest.unlocks_count || 0) > 20 ? 'up' : 'down',
                        status: (latest.unlocks_count || 0) > 30 ? 'elevated' : 'normal',
                    },
                    {
                        signalId: 'scroll',
                        title: '📜 Screen Scrolling',
                        value: `${Math.round(latest.scroll_velocity)} px/s`,
                        subtext: 'Scroll speed & frequency patterns',
                        colorClass: 'bg-emerald-500',
                        bars: scrollHistory,
                        trend: latest.scroll_velocity > 50 ? 'up' : 'down',
                        status: latest.scroll_velocity > 60 ? 'elevated' : 'normal',
                    },
                    {
                        signalId: 'activity',
                        title: '🚶 Activity Context',
                        value: latest.data_valid === false ? 'In motion' : 'Stationary',
                        subtext: latest.data_valid === false
                            ? 'Motion detected — window excluded from baseline'
                            : 'Physical activity detection & noise gate',
                        colorClass: latest.data_valid === false ? 'bg-orange-500' : 'bg-emerald-500',
                        bars: activityHistory,
                        trend: null,
                        status: latest.data_valid === false ? 'elevated' : 'normal',
                    }
                );
            } else {
                // Empty state placeholders when Firebase has no data
                const emptyBars = Array(10).fill({ val: 0, active: false });
                formattedSignals.push(
                    { signalId: 'keyboard', title: '⌨️ Keyboard Patterns', value: '-- ms', subtext: 'Typing rhythm & key press duration', colorClass: 'bg-zinc-600', bars: emptyBars, trend: null, status: 'pending' },
                    { signalId: 'scroll', title: '📜 Screen Scrolling', value: '-- px/s', subtext: 'Scroll speed & frequency patterns', colorClass: 'bg-zinc-600', bars: emptyBars, trend: null, status: 'pending' },
                    { signalId: 'activity', title: '🚶 Activity Context', value: '--', subtext: 'Physical activity detection & noise gate', colorClass: 'bg-zinc-600', bars: emptyBars, trend: null, status: 'pending' },
                );
            }

            setMetrics(formattedSignals);
            setLoading(false);
            localStorage.setItem(`cache_digital_signals_${userId}`, JSON.stringify(formattedSignals));
        });

        return () => unsubscribe();
    }, [userId]);

    // Guard: while redirect is in progress, render nothing
    if (!userId) return null;

    if (loading) return (
        <div className={`h-screen ${t.bg} flex flex-col items-center justify-center gap-3`}>
            <Loader2 size={28} className="text-[#7c6bf7] animate-spin" />
            <p className={`text-sm ${t.textMuted}`}>Syncing with sensors...</p>
        </div>
    );

    return (
        <div className={`h-screen ${t.bg} ${t.text} flex flex-col font-sans pb-24 overflow-y-auto hide-scrollbar max-w-md mx-auto shadow-2xl`}>
            {/* Header */}
            <div className="px-5 pt-5 pb-3 animate-fade-in">
                <h1 className={`text-xl font-bold ${t.text} mb-1`}>Digital Signals</h1>
                <p className={`text-xs ${t.textMuted} leading-relaxed`}>
                    Live behavioral metrics from your device. Tap any card for detailed breakdown.
                </p>
            </div>

            {/* Signal Cards */}
            <div className="px-5 flex-1 stagger-children">
                {metrics && metrics.map((s, i) => (
                    <SignalDetailCard key={i} {...s} />
                ))}
            </div>

            <p className={`text-center text-[10px] ${t.textDim} font-bold uppercase tracking-widest py-3`}>
                3 signals actively monitoring
            </p>

            <BottomNav />
        </div>
    );
}