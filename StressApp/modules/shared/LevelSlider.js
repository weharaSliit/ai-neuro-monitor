import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '../physiological/config/theme';
import { TYPE, RADIUS } from './theme/tokens';
import Badge from './Badge';
import { SLIDER_MODERATE_AT, SLIDER_LIMIT_AT } from './levels';

const KNOB = 20;

// Low -> Moderate -> High bar with a knob. `position` is 0..1 from
// levels.sliderPosition(), which already maps the person's OWN limit to
// a fixed spot on the bar (the small tick), so the colors always mean
// the same thing regardless of how high or low their personal limit is.
function LevelSlider({ title, position, word, color }) {
  const [w, setW] = useState(0);
  const has = position != null;

  return (
    <View>
      <View style={styles.head}>
        <Text style={styles.title}>{title}</Text>
        {has ? <Badge label={word} color={color} size="sm" /> : null}
      </View>
      <View style={styles.trackWrap} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        <LinearGradient
          colors={[COLORS.normal, COLORS.normalLight, COLORS.warning, COLORS.stress]}
          locations={[0, SLIDER_MODERATE_AT - 0.08, SLIDER_LIMIT_AT, 1]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={styles.track}
        />
        {w > 0 && (
          <View style={[styles.limitTick, { left: w * SLIDER_LIMIT_AT - 1 }]} />
        )}
        {has && w > 0 && (
          <View
            style={[
              styles.knob,
              { left: Math.max(0, Math.min(w - KNOB, w * position - KNOB / 2)), borderColor: color },
            ]}
          />
        )}
      </View>
      <View style={styles.scale}>
        <Text style={styles.scaleText}>Low</Text>
        <Text style={[styles.scaleText, styles.limitText, { left: `${SLIDER_LIMIT_AT * 100 - 12}%` }]}>Your limit</Text>
        <Text style={styles.scaleText}>High</Text>
      </View>
    </View>
  );
}

export default React.memo(LevelSlider);

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { ...TYPE.subtitle, color: COLORS.light.text },
  trackWrap: { height: KNOB, justifyContent: 'center' },
  track: { height: 8, borderRadius: RADIUS.pill },
  limitTick: { position: 'absolute', width: 2, height: 16, borderRadius: 1, backgroundColor: COLORS.light.text, opacity: 0.35 },
  knob: {
    position: 'absolute', width: KNOB, height: KNOB, borderRadius: KNOB / 2,
    backgroundColor: '#FFFFFF', borderWidth: 3,
    shadowColor: '#1E293B', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4, elevation: 3,
  },
  scale: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  scaleText: { ...TYPE.caption, color: COLORS.light.textMuted },
  limitText: { position: 'absolute', width: '24%', textAlign: 'center' },
});
