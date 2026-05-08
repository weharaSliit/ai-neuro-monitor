import React from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Calendar, Smartphone, TrendingUp } from 'lucide-react';

export function SetupComplete() {
    const navigate = useNavigate();

    return (
        <div className="h-screen bg-[#0f0f14] flex flex-col items-center justify-center p-6 text-center font-sans">
            {/* Success Animation/Icon */}
            <div className="mb-10 text-emerald-500">
                <CheckCircle2 size={80} strokeWidth={1.5} />
            </div>

            {/* Main Heading */}
            <h1 className="text-3xl font-bold text-white mb-4 tracking-tight">
                You're all set, Chathurika!
            </h1>

            <p className="text-gray-400 text-sm leading-relaxed mb-12 max-w-[280px]">
                PhenoCare will spend the next 7 days learning what's normal for you before predictions begin.
            </p>

            {/* Feature List */}
            <div className="w-full max-w-[300px] space-y-6 mb-20">
                <div className="flex items-center gap-4 text-left">
                    <Calendar size={20} className="text-emerald-500/80 shrink-0" />
                    <p className="text-[13px] text-gray-300">
                        Daily mood check — <span className="text-gray-500 text-xs">takes under a minute</span>
                    </p>
                </div>

                <div className="flex items-center gap-4 text-left">
                    <Smartphone size={20} className="text-emerald-500/80 shrink-0" />
                    <p className="text-[13px] text-gray-300">
                        Passive sensor monitoring — <span className="text-gray-500 text-xs">runs in the background</span>
                    </p>
                </div>

                <div className="flex items-center gap-4 text-left">
                    <TrendingUp size={20} className="text-emerald-500/80 shrink-0" />
                    <p className="text-[13px] text-gray-300">
                        Your first stress insight in 7 days
                    </p>
                </div>
            </div>

            {/* Final CTA */}
            <button
                onClick={() => navigate('/dashboard')}
                className="text-[#e8e8f8] font-bold text-base hover:text-[#7c6bf7] transition-colors mb-20"
            >
                Go to my dashboard
            </button>

            {/* Research Footer */}
            <footer className="absolute bottom-10 px-6">
                <p className="text-[9px] text-gray-600 uppercase tracking-widest leading-relaxed">
                    This app is part of Study ID: PHN-2024-08 · SLIIT Research
                </p>
            </footer>
        </div>
    );
}