import React, { useState } from 'react';
import { useTheme } from '../context/ThemeContext';
import { Activity, X } from 'lucide-react';

export function MotionDetectionModal({ isOpen, onClose, onConfirm }) {
  const { t, isDark } = useTheme();

  if (!isOpen) return null;

  const options = [
    { label: '🚶 Yes, walking', value: 'walking' },
    { label: '🏃 Yes, exercising', value: 'exercising' },
    { label: '🪑 No, I\'m still', value: 'stationary' },
  ];

  return (
    <div className={`fixed inset-0 z-[100] flex items-end justify-center ${t.modalOverlay}`} onClick={onClose}>
      <div
        className={`w-full max-w-md rounded-t-3xl p-6 pb-10 animate-slide-up ${isDark ? 'glass-dark' : 'glass-light'} border-t ${t.cardBorder}`}
        onClick={e => e.stopPropagation()}
      >
        {/* Close */}
        <div className="flex justify-between items-center mb-5">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${t.warningBg}`}>
              <Activity size={20} className={t.warningText} />
            </div>
            <h3 className={`font-bold ${t.text}`}>Movement Detected</h3>
          </div>
          <button onClick={onClose} className={`p-2 rounded-xl ${t.textMuted}`}>
            <X size={18} />
          </button>
        </div>

        <p className={`text-sm mb-6 leading-relaxed ${t.textSecondary}`}>
          Are you walking or moving right now? This helps us filter out physical noise from your typing data.
        </p>

        <div className="space-y-2.5">
          {options.map(opt => (
            <button
              key={opt.value}
              onClick={() => { onConfirm(opt.value); onClose(); }}
              className={`w-full p-4 rounded-2xl border ${t.card} ${t.cardBorder} ${t.text} text-sm font-medium text-left transition-all active:scale-[0.98] ${t.cardHover}`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <p className={`text-center text-[10px] mt-4 ${t.textDim}`}>
          Your response improves detection accuracy
        </p>
      </div>
    </div>
  );
}
