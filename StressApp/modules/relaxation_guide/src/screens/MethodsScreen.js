import React, { useState, useContext } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { Header } from '../components/Header';
import { DailyTasksModal } from '../components/DailyTasksModal';
import { RewardChestModal } from '../components/RewardChestModal';
import { AmbientBackground } from '../components/AmbientBackground';

const ARCADE_GAMES = [
  {
    id: 'flower_meadow',
    level: 1,
    title: 'Calm Meadow',
    icon: '🌸',
    description: 'Breathe with blooming petals to calm down.',
    color: '#EC4899', // Rose Pink
  },
  {
    id: 'water_lily_pond',
    level: 2,
    title: 'Zen Lily Pond',
    icon: '🪷',
    description: 'Tap water ripples with floating water lilies.',
    color: '#10B981', // Emerald Green
  },
  {
    id: 'box_meditation',
    level: 3,
    title: 'Focus Box',
    icon: '🧊',
    description: '4-second square rhythm to clear your mind.',
    color: '#3B82F6', // Sky Blue
  },
  {
    id: 'diaphragmatic_pace',
    level: 4,
    title: 'Deep Belly Calm',
    icon: '🫁',
    description: 'Slow deep breathing to lower stress.',
    color: '#0EA5E9', // Ocean Cyan
  },
  {
    id: 'pattern_alignment',
    level: 5,
    title: 'Color Match',
    icon: '🧩',
    description: 'Pattern matching puzzle to distract from worry.',
    color: '#8B5CF6', // Lavender Purple
  },
  {
    id: 'body_scan_mindful',
    level: 6,
    title: 'Body Sweep',
    icon: '🧘‍♂️',
    description: 'Interactive map to sweep muscle tension.',
    color: '#7C3AED', // Violet
  },
  {
    id: 'autogenic_warmth',
    level: 7,
    title: 'Warmth Flow',
    icon: '🔥',
    description: 'Soothing warmth flowing through your body.',
    color: '#F59E0B', // Warm Amber
  },
  {
    id: 'stroop_decoupler',
    level: 8,
    title: 'Color Clash',
    icon: '🎯',
    description: 'Color challenge to refocus your mind.',
    color: '#06B6D4', // Teal
  },
];

export const MethodsScreen = () => {
  const {
    setCurrentScreen,
    setCurrentRecommendation,
    setSelectedSubOption,
    setPreInterventionLabel,
    stressState
  } = useContext(AppContext);

  const { theme } = useContext(ThemeContext);

  const [showTasksModal, setShowTasksModal] = useState(false);
  const [showRewardModal, setShowRewardModal] = useState(false);

  const launchGame = (game) => {
    setPreInterventionLabel(stressState);
    const subOpt = { id: game.id, title: game.title, description: game.description };
    setSelectedSubOption(subOpt);
    setCurrentRecommendation({
      technique_id: game.id,
      title: game.title,
      description: game.description,
      selected_sub_option: subOpt,
    });
    setCurrentScreen('GamePlayer');
  };

  const isDark = theme?.isDark ?? true;

  return (
    <View style={[styles.container, { backgroundColor: theme?.bgPrimary || (isDark ? '#0F172A' : '#FAF9FC') }]}>
      <AmbientBackground />
      <Header title="Relaxation Arcade" showBack onBack={() => setCurrentScreen('Dashboard')} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Daily Tasks Button */}
        <TouchableOpacity
          style={[styles.taskRow, { backgroundColor: isDark ? 'rgba(30, 41, 59, 0.75)' : 'rgba(255, 255, 255, 0.85)', borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(226, 232, 240, 0.8)' }]}
          onPress={() => setShowTasksModal(true)}
          activeOpacity={0.7}
        >
          <Text style={styles.taskIcon}>📜</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.taskTitle, { color: theme?.textPrimary || (isDark ? '#F8FAFC' : '#0F172A') }]}>Daily Tasks & Quests</Text>
            <Text style={[styles.taskSub, { color: theme?.textMuted || '#94A3B8' }]}>Complete tasks for rewards</Text>
          </View>
          <Text style={[styles.arrowTxt, { color: '#3B82F6' }]}>▶</Text>
        </TouchableOpacity>

        {/* Section Title */}
        <Text style={[styles.arcadeTitle, { color: theme?.textPrimary || (isDark ? '#F8FAFC' : '#0F172A') }]}>
          Choose Level
        </Text>

        {/* Color-Coded Soothing Relaxation Cards */}
        {ARCADE_GAMES.map((game) => (
          <TouchableOpacity
            key={game.id}
            style={[
              styles.simpleCard,
              {
                backgroundColor: isDark ? 'rgba(30, 41, 59, 0.75)' : 'rgba(255, 255, 255, 0.85)',
                borderColor: game.color + '50',
              }
            ]}
            onPress={() => launchGame(game)}
            activeOpacity={0.7}
          >
            <View style={[styles.iconBox, { backgroundColor: game.color + '18' }]}>
              <Text style={styles.gameIcon}>{game.icon}</Text>
            </View>

            <View style={styles.infoCol}>
              <View style={styles.titleRow}>
                <Text style={[styles.gameTitle, { color: theme?.textPrimary || (isDark ? '#F8FAFC' : '#0F172A') }]}>
                  {game.title}
                </Text>
                <Text style={[styles.levelTag, { color: game.color }]}>
                  Lvl {game.level}
                </Text>
              </View>
              <Text style={[styles.gameDesc, { color: theme?.textMuted || '#94A3B8' }]} numberOfLines={1}>
                {game.description}
              </Text>
            </View>

            <View style={[styles.playBtn, { backgroundColor: game.color }]}>
              <Text style={styles.playTxt}>Play</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Task & Reward Modals */}
      <DailyTasksModal
        visible={showTasksModal}
        onClose={() => setShowTasksModal(false)}
        onOpenChest={() => {
          setShowTasksModal(false);
          setShowRewardModal(true);
        }}
        onStartTask={(task) => {
          let target = ARCADE_GAMES[0];
          if (task?.gameId) {
            target = ARCADE_GAMES.find((g) => g.id === task.gameId) || target;
          }
          launchGame(target);
        }}
      />

      <RewardChestModal
        visible={showRewardModal}
        onClose={() => setShowRewardModal(false)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 36,
    gap: 10,
  },

  // Task Row
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 4,
  },
  taskIcon: {
    fontSize: 22,
  },
  taskTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  taskSub: {
    fontSize: 11,
    marginTop: 1,
  },
  arrowTxt: {
    fontSize: 12,
    fontWeight: '800',
  },

  // Title
  arcadeTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginTop: 4,
    marginBottom: 2,
  },

  // Simple Color-Coded Game Cards
  simpleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gameIcon: {
    fontSize: 22,
  },
  infoCol: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  gameTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  levelTag: {
    fontSize: 11,
    fontWeight: '800',
  },
  gameDesc: {
    fontSize: 11,
    lineHeight: 15,
  },

  // Clean Play Button
  playBtn: {
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  playTxt: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
});

export default MethodsScreen;
