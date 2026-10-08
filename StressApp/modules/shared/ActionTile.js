import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from './Icon';
import { COLORS } from '../physiological/config/theme';
import { TYPE, RADIUS, SPACE } from './theme/tokens';

// Soft pastel action card -- "Inhale <b>Exhale</b> for Balance" style:
// a title with one bold keyword, a short caption, an icon, and a small
// arrow chip in the corner. `tint` drives the whole card's wash.
export default function ActionTile({ lead = '', bold = '', tail = '', caption, icon, tint, onPress, style }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.tile, { backgroundColor: tint + '14', borderColor: tint + '2A' }, style]}
    >
      <View style={styles.top}>
        <View style={[styles.iconCircle, { backgroundColor: tint + '24' }]}>
          <Icon name={icon} size={20} color={tint} />
        </View>
        <View style={styles.arrow}>
          <Icon name="arrow-top-right" size={15} color={COLORS.light.text} />
        </View>
      </View>
      <Text style={styles.title}>
        {lead}<Text style={styles.bold}>{bold}</Text>{tail}
      </Text>
      {caption ? <Text style={styles.caption} numberOfLines={2}>{caption}</Text> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1, borderRadius: RADIUS.xl, borderWidth: 1,
    padding: SPACE.lg, minHeight: 150, justifyContent: 'space-between',
  },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: SPACE.md },
  iconCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  arrow: {
    width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFFFFFCC',
  },
  title: { fontSize: 16, fontWeight: '500', color: COLORS.light.text, lineHeight: 21 },
  bold: { fontWeight: '800' },
  caption: { ...TYPE.caption, fontWeight: '600', color: COLORS.light.textMuted, marginTop: SPACE.xs },
});
