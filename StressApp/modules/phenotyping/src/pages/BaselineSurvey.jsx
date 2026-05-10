import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
    ChevronLeft, Moon, Zap, Activity, 
    Calendar, Heart, CheckCircle2
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

const SURVEY_DATA = [
    {
        id: 'sleep',
        question: "On most nights, how many hours do you sleep?",
        options: ["Less than 5 hours", "5-6 hours", "7-8 hours", "9+ hours"],
        icon: Moon,
        color: 'text-indigo-400',
        bgColor: 'bg-indigo-500/10',
        animation: 'animate-float'
    },
    {
        id: 'stress_freq',
        question: "On a typical week, how many days do you feel stressed?",
        options: ["0-1 day", "2-3 days", "4-5 days", "Every day"],
        icon: Zap,
        color: 'text-orange-400',
        bgColor: 'bg-orange-500/10',
        animation: 'animate-pulse'
    },
    {
        id: 'activity',
        question: "How physically active are you on a typical day?",
        options: ["Not at all", "Lightly active", "Moderately active", "Very active"],
        icon: Activity,
        color: 'text-emerald-400',
        bgColor: 'bg-emerald-500/10',
        animation: 'animate-bounce'
    },
    {
        id: 'schedule',
        question: "What does your typical daily schedule look like?",
        options: ["Fixed (9-5)", "Flexible/Remote", "Irregular/Shift", "Student/Study"],
        icon: Calendar,
        color: 'text-purple-400',
        bgColor: 'bg-purple-500/10',
        animation: 'animate-spin-slow'
    },
    {
        id: 'reason',
        question: "What is your main reason for using PhenoCare?",
        options: ["Stress awareness", "Research study", "Improve focus", "Health tracking"],
        icon: Heart,
        color: 'text-rose-400',
        bgColor: 'bg-rose-500/10',
        animation: 'animate-float'
    }
];

export function BaselineSurvey() {
    const navigate = useNavigate();
    const { t, isDark } = useTheme();
    const [step, setStep] = useState(0);
    const [answers, setAnswers] = useState({});
    const [isTransitioning, setIsTransitioning] = useState(false);

    const currentQ = SURVEY_DATA[step];
    const progress = ((step + 1) / SURVEY_DATA.length) * 100;

    const handleOptionSelect = (option) => {
        setAnswers({ ...answers, [currentQ.id]: option });
        
        // Advance after feedback
        setTimeout(() => {
            if (step < SURVEY_DATA.length - 1) {
                setIsTransitioning(true);
                setTimeout(() => {
                    setStep(step + 1);
                    setIsTransitioning(false);
                }, 300);
            } else {
                navigate('/setup-complete');
            }
        }, 400);
    };

    const handleBack = () => {
        if (step > 0) {
            setIsTransitioning(true);
            setTimeout(() => {
                setStep(step - 1);
                setIsTransitioning(false);
            }, 300);
        } else {
            navigate('/permissions');
        }
    };

    const isSelected = (option) => answers[currentQ.id] === option;

    return (
        <div className={`h-screen ${t.bg} flex flex-col font-sans overflow-hidden relative max-w-md mx-auto shadow-2xl`}>
            {/* Header / Progress */}
            <div className="px-6 pt-12 pb-6">
                <div className="flex items-center justify-between mb-6">
                    <button 
                        onClick={handleBack}
                        className={`p-2 -ml-2 rounded-xl ${t.textMuted} hover:${t.text} active:scale-90 transition-all`}
                    >
                        <ChevronLeft size={24} />
                    </button>
                    <span className={`text-[10px] font-bold uppercase tracking-widest ${t.textMuted}`}>
                        Step 2 of 3 — Baseline
                    </span>
                    <div className="w-10" /> 
                </div>
                
                <div className={`w-full h-1.5 ${t.progressBg} rounded-full overflow-hidden`}>
                    <div 
                        className="h-full bg-[#7c6bf7] transition-all duration-500 ease-out"
                        style={{ width: `${progress}%` }}
                    />
                </div>
            </div>

            {/* Question Content */}
            <div className={`flex-1 flex flex-col px-8 transition-all duration-300 ${isTransitioning ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0'}`}>
                
                {/* Animation Area */}
                <div className="flex flex-col items-center justify-center py-6">
                    <div className={`relative w-28 h-28 rounded-3xl ${currentQ.bgColor} flex items-center justify-center mb-8 transition-all duration-500 ${answers[currentQ.id] ? 'scale-110 shadow-2xl shadow-[#7c6bf7]/20' : ''}`}>
                        <currentQ.icon 
                            size={56} 
                            className={`${currentQ.color} ${answers[currentQ.id] ? 'animate-none' : currentQ.animation}`} 
                        />
                        {answers[currentQ.id] && (
                            <div className="absolute -top-2 -right-2 bg-emerald-500 text-white p-1.5 rounded-full shadow-lg animate-fade-in-scale">
                                <CheckCircle2 size={18} strokeWidth={3} />
                            </div>
                        )}
                        
                        <div className={`absolute -top-3 -left-3 w-3 h-3 rounded-full ${currentQ.color} opacity-40 animate-float`} />
                        <div className={`absolute bottom-3 -right-5 w-2 h-2 rounded-full ${currentQ.color} opacity-30 animate-pulse`} />
                    </div>
                    
                    <h2 className={`text-2xl font-bold ${t.text} text-center leading-tight mb-2 px-2`}>
                        {currentQ.question}
                    </h2>
                    <p className={`text-[11px] ${t.textDim} text-center uppercase tracking-widest font-bold`}>
                        Question {step + 1} of {SURVEY_DATA.length}
                    </p>
                </div>

                {/* Options List */}
                <div className="flex-1 flex flex-col justify-end pb-12 stagger-children">
                    <div className="space-y-3">
                        {currentQ.options.map((option, i) => {
                            const selected = isSelected(option);
                            return (
                                <button
                                    key={i}
                                    onClick={() => handleOptionSelect(option)}
                                    className={`w-full p-4 rounded-2xl border-2 text-left transition-all duration-300 flex items-center justify-between group
                                        ${selected 
                                            ? 'border-[#7c6bf7] bg-[#7c6bf7]/5 shadow-md translate-y-[-1px]' 
                                            : `${t.card} ${t.cardBorder} hover:${t.cardHover}`
                                        }
                                    `}
                                >
                                    <span className={`text-sm font-semibold transition-colors ${selected ? t.accent : t.text}`}>
                                        {option}
                                    </span>
                                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all
                                        ${selected 
                                            ? 'bg-[#7c6bf7] border-[#7c6bf7]' 
                                            : `border-zinc-700 group-hover:border-zinc-500`
                                        }
                                    `}>
                                        {selected && <CheckCircle2 size={12} className="text-white" strokeWidth={3} />}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Footer */}
            <div className="text-center pb-6">
                <p className={`text-[9px] ${t.textDim} uppercase tracking-widest`}>
                    Study ID: PHN-2024-08 · SLIIT Research
                </p>
            </div>
        </div>
    );
}