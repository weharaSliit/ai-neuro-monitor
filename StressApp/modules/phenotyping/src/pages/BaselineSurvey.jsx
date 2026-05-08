import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Info } from 'lucide-react';

const SURVEY_DATA = [
    {
        id: 1,
        category: "Sleep",
        badgeColor: "border-[#7c6bf7]/40 bg-[#7c6bf7]/10 text-[#7c6bf7]",
        question: "On most nights, how many hours do you sleep?",
        options: ["Less than 5 hours", "5 to 6 hours", "6 to 7 hours", "7 to 8 hours", "More than 8 hours"]
    },
    {
        id: 2,
        category: "Stress history",
        badgeColor: "border-orange-500/40 bg-orange-500/10 text-orange-500",
        question: "On a typical week, how many days do you feel stressed?",
        options: ["Rarely — 1 day or less", "Sometimes — 2 to 3 days", "Often — 4 to 5 days", "Almost every day"]
    },
    {
        id: 3,
        category: "Right now",
        badgeColor: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
        question: "Right now, your mood feels closer to...",
        options: ["Calm and relaxed", "Mostly fine, slight tension", "A bit stressed or anxious", "Quite stressed or overwhelmed"]
    },
    {
        id: 4,
        category: "Daily activity",
        badgeColor: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
        question: "How physically active are you on a typical day?",
        options: ["Sedentary — mostly sitting", "Lightly active — occasional walks", "Moderately active — regular movement", "Very active — daily exercise"]
    },
    {
        id: 5,
        category: "Work & study",
        badgeColor: "border-[#7c6bf7]/40 bg-[#7c6bf7]/10 text-[#7c6bf7]",
        question: "What does your typical daily schedule look like?",
        options: ["Fixed hours — same time every day", "Flexible hours — varies each day", "Shift work — rotating schedule", "Student — lecture-based schedule"],
        footerNote: "This helps us understand when your behavior patterns are expected to change naturally."
    },
    {
        id: 6,
        category: "Your goal",
        badgeColor: "border-[#7c6bf7]/40 bg-[#7c6bf7]/10 text-[#7c6bf7]",
        question: "What is your main reason for using PhenoCare?",
        options: ["Understand my stress patterns", "Get early warning before I burn out", "Support my therapy or counselling", "Participating in a research study"],
        finalAction: "Save my baseline"
    }
];

export function BaselineSurvey() {
    const navigate = useNavigate();
    const [currentStep, setCurrentStep] = useState(0);
    const [selections, setSelections] = useState({});

    const currentQ = SURVEY_DATA[currentStep];

    const handleContinue = () => {
        if (currentStep < SURVEY_DATA.length - 1) {
            setCurrentStep(currentStep + 1);
        } else {
            navigate('/setup-complete');
        }
    };

    const handleBack = () => {
        if (currentStep > 0) {
            setCurrentStep(currentStep - 1);
        } else {
            navigate(-1);
        }
    };

    return (
        <div className="h-screen bg-[#0f0f14] flex flex-col font-sans">
            {/* Top Header */}
            <div className="p-6">
                <div className="flex justify-between items-center mb-6">
                    <button onClick={handleBack} className="text-white/60">
                        <ArrowLeft size={24} />
                    </button>
                    <span className="text-[10px] text-[#c0c0d8] font-bold">9:41</span>
                </div>

                <div className="flex items-center gap-4">
                    <p className="text-[11px] text-gray-400 whitespace-nowrap">Step 2 of 3 — About you</p>
                    <div className="w-full h-[3px] bg-zinc-800 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-[#7c6bf7] rounded-full transition-all duration-500"
                            style={{ width: `${((currentStep + 1) / 6) * 100}%` }}
                        ></div>
                    </div>
                </div>
            </div>

            <div className="flex-1 px-6 pt-4">
                <div className={`inline-block px-4 py-1.5 rounded-full border ${currentQ.badgeColor} text-[11px] font-bold mb-6 transition-colors`}>
                    {currentQ.category}
                </div>

                <h1 className="text-2xl font-bold text-white mb-10 leading-tight">
                    {currentQ.question}
                </h1>

                <div className="space-y-3">
                    {currentQ.options.map((option) => (
                        <button
                            key={option}
                            onClick={() => setSelections({ ...selections, [currentQ.id]: option })}
                            className={`w-full p-5 rounded-2xl border text-left transition-all duration-200 ${selections[currentQ.id] === option
                                    ? 'bg-[#1a1228] border-[#7c6bf7] text-white'
                                    : 'bg-[#14141f] border-[#2a2a38] text-gray-300'
                                }`}
                        >
                            <span className="text-sm font-medium">{option}</span>
                        </button>
                    ))}
                </div>

                {/* Info Box for Question 5 */}
                {currentQ.footerNote && (
                    <div className="mt-6 flex gap-3 items-start text-[#3b82f6]">
                        <Info size={16} className="mt-0.5" />
                        <p className="text-[11px] leading-relaxed opacity-80">{currentQ.footerNote}</p>
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="p-6 flex flex-col items-center gap-4">
                <button
                    onClick={handleContinue}
                    disabled={!selections[currentQ.id]}
                    className={`w-full py-4 rounded-2xl font-bold text-sm transition-all ${selections[currentQ.id]
                            ? 'bg-transparent text-white border border-white/20 hover:bg-white/5'
                            : 'bg-transparent text-gray-600 cursor-not-allowed'
                        }`}
                >
                    {currentQ.finalAction || "Continue"}
                </button>

                <div className="text-center">
                    <p className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-2">
                        {currentStep + 1} of 6 questions
                    </p>
                    {currentStep === 5 && (
                        <p className="text-[10px] text-gray-700">You can update these answers anytime in Settings.</p>
                    )}
                </div>
            </div>
        </div>
    );
}