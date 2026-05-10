import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { BackHeader } from '../components/BackHeader';
import { StatusBadge } from '../components/StatusBadge';
import { SparkChart } from '../components/SparkChart';
import { Info, ChevronRight } from 'lucide-react';

const SIGNAL_DATA = {
    keyboard: {
        title: '⌨️ Keyboard Patterns',
        status: 'elevated',
        measures: [
            {
                name: 'Dwell Time',
                value: '145 ms',
                baseline: '120 ms',
                deviation: '+21%',
                status: 'elevated',
                bars: [65, 60, 58, 72, 68, 75, 80, 78, 85, 90],
                explanation: 'Dwell time is how long you hold each key down when typing. When you\'re stressed, your fingers tend to press keys for longer because muscle tension increases and fine motor control becomes less precise.',
                color: '#f59e0b',
            },
            {
                name: 'Flight Time',
                value: '210 ms',
                baseline: '195 ms',
                deviation: '+8%',
                status: 'normal',
                bars: [50, 55, 48, 52, 60, 55, 58, 62, 57, 60],
                explanation: 'Flight time is the gap between releasing one key and pressing the next. Longer flight times suggest slower cognitive processing, often linked to distraction or mental fatigue.',
                color: '#10b981',
            },
            {
                name: 'Typing Speed',
                value: '38 WPM',
                baseline: '48 WPM',
                deviation: '-22%',
                status: 'elevated',
                bars: [80, 75, 72, 68, 65, 60, 55, 50, 48, 45],
                explanation: 'Overall words typed per minute. A consistent drop in typing speed compared to your baseline is one of the strongest indicators of cognitive load and pre-perceived stress.',
                color: '#f59e0b',
            },
        ],
    },
    screen: {
        title: '📱 Screen On/Off Times',
        status: 'elevated',
        measures: [
            {
                name: 'Unlock Frequency',
                value: '14 /hr',
                baseline: '8 /hr',
                deviation: '+75%',
                status: 'anomalous',
                bars: [30, 35, 40, 45, 55, 60, 70, 75, 80, 90],
                explanation: 'How often you unlock your phone per hour. Frequent, short unlocks are a behavioral marker of restlessness or anxiety — your brain is seeking distraction.',
                color: '#ef4444',
            },
            {
                name: 'Session Duration',
                value: '2.1 min',
                baseline: '4.5 min',
                deviation: '-53%',
                status: 'elevated',
                bars: [80, 75, 65, 55, 45, 40, 35, 30, 28, 25],
                explanation: 'Average time per screen session. Very short sessions (unlock → check → lock) combined with high frequency indicates distracted behavior patterns.',
                color: '#f59e0b',
            },
            {
                name: 'Screen On Time',
                value: '3.2 hrs',
                baseline: '2.8 hrs',
                deviation: '+14%',
                status: 'normal',
                bars: [50, 55, 52, 58, 60, 55, 62, 65, 60, 68],
                explanation: 'Total screen-on duration today. Slight increases are normal, but combined with high unlock frequency, it suggests fragmented phone usage.',
                color: '#10b981',
            },
        ],
    },
    scroll: {
        title: '📜 Screen Scrolling',
        status: 'normal',
        measures: [
            {
                name: 'Scroll Velocity',
                value: '42 px/s',
                baseline: '38 px/s',
                deviation: '+11%',
                status: 'normal',
                bars: [45, 50, 48, 52, 55, 50, 48, 52, 55, 53],
                explanation: 'How fast you scroll through content. Faster scrolling than usual can indicate impatience or difficulty focusing on content — a subtle pre-stress marker.',
                color: '#10b981',
            },
            {
                name: 'Scroll Frequency',
                value: '120 /hr',
                baseline: '105 /hr',
                deviation: '+14%',
                status: 'normal',
                bars: [40, 45, 50, 48, 52, 55, 50, 58, 55, 60],
                explanation: 'Number of scroll gestures per hour. Combined with velocity, this tells us whether you\'re browsing purposefully or rapidly cycling through content.',
                color: '#10b981',
            },
        ],
    },
    notification: {
        title: '🔔 Notification Response',
        status: 'elevated',
        measures: [
            {
                name: 'Response Delay',
                value: '15 min',
                baseline: '3 min',
                deviation: '+400%',
                status: 'anomalous',
                bars: [20, 25, 30, 40, 50, 60, 70, 80, 85, 95],
                explanation: 'Average time between receiving a notification and opening it. Significantly delayed responses suggest avoidance behavior — a well-documented pre-stress coping mechanism.',
                color: '#ef4444',
            },
            {
                name: 'Ignored Count',
                value: '8 today',
                baseline: '2 /day',
                deviation: '+300%',
                status: 'anomalous',
                bars: [15, 20, 25, 30, 40, 50, 55, 65, 75, 85],
                explanation: 'Notifications that were not opened at all. Ignoring notifications often correlates with feeling overwhelmed — the brain\'s way of reducing input.',
                color: '#ef4444',
            },
        ],
    },
    activity: {
        title: '🚶 Activity Context',
        status: 'normal',
        measures: [
            {
                name: 'Stationary Ratio',
                value: '87%',
                baseline: '82%',
                deviation: '+6%',
                status: 'normal',
                bars: [75, 78, 80, 82, 85, 83, 86, 84, 87, 87],
                explanation: 'Percentage of time you\'ve been stationary today. This is used as a noise filter — typing data collected while walking is excluded because physical movement affects keystroke timing.',
                color: '#10b981',
            },
            {
                name: 'Current State',
                value: 'Sitting',
                baseline: '-',
                deviation: '-',
                status: 'normal',
                bars: [90, 92, 88, 95, 90, 85, 92, 88, 95, 92],
                explanation: 'Your current physical activity state detected via accelerometer. When you\'re stationary, your typing data is "clean" and reliable for stress analysis.',
                color: '#10b981',
            },
        ],
    },
};

export function SignalDetail() {
    const { signalId } = useParams();
    const navigate = useNavigate();
    const { t, isDark } = useTheme();

    const signal = SIGNAL_DATA[signalId];
    if (!signal) {
        return (
            <div className={`h-screen ${t.bg} flex items-center justify-center`}>
                <p className={t.textMuted}>Signal not found</p>
            </div>
        );
    }

    return (
        <div className={`h-screen ${t.bg} flex flex-col font-sans overflow-y-auto hide-scrollbar`}>
            <BackHeader title={signal.title} />

            <div className="px-5 pb-10">
                {/* Signal Status Header */}
                <div className={`flex items-center justify-between mb-5 animate-fade-in`}>
                    <div className="flex items-center gap-2">
                        <StatusBadge status={signal.status} />
                        <span className={`text-xs ${t.textMuted}`}>
                            {signal.measures.length} measures tracked
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
                    {signal.measures.map((measure, i) => {
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
