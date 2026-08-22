import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';

export const Timer = ({ initialSeconds = 60, onComplete }) => {
  const [seconds, setSeconds] = useState(initialSeconds);

  useEffect(() => {
    if (seconds <= 0) {
      if (onComplete) onComplete();
      return;
    }
    const timer = setInterval(() => {
      setSeconds((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [seconds, onComplete]);

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const timeStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

  return (
    <View style={styles.container}>
      <Text style={styles.timeText}>{timeStr}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0F172A',
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#38BDF8',
    alignSelf: 'center',
    marginVertical: 10
  },
  timeText: {
    color: '#38BDF8',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 2
  }
});
