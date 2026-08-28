import React from 'react';
import { View, StyleSheet } from 'react-native';
import Icon, { NAMES } from './Icon';

// One consistent, polished mood indicator used everywhere a Normal/Stress
// (or Low/High load) reading is shown -- Overview, Ring, EEG, Admin.
// Replaces the plain flat-tint circles each screen was building by hand:
// a soft outer ring in the state color plus a solid inner disc, closer to
// the rounded colorful mood badges in a polished consumer wellness app
// than a bare icon-on-tint square.
export default function MoodBadge({ stressed, color, size = 48, customIcon = null }) {
  const iconSize = Math.round(size * 0.48);
  const outerPad = 8;
  const innerPad = 14;

  return (
    <View
      style={[
        styles.outerAura,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color + '12',
          borderColor: color + '30',
        },
      ]}
    >
      <View
        style={[
          styles.middleRing,
          {
            width: size - outerPad,
            height: size - outerPad,
            borderRadius: (size - outerPad) / 2,
            backgroundColor: color + '20',
          },
        ]}
      >
        <View
          style={[
            styles.disc,
            {
              width: size - innerPad,
              height: size - innerPad,
              borderRadius: (size - innerPad) / 2,
              backgroundColor: '#FFFFFF',
              borderColor: color + '25',
            },
          ]}
        >
          <Icon
            name={customIcon || (stressed ? NAMES.moodStress : NAMES.moodNormal)}
            size={iconSize}
            color={color}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outerAura: {
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  middleRing: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  disc: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
});
