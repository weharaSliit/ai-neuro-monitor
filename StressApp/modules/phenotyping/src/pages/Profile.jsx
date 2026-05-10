import React, { useState } from 'react';
import { useTheme } from '../context/ThemeContext';
import { BottomNav } from '../components/BottomNav';
import { StatusBadge } from '../components/StatusBadge';
import {
    Sun, Moon, ChevronRight, ChevronDown, ChevronUp, Shield, FileText, HelpCircle,
    Keyboard, Bell, Smartphone, Activity, ScrollText, Settings, User as UserIcon, Download
} from 'lucide-react';

const SENSOR_LIST = [
    { icon: Keyboard, name: 'Keyboard Monitor', status: 'active', color: '#7c6bf7' },
    { icon: Smartphone, name: 'Screen Activity', status: 'active', color: '#10b981' },
    { icon: ScrollText, name: 'Scroll Tracker', status: 'active', color: '#3b82f6' },
    { icon: Bell, name: 'Notification Access', status: 'active', color: '#f59e0b' },
    { icon: Activity, name: 'Activity Detection', status: 'active', color: '#8b5cf6' },
];

const FAQ_LIST = [
    { q: 'How does PhenoCare detect stress?', a: 'It monitors your typing rhythm, scroll behavior, screen usage, and notification response patterns. When these deviate from your personal baseline (established during the first 7 days), it flags a pre-stress alert.' },
    { q: 'Does PhenoCare read my messages?', a: 'No. PhenoCare only measures timing patterns — how fast you type, how often you scroll, how quickly you respond. It never reads the content of any message, email, or notification.' },
    { q: 'What is the 7-day calibration?', a: 'During your first week, PhenoCare learns what is "normal" for you. It calculates your personal mean and standard deviation for each behavioral signal. This ensures predictions are tailored to your unique habits.' },
    { q: 'How does the baseline adapt?', a: 'Your baseline updates using Exponential Moving Average (EMA) with α=0.2. Crucially, it only updates during normal periods — stress episodes are excluded to prevent contamination.' },
];

export function Profile() {
    const { t, isDark, toggleTheme } = useTheme();
    const [expandedFaq, setExpandedFaq] = useState(null);
    const [expandedSection, setExpandedSection] = useState(null);

    return (
        <div className={`h-screen ${t.bg} ${t.text} flex flex-col font-sans pb-24 overflow-y-auto hide-scrollbar max-w-md mx-auto shadow-2xl`}>
            {/* Header */}
            <div className="px-5 pt-5 pb-4 animate-fade-in">
                <h1 className={`text-xl font-bold ${t.text} mb-1`}>Profile</h1>
            </div>

            <div className="px-5 flex-1 stagger-children">
                {/* User Card */}
                <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-5 mb-3 flex items-center gap-4`}>
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#7c6bf7] to-[#a855f7] flex items-center justify-center text-white text-xl font-bold shadow-lg">
                        C
                    </div>
                    <div className="flex-1">
                        <h2 className={`text-base font-bold ${t.text}`}>Chathurika</h2>
                        <p className={`text-xs ${t.textMuted}`}>Study ID: PHN-2024-08</p>
                        <p className={`text-[11px] ${t.textDim}`}>Enrolled 12 days ago</p>
                    </div>
                    <StatusBadge status="normal" />
                </div>

                {/* Theme Toggle */}
                <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-4 mb-3`}>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            {isDark ? <Moon size={20} className="text-[#7c6bf7]" /> : <Sun size={20} className="text-yellow-500" />}
                            <div>
                                <p className={`text-sm font-semibold ${t.text}`}>Appearance</p>
                                <p className={`text-[11px] ${t.textMuted}`}>{isDark ? 'Dark mode' : 'Light mode'}</p>
                            </div>
                        </div>
                        <button
                            onClick={toggleTheme}
                            className={`w-14 h-8 rounded-full p-1 transition-colors duration-300 ${isDark ? 'bg-[#7c6bf7]' : 'bg-[#e5e5ea]'}`}
                        >
                            <div className={`w-6 h-6 rounded-full bg-white shadow-md transition-transform duration-300 ${isDark ? 'translate-x-6' : 'translate-x-0'}`} />
                        </button>
                    </div>
                </div>

                {/* Summary Report */}
                <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-4 mb-3`}>
                    <div className="flex items-center gap-2 mb-3">
                        <FileText size={18} className="text-[#7c6bf7]" />
                        <h3 className={`text-sm font-bold ${t.text}`}>Summary Report</h3>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        {[
                            { label: 'Days monitored', value: '12', icon: '📅' },
                            { label: 'Pre-stress alerts', value: '7', icon: '⚠️' },
                            { label: 'Avg daily score', value: '42/100', icon: '📊' },
                            { label: 'Calibration', value: 'Complete', icon: '✅' },
                            { label: 'Mood logs', value: '28', icon: '📝' },
                            { label: 'Model type', value: 'OC-SVM', icon: '🧠' },
                        ].map((item, i) => (
                            <div key={i} className={`flex items-center gap-2.5 p-3 rounded-xl ${isDark ? 'bg-[#0f0f14]' : 'bg-[#f2f2f7]'}`}>
                                <span className="text-base">{item.icon}</span>
                                <div>
                                    <p className={`text-[10px] ${t.textMuted}`}>{item.label}</p>
                                    <p className={`text-sm font-bold ${t.text}`}>{item.value}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Sensor Settings */}
                <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-4 mb-3`}>
                    <button
                        onClick={() => setExpandedSection(expandedSection === 'sensors' ? null : 'sensors')}
                        className="flex items-center justify-between w-full"
                    >
                        <div className="flex items-center gap-2">
                            <Settings size={18} className="text-[#7c6bf7]" />
                            <h3 className={`text-sm font-bold ${t.text}`}>Sensor Settings</h3>
                        </div>
                        {expandedSection === 'sensors' ? <ChevronUp size={18} className={t.textMuted} /> : <ChevronDown size={18} className={t.textMuted} />}
                    </button>

                    {expandedSection === 'sensors' && (
                        <div className="mt-4 space-y-3 animate-fade-in">
                            {SENSOR_LIST.map((sensor, i) => (
                                <div key={i} className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${sensor.color}15` }}>
                                            <sensor.icon size={16} style={{ color: sensor.color }} />
                                        </div>
                                        <span className={`text-sm ${t.text}`}>{sensor.name}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-emerald-500" />
                                        <span className={`text-[11px] ${t.successText} font-medium`}>Active</span>
                                    </div>
                                </div>
                            ))}

                            <div className={`p-3 rounded-xl ${isDark ? 'bg-[#0f0f14]' : 'bg-[#f2f2f7]'}`}>
                                <p className={`text-[11px] ${t.textMuted} leading-relaxed`}>
                                    💡 To enable sensors, go to <strong>Settings → Accessibility → PhenoCare</strong> on your phone. Ensure battery optimization is disabled for continuous monitoring.
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* How PhenoCare Works */}
                <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-4 mb-3`}>
                    <button
                        onClick={() => setExpandedSection(expandedSection === 'howto' ? null : 'howto')}
                        className="flex items-center justify-between w-full"
                    >
                        <div className="flex items-center gap-2">
                            <HelpCircle size={18} className="text-[#7c6bf7]" />
                            <h3 className={`text-sm font-bold ${t.text}`}>How PhenoCare Works</h3>
                        </div>
                        {expandedSection === 'howto' ? <ChevronUp size={18} className={t.textMuted} /> : <ChevronDown size={18} className={t.textMuted} />}
                    </button>

                    {expandedSection === 'howto' && (
                        <div className="mt-4 space-y-3 animate-fade-in">
                            {[
                                { step: '1', title: 'Passive Monitoring', desc: 'Your phone continuously collects behavioral signals — typing rhythm, scroll patterns, screen usage — without recording any content.' },
                                { step: '2', title: 'Personal Baseline', desc: 'During the first 7 days, PhenoCare builds your unique behavioral fingerprint using mean/std calculations and One-Class SVM.' },
                                { step: '3', title: 'Pre-Stress Detection', desc: 'When your behavior deviates beyond Z-score 2.0 from your baseline, you receive an early warning — typically 30-60 minutes before you feel stressed.' },
                            ].map((item, i) => (
                                <div key={i} className="flex gap-3">
                                    <div className="w-7 h-7 rounded-full bg-[#7c6bf7]/15 flex items-center justify-center shrink-0">
                                        <span className="text-xs font-bold text-[#7c6bf7]">{item.step}</span>
                                    </div>
                                    <div>
                                        <p className={`text-sm font-semibold ${t.text} mb-0.5`}>{item.title}</p>
                                        <p className={`text-[11px] ${t.textMuted} leading-relaxed`}>{item.desc}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* FAQ */}
                <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-4 mb-3`}>
                    <h3 className={`text-sm font-bold ${t.text} mb-3`}>Frequently Asked Questions</h3>
                    <div className="space-y-2">
                        {FAQ_LIST.map((faq, i) => (
                            <button
                                key={i}
                                onClick={() => setExpandedFaq(expandedFaq === i ? null : i)}
                                className={`w-full text-left p-3 rounded-xl transition-all ${isDark ? 'bg-[#0f0f14]' : 'bg-[#f2f2f7]'}`}
                            >
                                <div className="flex items-center justify-between">
                                    <span className={`text-sm font-medium ${t.text} pr-4`}>{faq.q}</span>
                                    {expandedFaq === i ? <ChevronUp size={16} className={t.textMuted} /> : <ChevronDown size={16} className={t.textMuted} />}
                                </div>
                                {expandedFaq === i && (
                                    <p className={`text-[11px] ${t.textSecondary} leading-relaxed mt-2 animate-fade-in`}>{faq.a}</p>
                                )}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Privacy */}
                <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-4 mb-3`}>
                    <div className="flex items-center gap-2 mb-2">
                        <Shield size={18} className="text-emerald-500" />
                        <h3 className={`text-sm font-bold ${t.text}`}>Privacy & Data</h3>
                    </div>
                    <p className={`text-xs ${t.textMuted} leading-relaxed mb-3`}>
                        Your data stays on your device and is processed locally. Only anonymized metrics are used for research purposes under Study ID PHN-2024-08 (SLIIT Ethics Board approved).
                    </p>
                    <button className={`flex items-center gap-2 text-[11px] font-bold text-[#7c6bf7] active:opacity-70`}>
                        <Download size={14} />
                        Export my data
                    </button>
                </div>

                {/* App Info */}
                <div className="text-center py-6">
                    <p className={`text-sm font-bold ${t.text} mb-1`}>PhenoCare v1.0.0</p>
                    <p className={`text-[10px] ${t.textDim}`}>Pre-perceived stress detection via digital phenotyping</p>
                    <p className={`text-[10px] ${t.textDim} mt-1`}>Study ID: PHN-2024-08 · SLIIT Research</p>
                </div>
            </div>

            <BottomNav />
        </div>
    );
}
