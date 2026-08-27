import React, { createContext, useContext } from 'react';
import { COLORS } from './theme';

// Dark mode removed app-wide -- COLORS.light is now the only palette.
// isDark/toggle are kept as harmless no-op stubs (rather than deleted
// outright) so any screen not yet swept in this redesign pass that still
// destructures/calls them doesn't crash; they do nothing and should be
// dropped from call sites as each screen is touched.
const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const value = { isDark: false, toggle: () => {}, theme: COLORS.light, COLORS };
  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() { return useContext(ThemeContext); }
