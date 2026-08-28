import React, { createContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS } from '../../../physiological/config/theme';

export const ThemeContext = createContext();

const THEME_STORAGE_KEY = '@relaxation_guide_theme_mode';

export const themeTokens = {
  dark: {
    mode: 'dark',
    bgPrimary: '#0F172A',
    bgSecondary: '#1E293B',
    bgCard: '#1E293B',
    bgInput: '#334155',
    textPrimary: '#F8FAFC',
    textSecondary: '#CBD5E1',
    textMuted: '#94A3B8',
    border: '#334155',
    accent: COLORS.brand || '#8B87C4',
    accentText: '#FFFFFF',
    success: COLORS.normal || '#82C0A0',
    warning: COLORS.warning || '#E8B368',
    danger: COLORS.stress || '#E08585',
  },
  light: {
    mode: 'light',
    bgPrimary: COLORS.light?.bg || '#FAF9FC',
    bgSecondary: COLORS.light?.surface || '#FFFFFF',
    bgCard: COLORS.light?.card || '#FFFFFF',
    bgInput: COLORS.light?.cardHover || '#F5F3FA',
    textPrimary: COLORS.light?.text || '#332F45',
    textSecondary: COLORS.light?.textSub || '#6F6A87',
    textMuted: COLORS.light?.textMuted || '#8B86A3',
    border: COLORS.light?.border || '#E9E5F2',
    accent: COLORS.brand || '#8B87C4',
    accentText: '#FFFFFF',
    success: COLORS.normal || '#82C0A0',
    warning: COLORS.warning || '#E8B368',
    danger: COLORS.stress || '#E08585',
  },
};

export const ThemeProvider = ({ children }) => {
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    const loadTheme = async () => {
      try {
        const savedMode = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (savedMode !== null) {
          setIsDarkMode(savedMode === 'dark');
        }
      } catch (e) {
        console.warn('Failed to load theme mode', e);
      }
    };
    loadTheme();
  }, []);

  const toggleTheme = async () => {
    try {
      const nextMode = !isDarkMode;
      setIsDarkMode(nextMode);
      await AsyncStorage.setItem(THEME_STORAGE_KEY, nextMode ? 'dark' : 'light');
    } catch (e) {
      console.warn('Failed to save theme mode', e);
    }
  };

  const theme = isDarkMode ? themeTokens.dark : themeTokens.light;

  const value = { isDarkMode, toggleTheme, theme };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};
