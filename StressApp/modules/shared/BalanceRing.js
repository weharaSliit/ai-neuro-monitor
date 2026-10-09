import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { COLORS } from '../physiological/config/theme';
import { TYPE } from './theme/tokens';

// Circular progress ring: big % in the middle, a plain-language word
// under it ("Calm", "Focused"...). Memoized -- only re-renders when its
// own value/word/color actually change, not on every parent tick.
function BalanceRing({ title, value, word, color, size = 104, stroke = 10 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const hasValue = value != null && !Number.isNaN(value);
  const pct = hasValue ? Math.max(0, Math.min(100, value)) : 0;
  const tint = hasValue ? color : COLORS.light.textMuted;

  return (
    <View style={styles.wrap}>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <Circle
            cx={size / 2} cy={size / 2} r={r}
            stroke={COLORS.light.borderSoft} strokeWidth={stroke} fill="none"
          />
          {hasValue && (
            <Circle
              cx={size / 2} cy={size / 2} r={r}
              stroke={color} strokeWidth={stroke} fill="none"
              strokeDasharray={`${c} ${c}`}
              strokeDashoffset={c * (1 - pct / 100)}
              strokeLinecap="round"
              rotation={-90}
              origin={`${size / 2}, ${size / 2}`}
            />
          )}
        </Svg>
        <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
          <Text style={styles.pct}>{hasValue ? `${Math.round(pct)}%` : '—'}</Text>
          <Text style={[styles.word, { color: tint }]} numberOfLines={1}>
            {hasValue ? word : 'No reading'}
          </Text>
        </View>
      </View>
    </View>
  );
}

export default React.memo(BalanceRing);

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', flex: 1 },
  title: { ...TYPE.subtitle, color: COLORS.light.text, marginBottom: 10 },
  center: { alignItems: 'center', justifyContent: 'center' },
  pct: { fontSize: 20, fontWeight: '800', color: COLORS.light.text, letterSpacing: -0.4 },
  word: { ...TYPE.caption, marginTop: 1 },
});
