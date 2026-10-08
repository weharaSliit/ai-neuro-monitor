import React, { useContext } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ThemeContext } from '../context/ThemeContext';

export const HostAppSwitchBar = () => {
  const navigation = useNavigation();
  const { isDarkMode } = useContext(ThemeContext);

  const isDark = isDarkMode ?? true;
  const navBg = isDark ? 'rgba(15, 23, 42, 0.96)' : 'rgba(255, 255, 255, 0.96)';
  const borderCol = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)';

  const handleGoMainHub = () => {
    try {
      navigation.navigate('Physiological');
    } catch (e) {
      console.warn('Navigation error to Physiological', e);
    }
  };

  const handleGoMainProfile = () => {
    try {
      navigation.navigate('Profile');
    } catch (e) {
      console.warn('Navigation error to Profile', e);
    }
  };

  return (
    <View style={styles.outerWrapper}>
      <View style={[styles.navContainer, { backgroundColor: navBg, borderColor: borderCol }]}>
        {/* Main App Hub Button */}
        <TouchableOpacity
          style={[
            styles.btn,
            {
              backgroundColor: isDark ? 'rgba(129, 140, 248, 0.22)' : 'rgba(99, 102, 241, 0.12)',
              borderColor: isDark ? 'rgba(129, 140, 248, 0.4)' : 'rgba(99, 102, 241, 0.3)',
            }
          ]}
          onPress={handleGoMainHub}
          activeOpacity={0.75}
        >
          <View style={[styles.iconBadge, { backgroundColor: isDark ? 'rgba(129, 140, 248, 0.3)' : 'rgba(99, 102, 241, 0.2)' }]}>
            <Text style={styles.btnIcon}>🏠</Text>
          </View>
          <Text style={[styles.btnTxt, { color: isDark ? '#C7D2FE' : '#4338CA' }]}>Main Hub</Text>
        </TouchableOpacity>

        <View style={[styles.divider, { backgroundColor: borderCol }]} />

        {/* Main System Profile Button */}
        <TouchableOpacity
          style={[
            styles.btn,
            {
              backgroundColor: isDark ? 'rgba(16, 185, 129, 0.22)' : 'rgba(16, 185, 129, 0.12)',
              borderColor: isDark ? 'rgba(16, 185, 129, 0.4)' : 'rgba(16, 185, 129, 0.3)',
            }
          ]}
          onPress={handleGoMainProfile}
          activeOpacity={0.75}
        >
          <View style={[styles.iconBadge, { backgroundColor: isDark ? 'rgba(16, 185, 129, 0.3)' : 'rgba(16, 185, 129, 0.2)' }]}>
            <Text style={styles.btnIcon}>👤</Text>
          </View>
          <Text style={[styles.btnTxt, { color: isDark ? '#A7F3D0' : '#047857' }]}>Main Profile</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  outerWrapper: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 74 : 64,
    left: 14,
    right: 14,
    zIndex: 9999,
    pointerEvents: 'box-none',
  },
  navContainer: {
    height: 56,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    borderRadius: 26,
    borderWidth: 1.5,
    paddingHorizontal: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 16,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    flex: 1,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 18,
    borderWidth: 1,
    marginHorizontal: 4,
  },
  iconBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnIcon: {
    fontSize: 14,
  },
  btnTxt: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  divider: {
    width: 1,
    height: 26,
  },
});

export default HostAppSwitchBar;
