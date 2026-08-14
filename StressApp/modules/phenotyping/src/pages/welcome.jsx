import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, ChevronRight } from 'lucide-react';

export function Welcome() {
  const navigate = useNavigate();
  const [typedText, setTypedText] = useState('');
  const fullText = "Detect stress before it peaks";
  
  useEffect(() => {
    let i = 0;
    const timer = setInterval(() => {
      if (i <= fullText.length) {
        setTypedText(fullText.slice(0, i));
        i++;
      } else {
        clearInterval(timer);
      }
    }, 70);
    return () => clearInterval(timer);
  }, []);

  return (
    /* min-h-[100dvh]: takes at least full viewport on mobile, grows on desktop */
    <div
      className="bg-[#0a0a0f] flex flex-col items-center justify-between font-sans relative overflow-x-hidden"
      style={{ minHeight: '100dvh', padding: '20px 20px 32px' }}
    >
      {/* Background glows */}
      <div className="absolute top-0 left-0 w-1/2 h-1/2 bg-[#7c6bf7]/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-1/2 h-1/2 bg-[#4c1d95]/10 rounded-full blur-[100px] pointer-events-none" />

      {/* Center content */}
      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-md mx-auto relative z-10">
        {/* Phone mockup */}
        <div className="relative mb-8 animate-float">
          <div className="w-[150px] h-[280px] bg-[#1c1c24] rounded-[36px] border-[5px] border-[#2a2a38] shadow-2xl relative overflow-hidden ring-1 ring-white/5">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-16 h-5 bg-[#2a2a38] rounded-b-2xl z-20" />
            <div className="absolute inset-0 bg-[#0f0f14] flex flex-col items-center justify-center p-4">
              <div className="w-12 h-12 bg-[#7c6bf7]/10 rounded-2xl flex items-center justify-center mb-4 border border-[#7c6bf7]/20">
                <img src="/favicon.png" alt="PhenoCare" className="w-8 h-8 object-contain" />
              </div>
              <div className="space-y-2 w-full px-2">
                <div className="h-1.5 w-full bg-zinc-800 rounded-full" />
                <div className="h-1.5 w-3/4 bg-zinc-800 rounded-full" />
                <div className="h-1.5 w-1/2 bg-[#7c6bf7]/30 rounded-full" />
              </div>
              <div className="absolute inset-0 opacity-10 pointer-events-none"
                style={{ backgroundImage: 'radial-gradient(#7c6bf7 1px, transparent 1px)', backgroundSize: '15px 15px' }} />
            </div>
          </div>
          <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-24 h-3 bg-black/40 rounded-full blur-md" />
        </div>

        {/* Hero text */}
        <h1 className="text-5xl md:text-6xl font-black text-white mb-2 tracking-tighter text-center bg-clip-text text-transparent bg-gradient-to-b from-white to-white/60">
          PhenoCare
        </h1>
        <div className="h-7 mb-8 flex items-center justify-center">
          <p className="text-[#94a3b8] text-sm md:text-base font-medium tracking-wide text-center">
            {typedText}
            <span className="inline-block w-0.5 h-4 bg-[#7c6bf7] ml-1 animate-pulse" />
          </p>
        </div>

        {/* CTA */}
        <button
          onClick={() => navigate('/permissions')}
          className="group px-10 py-4 rounded-full bg-white text-black font-bold text-base transition-all hover:scale-105 active:scale-95 shadow-xl shadow-white/10 flex items-center gap-2"
        >
          Get Started
          <ChevronRight size={20} className="transition-transform group-hover:translate-x-1" />
        </button>
      </div>

      {/* Footer */}
      <div className="relative z-10 flex flex-col items-center gap-3 mt-6">
        <p className="text-sm text-[#64748b]">
          Already have an account?{' '}
          <span className="text-white font-semibold cursor-pointer hover:underline underline-offset-4">Sign in</span>
        </p>
        <div className="flex items-center gap-2 text-[10px] text-[#475569] uppercase tracking-[0.2em] font-bold">
          <Lock size={10} className="text-[#7c6bf7]" />
          <span>On-Device Privacy First</span>
        </div>
      </div>
    </div>
  );
}