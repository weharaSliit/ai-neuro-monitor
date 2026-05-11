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
    <div className="h-screen bg-[#0a0a0f] flex flex-col items-center justify-between p-8 text-center overflow-hidden relative">
      {/* Background Gradient Glows */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-[#7c6bf7]/10 rounded-full blur-[100px]" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-[#4c1d95]/10 rounded-full blur-[100px]" />

      <div className="flex-1 flex flex-col items-center justify-center w-full">
        {/* Smartphone Mockup Animation */}
        <div className="relative mb-12 animate-float">
          {/* Phone Frame */}
          <div className="w-[180px] h-[340px] bg-[#1c1c24] rounded-[40px] border-[6px] border-[#2a2a38] shadow-2xl relative overflow-hidden ring-1 ring-white/5">
            {/* Notch */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-20 h-6 bg-[#2a2a38] rounded-b-2xl z-20" />
            
            {/* Phone Screen / Wallpaper */}
            <div className="absolute inset-0 bg-[#0f0f14] flex flex-col items-center justify-center p-4">
              <div className="w-16 h-16 bg-[#7c6bf7]/10 rounded-2xl flex items-center justify-center mb-4 border border-[#7c6bf7]/20">
                <img src="/favicon.png" alt="PhenoCare" className="w-10 h-10 object-contain animate-pulse-slow" />
              </div>
              <div className="space-y-2 w-full px-2">
                <div className="h-1.5 w-full bg-zinc-800 rounded-full" />
                <div className="h-1.5 w-3/4 bg-zinc-800 rounded-full" />
                <div className="h-1.5 w-1/2 bg-[#7c6bf7]/30 rounded-full" />
              </div>
              
              {/* Decorative Grid */}
              <div className="absolute inset-0 opacity-10 pointer-events-none" 
                   style={{ backgroundImage: 'radial-gradient(#7c6bf7 1px, transparent 1px)', backgroundSize: '15px 15px' }} />
            </div>
          </div>
          
          {/* Shadow */}
          <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 w-32 h-4 bg-black/40 rounded-full blur-lg" />
        </div>

        {/* Hero Content */}
        <div className="stagger-children relative z-10">
          <h1 className="text-5xl font-black text-white mb-4 tracking-tighter bg-clip-text text-transparent bg-gradient-to-b from-white to-white/60">
            PhenoCare
          </h1>
          
          <div className="h-6 mb-16">
            <p className="text-[#94a3b8] text-base font-medium tracking-wide">
              {typedText}
              <span className="inline-block w-1 h-4 bg-[#7c6bf7] ml-1 animate-pulse" />
            </p>
          </div>
        </div>

        {/* Action Button */}
        <button 
          onClick={() => navigate('/permissions')}
          className="group relative px-10 py-5 rounded-full bg-white text-black font-bold text-lg transition-all hover:scale-105 active:scale-95 shadow-xl shadow-white/10"
        >
          <span className="flex items-center gap-2">
            Get Started
            <ChevronRight size={20} className="transition-transform group-hover:translate-x-1" />
          </span>
        </button>
      </div>

      {/* Footer Info */}
      <div className="pb-8 space-y-4 w-full">
        <div className="text-sm text-[#64748b]">
          Already have an account? <span className="text-white font-semibold cursor-pointer hover:underline underline-offset-4">Sign in</span>
        </div>
        
        <div className="flex items-center justify-center gap-2 text-[10px] text-[#475569] uppercase tracking-[0.2em] font-bold">
          <Lock size={12} className="text-[#7c6bf7]" />
          <span>On-Device Privacy First</span>
        </div>
      </div>
    </div>
  );
}