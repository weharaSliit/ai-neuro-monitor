import React, { createContext, useState } from 'react';

export const ThemeContext = createContext();

export const themeTokens = {
  dark: {
    mode: 'dark',
    bgPrimary: '#0F172A',      // Slate 900
    bgSecondary: '#1E293B',    // Slate 800
    bgCard: '#1E293B',
    bgInput: '#0F172A',
    textPrimary: '#F8FAFC',    // Slate 50
    textSecondary: '#94A3B8',  // Slate 400
    textMuted: '#64748B',      // Slate 500
    border: '#334155',         // Slate 700
    accent: '#38BDF8',         // Sky 400
    accentText: '#0F172A',
    success: '#10B981',        // Emerald 500
    warning: '#F59E0B',        // Amber 500
    danger: '#EF4444'          // Red 500
  },
  light: {
    mode: 'light',
    bgPrimary: '#F8FAFC',     // Slate 50
    bgSecondary: '#FFFFFF',   // Pure White
    bgCard: '#FFFFFF',
    bgInput: '#F1F5F9',       // Slate 100
    textPrimary: '#0F172A',   // Slate 900
    textSecondary: '#475569', // Slate 600
    textMuted: '#64748B',     // Slate 500
    border: '#E2E8F0',        // Slate 200
    accent: '#0284C7',        // Sky 600
    accentText: '#FFFFFF',
    success: '#059669',       // Emerald 600
    warning: '#D97706',       // Amber 600
    danger: '#DC2626'         // Red 600
  }
};

export const ThemeProvider = ({ children }) => {
  const [isDarkMode, setIsDarkMode] = useState(true);

  const toggleTheme = () => {
    setIsDarkMode((prev) => !prev);
  };

  const theme = isDarkMode ? themeTokens.dark : themeTokens.light;

  return (
    <ThemeContext.Provider value={{ isDarkMode, toggleTheme, theme }}>
      {children}
    </ThemeContext.Provider>
  );
};
