import React, { useContext } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, StatusBar } from 'react-native';
import { ThemeContext } from '../context/ThemeContext';

// This module is StressApp's "Intervention" tab (one of five main tabs,
// see PhysiologicalNavigator.js), not a standalone landing experience --
// the header never shows a "back to host" affordance, logging out (Profile
// screen) is the only way out, same as any other primary app screen.
// Dark mode removed app-wide -- theme toggle button removed accordingly.
export const Header = ({ title, showBack = false, onBack }) => {
  const { theme } = useContext(ThemeContext);

  // Filter out any standalone "Home" text
  const displayTitle = (title && title !== 'Home') ? title : 'Welcome to MindPulse AI Relaxation Guide';

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
          <Text style={styles.brandIcon}>🧠</Text>
          <Text style={[styles.brandTitle, { color: theme.accent }]}>MindPulse AI</Text>
        </View>
      )}

      <Text style={[styles.title, { color: theme.textPrimary }]} numberOfLines={1} ellipsisMode="tail">
        {displayTitle}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingBottom: 6,
    paddingTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    elevation: 2
  },
  brandBox: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  brandIcon: {
    fontSize: 16,
    marginRight: 4
  },
  brandTitle: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.4
  },
  btn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6
  },
  btnTxt: {
    fontWeight: '600',
    fontSize: 12
  },
  title: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.2,
    flexShrink: 1,
    textAlign: 'right',
    marginLeft: 8
  },
});
