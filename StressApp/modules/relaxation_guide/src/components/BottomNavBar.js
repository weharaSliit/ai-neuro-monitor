import React, { useContext } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';

export const BottomNavBar = () => {
  const { currentScreen, setCurrentScreen, userId } = useContext(AppContext);
  const { theme, isDarkMode } = useContext(ThemeContext);
  const navigation = useNavigation();

  const baseItems = [
    { id: 'Dashboard', label: 'Guide', icon: '🏠', aliases: ['Intervention', 'Recovery', 'Rating'] },
    { id: 'Methods', label: 'Arcade', icon: '🌸', aliases: ['GamePlayer', 'SubOptionSelector'] },
    { id: 'PerformanceOverview', label: 'Analytics', icon: '📈', aliases: ['BaselineCalibration'] },
    { id: 'History', label: 'History', icon: '📊', aliases: [] },
    { id: 'UserProfile', label: 'Profile', icon: '👤', aliases: ['PrivacyPolicy'] },
    { id: 'FusionPipeline', label: 'Pipeline', icon: '📡', aliases: [] },
  ];

  const navItems = baseItems;

  const isDark = isDarkMode ?? true;
  const navBg = isDark ? 'rgba(15, 23, 42, 0.94)' : 'rgba(255, 255, 255, 0.94)';
  const borderCol = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)';

  return (
    <View style={[styles.outerWrapper, { paddingBottom: Platform.OS === 'ios' ? 20 : 10 }]}>
      <View style={[styles.navContainer, { backgroundColor: navBg, borderColor: borderCol }]}>
        {navItems.map((item) => {
          const isActive = currentScreen === item.id || (item.aliases && item.aliases.includes(currentScreen));
          const activeBg = isDark ? 'rgba(129, 140, 248, 0.18)' : 'rgba(99, 102, 241, 0.12)';
          const activeText = isDark ? '#A5B4FC' : '#4F46E5';

          return (
            <TouchableOpacity
              key={item.id}
              style={[
                styles.tabBtn,
                isActive && { backgroundColor: activeBg }
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
              activeOpacity={0.75}
            >
              <Text style={[styles.tabIcon, isActive && styles.tabIconActive]}>
                {item.icon}
              </Text>
              <Text style={[
                styles.tabLabel,
                { color: isActive ? activeText : (isDark ? '#94A3B8' : '#64748B'), fontWeight: isActive ? '800' : '600' }
              ]}>
                {item.label}
              </Text>
              {isActive && <View style={[styles.activeDot, { backgroundColor: activeText }]} />}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  outerWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    pointerEvents: 'box-none',
  },
  navContainer: {
    height: 64,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 16,
  },
  tabBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 18,
    marginHorizontal: 2,
    position: 'relative',
  },
  tabIcon: {
    fontSize: 18,
    marginBottom: 2,
  },
  tabIconActive: {
    transform: [{ scale: 1.15 }],
  },
  tabLabel: {
    fontSize: 10,
    letterSpacing: 0.3,
  },
  activeDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 2,
  }
});


