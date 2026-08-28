import React from 'react';
import { View, Text, StyleSheet, Dimensions, TouchableOpacity } from 'react-native';
import Svg, { Circle, Path, G } from 'react-native-svg';
import { COLORS } from '../physiological/config/theme';
import Icon, { NAMES } from './Icon';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

/**
 * FreudHeroBanner
 * Authentic curved organic hero banner inspired by Freud v2 (images 2, 4, 5).
 * Renders an arched top canvas with abstract geometric watermarks, large score/state,
 * pill tags, and a floating central action disc at the curved seam.
 */
export default function FreudHeroBanner({
  title = null,
  score = null,
  scoreUnit = '',
  stateLabel = 'Optimal Calm',
  stateSub = null,
  color = COLORS.normal,
  emoji = null,
  chips = [],
  onActionPress,
  actionIcon = 'pulse',
  actionLabel,
  rightAction,
}) {
  return (
    <View style={styles.container}>
      {/* Background with abstract organic geometry */}
      <View style={[styles.heroBg, { backgroundColor: color }]}>
        <Svg
          width={SCREEN_WIDTH}
          height={280}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        >
          {/* Concentric ambient background rings */}
          <G opacity={0.12}>
            <Circle cx={SCREEN_WIDTH * 0.15} cy={60} r={90} fill="#FFFFFF" />
            <Circle cx={SCREEN_WIDTH * 0.15} cy={60} r={140} stroke="#FFFFFF" strokeWidth={2} />
            <Circle cx={SCREEN_WIDTH * 0.85} cy={110} r={120} fill="#FFFFFF" />
            <Circle cx={SCREEN_WIDTH * 0.85} cy={110} r={180} stroke="#FFFFFF" strokeWidth={3} />
            <Path
              d={`M-20,180 Q${SCREEN_WIDTH * 0.5},100 ${SCREEN_WIDTH + 20},190`}
              stroke="#FFFFFF"
              strokeWidth={2}
              fill="none"
            />
          </G>
        </Svg>

        {/* Top Header Row */}
        {(title || rightAction) && (
          <View style={styles.topRow}>
            {title ? (
              <View style={styles.titleBadge}>
                <Text style={styles.titleText}>{title}</Text>
              </View>
            ) : <View />}
            {rightAction && (
              <View style={styles.rightActionWrap}>
                {rightAction}
              </View>
            )}
          </View>
        )}

        {/* Center Score Block */}
        <View style={styles.scoreBlock}>
          {score != null && (
            <View style={styles.scoreRow}>
              {emoji ? <Text style={styles.emojiText}>{emoji}</Text> : null}
              <Text style={styles.scoreNumber}>{score}</Text>
              {scoreUnit ? <Text style={styles.scoreUnit}>{scoreUnit}</Text> : null}
            </View>
          )}
          <Text style={styles.stateTitle}>{stateLabel}</Text>
          {stateSub ? <Text style={styles.stateSubText}>{stateSub}</Text> : null}
        </View>

        {/* Status Chips Row */}
        {chips && chips.length > 0 && (
          <View style={styles.chipsRow}>
            {chips.map((chip, idx) => (
              <View key={idx} style={styles.chipPill}>
                <Text style={styles.chipText}>{chip}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Arched Bottom Cutout & Central Action Button */}
      <View style={styles.archWrapper}>
        <Svg width={SCREEN_WIDTH} height={36} viewBox={`0 0 ${SCREEN_WIDTH} 36`}>
          <Path
            d={`M 0,0 Q ${SCREEN_WIDTH * 0.5},42 ${SCREEN_WIDTH},0 L ${SCREEN_WIDTH},36 L 0,36 Z`}
            fill={COLORS.light.bg}
          />
        </Svg>

        {/* Floating Circular Action Disc */}
        {onActionPress && (
          <TouchableOpacity
            activeOpacity={0.88}
            onPress={onActionPress}
            style={[styles.floatingActionDisc, { borderColor: COLORS.light.bg }]}
          >
            <View style={[styles.floatingActionInner, { backgroundColor: color }]}>
              <Icon name={actionIcon} size={22} color="#FFFFFF" />
            </View>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    position: 'relative',
    marginBottom: 10,
  },
  heroBg: {
    paddingTop: 16,
    paddingHorizontal: 20,
    paddingBottom: 22,
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
    overflow: 'hidden',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  titleBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
  },
  titleText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  rightActionWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  scoreBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 6,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emojiText: {
    fontSize: 34,
    marginRight: 4,
  },
  scoreNumber: {
    fontSize: 54,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -1.5,
  },
  scoreUnit: {
    fontSize: 22,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.85)',
    marginLeft: 2,
    marginTop: 12,
  },
  stateTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FFFFFF',
    marginTop: 2,
    letterSpacing: -0.2,
  },
  stateSubText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.9)',
    marginTop: 3,
    textAlign: 'center',
    fontWeight: '500',
  },
  chipsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  chipPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 11,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  chipText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  archWrapper: {
    width: '100%',
    height: 32,
    marginTop: -20,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    zIndex: 10,
  },
  floatingActionDisc: {
    position: 'absolute',
    top: -14,
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 3.5,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 8,
    elevation: 6,
  },
  floatingActionInner: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

