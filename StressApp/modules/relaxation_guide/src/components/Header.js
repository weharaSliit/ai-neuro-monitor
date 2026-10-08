import React, { useContext } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, StatusBar } from 'react-native';
import { ThemeContext } from '../context/ThemeContext';
import { AppContext } from '../context/AppContext';

export const Header = ({ title, showBack = false, onBack }) => {
  const { theme, isDarkMode, toggleTheme } = useContext(ThemeContext);
  const appContext = useContext(AppContext);
  const setCurrentScreen = appContext?.setCurrentScreen;

  const setIsDrawerOpen = appContext?.setIsDrawerOpen;

  const paddingTop = Platform.OS === 'android' ? (StatusBar.currentHeight || 20) + 2 : 6;
  const isDark = isDarkMode ?? true;

  // Filter out any standalone "Home" or verbose text to keep header ultra sleek
  let displayTitle = title;
  if (!displayTitle || displayTitle === 'Home') {
    displayTitle = 'Welcome to Relaxation Guide';
  }

  const headerBg = isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.95)';
  const borderCol = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';

  return (
    <View style={[styles.container, { backgroundColor: headerBg, borderBottomColor: borderCol, paddingTop }]}>
      <View style={styles.leftSection}>
        <TouchableOpacity
          style={[styles.menuBtn, { backgroundColor: isDark ? 'rgba(129, 140, 248, 0.2)' : 'rgba(99, 102, 241, 0.12)', borderColor: isDark ? '#818CF8' : '#6366F1' }]}
          onPress={() => setIsDrawerOpen && setIsDrawerOpen(true)}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={[styles.menuBtnIcon, { color: isDark ? '#A5B4FC' : '#4F46E5' }]}>☰ Menu</Text>
        </TouchableOpacity>

        {showBack ? (
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)', borderColor: borderCol }]}
            onPress={onBack}
            activeOpacity={0.75}
          >
            <Text style={[styles.btnTxt, { color: isDark ? '#A5B4FC' : '#4F46E5' }]}>← Back</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.brandBox}
            onPress={() => setCurrentScreen && setCurrentScreen('Dashboard')}
            activeOpacity={0.8}
          >
            <View style={styles.brandBadge}>
              <Text style={styles.brandIcon}>🧠</Text>
            </View>
            <Text style={[styles.brandTitle, { color: isDark ? '#F8FAFC' : '#0F172A' }]}>MindPulse</Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={[styles.title, { color: isDark ? '#F8FAFC' : '#0F172A' }]} numberOfLines={1} ellipsisMode="tail">
        {displayTitle}
      </Text>

      {/* Theme Toggle Icon in Upper Header */}
      <TouchableOpacity
        style={[
          styles.themeToggleBtn,
          {
            backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
            borderColor: borderCol,
          }
        ]}
        onPress={toggleTheme}
        activeOpacity={0.75}
      >
        <Text style={styles.themeToggleIcon}>{isDark ? '☀️' : '🌙'}</Text>
        <Text style={[styles.themeToggleTxt, { color: isDark ? '#CBD5E1' : '#475569' }]}>
          {isDark ? 'Light' : 'Dark'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    elevation: 3,
    zIndex: 20,
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  menuBtn: {
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuBtnIcon: {
    fontSize: 12,
    fontWeight: '800',
  },
  brandBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  brandBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(129, 140, 248, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandIcon: {
    fontSize: 12,
  },
  brandTitle: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  title: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    marginHorizontal: 6,
  },
  btn: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  btnTxt: {
    fontSize: 11,
    fontWeight: '700',
  },
  themeToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  themeToggleIcon: {
    fontSize: 11,
  },
  themeToggleTxt: {
    fontSize: 10,
    fontWeight: '700',
  },
});
