import React, { useEffect, useRef, useContext } from 'react';
import { View, StyleSheet, Animated, Easing, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ThemeContext } from '../context/ThemeContext';

const { width: SCREEN_W } = Dimensions.get('window');

/* ────────────────────────────────────────────────────────
   DRIFTING AMBIENT LIGHT ORB
   ──────────────────────────────────────────────────────── */
export const AmbientOrb = ({ size, color, top, left, duration = 10000, dx = 40, dy = 30 }) => {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, {
          toValue: 1,
          duration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(t, {
          toValue: 0,
          duration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [t, duration]);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top,
        left,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity: 0.38,
        transform: [
          { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, dx] }) },
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, dy] }) },
        ],
      }}
    />
  );
};

/* ────────────────────────────────────────────────────────
   SERENE MAIN PAGE AMBIENT BACKDROP
   ──────────────────────────────────────────────────────── */
export const AmbientBackground = () => {
  const { theme, isDarkMode } = useContext(ThemeContext);
  const isDark = isDarkMode ?? theme?.isDark ?? true;

  const colors = isDark
    ? ['#0F172A', '#131C35', '#162544']
    : ['#F0F9FF', '#E8F1FB', '#F7EEF8'];

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient colors={colors} style={StyleSheet.absoluteFill} />
      <AmbientOrb
        size={260}
        color={isDark ? '#38BDF8' : '#7DD3FC'}
        top={-60}
        left={-80}
        duration={9000}
        dx={50}
        dy={40}
      />
      <AmbientOrb
        size={200}
        color={isDark ? '#818CF8' : '#F9A8D4'}
        top={320}
        left={SCREEN_W - 140}
        duration={11000}
        dx={-40}
        dy={-50}
      />
      <AmbientOrb
        size={180}
        color={isDark ? '#10B981' : '#6EE7B7'}
        top={640}
        left={-60}
        duration={13000}
        dx={60}
        dy={-30}
      />
    </View>
  );
};

export default AmbientBackground;
