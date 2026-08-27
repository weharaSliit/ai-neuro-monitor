import React from 'react';
import { View, StyleSheet } from 'react-native';
import Icon, { NAMES } from './Icon';

// One consistent, polished mood indicator used everywhere a Normal/Stress
// (or Low/High load) reading is shown -- Overview, Ring, EEG, Admin.
// Replaces the plain flat-tint circles each screen was building by hand:
// a soft outer ring in the state color plus a solid inner disc, closer to
// the rounded colorful mood badges in a polished consumer wellness app
// than a bare icon-on-tint square.
export default function MoodBadge({ stressed, color, size = 46 }) {
  const iconSize = Math.round(size * 0.5);
  return (
    <View style={[styles.ring, { width: size, height: size, borderRadius: size / 2, borderColor: color + '35' }]}>
      <View style={[styles.disc, {
        width: size - 10, height: size - 10, borderRadius: (size - 10) / 2, backgroundColor: color + '1F',
      }]}>
        <Icon name={stressed ? NAMES.moodStress : NAMES.moodNormal} size={iconSize} color={color} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disc: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
