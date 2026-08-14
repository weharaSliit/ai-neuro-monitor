import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { BackHeader } from '../components/BackHeader';
import { StatusBadge } from '../components/StatusBadge';
import { SparkChart } from '../components/SparkChart';
import { TrendingUp, TrendingDown, Minus, Loader2 } from 'lucide-react';
import { db } from '../firebase';
import { ref, onValue } from 'firebase/database';
import { getUserProfile } from '../utils/userStorage';

const SIGNAL_NAMES = {
    keyboard: '⌨️ Keyboard Patterns',
    screen: '📱 Screen On/Off',
    scroll: '📜 Scrolling',
    notification: '🔔 Notifications',
    activity: '🚶 Activity',
};

const SIGNAL_UNITS = {
    keyboard: 'ms',
    screen: 'unlocks/hr',
    scroll: 'px/s',
    notification: 'min',
    activity: '%',
};

function generateEmptyDays() {
    const days = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        days.push({
            date: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
            dayOfWeek: d.toLocaleDateString('en-US', { weekday: 'long' }),
            avg: '--',
            min: '--',
            max: '--',
            status: 'pending',
            hourly: Array(12).fill(0),
            isToday: i === 0,
        });
    }
    return days;
}

export function SignalHistory() {
    const { signalId } = useParams();
    const { t, isDark } = useTheme();
    const [days, setDays] = useState(null);
    
    const profile = getUserProfile();
    const userId = profile?.userId;

    // Redirect unregistered users back to onboarding
    useEffect(() => {
        if (!userId) navigate('/');
    }, [userId]);

    const signalName = SIGNAL_NAMES[signalId] || 'Signal';
    const unit = SIGNAL_UNITS[signalId] || '';

    useEffect(() => {
        const metricsRef = ref(db, `phenotyping/data_logs/${userId}`);
        const unsubscribe = onValue(metricsRef, (snapshot) => {
            const rawData = snapshot.val();
            let processedDays = generateEmptyDays();

            if (rawData) {
                // We have some data! For now, let's map the latest data into 'Today'
                // A full historical aggregation requires querying past 7 days of logs.
                const entries = Object.values(rawData);
                const latest = entries[entries.length - 1];
                
                let todayVal = null;
                if (signalId === 'keyboard' && latest.avg_dwell) todayVal = latest.avg_dwell;
                else if (signalId === 'scroll' && latest.scroll_velocity) todayVal = latest.scroll_velocity;
                else if (signalId === 'activity') todayVal = latest.data_valid === false ? 1 : 0;

                if (todayVal !== null) {
                    processedDays[6].avg = Math.round(todayVal);
                    processedDays[6].min = Math.round(todayVal * 0.8);
                    processedDays[6].max = Math.round(todayVal * 1.2);
                    processedDays[6].status = signalId === 'keyboard' ? (todayVal > 150 ? 'anomalous' : todayVal > 130 ? 'elevated' : 'normal') : 'normal';
                    // Inject real hourly trend for today from recent entries
                    const recent12 = entries.slice(-12).map(e => signalId === 'keyboard' ? e.avg_dwell : signalId === 'scroll' ? e.scroll_velocity : 0);
                    while (recent12.length < 12) recent12.unshift(0);
                    processedDays[6].hourly = recent12;
                }
            }
            
            setDays(processedDays);
        });

        return () => unsubscribe();
    }, [userId, signalId]);

    if (!days) {
        return (
             <div className={`h-screen ${t.bg} flex flex-col font-sans overflow-y-auto hide-scrollbar`}>
                <BackHeader title="7-Day History" />
                <div className="flex-1 flex flex-col items-center justify-center pt-20">
                    <Loader2 size={28} className="text-[#7c6bf7] animate-spin" />
                </div>
             </div>
        );
    }

    // Summary stats calculation with safe checks for empty '--' data
    const validAvgs = days.map(d => d.avg).filter(a => typeof a === 'number');
    const weekAvg = validAvgs.length > 0 ? Math.round(validAvgs.reduce((a, b) => a + b, 0) / validAvgs.length) : '--';
    const trend = validAvgs.length >= 2 ? (validAvgs[validAvgs.length - 1] > validAvgs[0] ? 'up' : 'down') : 'flat';
    const daysAbove = days.filter(d => d.status === 'elevated' || d.status === 'anomalous').length;

    const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
    const trendColor = trend === 'up' ? '#f59e0b' : trend === 'down' ? '#10b981' : '#6b6b80';

    return (
        <div className={`h-screen ${t.bg} flex flex-col font-sans overflow-y-auto hide-scrollbar`}>
            <BackHeader title="7-Day History" />

            <div className="px-5 pb-10">
                {/* Signal Name */}
                <h2 className={`text-lg font-bold ${t.text} mb-4 animate-fade-in`}>{signalName}</h2>

                {/* Summary Stats */}
                <div className="grid grid-cols-3 gap-2.5 mb-5 animate-fade-in-up">
                    <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-3.5 text-center`}>
                        <p className={`text-[10px] font-bold uppercase tracking-wider ${t.textMuted} mb-1`}>7-Day Avg</p>
                        <p className={`text-xl font-bold ${t.text}`}>{weekAvg}</p>
                        <p className={`text-[10px] ${t.textDim}`}>{unit}</p>
                    </div>
                    <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-3.5 text-center`}>
                        <p className={`text-[10px] font-bold uppercase tracking-wider ${t.textMuted} mb-1`}>Trend</p>
                        <div className="flex items-center justify-center gap-1">
                            <TrendIcon size={18} style={{ color: trendColor }} />
                            <span className="text-sm font-bold" style={{ color: trendColor }}>
                                {trend === 'up' ? 'Rising' : trend === 'down' ? 'Falling' : 'Stable'}
                            </span>
                        </div>
                    </div>
                    <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-3.5 text-center`}>
                        <p className={`text-[10px] font-bold uppercase tracking-wider ${t.textMuted} mb-1`}>Elevated</p>
                        <p className={`text-xl font-bold ${daysAbove > 0 ? 'text-orange-400' : t.successText}`}>{daysAbove}</p>
                        <p className={`text-[10px] ${t.textDim}`}>days</p>
                    </div>
                </div>

                {/* Week Overview Chart */}
                <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-4 mb-5 animate-fade-in-up`}>
                    <p className={`text-xs font-bold ${t.textMuted} mb-3`}>Weekly Overview</p>
                    <SparkChart
                        data={days.map((d, i) => ({
                            val: typeof d.avg === 'number' ? d.avg : 0,
                            active: d.isToday,
                        }))}
                        color="#7c6bf7"
                        height={56}
                    />
                    <div className="flex justify-between mt-2">
                        {days.map((d, i) => (
                            <span key={i} className={`text-[9px] font-medium flex-1 text-center ${d.isToday ? t.accent : t.textDim}`}>
                                {d.date.split(',')[0].split(' ')[0]}
                            </span>
                        ))}
                    </div>
                </div>

                {/* Daily Cards */}
                <h3 className={`text-xs font-bold uppercase tracking-widest ${t.textMuted} mb-3`}>Day by Day</h3>
                <div className="space-y-2.5 stagger-children">
                    {[...days].reverse().map((day, i) => (
                        <div key={i} className={`${t.card} border ${t.cardBorder} rounded-2xl p-4`}>
                            <div className="flex items-center justify-between mb-2">
                                <div>
                                    <span className={`text-sm font-semibold ${t.text}`}>
                                        {day.isToday ? 'Today' : day.date}
                                    </span>
                                    {day.isToday && (
                                        <span className={`text-[10px] ml-2 font-bold text-[#7c6bf7]`}>● Live</span>
                                    )}
                                </div>
                                <StatusBadge status={day.status} />
                            </div>

                            {/* Hourly mini chart */}
                            <div className="mb-3">
                                <SparkChart
                                    data={day.hourly.map((v, idx) => ({ val: v, active: day.isToday && idx === day.hourly.length - 1 }))}
                                    color={day.status === 'normal' ? '#10b981' : day.status === 'elevated' ? '#f59e0b' : day.status === 'pending' ? '#52525b' : '#ef4444'}
                                    height={32}
                                />
                            </div>

                            <div className="flex gap-5">
                                <div>
                                    <span className={`text-[10px] ${t.textDim}`}>Avg</span>
                                    <p className={`text-sm font-bold ${t.text}`}>{day.avg} {unit}</p>
                                </div>
                                <div>
                                    <span className={`text-[10px] ${t.textDim}`}>Min</span>
                                    <p className={`text-sm font-medium ${t.textSecondary}`}>{day.min}</p>
                                </div>
                                <div>
                                    <span className={`text-[10px] ${t.textDim}`}>Max</span>
                                    <p className={`text-sm font-medium ${t.textSecondary}`}>{day.max}</p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
