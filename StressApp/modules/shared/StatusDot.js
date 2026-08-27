import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet } from 'react-native';

// Replaces the repeated per-screen "LivePulseDot" implementations
// (Ringscreen.js, FusionSessionScreen.js, etc.) with one shared version.
// `active` pulses the dot via opacity/scale; inactive renders it static.
export default function StatusDot({ color, active = true, size = 8 }) {
  const anim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [active]);

  return (
    <Animated.View
      style={[
        styles.dot,
        {
          width: size, height: size, borderRadius: size / 2,
          backgroundColor: color,
          opacity: active ? anim : 1,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dot: {},
});
