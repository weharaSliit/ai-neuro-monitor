import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from './Icon';
import { COLORS } from '../physiological/config/theme';

/**
 * MoodHistoryBar — 7-day emotion tracking bar chart with cute mood emojis
 * on top of rounded vertical bars.
 * Inspired directly by Freud v2 reference image 1 & 4.
 */
export default function MoodHistoryBar({
  history = [
    { day: 'Mon', mood: 'happy', score: 85 },
    { day: 'Tue', mood: 'calm', score: 70 },
    { day: 'Wed', mood: 'neutral', score: 55 },
    { day: 'Thu', mood: 'stressed', score: 40 },
    { day: 'Fri', mood: 'calm', score: 75 },
    { day: 'Sat', mood: 'happy', score: 90 },
    { day: 'Sun', mood: 'happy', score: 88 },
  ],
  onDayPress = null,
}) {
  const MOOD_CONFIG = {
    happy: {
      icon: 'emoticon-happy-outline',
      color: COLORS.normal,
      bg: COLORS.normalSoft,
      label: 'Happy',
    },
    calm: {
      icon: 'emoticon-outline',
      color: COLORS.brand,
      bg: COLORS.brandSoft,
      label: 'Calm',
    },
    neutral: {
      icon: 'emoticon-neutral-outline',
      color: COLORS.warning,
      bg: COLORS.warningSoft,
      label: 'Neutral',
    },
    stressed: {
      icon: 'emoticon-sad-outline',
      color: COLORS.stress,
      bg: COLORS.stressSoft,
      label: 'Stressed',
    },
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: COLORS.light.text }]}>Mood History</Text>
        <View style={styles.badgePill}>
          <Text style={[styles.badgeText, { color: COLORS.normalDark }]}>7 Days</Text>
        </View>
      </View>

      <View style={styles.barsContainer}>
        {history.map((item, index) => {
          const moodInfo = MOOD_CONFIG[item.mood] || MOOD_CONFIG.calm;
          const barHeightPercent = Math.max(25, Math.min(100, item.score || 60));

          return (
            <TouchableOpacity
              key={index}
              style={styles.dayColumn}
              activeOpacity={0.7}
              onPress={() => onDayPress && onDayPress(item, index)}
            >
              {/* Emoji Face Icon Bubble */}
              <View
                style={[
                  styles.emojiBubble,
                  { backgroundColor: moodInfo.bg, borderColor: moodInfo.color + '40' },
                ]}
              >
                <Icon name={moodInfo.icon} size={16} color={moodInfo.color} />
              </View>

              {/* Vertical Pill Bar Track & Fill */}
              <View style={[styles.barTrack, { backgroundColor: COLORS.light.pillBg }]}>
                <View
                  style={[
                    styles.barFill,
                    {
                      height: `${barHeightPercent}%`,
                      backgroundColor: moodInfo.color,
                    },
                  ]}
                />
              </View>

              {/* Day Label */}
              <Text style={[styles.dayText, { color: COLORS.light.textMuted }]}>
                {item.day}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  title: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.1,
  },
  badgePill: {
    backgroundColor: COLORS.normalSoft,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.normal + '30',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  barsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 140,
    paddingTop: 10,
    paddingBottom: 4,
  },
  dayColumn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: '100%',
  },
  emojiBubble: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  barTrack: {
    width: 14,
    height: 70,
    borderRadius: 7,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    marginBottom: 8,
  },
  barFill: {
    width: '100%',
    borderRadius: 7,
  },
  dayText: {
    fontSize: 11,
    fontWeight: '700',
  },
});

