import React, { useContext } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, StatusBar } from 'react-native';
import { ThemeContext } from '../context/ThemeContext';
import { AppContext } from '../context/AppContext';

export const Header = ({ title, showBack = false, onBack }) => {
  const { theme, isDarkMode, toggleTheme } = useContext(ThemeContext);
  const appContext = useContext(AppContext);
  const setCurrentScreen = appContext?.setCurrentScreen;

  const paddingTop = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 4 : 8;

  // Filter out any standalone "Home" text
  const displayTitle = (title && title !== 'Home') ? title : 'MindPulse AI Relaxation Guide';

  return (
    <View style={[styles.container, { backgroundColor: theme.bgSecondary, borderBottomColor: theme.border, paddingTop }]}>
      <View style={styles.leftSection}>
        {showBack ? (
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: theme.bgPrimary, borderColor: theme.border }]}
            onPress={onBack}
            activeOpacity={0.7}
          >
            <Text style={[styles.btnTxt, { color: theme.accent }]}>← Back</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.brandBox}
            onPress={() => setCurrentScreen && setCurrentScreen('Dashboard')}
            activeOpacity={0.8}
          >
            <Text style={styles.brandIcon}>🧠</Text>
            <Text style={[styles.brandTitle, { color: theme.accent }]}>MindPulse AI</Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={[styles.title, { color: theme.textPrimary }]} numberOfLines={1} ellipsisMode="tail">
        {displayTitle}
      </Text>

      {/* Theme Toggle Icon in Upper Header */}
      <TouchableOpacity
        style={[
          styles.themeToggleBtn,
          {
            backgroundColor: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
            borderColor: theme.border,
          }
        ]}
        onPress={toggleTheme}
        activeOpacity={0.75}
      >
        <Text style={styles.themeToggleIcon}>{isDarkMode ? '☀️' : '🌙'}</Text>
        <Text style={[styles.themeToggleTxt, { color: theme.textPrimary }]}>
          {isDarkMode ? 'Light' : 'Dark'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingBottom: 8,
    paddingTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    elevation: 2,
    zIndex: 10,
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandBox: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandIcon: {
    fontSize: 16,
    marginRight: 4,
  },
  brandTitle: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  btn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  btnTxt: {
    fontWeight: '700',
    fontSize: 12,
  },
  title: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.2,
    flexShrink: 1,
    textAlign: 'center',
    marginHorizontal: 6,
  },
  themeToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 16,
    borderWidth: 1,
  },
  themeToggleIcon: {
    fontSize: 14,
    marginRight: 4,
  },
  themeToggleTxt: {
    fontSize: 11,
    fontWeight: '800',
  },
});
