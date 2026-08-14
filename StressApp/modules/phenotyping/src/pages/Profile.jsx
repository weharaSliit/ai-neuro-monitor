import React, { useState, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import { BottomNav } from '../components/BottomNav';
import { StatusBadge } from '../components/StatusBadge';
import { getUserProfile, getCalibrationStatus } from '../utils/userStorage';
import {
    Sun, Moon, ChevronDown, ChevronUp, Shield, FileText, HelpCircle,
    Keyboard, Smartphone, Activity, ScrollText, Settings, RefreshCw, Download
} from 'lucide-react';

const SENSOR_LIST = [
    { icon: Keyboard, name: 'Keyboard Monitor', status: 'active', color: '#7c6bf7' },
    { icon: Smartphone, name: 'Screen Activity', status: 'active', color: '#10b981' },
    { icon: ScrollText, name: 'Scroll Tracker', status: 'active', color: '#3b82f6' },
    { icon: RefreshCw, name: 'App Switch Monitor', status: 'active', color: '#f59e0b' },
    { icon: Activity, name: 'Physical Motion Context', status: 'active', color: '#8b5cf6' },
];

const FAQ_LIST = [
    { q: 'How does PhenoCare detect stress?', a: 'It monitors your typing rhythm, scroll behavior, screen usage, app switching patterns, and physical movement. When these deviate from your personal baseline (established during the first 7 days), it flags a pre-stress alert.' },
    { q: 'Does PhenoCare read my messages?', a: 'No. PhenoCare only measures timing patterns — how fast you type, how often you scroll, how quickly you switch apps. It never reads the content of any message, email, or notification.' },
    { q: 'What is the 7-day calibration?', a: 'During your first 7 days, PhenoCare learns what is "normal" for you. It calculates your personal mean and standard deviation for each behavioral signal. This ensures predictions are tailored to your unique habits.' },
    { q: 'How does the baseline adapt?', a: 'Your baseline updates using Exponential Moving Average (EMA) with α=0.2. Crucially, it only updates during normal periods — stress episodes are excluded to prevent contamination.' },
];

export function Profile() {
    const { t, isDark, toggleTheme } = useTheme();
    const [expandedFaq, setExpandedFaq] = useState(null);
    const [expandedSection, setExpandedSection] = useState(null);
    const [userProfile, setUserProfile] = useState(() => getUserProfile());
    const [calibStatus, setCalibStatus] = useState(() => getCalibrationStatus(userProfile));

    useEffect(() => {
        const p = getUserProfile();
        setUserProfile(p);
        setCalibStatus(getCalibrationStatus(p));
    }, []);

    const userName = userProfile.name || 'Participant';
    const firstInitial = userName.charAt(0).toUpperCase();

    return (
        <div className={`min-h-screen ${t.bg} ${t.text} flex flex-col font-sans pb-24 relative`}>
            <div className="w-full max-w-5xl mx-auto flex-1 flex flex-col px-5 pt-5">
                
                {/* Header */}
                <div className="pb-4 animate-fade-in">
                    <h1 className={`text-xl font-bold ${t.text} mb-1`}>Profile</h1>
                    <p className={`text-xs ${t.textMuted}`}>Personal settings & calibration status</p>
                </div>

                <div className="flex-1 stagger-children space-y-4">
                    
                    {/* User Card */}
                    <div className={`${t.card} border ${t.cardBorder} rounded-3xl p-5 flex items-center gap-4`}>
                        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#7c6bf7] to-[#a855f7] flex items-center justify-center text-white text-xl font-bold shadow-lg shrink-0">
                            {firstInitial}
                        </div>
                        <div className="flex-1 min-w-0">
                            <h2 className={`text-base font-bold ${t.text} truncate`}>{userName}</h2>
                            <p className={`text-xs ${t.textMuted}`}>ID: {userProfile.userId || 'Not registered'}</p>
                            <p className={`text-[11px] ${t.textDim} mt-0.5`}>
                                {calibStatus.phase === 'calibration' 
                                    ? `Calibration: ${calibStatus.displayDays}` 
                                    : 'Baseline Calibrated (Day 8+)'}
                            </p>
                        </div>
                        <StatusBadge status={calibStatus.isCalibrated ? 'normal' : 'elevated'} />
                    </div>

                    {/* Theme Toggle */}
                    <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-4`}>
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
                    <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-4`}>
                        <div className="flex items-center gap-2 mb-3">
                            <FileText size={18} className="text-[#7c6bf7]" />
                            <h3 className={`text-sm font-bold ${t.text}`}>Summary Report</h3>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            {[
                                { label: 'Monitoring period', value: calibStatus.displayDays, icon: '📅' },
                                { label: 'Baseline state', value: calibStatus.isCalibrated ? 'Calibrated' : 'Gathering', icon: '✅' },
                                { label: 'Study ID', value: userProfile.study_id || 'PHN-2024-08', icon: '🧬' },
                                { label: 'Model type', value: 'One-Class SVM', icon: '🧠' },
                                { label: 'Data rate', value: '30-min window', icon: '⏱️' },
                                { label: 'Context gate', value: 'Accelerometer', icon: '🚶' },
                            ].map((item, i) => (
                                <div key={i} className={`flex items-center gap-2.5 p-3 rounded-xl ${isDark ? 'bg-[#0f0f14]' : 'bg-[#f2f2f7]'}`}>
                                    <span className="text-base">{item.icon}</span>
                                    <div>
                                        <p className={`text-[10px] ${t.textMuted}`}>{item.label}</p>
                                        <p className={`text-xs font-bold ${t.text}`}>{item.value}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Sensor Settings */}
                    <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-4`}>
                        <button
                            onClick={() => setExpandedSection(expandedSection === 'sensors' ? null : 'sensors')}
                            className="flex items-center justify-between w-full"
                        >
                            <div className="flex items-center gap-2">
                                <Settings size={18} className="text-[#7c6bf7]" />
                                <h3 className={`text-sm font-bold ${t.text}`}>Active Sensors</h3>
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
                            </div>
                        )}
                    </div>

                    {/* How PhenoCare Works */}
                    <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-4`}>
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
                                    { step: '1', title: 'Passive Monitoring', desc: 'Your phone continuously collects behavioral signals — typing rhythm, scroll patterns, screen usage, app switches — without recording text content.' },
                                    { step: '2', title: '7-Day Baseline Calibration', desc: 'During your first 7 days, PhenoCare builds your unique behavioral fingerprint using idiographic mean/std calculations and One-Class SVM.' },
                                    { step: '3', title: 'Pre-Stress Detection (Day 8+)', desc: 'When your behavior deviates beyond Z-score 2.0 from your baseline, you receive an early warning — typically 30-60 minutes before stress peaks.' },
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
                    <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-4`}>
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
                    <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-4`}>
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
                    <div className="text-center py-4">
                        <p className={`text-sm font-bold ${t.text} mb-1`}>PhenoCare v1.0.0</p>
                        <p className={`text-[10px] ${t.textDim}`}>Pre-perceived stress detection via digital phenotyping</p>
                        <p className={`text-[10px] ${t.textDim} mt-1`}>Study ID: PHN-2024-08 · SLIIT Research</p>
                    </div>
                </div>
            </div>

            <BottomNav />
        </div>
    );
}
