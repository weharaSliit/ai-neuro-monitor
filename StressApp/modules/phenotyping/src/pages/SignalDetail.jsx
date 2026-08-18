import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { BackHeader } from '../components/BackHeader';
import { StatusBadge } from '../components/StatusBadge';
import { SparkChart } from '../components/SparkChart';
import { Info, ChevronRight, Loader2 } from 'lucide-react';
import { db } from '../firebase';
import { ref, onValue } from 'firebase/database';
import { getUserProfile } from '../utils/userStorage';

// Static configuration for titles and explanations
const SIGNAL_CONFIG = {
    keyboard: {
        title: '⌨️ Keyboard Patterns',
        measures: [
            {
                id: 'dwell',
                name: 'Dwell Time',
                explanation: 'Dwell time is how long you hold each key down when typing. When you\'re stressed, your fingers tend to press keys for longer because muscle tension increases and fine motor control becomes less precise.',
                color: '#f59e0b',
                unit: 'ms'
            },
            {
                id: 'flight',
                name: 'Flight Time',
                explanation: 'Flight time is the gap between releasing one key and pressing the next. Longer flight times suggest slower cognitive processing, often linked to distraction or mental fatigue.',
                color: '#10b981',
                unit: 'ms'
            }
        ]
    },
    scroll: {
        title: '📜 Screen Scrolling',
        measures: [
            {
                id: 'scroll_vel',
                name: 'Scroll Velocity',
                explanation: 'How fast you scroll through content. Faster scrolling than usual can indicate impatience or difficulty focusing on content — a subtle pre-stress marker.',
                color: '#10b981',
                unit: 'px/s'
            }
        ]
    },
    app_switch: {
        title: '🔄 App Switching Frequency',
        measures: [
            {
                id: 'switch_rate',
                name: 'Switch Rate',
                explanation: 'How often you switch between apps. High switching indicates multitasking and fragmented attention.',
                color: '#8b5cf6',
                unit: '/min'
            }
        ]
    },
    activity: {
        title: '🚶 Activity Context',
        measures: [
            {
                id: 'motion',
                name: 'Motion Detected',
                explanation: 'Whether significant physical motion (like walking) is detected. Motion invalidates keystroke timing analysis.',
                color: '#10b981',
                unit: ''
            }
        ]
    },
    screen: {
        title: '📱 Screen On/Off Times',
        measures: [
            {
                id: 'unlocks',
                name: 'Unlock Frequency',
                explanation: 'How often you unlock your phone. High unlock frequency, especially for very short sessions, is a strong behavioral marker for anxiety and checking behaviors.',
                color: '#f59e0b',
                unit: 'unlocks'
            }
        ]
    }
};

export function SignalDetail() {
    const { signalId } = useParams();
    const navigate = useNavigate();
    const { t, isDark } = useTheme();
    const [liveData, setLiveData] = useState(null);
    const [loading, setLoading] = useState(true);

    const config = SIGNAL_CONFIG[signalId];
    const profile = getUserProfile();
    const userId = profile?.userId;

    // Redirect unregistered users back to onboarding
    useEffect(() => {
        if (!userId) navigate('/');
    }, [userId]);

    useEffect(() => {
        if (!config) {
            setLoading(false);
            return;
        }

        const metricsRef = ref(db, `phenotyping/data_logs/${userId}`);
        const unsubscribe = onValue(metricsRef, (snapshot) => {
            const rawData = snapshot.val();
            if (rawData) {
                const entries = Object.values(rawData).slice(-10); // Last 10 windows
                const latest = entries[entries.length - 1];

                let processedMeasures = [];

                if (signalId === 'keyboard') {
                    processedMeasures = [
                        {
                            ...config.measures[0],
                            value: `${Math.round(latest.avg_dwell || 0)} ms`,
                            baseline: '120 ms',
                            deviation: latest.avg_dwell > 130 ? `+${Math.round((latest.avg_dwell - 120) / 120 * 100)}%` : '-',
                            status: latest.avg_dwell > 150 ? 'anomalous' : latest.avg_dwell > 130 ? 'elevated' : 'normal',
                            bars: entries.map(e => e.avg_dwell || 0)
                        },
                        {
                            ...config.measures[1],
                            value: `${Math.round(latest.avg_flight || 0)} ms`,
                            baseline: '195 ms',
                            deviation: '-',
                            status: 'normal',
                            bars: entries.map(e => e.avg_flight || 0)
                        }
                    ];
                } else if (signalId === 'scroll') {
                    processedMeasures = [
                        {
                            ...config.measures[0],
                            value: `${Math.round(latest.scroll_velocity || 0)} px/s`,
                            baseline: '38 px/s',
                            deviation: '-',
                            status: latest.scroll_velocity > 60 ? 'elevated' : 'normal',
                            bars: entries.map(e => e.scroll_velocity || 0)
                        }
                    ];
                } else if (signalId === 'app_switch') {
                    processedMeasures = [
                        {
                            ...config.measures[0],
                            value: `${(latest.app_switch_rate || 0).toFixed(1)} /min`,
                            baseline: '2.0 /min',
                            deviation: '-',
                            status: 'normal',
                            bars: entries.map(e => e.app_switch_rate || 0)
                        }
                    ];
                } else if (signalId === 'activity') {
                     processedMeasures = [
                        {
                            ...config.measures[0],
                            value: latest.data_valid === false ? 'Motion' : 'Stationary',
                            baseline: '-',
                            deviation: '-',
                            status: latest.data_valid === false ? 'elevated' : 'normal',
                            bars: entries.map(e => e.data_valid === false ? 1 : 0)
                        }
                    ];
                } else if (signalId === 'screen') {
                    processedMeasures = [
                        {
                            ...config.measures[0],
                            value: `${Math.round(latest.interaction_rate || 0)} unlocks`,
                            baseline: '5 unlocks',
                            deviation: '-',
                            status: (latest.interaction_rate || 0) > 8 ? 'elevated' : 'normal',
                            bars: entries.map(e => e.interaction_rate || 0)
                        }
                    ];
                }

                setLiveData({
                    title: config.title,
                    status: processedMeasures.some(m => m.status === 'anomalous') ? 'anomalous' : processedMeasures.some(m => m.status === 'elevated') ? 'elevated' : 'normal',
                    measures: processedMeasures
                });
            } else {
                // If NO data is available in Firebase, build EMPTY placeholders
                const processedMeasures = config.measures.map(m => ({
                    ...m, value: `-- ${m.unit}`, baseline: '--', deviation: '-', status: 'pending', bars: Array(10).fill(0), color: '#52525b'
                }));
                setLiveData({
                    title: config.title,
                    status: 'pending',
                    measures: processedMeasures
                });
            }
            setLoading(false);
        });

        return () => unsubscribe();
    }, [userId, signalId, config]);

    if (!config) {
        return (
            <div className={`h-screen ${t.bg} flex flex-col font-sans overflow-y-auto hide-scrollbar`}>
                <BackHeader title="Unknown Signal" />
                <div className="flex-1 flex items-center justify-center">
                    <p className={t.textMuted}>Signal not found</p>
                </div>
            </div>
        );
    }

    if (loading || !liveData) {
        return (
             <div className={`h-screen ${t.bg} flex flex-col font-sans overflow-y-auto hide-scrollbar`}>
                <BackHeader title={config.title} />
                <div className="flex-1 flex flex-col items-center justify-center pt-20">
                    <Loader2 size={28} className="text-[#7c6bf7] animate-spin" />
                </div>
             </div>
        );
    }

    return (
        <div className={`h-screen ${t.bg} flex flex-col font-sans overflow-y-auto hide-scrollbar`}>
            <BackHeader title={liveData.title} />

            <div className="px-5 pb-10">
                {/* Signal Status Header */}
                <div className={`flex items-center justify-between mb-5 animate-fade-in`}>
                    <div className="flex items-center gap-2">
                        <StatusBadge status={liveData.status} />
                        <span className={`text-xs ${t.textMuted}`}>
                            {liveData.measures.length} measures tracked
                        </span>
                    </div>
                    <button
                        onClick={() => navigate(`/signal-history/${signalId}`)}
                        className="flex items-center gap-1 text-[11px] font-bold text-[#7c6bf7] active:opacity-70"
                    >
                        7-day history
                        <ChevronRight size={14} />
                    </button>
                </div>

                {/* Measure Cards */}
                <div className="space-y-4 stagger-children">
                    {liveData.measures.map((measure, i) => {
                        const barData = measure.bars.map((v, idx) => ({
                            val: v,
                            active: idx === measure.bars.length - 1,
                        }));

                        return (
                            <div key={i} className={`${t.card} border ${t.cardBorder} rounded-[20px] p-5`}>
                                {/* Measure Header */}
                                <div className="flex items-start justify-between mb-1">
                                    <div>
                                        <h3 className={`text-base font-bold ${t.text}`}>{measure.name}</h3>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-lg font-bold" style={{ color: measure.color }}>{measure.value}</span>
                                    </div>
                                </div>

                                {/* Baseline comparison */}
                                <div className="flex items-center gap-3 mb-4">
                                    <span className={`text-[11px] ${t.textMuted}`}>
                                        Baseline: {measure.baseline}
                                    </span>
                                    {measure.deviation !== '-' && (
                                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${measure.status === 'normal'
                                                ? `${t.successBg} ${t.successText}`
                                                : measure.status === 'elevated'
                                                    ? `${t.warningBg} ${t.warningText}`
                                                    : measure.status === 'pending'
                                                    ? 'bg-zinc-800 text-zinc-400'
                                                    : `${t.dangerBg} ${t.dangerText}`
                                            }`}>
                                            {measure.deviation}
                                        </span>
                                    )}
                                    <StatusBadge status={measure.status} />
                                </div>

                                {/* Chart */}
                                <div className="mb-4">
                                    <SparkChart data={barData} color={measure.color} height={48} />
                                </div>

                                {/* Explanation */}
                                <div className={`flex gap-2.5 p-3.5 rounded-xl ${isDark ? 'bg-[#0f0f14]' : 'bg-[#f2f2f7]'}`}>
                                    <Info size={16} className="text-[#7c6bf7] shrink-0 mt-0.5" />
                                    <p className={`text-[11px] leading-[1.6] ${t.textSecondary}`}>
                                        {measure.explanation}
                                    </p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
