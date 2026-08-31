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
    accent: '#8B87C4',
    accentText: '#FFFFFF',
    success: '#34D399',
    warning: '#F59E0B',
    danger: '#F87171',
    gameBg: '#071A14',
    gameCard: 'rgba(30, 41, 59, 0.9)',
    isDark: true,
  },
  light: {
    mode: 'light',
    bgPrimary: '#FAF9FC',
    bgSecondary: '#FFFFFF',
    bgCard: '#FFFFFF',
    bgInput: '#F1F5F9',
    textPrimary: '#1E293B',
    textSecondary: '#475569',
    textMuted: '#64748B',
    border: '#E2E8F0',
    accent: '#7C3AED',
    accentText: '#FFFFFF',
    success: '#10B981',
    warning: '#D97706',
    danger: '#EF4444',
    gameBg: '#E6F4F0',
    gameCard: 'rgba(255, 255, 255, 0.95)',
    isDark: false,
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
