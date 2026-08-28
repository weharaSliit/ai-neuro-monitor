import React, { createContext } from 'react';
import { COLORS } from '../../../physiological/config/theme';

export const ThemeContext = createContext();

// Repointed to the app-wide "Calm Mist" palette (StressApp/modules/
// physiological/config/theme.js) instead of this module's previous
// independent Slate/Sky palette -- per the redesign's explicit scope for
// this module (colors/background only, no game or structural changes).
// `dark` is kept (rather than deleted) only so any lingering reference
// doesn't crash; isDarkMode is now hardcoded false app-wide, so it's never
// actually selected.
export const themeTokens = {
  dark: {
    mode: 'dark',
    bgPrimary: COLORS.light.bg,
    bgSecondary: COLORS.light.surface,
    bgCard: COLORS.light.card,
    bgInput: COLORS.light.cardHover,
    textPrimary: COLORS.light.text,
    textSecondary: COLORS.light.textSub,
    textMuted: COLORS.light.textMuted,
    border: COLORS.light.border,
    accent: COLORS.brand,
    accentText: '#FFFFFF',
    success: COLORS.normal,
    warning: COLORS.warning,
    danger: COLORS.stress,
  },
  light: {
    mode: 'light',
    bgPrimary: COLORS.light.bg,
    bgSecondary: COLORS.light.surface,
    bgCard: COLORS.light.card,
    bgInput: COLORS.light.cardHover,
    textPrimary: COLORS.light.text,
    textSecondary: COLORS.light.textSub,
    textMuted: COLORS.light.textMuted,
    border: COLORS.light.border,
    accent: COLORS.brand,
    accentText: '#FFFFFF',
    success: COLORS.normal,
    warning: COLORS.warning,
    danger: COLORS.stress,
  },
};

// Dark mode removed app-wide -- always light, toggleTheme kept as a no-op
// so any screen not yet swept still calling it doesn't crash.
export const ThemeProvider = ({ children }) => {
  const value = { isDarkMode: false, toggleTheme: () => {}, theme: themeTokens.light };
  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};
