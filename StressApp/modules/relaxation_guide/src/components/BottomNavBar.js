import React, { useContext } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';

export const BottomNavBar = () => {
  const { currentScreen, setCurrentScreen } = useContext(AppContext);
  const { theme } = useContext(ThemeContext);
  const navigation = useNavigation();

  const navItems = [
    { id: 'Dashboard', label: 'Home', icon: '🏠' },
    { id: 'Methods', label: 'Catalog', icon: '🌸' },
    { id: 'FusionPipeline', label: 'Pipeline', icon: '📡' },
    { id: 'History', label: 'History', icon: '📊' },
    { id: 'UserProfile', label: 'Profile', icon: '👤' }
  ];

  // Hide bottom nav during full-screen immersive games or onboarding flow
  const hideScreens = ['GamePlayer', 'PrivacyPolicy', 'OnboardingQuestions', 'Permissions'];
  if (hideScreens.includes(currentScreen)) {
    return null;
  }

  const paddingBottom = Platform.OS === 'ios' ? 22 : 10;

  return (
    <View style={[
      styles.navContainer,
      {
        backgroundColor: theme.bgSecondary,
        borderTopColor: theme.border,
        paddingBottom
      }
    ]}>
      {navItems.map((item) => {
        const isActive = currentScreen === item.id;
        return (
          <TouchableOpacity
            key={item.id}
            style={[
              styles.tabBtn,
              isActive && { backgroundColor: theme.accent + '1A' }
            ]}
            onPress={() => {
              if (item.external) {
                try {
                  navigation.navigate(item.id);
                } catch (e) {
                  setCurrentScreen(item.id);
                }
              } else {
                setCurrentScreen(item.id);
              }
            }}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabIcon, isActive && styles.tabIconActive]}>
              {item.icon}
            </Text>
            <Text style={[
              styles.tabLabel,
              { color: isActive ? theme.accent : theme.textMuted, fontWeight: isActive ? '800' : '600' }
            ]}>
              {item.label}
            </Text>
            {isActive && <View style={[styles.activeDot, { backgroundColor: theme.accent }]} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  navContainer: {
    height: Platform.OS === 'ios' ? 76 : 68,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    borderTopWidth: 1,
    paddingTop: 8,
    paddingHorizontal: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 12
  },
  tabBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: 16,
    marginHorizontal: 2,
    position: 'relative'
  },
  tabIcon: {
    fontSize: 18,
    marginBottom: 2
  },
  tabIconActive: {
    transform: [{ scale: 1.15 }]
  },
  tabLabel: {
    fontSize: 10,
    letterSpacing: 0.2
  },
  activeDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 3
  }
});

