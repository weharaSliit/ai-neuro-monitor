import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import {
    CheckCircle2, Calendar, Smartphone, TrendingUp, ChevronDown, ChevronUp,
    Keyboard, Bell, Battery, MapPin, Activity, ScrollText, Eye, MousePointer2, SmartphoneIcon
} from 'lucide-react';

const TIMELINE_STEPS = [
    { days: 'Day 1–3', icon: MousePointer2, title: 'Learning your rhythm', desc: 'PhenoCare observes your typing speed, scroll habits, and screen usage patterns.', color: '#7c6bf7' },
    { days: 'Day 3–5', icon: TrendingUp, title: 'Building your fingerprint', desc: 'A unique behavioral baseline is created from your natural phone usage.', color: '#10b981' },
    { days: 'Day 5–7', icon: SmartphoneIcon, title: 'Calibrating your baseline', desc: 'The AI refines mean & deviation thresholds personalized to you.', color: '#f59e0b' },
    { days: 'Day 7+', icon: Bell, title: 'Pre-stress predictions begin', desc: 'You\'ll receive alerts when your behavior deviates from your baseline.', color: '#ef4444' },
];

const PHONE_SETTINGS = [
    { icon: Keyboard, title: 'Accessibility service', desc: 'Enable PhenoCare keyboard monitor in Settings → Accessibility', color: '#7c6bf7' },
    { icon: Bell, title: 'Notification access', desc: 'Allow notification listener to measure response delay', color: '#f59e0b' },
    { icon: Battery, title: 'Battery optimization', desc: 'Disable battery saver for PhenoCare to ensure continuous monitoring', color: '#10b981' },
    { icon: MapPin, title: 'Location (optional)', desc: 'Adds location variety as a context signal — general area only', color: '#8b5cf6' },
];

const TRACKED_SIGNALS = [
    { icon: Keyboard, name: 'Keyboard patterns', desc: 'Typing speed, dwell time, flight time', color: 'text-indigo-400' },
    { icon: Smartphone, name: 'Screen on/off times', desc: 'Unlock frequency, usage sessions', color: 'text-orange-400' },
    { icon: ScrollText, name: 'Scrolling behavior', desc: 'Scroll speed and frequency', color: 'text-emerald-400' },
    { icon: Bell, name: 'Notification response', desc: 'How quickly you respond', color: 'text-rose-400' },
    { icon: Activity, name: 'Activity context', desc: 'Stationary vs. walking detection', color: 'text-purple-400' },
];

export function SetupComplete() {
    const navigate = useNavigate();
    const { t, isDark } = useTheme();
    const [expandedSetting, setExpandedSetting] = useState(null);

    return (
        <div className={`h-screen ${t.bg} flex flex-col font-sans overflow-y-auto hide-scrollbar max-w-md mx-auto shadow-2xl relative`}>
            {/* Success Header */}
            <div className="flex flex-col items-center pt-10 pb-6 px-6 text-center animate-fade-in relative">
                <div className="absolute top-10 left-1/2 -translate-x-1/2 w-32 h-32 bg-[#7c6bf7]/10 rounded-full blur-3xl" />
                <div className="mb-6 text-emerald-500 animate-fade-in-scale relative z-10">
                    <CheckCircle2 size={80} strokeWidth={1} />
                </div>
                <h1 className={`text-2xl font-bold ${t.text} mb-3 tracking-tight relative z-10`}>
                    You're all set, Chathurika!
                </h1>
                <p className={`${t.textSecondary} text-[13px] leading-relaxed max-w-[280px] relative z-10 mx-auto`}>
                    PhenoCare will spend the next 7 days learning what's normal for you before predictions begin.
                </p>
            </div>

            {/* 7-Day Timeline */}
            <div className="px-6 mb-8 animate-fade-in-up">
                <h2 className={`text-[10px] font-bold uppercase tracking-[0.15em] ${t.textMuted} mb-6 text-center`}>
                    The 7-Day Calibration Path
                </h2>
                <div className="relative">
                    {/* Vertical line */}
                    <div className={`absolute left-5 top-2 bottom-2 w-[2px] ${isDark ? 'bg-[#2a2a38]' : 'bg-[#e5e5ea]'}`} />
                    <div className="space-y-4">
                        {TIMELINE_STEPS.map((step, i) => (
                            <div key={i} className="flex gap-4 items-start relative group">
                                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center z-10 ${t.card} border ${t.cardBorder} shrink-0 transition-transform group-hover:scale-110`} style={{ boxShadow: `0 8px 16px -4px ${step.color}20` }}>
                                    <step.icon size={18} style={{ color: step.color }} />
                                </div>
                                <div className={`flex-1 ${t.card} border ${t.cardBorder} rounded-2xl p-4 transition-all hover:${t.cardHover}`}>
                                    <span className="text-[10px] font-bold uppercase tracking-wider mb-1 block" style={{ color: step.color }}>{step.days}</span>
                                    <p className={`text-sm font-bold ${t.text} mb-1`}>{step.title}</p>
                                    <p className={`text-[11px] ${t.textMuted} leading-relaxed`}>{step.desc}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Phone Settings Guide */}
            <div className="px-6 mb-8 animate-fade-in-up">
                <h2 className={`text-[10px] font-bold uppercase tracking-[0.15em] ${t.textMuted} mb-5`}>
                    Phone Configuration
                </h2>
                <div className="space-y-3">
                    {PHONE_SETTINGS.map((setting, i) => {
                        const isExpanded = expandedSetting === i;
                        return (
                            <button
                                key={i}
                                onClick={() => setExpandedSetting(isExpanded ? null : i)}
                                className={`w-full text-left ${t.card} border ${t.cardBorder} rounded-2xl p-4 transition-all duration-300 ${isExpanded ? 'border-[#7c6bf7]/50 ring-1 ring-[#7c6bf7]/20 shadow-lg' : t.cardHover}`}
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${setting.color}15` }}>
                                        <setting.icon size={18} style={{ color: setting.color }} />
                                    </div>
                                    <div className="flex-1">
                                        <p className={`text-[13px] font-bold ${t.text}`}>{setting.title}</p>
                                    </div>
                                    <div className={`transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}>
                                        <ChevronDown size={16} className={t.textMuted} />
                                    </div>
                                </div>
                                {isExpanded && (
                                    <div className="mt-4 ml-12 animate-fade-in">
                                        <p className={`text-xs ${t.textSecondary} leading-relaxed mb-4 pr-2`}>{setting.desc}</p>
                                        <div className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[11px] font-bold shadow-sm transition-transform active:scale-95" style={{ backgroundColor: `${setting.color}`, color: '#fff' }}>
                                            Configure Settings
                                        </div>
                                    </div>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* What We Track */}
            <div className="px-6 mb-8 animate-fade-in-up">
                <h2 className={`text-[10px] font-bold uppercase tracking-[0.15em] ${t.textMuted} mb-5`}>
                    Active Monitoring Signals
                </h2>
                <div className={`${t.card} border ${t.cardBorder} rounded-3xl p-5 space-y-4`}>
                    {TRACKED_SIGNALS.map((sig, i) => (
                        <div key={i} className="flex items-center gap-4 group">
                            <div className={`w-10 h-10 rounded-xl ${isDark ? 'bg-zinc-800/50' : 'bg-zinc-100'} flex items-center justify-center transition-colors group-hover:bg-[#7c6bf7]/10`}>
                                <sig.icon size={20} className={sig.color} />
                            </div>
                            <div className="flex-1">
                                <p className={`text-[13px] font-bold ${t.text}`}>{sig.name}</p>
                                <p className={`text-[11px] ${t.textMuted}`}>{sig.desc}</p>
                            </div>
                            <div className={`w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse`} />
                        </div>
                    ))}
                </div>
            </div>

            {/* Feature List */}
            <div className="px-6 mb-8 space-y-4">
                <div className="flex items-center gap-4 p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/10">
                    <Calendar size={18} className="text-emerald-500 shrink-0" />
                    <p className={`text-[13px] ${t.textSecondary} font-medium`}>
                        Daily mood check — <span className={`text-xs ${t.textMuted}`}>takes under a minute</span>
                    </p>
                </div>
                <div className="flex items-center gap-4 p-4 rounded-2xl bg-blue-500/5 border border-blue-500/10">
                    <Smartphone size={18} className="text-blue-500 shrink-0" />
                    <p className={`text-[13px] ${t.textSecondary} font-medium`}>
                        Passive sensor monitoring — <span className={`text-xs ${t.textMuted}`}>runs in the background</span>
                    </p>
                </div>
            </div>

            {/* CTA */}
            <div className="px-6 pb-8 mt-auto sticky bottom-0 pt-4 bg-inherit border-t border-zinc-500/10">
                <button
                    onClick={() => navigate('/dashboard')}
                    className="w-full py-4 rounded-2xl bg-[#7c6bf7] text-white font-bold text-sm transition-all active:scale-[0.98] hover:bg-[#6355d8] shadow-xl shadow-[#7c6bf7]/30 flex items-center justify-center gap-2"
                >
                    Finish Setup & Explore
                    <TrendingUp size={16} />
                </button>
                <p className={`text-center text-[9px] ${t.textDim} uppercase tracking-widest mt-4 font-bold`}>
                    Study ID: PHN-2024-08 · SLIIT Research
                </p>
            </div>
        </div>
    );
}