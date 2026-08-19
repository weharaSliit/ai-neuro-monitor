import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Moon, Zap, Activity, Calendar, Heart, CheckCircle2, User, ArrowRight } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { getUserProfile, saveUserProfile } from '../utils/userStorage';

const SURVEY_DATA = [
    {
        id: 'user_name', type: 'text',
        question: "What is your Name / Participant ID?",
        subtitle: "Enter your name to personalize your digital phenotyping stress baselines.",
        icon: User, color: 'text-purple-400', bgColor: 'bg-purple-500/10', animation: 'animate-float'
    },
    {
        id: 'sleep', type: 'choice',
        question: "On most nights, how many hours do you sleep?",
        options: ["Less than 5 hours", "5-6 hours", "7-8 hours", "9+ hours"],
        icon: Moon, color: 'text-indigo-400', bgColor: 'bg-indigo-500/10', animation: 'animate-float'
    },
    {
        id: 'stress_freq', type: 'choice',
        question: "On a typical week, how many days do you feel stressed?",
        options: ["0-1 day", "2-3 days", "4-5 days", "Every day"],
        icon: Zap, color: 'text-orange-400', bgColor: 'bg-orange-500/10', animation: 'animate-pulse'
    },
    {
        id: 'activity', type: 'choice',
        question: "How physically active are you on a typical day?",
        options: ["Not at all", "Lightly active", "Moderately active", "Very active"],
        icon: Activity, color: 'text-emerald-400', bgColor: 'bg-emerald-500/10', animation: 'animate-bounce'
    },
    {
        id: 'schedule', type: 'choice',
        question: "What does your typical daily schedule look like?",
        options: ["Fixed (9-5)", "Flexible/Remote", "Irregular/Shift", "Student/Study"],
        icon: Calendar, color: 'text-purple-400', bgColor: 'bg-purple-500/10', animation: 'animate-spin-slow'
    },
    {
        id: 'reason', type: 'choice',
        question: "What is your main reason for using PhenoCare?",
        options: ["Stress awareness", "Research study", "Improve focus", "Health tracking"],
        icon: Heart, color: 'text-rose-400', bgColor: 'bg-rose-500/10', animation: 'animate-float'
    }
];

export function BaselineSurvey() {
    const navigate = useNavigate();
    const { t } = useTheme();
    const [step, setStep] = useState(0);
    const [nameInput, setNameInput] = useState('');
    const [answers, setAnswers] = useState({});
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');

    useEffect(() => {
        const profile = getUserProfile();
        if (profile && profile.name && profile.name !== 'Participant') {
            setNameInput(profile.name);
        }
    }, []);

    const currentQ = SURVEY_DATA[step];
    const progress = ((step + 1) / SURVEY_DATA.length) * 100;

    const advanceStep = async (newAnswers) => {
        if (step < SURVEY_DATA.length - 1) {
            setIsTransitioning(true);
            setTimeout(() => { setStep(step + 1); setIsTransitioning(false); }, 280);
        } else {
            const finalName = newAnswers.user_name || nameInput.trim() || 'Participant';
            await saveUserProfile({ name: finalName, created_at: new Date().toISOString(), is_calibrated: false, survey_answers: newAnswers });
            navigate('/setup-complete');
        }
    };

    const handleNameSubmit = (e) => {
        e.preventDefault();
        const trimmed = nameInput.trim();
        if (!trimmed) { setErrorMsg('Please enter your name or participant ID'); return; }
        setErrorMsg('');
        const updated = { ...answers, user_name: trimmed };
        setAnswers(updated);
        advanceStep(updated);
    };

    const handleOptionSelect = (option) => {
        const updated = { ...answers, [currentQ.id]: option };
        setAnswers(updated);
        setTimeout(() => advanceStep(updated), 300);
    };

    const handleBack = () => {
        if (step > 0) {
            setIsTransitioning(true);
            setTimeout(() => { setStep(step - 1); setIsTransitioning(false); }, 280);
        } else { navigate('/permissions'); }
    };

    return (
        /**
         * LAYOUT: Full page scroll — content grows naturally, button inside the page flow (not fixed).
         * On mobile: user scrolls to the bottom to tap "Save Name & Continue" or taps a choice option.
         * Choice questions auto-advance on select so no button needed.
         */
        <div className={`${t.bg} font-sans`} style={{ minHeight: '100dvh' }}>
            <div className="w-full max-w-4xl mx-auto px-5 md:px-12 py-6 pb-16">

                {/* Header */}
                <div className="mb-6">
                    <div className="flex items-center justify-between mb-4">
                        <button onClick={handleBack} className={`p-2 -ml-2 rounded-xl ${t.textMuted} transition-all flex items-center gap-1`}>
                            <ChevronLeft size={22} />
                            <span className="text-xs font-semibold hidden md:inline">Back</span>
                        </button>
                        <span className={`text-[10px] font-bold uppercase tracking-widest ${t.textMuted}`}>
                            Step 2 of 3 — Setup Profile
                        </span>
                        <div className="w-16" />
                    </div>
                    <div className={`w-full h-1.5 ${t.progressBg} rounded-full overflow-hidden`}>
                        <div className="h-full bg-[#7c6bf7] transition-all duration-500 ease-out" style={{ width: `${progress}%` }} />
                    </div>
                </div>

                {/* Question area */}
                <div className={`transition-all duration-280 ${isTransitioning ? 'opacity-0 translate-x-3' : 'opacity-100 translate-x-0'}`}>
                    {/* Icon */}
                    <div className="flex flex-col items-center mb-8">
                        <div className={`w-20 h-20 rounded-3xl ${currentQ.bgColor} flex items-center justify-center mb-5`}>
                            <currentQ.icon size={40} className={`${currentQ.color} ${currentQ.animation}`} />
                        </div>
                        <h2 className={`text-xl md:text-2xl font-bold ${t.text} text-center leading-snug mb-2 max-w-sm`}>
                            {currentQ.question}
                        </h2>
                        {currentQ.subtitle && (
                            <p className={`text-xs ${t.textMuted} text-center max-w-xs`}>{currentQ.subtitle}</p>
                        )}
                        <p className={`text-[10px] ${t.textDim} text-center uppercase tracking-widest font-bold mt-3`}>
                            Question {step + 1} of {SURVEY_DATA.length}
                        </p>
                    </div>

                    {/* Input or choices */}
                    <div className="max-w-xl mx-auto">
                        {currentQ.type === 'text' ? (
                            <form onSubmit={handleNameSubmit} className="space-y-4">
                                <div>
                                    <label className={`block text-xs font-semibold ${t.textMuted} mb-2`}>
                                        Your Name / Participant ID
                                    </label>
                                    <input
                                        type="text"
                                        value={nameInput}
                                        onChange={(e) => { setNameInput(e.target.value); if (errorMsg) setErrorMsg(''); }}
                                        placeholder="e.g. Chathurika or P001"
                                        className="w-full p-4 rounded-2xl border-2 bg-[#14141f] border-[#2a2a38] text-white placeholder-gray-500 focus:border-[#7c6bf7] focus:outline-none text-base transition-all"
                                        autoFocus
                                    />
                                    {errorMsg && <p className="text-xs text-red-400 mt-1.5 font-medium">{errorMsg}</p>}
                                </div>
                                <button
                                    type="submit"
                                    className="w-full py-4 rounded-2xl bg-[#7c6bf7] text-white font-bold text-sm transition-all hover:bg-[#6856f5] shadow-lg shadow-[#7c6bf7]/25 flex items-center justify-center gap-2 active:scale-[0.98]"
                                >
                                    Save Name & Continue <ArrowRight size={18} />
                                </button>
                            </form>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {currentQ.options.map((option, i) => {
                                    const selected = answers[currentQ.id] === option;
                                    return (
                                        <button
                                            key={i}
                                            onClick={() => handleOptionSelect(option)}
                                            className={`w-full p-4 rounded-2xl border-2 text-left transition-all duration-200 flex items-center justify-between group ${
                                                selected
                                                    ? 'border-[#7c6bf7] bg-[#7c6bf7]/10 shadow-md'
                                                    : `${t.card} ${t.cardBorder} hover:border-zinc-600`
                                            }`}
                                        >
                                            <span className={`text-sm font-semibold ${selected ? t.accent : t.text}`}>{option}</span>
                                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ml-3 ${selected ? 'bg-[#7c6bf7] border-[#7c6bf7]' : 'border-zinc-600'}`}>
                                                {selected && <CheckCircle2 size={12} className="text-white" strokeWidth={3} />}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <p className={`text-center text-[9px] ${t.textDim} uppercase tracking-widest font-bold mt-10`}>
                    Study ID: PHN-2024-08 · SLIIT Research
                </p>
            </div>
        </div>
    );
}