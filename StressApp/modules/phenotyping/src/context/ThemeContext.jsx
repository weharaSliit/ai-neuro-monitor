import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

const themes = {
  dark: {
    bg: 'bg-[#0f0f14]',
    card: 'bg-[#14141f]',
    cardBorder: 'border-[#2a2a38]',
    cardHover: 'hover:border-[#3a3a4e]',
    text: 'text-[#e8e8f8]',
    textSecondary: 'text-[#9999b0]',
    textMuted: 'text-[#6b6b80]',
    textDim: 'text-[#4a4a5e]',
    accent: 'text-[#7c6bf7]',
    accentBg: 'bg-[#7c6bf7]',
    accentGlow: 'bg-[#1a1228]',
    accentBorder: 'border-[#7c6bf7]/40',
    headerBg: 'bg-[#0f0f14]/95',
    navBg: 'bg-[#0f0f14]',
    navBorder: 'border-[#1e1e2e]',
    inputBg: 'bg-[#14141f]',
    inputBorder: 'border-[#2a2a38]',
    progressBg: 'bg-zinc-800',
    divider: 'border-[#1e1e2e]',
    modalOverlay: 'bg-black/60',
    modalBg: 'bg-[#1a1a2e]',
    toggleBg: 'bg-[#2a2a38]',
    successText: 'text-emerald-400',
    warningText: 'text-orange-400',
    dangerText: 'text-red-400',
    successBg: 'bg-emerald-500/10',
    warningBg: 'bg-orange-500/10',
    dangerBg: 'bg-red-500/10',
    badgeNormal: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    badgeElevated: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
    badgeAnomalous: 'bg-red-500/15 text-red-400 border-red-500/30',
    badgeInfo: 'bg-[#7c6bf7]/15 text-[#7c6bf7] border-[#7c6bf7]/30',
  },
  light: {
    bg: 'bg-[#f5f5f7]',
    card: 'bg-white',
    cardBorder: 'border-[#e5e5ea]',
    cardHover: 'hover:border-[#d1d1d6]',
    text: 'text-[#1c1c1e]',
    textSecondary: 'text-[#636366]',
    textMuted: 'text-[#8e8e93]',
    textDim: 'text-[#aeaeb2]',
    accent: 'text-[#6355d8]',
    accentBg: 'bg-[#6355d8]',
    accentGlow: 'bg-[#ede9fe]',
    accentBorder: 'border-[#6355d8]/30',
    headerBg: 'bg-[#f5f5f7]/95',
    navBg: 'bg-white',
    navBorder: 'border-[#e5e5ea]',
    inputBg: 'bg-[#f2f2f7]',
    inputBorder: 'border-[#d1d1d6]',
    progressBg: 'bg-[#e5e5ea]',
    divider: 'border-[#e5e5ea]',
    modalOverlay: 'bg-black/40',
    modalBg: 'bg-white',
    toggleBg: 'bg-[#e5e5ea]',
    successText: 'text-emerald-600',
    warningText: 'text-orange-600',
    dangerText: 'text-red-600',
    successBg: 'bg-emerald-50',
    warningBg: 'bg-orange-50',
    dangerBg: 'bg-red-50',
    badgeNormal: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    badgeElevated: 'bg-orange-50 text-orange-700 border-orange-200',
    badgeAnomalous: 'bg-red-50 text-red-700 border-red-200',
    badgeInfo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  },
};

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('phenocare-theme') || 'dark';
    } catch {
      return 'dark';
    }
  });

  useEffect(() => {
    try { localStorage.setItem('phenocare-theme', theme); } catch {}
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  const t = themes[theme];
  const isDark = theme === 'dark';

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, t, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
