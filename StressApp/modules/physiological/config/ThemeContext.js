import React, { createContext, useContext } from 'react';
import { COLORS } from './theme';

export { COLORS };
export const colors = COLORS;

const defaultThemeValue = {
  isDark: false,
  toggle: () => {},
  theme: { ...COLORS.light, colors: { ...COLORS, ...COLORS.light } },
  COLORS,
  colors: { ...COLORS, ...COLORS.light },
};

const ThemeContext = createContext(defaultThemeValue);

export function ThemeProvider({ children }) {
  const value = {
    isDark: false,
    toggle: () => {},
    theme: {
      ...COLORS.light,
      colors: { ...COLORS, ...COLORS.light },
    },
    COLORS,
    colors: { ...COLORS, ...COLORS.light },
  };
  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  return ctx || defaultThemeValue;
}

