import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { ref, onValue } from 'firebase/database';
import { SignalDetailCard } from '../components/SignalDetailCard';
import { BottomNav } from '../components/BottomNav';
import { useTheme } from '../context/ThemeContext';
import { Loader2 } from 'lucide-react';

// Mock data generators for the 2 new signals
function generateMockBars(count = 10, min = 20, max = 80) {
    return Array.from({ length: count }, (_, i) => ({
        val: min + Math.random() * (max - min),
        active: i === count - 1,
    }));
}

export function DigitalSignals() {
    const { t, isDark } = useTheme();
    const [metrics, setMetrics] = useState(null);
    const [loading, setLoading] = useState(true);
    const userId = 'demo_user_123';

    useEffect(() => {
        const metricsRef = ref(db, `phenotyping/data_logs/${userId}`);
        const unsubscribe = onValue(metricsRef, (snapshot) => {
            const rawData = snapshot.val();
            const formattedSignals = [];

            if (rawData) {
                const entries = Object.values(rawData);
                const latest = entries[entries.length - 1];
                const recentEntries = entries.slice(-10);

                const dwellHistory = recentEntries.map((e, idx) => ({ val: e.avg_dwell, active: idx === recentEntries.length - 1 }));
                const flightHistory = recentEntries.map((e, idx) => ({ val: e.avg_flight, active: idx === recentEntries.length - 1 }));
                const scrollHistory = recentEntries.map((e, idx) => ({ val: e.scroll_velocity, active: idx === recentEntries.length - 1 }));

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
                        value: `${Math.round(12 + Math.random() * 5)} unlocks`,
                        subtext: 'Unlock frequency & session duration',
                        colorClass: 'bg-orange-500',
                        bars: generateMockBars(10, 15, 70),
                        trend: 'up',
                        status: 'elevated',
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
                        signalId: 'notification',
                        title: '🔔 Notification Response',
                        value: `${Math.round(3 + Math.random() * 15)} min`,
                        subtext: 'Response delay & ignored count',
                        colorClass: 'bg-orange-500',
                        bars: generateMockBars(10, 10, 90),
                        trend: 'up',
                        status: 'elevated',
                    },
                    {
                        signalId: 'activity',
                        title: '🚶 Activity Context',
                        value: 'Stationary',
                        subtext: 'Physical activity detection & noise gate',
                        colorClass: 'bg-emerald-500',
                        bars: generateMockBars(10, 60, 95),
                        trend: null,
                        status: 'normal',
                    }
                );
            } else {
                // Fallback mock data when Firebase has no data
                formattedSignals.push(
                    { signalId: 'keyboard', title: '⌨️ Keyboard Patterns', value: '126 ms', subtext: 'Typing rhythm & key press duration', colorClass: 'bg-emerald-500', bars: generateMockBars(), trend: 'down', status: 'normal' },
                    { signalId: 'screen', title: '📱 Screen On/Off Times', value: '14 unlocks', subtext: 'Unlock frequency & session duration', colorClass: 'bg-orange-500', bars: generateMockBars(), trend: 'up', status: 'elevated' },
                    { signalId: 'scroll', title: '📜 Screen Scrolling', value: '42 px/s', subtext: 'Scroll speed & frequency patterns', colorClass: 'bg-emerald-500', bars: generateMockBars(), trend: null, status: 'normal' },
                    { signalId: 'notification', title: '🔔 Notification Response', value: '8 min', subtext: 'Response delay & ignored count', colorClass: 'bg-orange-500', bars: generateMockBars(), trend: 'up', status: 'elevated' },
                    { signalId: 'activity', title: '🚶 Activity Context', value: 'Stationary', subtext: 'Physical activity detection & noise gate', colorClass: 'bg-emerald-500', bars: generateMockBars(10, 60, 95), trend: null, status: 'normal' },
                );
            }

            setMetrics(formattedSignals);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

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
                5 signals actively monitoring
            </p>

            <BottomNav />
        </div>
    );
}