import React, { useState, useContext, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Animated,
  Dimensions,
  Easing,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ThemeContext } from '../context/ThemeContext';
import { AppContext } from '../context/AppContext';

const { width: SCREEN_W } = Dimensions.get('window');

// Ambient floating light orb component for innovative modal backdrop
const AmbientOrb = ({ size, color, top, left, duration, dx, dy }) => {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [t, duration]);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top,
        left,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity: 0.25,
        transform: [
          { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, dx] }) },
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, dy] }) },
        ],
      }}
    />
  );
};

export const DailyTasksModal = ({
  visible,
  onClose,
  onStartTask,
  totalTasks = 4,
  onOpenChest
}) => {
  const { theme, isDarkMode } = useContext(ThemeContext);
  const appContext = useContext(AppContext) || {};
  const setSelectedSubOption = appContext.setSelectedSubOption;
  const setCurrentRecommendation = appContext.setCurrentRecommendation;
  const setCurrentScreen = appContext.setCurrentScreen;

  const isDark = isDarkMode ?? theme?.isDark ?? true;

  const [tasks, setTasks] = useState([
    {
      id: 'zen_breathing',
      gameId: 'water_lily_pond',
      icon: '🪷',
      title: 'Breathe 3 mins in Zen Lily Pond',
      progress: 0,
      target: 3,
      reward: 'Serenity Elixir',
      color: '#10B981',
      gradient: ['#10B981', '#059669'],
      unit: 'min',
    },
    {
      id: 'garden_bloom',
      gameId: 'flower_meadow',
      icon: '🌸',
      title: 'Bloom 5 Lotus Flowers in Calm Meadow',
      progress: 0,
      target: 5,
      reward: 'Lotus Gem',
      color: '#EC4899',
      gradient: ['#F43F5E', '#EC4899'],
      unit: 'flowers',
    },
    {
      id: 'focus_rhythm',
      gameId: 'box_meditation',
      icon: '🧊',
      title: 'Complete 1 Box Breathing session',
      progress: 0,
      target: 1,
      reward: '+100 Zen XP',
      color: '#3B82F6',
      gradient: ['#3B82F6', '#2563EB'],
      unit: 'session',
    },
    {
      id: 'calm_elixir',
      gameId: 'diaphragmatic_pace',
      icon: '🧪',
      title: 'Activate 1 Serenity Elixir in game',
      progress: 0,
      target: 1,
      reward: 'Chest Key',
      color: '#F59E0B',
      gradient: ['#F59E0B', '#D97706'],
      unit: 'item',
    },
  ]);

  if (!visible) return null;

  const currentProgress = tasks.filter((t) => t.progress >= t.target).length;
  const progressPercent = Math.min(100, Math.round((currentProgress / totalTasks) * 100));

  const handleStartTask = (task) => {
    if (onStartTask) {
      onStartTask(task);
    } else if (task && task.gameId) {
      const subOpt = { id: task.gameId, title: task.title, description: task.title };
      if (setSelectedSubOption) setSelectedSubOption(subOpt);
      if (setCurrentRecommendation) {
        setCurrentRecommendation({
          technique_id: task.gameId,
          title: task.title,
          description: task.title,
          selected_sub_option: subOpt,
        });
      }
      if (setCurrentScreen) setCurrentScreen('GamePlayer');
    }
    if (onClose) onClose();
  };

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.overlay}>
        {/* Innovative Ambient Backdrop Orbs */}
        <AmbientOrb size={220} color={isDark ? '#818CF8' : '#38BDF8'} top={-40} left={-50} duration={8000} dx={40} dy={30} />
        <AmbientOrb size={180} color={isDark ? '#EC4899' : '#F472B6'} top={300} left={SCREEN_W - 140} duration={10000} dx={-30} dy={-40} />
        <AmbientOrb size={160} color={isDark ? '#10B981' : '#34D399'} top={500} left={-40} duration={12000} dx={50} dy={-20} />

        {/* Gradient Border Frame */}
        <LinearGradient
          colors={isDark ? ['#38BDF8', '#818CF8', '#EC4899'] : ['#60A5FA', '#A78BFA', '#F472B6']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradientBorderFrame}
        >
          <LinearGradient
            colors={isDark ? ['#0F172A', '#1E1B4B', '#111827'] : ['#FFFFFF', '#F8FAFC', '#F1F5F9']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.modalInnerContainer}
          >
            {/* Header Row */}
            <View style={styles.headerRow}>
              <View>
                <Text style={[styles.modalTitle, { color: isDark ? '#F8FAFC' : '#0F172A' }]}>
                  📜 Daily Quests
                </Text>
                <Text style={[styles.modalSub, { color: isDark ? '#94A3B8' : '#64748B' }]}>
                  Complete tasks to unlock relaxation rewards
                </Text>
              </View>

              <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.75}>
                <Text style={[styles.closeBtnTxt, { color: isDark ? '#CBD5E1' : '#475569' }]}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Innovative Progress Banner */}
            <LinearGradient
              colors={isDark ? ['rgba(30, 27, 75, 0.7)', 'rgba(15, 23, 42, 0.85)'] : ['#F0F9FF', '#FAF5FF']}
              style={[styles.progressCard, { borderColor: isDark ? 'rgba(129, 140, 248, 0.35)' : 'rgba(59, 130, 246, 0.25)' }]}
            >
              <View style={styles.progressHeader}>
                <Text style={[styles.progressTitle, { color: isDark ? '#60A5FA' : '#0284C7' }]}>
                  ✨ {currentProgress} of {totalTasks} Quests Completed
                </Text>
                <TouchableOpacity onPress={onOpenChest} activeOpacity={0.75}>
                  <Text style={styles.chestIcon}>🎁 Claim Chest</Text>
                </TouchableOpacity>
              </View>

              <View style={[styles.progressBarTrack, { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(15, 23, 42, 0.08)' }]}>
                <LinearGradient
                  colors={['#3B82F6', '#8B5CF6', '#EC4899']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.progressBarFill, { width: `${progressPercent}%` }]}
                />
              </View>
            </LinearGradient>

            {/* Color-Coded Quest Tasks List */}
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.taskList}>
              {tasks.map((task) => {
                const isDone = task.progress >= task.target;
                return (
                  <View
                    key={task.id}
                    style={[
                      styles.taskCard,
                      {
                        backgroundColor: isDark ? 'rgba(15, 23, 42, 0.65)' : '#FFFFFF',
                        borderColor: task.color + '45',
                      }
                    ]}
                  >
                    <View style={[styles.iconBox, { backgroundColor: task.color + '20' }]}>
                      <Text style={styles.taskIcon}>{task.icon}</Text>
                    </View>

                    <View style={styles.taskInfoCol}>
                      <Text style={[styles.taskTitle, { color: isDark ? '#F8FAFC' : '#0F172A' }]}>
                        {task.title}
                      </Text>
                      <Text style={[styles.taskReward, { color: task.color }]}>
                        🎁 Reward: {task.reward}
                      </Text>
                    </View>

                    <TouchableOpacity
                      onPress={() => handleStartTask(task)}
                      disabled={isDone}
                      activeOpacity={0.8}
                      style={styles.startBtnWrapper}
                    >
                      {isDone ? (
                        <View style={[styles.startBtnDone, { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.1)' : '#E2E8F0' }]}>
                          <Text style={[styles.startBtnTxt, { color: isDark ? '#94A3B8' : '#64748B' }]}>Done ✓</Text>
                        </View>
                      ) : (
                        <LinearGradient
                          colors={task.gradient}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 0 }}
                          style={styles.startBtnGradient}
                        >
                          <Text style={styles.startBtnTxtActive}>Start ▶</Text>
                        </LinearGradient>
                      )}
                    </TouchableOpacity>
                  </View>
                );
              })}
            </ScrollView>

          </LinearGradient>
        </LinearGradient>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(10, 15, 30, 0.82)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 18,
    position: 'relative',
  },
  gradientBorderFrame: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 28,
    padding: 2.5,
    maxHeight: '85%',
    elevation: 24,
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
  },
  modalInnerContainer: {
    borderRadius: 26,
    padding: 20,
    overflow: 'hidden',
  },

  // Header
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  modalSub: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnTxt: {
    fontSize: 16,
    fontWeight: '800',
  },

  // Progress Card
  progressCard: {
    padding: 14,
    borderRadius: 18,
    borderWidth: 1.5,
    marginBottom: 14,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  progressTitle: {
    fontSize: 13,
    fontWeight: '800',
  },
  chestIcon: {
    fontSize: 12,
    fontWeight: '900',
    color: '#F59E0B',
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.4)',
  },
  progressBarTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },

  // Tasks List
  taskList: {
    gap: 12,
  },
  taskCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 18,
    borderWidth: 1.5,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskIcon: {
    fontSize: 22,
  },
  taskInfoCol: {
    flex: 1,
  },
  taskTitle: {
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  taskReward: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 3,
  },
  startBtnWrapper: {
    borderRadius: 12,
    elevation: 3,
  },
  startBtnGradient: {
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  startBtnDone: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  startBtnTxtActive: {
    fontSize: 12,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  startBtnTxt: {
    fontSize: 12,
    fontWeight: '800',
  },
});

export default DailyTasksModal;
