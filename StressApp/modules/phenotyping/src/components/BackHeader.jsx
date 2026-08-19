import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';

export function BackHeader({ title, rightElement, onBack }) {
  const navigate = useNavigate();
  const { t } = useTheme();

  return (
    <div className={`sticky top-0 z-40 px-5 pt-4 pb-3 ${t.bg} backdrop-blur-xl`}>
      <div className="flex items-center justify-between">
        <button
          onClick={onBack || (() => navigate(-1))}
          className={`p-2 -ml-2 rounded-xl ${t.textMuted} hover:${t.text} active:scale-95 transition-all`}
        >
          <ArrowLeft size={22} />
        </button>
        {title && (
          <h1 className={`text-base font-bold ${t.text} absolute left-1/2 -translate-x-1/2`}>
            {title}
          </h1>
        )}
        <div className="min-w-[40px] flex justify-end">
          {rightElement || null}
        </div>
      </div>
    </div>
  );
}
