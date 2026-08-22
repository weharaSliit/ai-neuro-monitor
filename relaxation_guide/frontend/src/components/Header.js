import React, { useContext } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, StatusBar } from 'react-native';
import { ThemeContext } from '../context/ThemeContext';

export const Header = ({ title, showBack = false, onBack }) => {
  const { isDarkMode, toggleTheme, theme } = useContext(ThemeContext);

  const paddingTop = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 6 : 10;

  return (
    <View style={[styles.container, { backgroundColor: theme.bgSecondary, borderBottomColor: theme.border, paddingTop }]}>
      {showBack ? (
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: theme.bgPrimary }]}
          onPress={onBack}
        >
          <Text style={[styles.btnTxt, { color: theme.accent }]}>← Back</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.brandBox}>
          <Text style={styles.brandIcon}>🧘</Text>
          <Text style={[styles.brandTitle, { color: theme.accent }]}>Calm AI</Text>
        </View>
      )}

      <Text style={[styles.title, { color: theme.textPrimary }]}>{title}</Text>

      {/* Theme Toggle Button (Moon / Sun) */}
      <TouchableOpacity
        style={[styles.themeBtn, { backgroundColor: theme.bgPrimary }]}
        onPress={toggleTheme}
      >
        <Text style={styles.themeIcon}>{isDarkMode ? '🌙' : '☀️'}</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    elevation: 2
  },
  brandBox: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  brandIcon: {
    fontSize: 18,
    marginRight: 4
  },
  brandTitle: {
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.5
  },
  btn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8
  },
  btnTxt: {
    fontWeight: '600',
    fontSize: 13
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3
  },
  themeBtn: {
    padding: 6,
    borderRadius: 20,
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center'
  },
  themeIcon: {
    fontSize: 15
  }
});
