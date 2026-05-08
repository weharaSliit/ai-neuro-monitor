import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Brain, Lock } from 'lucide-react';

export function Welcome() {
  const navigate = useNavigate();

  return (
    <div className="h-screen bg-[#0f0f14] flex flex-col items-center justify-center p-6 text-center">
      {/* App Logo/Icon */}
      <div className="w-20 h-20 bg-[#1a1228] border border-[#7c6bf7]/30 rounded-3xl flex items-center justify-center mb-8 shadow-[0_0_40px_rgba(124,107,247,0.15)]">
        <Brain size={42} className="text-[#7c6bf7]" />
      </div>

      {/* Hero Text */}
      <h1 className="text-4xl font-bold text-[#e8e8f8] mb-3 tracking-tight">
        PhenoCare
      </h1>
      <p className="text-[#6b6b80] text-sm mb-24 max-w-[200px]">
        Detect stress before it peaks
      </p>

      {/* Buttons */}
      <button 
        onClick={() => navigate('/permissions')}
        className="text-[#e8e8f8] font-semibold text-lg mb-8 hover:text-[#7c6bf7] transition-colors"
      >
        Begin setup
      </button>

      <div className="text-xs text-[#6b6b80]">
        Already have an account? <span className="text-[#7c6bf7] cursor-pointer">Sign in</span>
      </div>

      {/* Privacy Note */}
      <div className="absolute bottom-10 flex items-center gap-2 text-[10px] text-[#4a4a5e] uppercase tracking-widest font-bold">
        <Lock size={12} />
        Your data never leaves your device
      </div>
    </div>
  );
}