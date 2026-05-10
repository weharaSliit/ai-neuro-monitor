import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { BackHeader } from '../components/BackHeader';
import { StatusBadge } from '../components/StatusBadge';
import { Wind, BookOpen, AlertTriangle } from 'lucide-react';

const TRIGGERS = [
    {
        signal: 'Typing pace',
        emoji: '⌨️',
        baseline: '120 ms',
        current: '145 ms',
        deviation: '+21%',
        status: 'elevated',
        explanation: 'Your key press duration is significantly longer than your baseline, suggesting slower, more hesitant typing.',
    },
    {
        signal: 'Screen unlocks',
        emoji: '📱',
        baseline: '8 /hour',
        current: '14 /hour',
        deviation: '+75%',
        status: 'anomalous',
        explanation: 'You are unlocking your phone much more frequently, which often correlates with restlessness or anxiety.',
    },
    {
        signal: 'Notification delay',
        emoji: '🔔',
        baseline: '3 min',
        current: '15 min',
        deviation: '+400%',
        status: 'anomalous',
        explanation: 'You are taking much longer to respond to notifications, a pattern commonly seen before perceived stress episodes.',
    },
];

const SUGGESTIONS = [
    { emoji: '🫁', title: 'Try box breathing', desc: '4-4-4 breathing for 3 minutes', path: '/toolkit' },
    { emoji: '🚶', title: 'Take a short walk', desc: 'Even 5 minutes helps reset', path: null },
    { emoji: '📝', title: 'Log how you feel', desc: 'Track your mood to find patterns', path: '/toolkit' },
];

export function AlertDetail() {
    const navigate = useNavigate();
    const { t, isDark } = useTheme();

    return (
        <div className={`h-screen ${t.bg} flex flex-col font-sans overflow-y-auto hide-scrollbar`}>
            <BackHeader title="Alert Detail" />

            <div className="px-5 pb-10">
                {/* Alert Header */}
                <div className={`p-5 rounded-3xl border mb-5 animate-fade-in ${isDark ? 'bg-[#1a1228] border-[#7c6bf7]/30' : 'bg-indigo-50 border-indigo-200'}`}>
                    <div className="flex items-center gap-2.5 mb-3">
                        <AlertTriangle size={18} className="text-[#7c6bf7]" />
                        <span className={`text-sm font-bold ${t.text}`}>Pre-stress alert triggered</span>
                    </div>
                    <p className={`text-xs leading-relaxed ${t.textSecondary}`}>
                        Your behavior has deviated from your baseline pattern. 3 out of 5 monitored signals show unusual activity in the last 2 hours.
                    </p>
                    <div className="flex items-center gap-3 mt-3">
                        <span className={`text-[10px] ${t.textDim}`}>Triggered 2h ago</span>
                        <span className={`text-[10px] ${t.textDim}`}>•</span>
                        <span className={`text-[10px] ${t.textDim}`}>Z-score: 2.3 (threshold: 2.0)</span>
                    </div>
                </div>

                {/* Trigger Cards */}
                <h3 className={`text-xs font-bold uppercase tracking-widest ${t.textMuted} mb-3`}>What triggered this</h3>
                <div className="space-y-3 mb-6 stagger-children">
                    {TRIGGERS.map((trigger, i) => (
                        <div key={i} className={`${t.card} border ${t.cardBorder} rounded-2xl p-4`}>
                            <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <span className="text-lg">{trigger.emoji}</span>
                                    <span className={`text-sm font-semibold ${t.text}`}>{trigger.signal}</span>
                                </div>
                                <StatusBadge status={trigger.status} />
                            </div>

                            {/* Baseline vs Current Bar */}
                            <div className="mb-3">
                                <div className="flex justify-between text-[10px] mb-1.5">
                                    <span className={t.textMuted}>Your baseline</span>
                                    <span className={t.textMuted}>{trigger.baseline}</span>
                                </div>
                                <div className={`w-full h-2 rounded-full ${isDark ? 'bg-[#2a2a38]' : 'bg-[#e5e5ea]'}`}>
                                    <div className="h-full rounded-full bg-emerald-500/60" style={{ width: '40%' }} />
                                </div>

                                <div className="flex justify-between text-[10px] mb-1.5 mt-2">
                                    <span className={t.textMuted}>Right now</span>
                                    <span className="font-bold text-orange-400">{trigger.current} ({trigger.deviation})</span>
                                </div>
                                <div className={`w-full h-2 rounded-full ${isDark ? 'bg-[#2a2a38]' : 'bg-[#e5e5ea]'}`}>
                                    <div className="h-full rounded-full bg-orange-400 animate-progress" style={{ width: `${40 + parseInt(trigger.deviation) * 0.4}%` }} />
                                </div>
                            </div>

                            <p className={`text-[11px] leading-relaxed ${t.textMuted}`}>{trigger.explanation}</p>
                        </div>
                    ))}
                </div>

                {/* Suggestions */}
                <h3 className={`text-xs font-bold uppercase tracking-widest ${t.textMuted} mb-3`}>What you can do</h3>
                <div className="space-y-2.5 mb-6 stagger-children">
                    {SUGGESTIONS.map((sug, i) => (
                        <button
                            key={i}
                            onClick={() => sug.path && navigate(sug.path)}
                            className={`w-full flex items-center gap-3.5 p-4 rounded-2xl border ${t.card} ${t.cardBorder} text-left transition-all active:scale-[0.98] ${t.cardHover}`}
                        >
                            <span className="text-2xl">{sug.emoji}</span>
                            <div>
                                <p className={`text-sm font-semibold ${t.text}`}>{sug.title}</p>
                                <p className={`text-[11px] ${t.textMuted}`}>{sug.desc}</p>
                            </div>
                        </button>
                    ))}
                </div>

                {/* Timeline */}
                <h3 className={`text-xs font-bold uppercase tracking-widest ${t.textMuted} mb-3`}>Timeline</h3>
                <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-4`}>
                    {[
                        { time: '2:45 PM', event: 'Typing deviation detected (Z=1.2)', color: '#f59e0b' },
                        { time: '3:10 PM', event: 'Screen unlock spike detected (Z=1.8)', color: '#f59e0b' },
                        { time: '3:22 PM', event: 'Notification delay exceeded threshold (Z=2.3)', color: '#ef4444' },
                        { time: '3:22 PM', event: '⚠️ Pre-stress alert triggered', color: '#7c6bf7' },
                    ].map((item, i) => (
                        <div key={i} className="flex gap-3 items-start mb-3 last:mb-0">
                            <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: item.color }} />
                            <div>
                                <span className={`text-[10px] font-bold ${t.textDim}`}>{item.time}</span>
                                <p className={`text-xs ${t.textSecondary}`}>{item.event}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
