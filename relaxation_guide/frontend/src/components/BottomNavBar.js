import React, { useContext } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';

export const BottomNavBar = () => {
  const { currentScreen, setCurrentScreen } = useContext(AppContext);
  const { theme } = useContext(ThemeContext);

  const navItems = [
    { id: 'Dashboard', label: 'Home', icon: '🏠' },
    { id: 'Methods', label: 'Methods', icon: '📖' },
    { id: 'Intervention', label: 'Bandit', icon: '⚡' },
    { id: 'Chatbot', label: 'AI Guide', icon: '🤖' },
    { id: 'UserProfile', label: 'Profile', icon: '👤' }
  ];

  // Hide bottom nav on splash/auth screens
  if (['Splash', 'Login', 'SignIn', 'SignUp', 'Welcome'].includes(currentScreen)) {
    return null;
  }

  const paddingBottom = Platform.OS === 'ios' ? 20 : 8;

  return (
    <View style={[styles.navContainer, { backgroundColor: theme.bgSecondary, borderTopColor: theme.border, paddingBottom }]}>
      {navItems.map((item) => {
        const isActive = currentScreen === item.id;
        return (
          <TouchableOpacity
            key={item.id}
            style={styles.tabBtn}
            onPress={() => setCurrentScreen(item.id)}
          >
            <Text style={[styles.tabIcon, isActive && styles.tabIconActive]}>{item.icon}</Text>
            <Text style={[styles.tabLabel, { color: isActive ? theme.accent : theme.textMuted }]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  navContainer: {
    height: 64,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    borderTopWidth: 1,
    paddingTop: 6,
    elevation: 8
  },
  tabBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    paddingVertical: 4
  },
  tabIcon: {
    fontSize: 20,
    marginBottom: 2
  },
  tabIconActive: {
    transform: [{ scale: 1.15 }]
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '700'
  }
});
