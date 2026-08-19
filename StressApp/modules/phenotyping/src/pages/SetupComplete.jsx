import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { getUserProfile } from '../utils/userStorage';
import {
    CheckCircle2, Calendar, Smartphone, TrendingUp, ChevronDown,
    Keyboard, RefreshCw, Battery, Activity, ScrollText, MousePointer2, SmartphoneIcon, ShieldCheck
} from 'lucide-react';

const TIMELINE_STEPS = [
    { days: 'Day 1–3', icon: MousePointer2, title: 'Learning your rhythm', desc: 'PhenoCare observes your typing speed, scroll habits, and screen usage patterns.', color: '#7c6bf7' },
    { days: 'Day 3–5', icon: TrendingUp, title: 'Building your fingerprint', desc: 'A unique behavioral baseline is created from your natural phone usage.', color: '#10b981' },
    { days: 'Day 5–7', icon: SmartphoneIcon, title: 'Calibrating your baseline', desc: 'The AI refines mean & deviation thresholds personalized to you.', color: '#f59e0b' },
    { days: 'Day 7+', icon: ShieldCheck, title: 'Pre-stress predictions begin', desc: "You'll receive alerts when your behavior deviates from your baseline.", color: '#ef4444' },
];

const PHONE_SETTINGS = [
    { icon: Keyboard, title: 'Accessibility service', desc: 'Enable PhenoCare keyboard monitor in Settings → Accessibility', color: '#7c6bf7' },
    { icon: RefreshCw, title: 'App switching monitoring', desc: 'Track multitasking rhythm to measure context transition stress', color: '#3b82f6' },
    { icon: Battery, title: 'Battery optimization', desc: 'Disable battery saver for PhenoCare to ensure continuous monitoring', color: '#10b981' },
    { icon: Activity, title: 'Motion sensor access', desc: 'Accelerometer access filters out movement noise during baseline calibration', color: '#8b5cf6' },
];

const TRACKED_SIGNALS = [
    { icon: Keyboard, name: 'Keyboard patterns', desc: 'Typing speed, dwell time, flight time', color: 'text-indigo-400' },
    { icon: Smartphone, name: 'Screen on/off times', desc: 'Unlock frequency, usage sessions', color: 'text-orange-400' },
    { icon: ScrollText, name: 'Scrolling behavior', desc: 'Scroll speed and frequency', color: 'text-emerald-400' },
    { icon: RefreshCw, name: 'App switching rate', desc: 'Context transition frequency', color: 'text-rose-400' },
    { icon: Activity, name: 'Activity context', desc: 'Stationary vs. walking detection', color: 'text-purple-400' },
];

export function SetupComplete() {
    const navigate = useNavigate();
    const { t, isDark } = useTheme();
    const [expandedSetting, setExpandedSetting] = useState(null);
    const [userName, setUserName] = useState('Participant');

    useEffect(() => {
        const profile = getUserProfile();
        if (profile && profile.name) setUserName(profile.name);
    }, []);

    return (
        /**
         * LAYOUT: Pure natural page scroll. Content grows, browser scrolls.
         * "Finish Setup" button is at the end of content — always reachable by scrolling.
         * No fixed/sticky elements on this page.
         */
        <div className={`${t.bg} font-sans`} style={{ minHeight: '100dvh' }}>
            <div className="w-full max-w-5xl mx-auto px-4 md:px-12 py-8 space-y-8">

                {/* Success Header */}
                <div className="flex flex-col items-center pt-4 pb-2 text-center relative">
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 w-48 h-48 bg-[#7c6bf7]/8 rounded-full blur-3xl pointer-events-none" />
                    <div className="mb-5 text-emerald-500 relative z-10">
                        <CheckCircle2 size={80} strokeWidth={1.2} />
                    </div>
                    <h1 className={`text-2xl md:text-4xl font-extrabold ${t.text} mb-3 tracking-tight relative z-10`}>
                        You're all set, {userName}!
                    </h1>
                    <p className={`${t.textSecondary} text-sm md:text-base leading-relaxed max-w-md relative z-10 mx-auto`}>
                        PhenoCare will spend the next 7 days learning what's normal for you before predictions begin.
                    </p>
                </div>

                {/* 7-Day Calibration Path */}
                <div>
                    <h2 className={`text-xs font-bold uppercase tracking-[0.15em] ${t.textMuted} mb-4 text-center`}>
                        The 7-Day Calibration Path
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        {TIMELINE_STEPS.map((step, i) => (
                            <div key={i} className={`${t.card} border ${t.cardBorder} rounded-2xl p-4`}>
                                <div className="flex items-center gap-3 mb-3">
                                    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${step.color}18` }}>
                                        <step.icon size={18} style={{ color: step.color }} />
                                    </div>
                                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: step.color }}>{step.days}</span>
                                </div>
                                <p className={`text-sm font-bold ${t.text} mb-1`}>{step.title}</p>
                                <p className={`text-xs ${t.textMuted} leading-relaxed`}>{step.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Phone Configuration */}
                <div>
                    <h2 className={`text-xs font-bold uppercase tracking-[0.15em] ${t.textMuted} mb-4`}>Phone Configuration</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {PHONE_SETTINGS.map((setting, i) => {
                            const isExpanded = expandedSetting === i;
                            return (
                                <button
                                    key={i}
                                    onClick={() => setExpandedSetting(isExpanded ? null : i)}
                                    className={`w-full text-left ${t.card} border ${t.cardBorder} rounded-2xl p-4 transition-all duration-200 ${isExpanded ? 'border-[#7c6bf7]/40' : ''}`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${setting.color}15` }}>
                                            <setting.icon size={18} style={{ color: setting.color }} />
                                        </div>
                                        <p className={`text-sm font-bold ${t.text} flex-1`}>{setting.title}</p>
                                        <ChevronDown size={16} className={`${t.textMuted} transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                                    </div>
                                    {isExpanded && (
                                        <div className="mt-3 pl-12">
                                            <p className={`text-xs ${t.textSecondary} leading-relaxed mb-3`}>{setting.desc}</p>
                                            <span className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-bold text-white" style={{ backgroundColor: setting.color }}>
                                                Configure Settings
                                            </span>
                                        </div>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Active Monitoring Signals */}
                <div>
                    <h2 className={`text-xs font-bold uppercase tracking-[0.15em] ${t.textMuted} mb-4`}>Active Monitoring Signals</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {TRACKED_SIGNALS.map((sig, i) => (
                            <div key={i} className={`${t.card} border ${t.cardBorder} rounded-2xl p-4 flex items-center gap-3`}>
                                <div className={`w-9 h-9 rounded-xl ${isDark ? 'bg-zinc-800/60' : 'bg-zinc-100'} flex items-center justify-center shrink-0`}>
                                    <sig.icon size={18} className={sig.color} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className={`text-sm font-bold ${t.text} truncate`}>{sig.name}</p>
                                    <p className={`text-xs ${t.textMuted} truncate`}>{sig.desc}</p>
                                </div>
                                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                            </div>
                        ))}
                    </div>
                </div>

                {/* Info cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="flex items-center gap-4 p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/10">
                        <Calendar size={20} className="text-emerald-500 shrink-0" />
                        <p className={`text-sm ${t.textSecondary} font-medium`}>Daily mood check — <span className={`text-xs ${t.textMuted}`}>takes under a minute</span></p>
                    </div>
                    <div className="flex items-center gap-4 p-4 rounded-2xl bg-blue-500/5 border border-blue-500/10">
                        <Smartphone size={20} className="text-blue-500 shrink-0" />
                        <p className={`text-sm ${t.textSecondary} font-medium`}>Passive monitoring — <span className={`text-xs ${t.textMuted}`}>runs in the background</span></p>
                    </div>
                </div>

                {/* CTA — inline at end of page, always reachable by scrolling */}
                <div className="max-w-md mx-auto pb-8">
                    <button
                        onClick={() => navigate('/dashboard')}
                        className="w-full py-5 rounded-2xl bg-[#7c6bf7] text-white font-bold text-base transition-all active:scale-[0.98] hover:bg-[#6355d8] shadow-xl shadow-[#7c6bf7]/30 flex items-center justify-center gap-2"
                    >
                        Finish Setup & Explore
                        <TrendingUp size={18} />
                    </button>
                    <p className={`text-center text-[10px] ${t.textDim} uppercase tracking-widest mt-4 font-bold`}>
                        Study ID: PHN-2024-08 · SLIIT Research
                    </p>
                </div>

            </div>
        </div>
    );
}