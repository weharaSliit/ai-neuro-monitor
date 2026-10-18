import React, { useState, useContext, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Dimensions,
  ActivityIndicator,
  Vibration
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { Header } from '../components/Header';
import { DailyTasksModal } from '../components/DailyTasksModal';
import { RewardChestModal } from '../components/RewardChestModal';
import { AmbientBackground } from '../components/AmbientBackground';

const { width } = Dimensions.get('window');

// Simple, friendly game titles & unique color-mixed gradients
const SIMPLE_GAME_MAP = {
  flower_meadow: { title: 'Calm Meadow', icon: '🌸', color: '#EC4899', gradient: ['#F43F5E', '#EC4899', '#FDE68A'], tag: 'Garden Bloom' },
  breathing_garden: { title: 'Calm Meadow', icon: '🌸', color: '#EC4899', gradient: ['#F43F5E', '#EC4899', '#FDE68A'], tag: 'Garden Bloom' },
  water_lily_pond: { title: 'Zen Lily Pond', icon: '🪷', color: '#10B981', gradient: ['#059669', '#10B981', '#06B6D4'], tag: 'Breathe & Float' },
  soft_fascination: { title: 'Zen Lily Pond', icon: '🪷', color: '#10B981', gradient: ['#059669', '#10B981', '#06B6D4'], tag: 'Breathe & Float' },
  guided_imagery: { title: 'Zen Lily Pond', icon: '🪷', color: '#10B981', gradient: ['#059669', '#10B981', '#06B6D4'], tag: 'Breathe & Float' },
  box_meditation: { title: 'Focus Box', icon: '🧊', color: '#0EA5E9', gradient: ['#1E1B4B', '#3B82F6', '#38BDF8'], tag: 'Square Rhythm' },
  guided_meditation: { title: 'Focus Box', icon: '🧊', color: '#0EA5E9', gradient: ['#1E1B4B', '#3B82F6', '#38BDF8'], tag: 'Square Rhythm' },
  vagus_humming: { title: 'Focus Box', icon: '🧊', color: '#0EA5E9', gradient: ['#1E1B4B', '#3B82F6', '#38BDF8'], tag: 'Square Rhythm' },
  diaphragmatic_pace: { title: 'Deep Belly Calm', icon: '🫁', color: '#3B82F6', gradient: ['#0284C7', '#0EA5E9', '#6EE7B7'], tag: 'Relax Body' },
  pattern_alignment: { title: 'Color Match', icon: '🧩', color: '#F59E0B', gradient: ['#8B5CF6', '#D946EF', '#F59E0B'], tag: 'Brain Puzzle' },
  body_scan_mindful: { title: 'Body Sweep', icon: '🧘‍♂️', color: '#8B5CF6', gradient: ['#4C1D95', '#7C3AED', '#C4B5FD'], tag: 'Release Tension' },
  autogenic_warmth: { title: 'Warmth Flow', icon: '🔥', color: '#EF4444', gradient: ['#B91C1C', '#EF4444', '#F59E0B'], tag: 'Feel Warm' },
  stroop_decoupler: { title: 'Color Clash', icon: '🎯', color: '#06B6D4', gradient: ['#0891B2', '#06B6D4', '#A855F7'], tag: 'Quick Focus' },
  pmr_crystal_squeeze: { title: 'Somatic PMR', icon: '💎', color: '#EC4899', gradient: ['#881337', '#BE185D', '#F472B6'], tag: 'Muscle Iso-Tension' },
  progressive_muscle: { title: 'Somatic PMR', icon: '💎', color: '#EC4899', gradient: ['#881337', '#BE185D', '#F472B6'], tag: 'Muscle Iso-Tension' },
  cognitive_destress: { title: 'Somatic PMR', icon: '💎', color: '#EC4899', gradient: ['#881337', '#BE185D', '#F472B6'], tag: 'Muscle Iso-Tension' },
  emdr_saccadic_trace: { title: 'Cosmic Trace', icon: '✨', color: '#38BDF8', gradient: ['#0369A1', '#38BDF8', '#C084FC'], tag: 'EMDR Saccadic Trace' },
  cosmic_nebula: { title: 'Cosmic Trace', icon: '✨', color: '#38BDF8', gradient: ['#0369A1', '#38BDF8', '#C084FC'], tag: 'EMDR Saccadic Trace' },
  galvanic_biofeedback_flow: { title: 'Bio GSR Pool', icon: '💧', color: '#06B6D4', gradient: ['#083344', '#06B6D4', '#67E8F9'], tag: 'GSR Fluid Biofeedback' },
};

const UNIQUE_TECHNIQUES = {
  flower_meadow: { title: 'Calm Meadow', icon: '🌸', color: '#EC4899', gradient: ['#F43F5E', '#EC4899', '#FDE68A'], tag: 'Garden Bloom' },
  water_lily_pond: { title: 'Zen Lily Pond', icon: '🪷', color: '#10B981', gradient: ['#059669', '#10B981', '#06B6D4'], tag: 'Breathe & Float' },
  box_meditation: { title: 'Focus Box', icon: '🧊', color: '#0EA5E9', gradient: ['#1E1B4B', '#3B82F6', '#38BDF8'], tag: 'Square Rhythm' },
  diaphragmatic_pace: { title: 'Deep Belly Calm', icon: '🫁', color: '#3B82F6', gradient: ['#0284C7', '#0EA5E9', '#6EE7B7'], tag: 'Relax Body' },
  pattern_alignment: { title: 'Color Match', icon: '🧩', color: '#F59E0B', gradient: ['#8B5CF6', '#D946EF', '#F59E0B'], tag: 'Brain Puzzle' },
  body_scan_mindful: { title: 'Body Sweep', icon: '🧘‍♂️', color: '#8B5CF6', gradient: ['#4C1D95', '#7C3AED', '#C4B5FD'], tag: 'Release Tension' },
  autogenic_warmth: { title: 'Warmth Flow', icon: '🔥', color: '#EF4444', gradient: ['#B91C1C', '#EF4444', '#F59E0B'], tag: 'Feel Warm' },
  stroop_decoupler: { title: 'Color Clash', icon: '🎯', color: '#06B6D4', gradient: ['#0891B2', '#06B6D4', '#A855F7'], tag: 'Quick Focus' },
  pmr_crystal_squeeze: { title: 'Somatic PMR', icon: '💎', color: '#EC4899', gradient: ['#881337', '#BE185D', '#F472B6'], tag: 'Muscle Iso-Tension' },
  emdr_saccadic_trace: { title: 'Cosmic Trace', icon: '✨', color: '#38BDF8', gradient: ['#0369A1', '#38BDF8', '#C084FC'], tag: 'EMDR Saccadic Trace' },
  galvanic_biofeedback_flow: { title: 'Bio GSR Pool', icon: '💧', color: '#06B6D4', gradient: ['#083344', '#06B6D4', '#67E8F9'], tag: 'GSR Fluid Biofeedback' },
};

export const InterventionScreen = () => {
  const {
    userId,
    currentRecommendation,
    setCurrentScreen,
    setSelectedSubOption
  } = useContext(AppContext);

  const { theme } = useContext(ThemeContext);

  const [isAccepting, setIsAccepting] = useState(false);
  const [showTasksModal, setShowTasksModal] = useState(false);
  const [showRewardModal, setShowRewardModal] = useState(false);

  // Animation values
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.03, duration: 1500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1500, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  if (!currentRecommendation) {
    return (
      <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
        <AmbientBackground />
        <Header title="Relaxation Hub" showBack onBack={() => setCurrentScreen('Dashboard')} />
        <View style={styles.emptyBox}>
          <Text style={styles.emptyIcon}>🎮</Text>
          <Text style={[styles.emptyTxt, { color: theme.textMuted }]}>Choose a game from the catalog to begin!</Text>
          <TouchableOpacity
            style={styles.catalogBtn}
            onPress={() => setCurrentScreen('Methods')}
          >
            <Text style={styles.catalogBtnTxt}>🎮 Go to Game Catalog</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const techId = currentRecommendation.technique_id || 'water_lily_pond';
  const gameInfo = SIMPLE_GAME_MAP[techId] || SIMPLE_GAME_MAP.water_lily_pond;

  const handleStartGame = () => {
    setIsAccepting(true);
    Vibration.vibrate(30);

    setTimeout(() => {
      // Go straight to the recommended technique
      setSelectedSubOption(
        currentRecommendation?.selected_sub_option ||
        { id: techId, title: gameInfo.title, description: gameInfo.tag, gradient: gameInfo.gradient }
      );
      setCurrentScreen('GamePlayer');
      setIsAccepting(false);
    }, 300);
  };

  const handleSelectAlternative = (key) => {
    const item = SIMPLE_GAME_MAP[key];
    const subOpt = { id: key, title: item.title, description: item.tag, gradient: item.gradient };
    setSelectedSubOption(subOpt);
    setCurrentScreen('GamePlayer');
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <AmbientBackground />
      <Header title="Today's Recommended Session" showBack onBack={() => setCurrentScreen('Dashboard')} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Quick Action Bar for Quests & Rewards */}
        <View style={styles.topActionsRow}>
          <TouchableOpacity
            style={styles.questBarBtn}
            onPress={() => setShowTasksModal(true)}
            activeOpacity={0.85}
          >
            <Text style={styles.questBarIcon}>📜</Text>
            <Text style={styles.questBarTxt}>Daily Tasks (0/4)</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.rewardBarBtn}
            onPress={() => setShowRewardModal(true)}
            activeOpacity={0.85}
          >
            <Text style={styles.rewardBarIcon}>🎁</Text>
            <Text style={styles.rewardBarTxt}>Claim Reward</Text>
          </TouchableOpacity>
        </View>

        {/* Featured Level Card with Gradient Border */}
        <Animated.View
          style={[
            styles.mainCardWrapper,
            {
              opacity: fadeAnim,
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >
          <LinearGradient
            colors={gameInfo.gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.gradientBorderMain}
          >
            <View style={[styles.mainCardInner, { backgroundColor: theme.bgSecondary }]}>
              {/* Top Badge */}
              <LinearGradient
                colors={gameInfo.gradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.recommendedBadge}
              >
                <Text style={styles.recommendedBadgeTxt}>⭐ RECOMMENDED LEVEL</Text>
              </LinearGradient>

              {/* Icon & Title */}
              <View style={styles.heroCenter}>
                <Text style={styles.heroEmoji}>{gameInfo.icon}</Text>
                <Text style={[styles.heroTitle, { color: theme.textPrimary }]}>{gameInfo.title}</Text>
                <Text style={[styles.heroTag, { color: gameInfo.color }]}>{gameInfo.tag}</Text>
              </View>

              {/* Level Rewards Banner */}
              <View style={styles.rewardsBanner}>
                <Text style={styles.rewardsBannerTitle}>LEVEL REWARDS</Text>
                <View style={styles.rewardBadgesRow}>
                  <View style={styles.rewardItemPill}>
                    <Text style={styles.rewardItemIcon}>⭐</Text>
                    <Text style={styles.rewardItemTxt}>+200 XP</Text>
                  </View>
                  <View style={styles.rewardItemPill}>
                    <Text style={styles.rewardItemIcon}>🧪</Text>
                    <Text style={styles.rewardItemTxt}>+1 Potion</Text>
                  </View>
                  <View style={styles.rewardItemPill}>
                    <Text style={styles.rewardItemIcon}>🎁</Text>
                    <Text style={styles.rewardItemTxt}>Chest Key</Text>
                  </View>
                </View>
              </View>

              {/* Glossy 3D Color-Mixed Play Button */}
              <Animated.View style={{ transform: [{ scale: pulseAnim }], width: '100%', alignItems: 'center' }}>
                <TouchableOpacity
                  onPress={handleStartGame}
                  disabled={isAccepting}
                  activeOpacity={0.85}
                  style={styles.playBtnWrapper}
                >
                  <LinearGradient
                    colors={gameInfo.gradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.playBtnGradient}
                  >
                    {isAccepting ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <>
                        <Text style={styles.playBtnIcon}>▶</Text>
                        <Text style={styles.playBtnTxt}>PLAY LEVEL</Text>
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              </Animated.View>
            </View>
          </LinearGradient>
        </Animated.View>

        {/* Alternate Games Section - All Techniques Catalog */}
        <View style={styles.altSection}>
          <Text style={[styles.altSectionTitle, { color: theme.textPrimary }]}>🎮 Test Any Technique in the Catalog ({Object.keys(UNIQUE_TECHNIQUES).length} Games Available)</Text>
          <Text style={{ color: theme.textMuted, fontSize: 12, marginBottom: 14 }}>
            For research user studies, you can select and test ANY technique below:
          </Text>

          <View style={styles.altGrid}>
            {Object.keys(UNIQUE_TECHNIQUES)
              .filter((k) => k !== techId)
              .map((key) => {
                const item = UNIQUE_TECHNIQUES[key];
                return (
                  <TouchableOpacity
                    key={key}
                    style={styles.altCardWrapper}
                    onPress={() => handleSelectAlternative(key)}
                    activeOpacity={0.85}
                  >
                    <LinearGradient
                      colors={item.gradient}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.altGradientBorder}
                    >
                      <View style={[styles.altCardInner, { backgroundColor: theme.bgSecondary }]}>
                        <Text style={styles.altGameEmoji}>{item.icon}</Text>
                        <Text style={[styles.altGameTitle, { color: theme.textPrimary }]}>{item.title}</Text>
                        <Text style={[styles.altGameTag, { color: item.color }]}>{item.tag}</Text>
                        <LinearGradient
                          colors={item.gradient}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 0 }}
                          style={styles.altPlayBtnGradient}
                        >
                          <Text style={styles.altPlayTxt}>Test Game ▶</Text>
                        </LinearGradient>
                      </View>
                    </LinearGradient>
                  </TouchableOpacity>
                );
              })}
          </View>
        </View>
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
          if (task?.gameId) {
            const subOpt = { id: task.gameId, title: task.title, description: task.title };
            setSelectedSubOption(subOpt);
            setCurrentRecommendation({
              technique_id: task.gameId,
              title: task.title,
              description: task.title,
              selected_sub_option: subOpt,
            });
            setCurrentScreen('GamePlayer');
          }
        }}
      />

      <RewardChestModal
        visible={showRewardModal}
        onClose={() => setShowRewardModal(false)}
        techniqueId={techId}
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
    paddingBottom: 40,
  },
  emptyBox: {
    padding: 32,
    alignItems: 'center',
    marginTop: 60,
  },
  emptyIcon: {
    fontSize: 56,
    marginBottom: 12,
  },
  emptyTxt: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  catalogBtn: {
    backgroundColor: '#8B5CF6',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 16,
  },
  catalogBtnTxt: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
  },
  topActionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  questBarBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#7C3AED',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#A78BFA',
    elevation: 4,
  },
  questBarIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  questBarTxt: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  rewardBarBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F59E0B',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#FDE68A',
    elevation: 4,
  },
  rewardBarIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  rewardBarTxt: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  mainCardWrapper: {
    borderRadius: 28,
    elevation: 6,
    marginBottom: 24,
  },
  gradientBorderMain: {
    padding: 3,
    borderRadius: 28,
  },
  mainCardInner: {
    borderRadius: 26,
    padding: 24,
    alignItems: 'center',
  },
  recommendedBadge: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 14,
    marginBottom: 16,
  },
  recommendedBadgeTxt: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  heroCenter: {
    alignItems: 'center',
    marginBottom: 20,
  },
  heroEmoji: {
    fontSize: 72,
    marginBottom: 8,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '900',
    textAlign: 'center',
  },
  heroTag: {
    fontSize: 14,
    fontWeight: '800',
    marginTop: 4,
  },
  rewardsBanner: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 18,
    padding: 12,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  rewardsBannerTitle: {
    color: '#F59E0B',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 8,
  },
  rewardBadgesRow: {
    flexDirection: 'row',
    gap: 8,
  },
  rewardItemPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  rewardItemIcon: {
    fontSize: 14,
    marginRight: 4,
  },
  rewardItemTxt: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  playBtnWrapper: {
    width: 240,
    borderRadius: 22,
    elevation: 8,
  },
  playBtnGradient: {
    paddingVertical: 16,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  playBtnIcon: {
    color: '#FFFFFF',
    fontSize: 22,
    marginRight: 8,
  },
  playBtnTxt: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 1,
  },
  altSection: {
    marginTop: 8,
  },
  altSectionTitle: {
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 12,
  },
  altGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  altCardWrapper: {
    width: (width - 44) / 2,
    borderRadius: 20,
    elevation: 2,
  },
  altGradientBorder: {
    padding: 2,
    borderRadius: 20,
  },
  altCardInner: {
    padding: 14,
    borderRadius: 18,
    alignItems: 'center',
  },
  altGameEmoji: {
    fontSize: 36,
    marginBottom: 6,
  },
  altGameTitle: {
    fontSize: 15,
    fontWeight: '900',
    textAlign: 'center',
  },
  altGameTag: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 10,
  },
  altPlayBtnGradient: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  altPlayTxt: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
  },
});

export default InterventionScreen;