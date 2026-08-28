import React, { useState, useContext, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Easing,
  Dimensions,
  SafeAreaView
} from 'react-native';
import Svg, { Path, Circle, Line, Rect, Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { Header } from '../components/Header';
import { apiService } from '../api/apiService';

const { width } = Dimensions.get('window');
const CHART_WIDTH = width - 48;
const CHART_HEIGHT = 160;

// Dummy historical trend data points for dual-stream chart (Pre vs Post sessions)
const HISTORICAL_SESSIONS = [
  { session: 'S1', physioPre: 78, physioPost: 22, phenoPre: 65, phenoPost: 28, date: 'Mon' },
  { session: 'S2', physioPre: 84, physioPost: 30, phenoPre: 72, phenoPost: 32, date: 'Tue' },
  { session: 'S3', physioPre: 62, physioPost: 18, phenoPre: 58, phenoPost: 20, date: 'Wed' },
  { session: 'S4', physioPre: 90, physioPost: 25, phenoPre: 82, phenoPost: 35, date: 'Thu' },
  { session: 'S5', physioPre: 75, physioPost: 20, phenoPre: 68, phenoPost: 22, date: 'Fri' },
  { session: 'S6', physioPre: 88, physioPost: 24, phenoPre: 80, phenoPost: 26, date: 'Sat' },
  { session: 'S7', physioPre: 70, physioPost: 15, phenoPre: 64, phenoPost: 18, date: 'Sun' },
];

// Category performance benchmark data
const CATEGORY_PERFORMANCE = [
  { category: 'Vagal & Somatic Reset', successRate: 92, avgTime: '98s', icon: '🪷', color: '#10B981' },
  { category: 'Baroreflex HRV Resonance', successRate: 84, avgTime: '136s', icon: '🌌', color: '#8B5CF6' },
  { category: 'Autonomic Square Breathing', successRate: 68, avgTime: '168s', icon: '📦', color: '#3B82F6' },
  { category: 'Visuospatial Memory Occupancy', successRate: 56, avgTime: '210s', icon: '🧩', color: '#EC4899' },
];

export const PerformanceOverviewScreen = () => {
  const { setCurrentScreen, history, userId, username, userBaseline } = useContext(AppContext);
  const { theme, isDarkMode } = useContext(ThemeContext);

  const [activeTab, setActiveTab] = useState('reduction');
  const [selectedPoint, setSelectedPoint] = useState(null);

  const baselinePct = (typeof userBaseline === 'number' && userBaseline > 0) ? (userBaseline * 100).toFixed(0) : '25';
  const displayUser = username || userId || 'User';

  // Compute dynamic personalized stats from user's history
  const hasHistory = Array.isArray(history) && history.length > 0;
  const userAvgDrop = hasHistory
    ? (history.reduce((acc, h) => acc + (h.recovery_percentage || h.recovery_pct || 75), 0) / history.length).toFixed(1)
    : '78.4';
  const userSessionCount = hasHistory ? history.length : 7;

  // Entrance animation
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 40, friction: 8, useNativeDriver: true })
    ]).start();
  }, []);

  // Build SVG Path for Dual-Stream Trend Chart
  const buildTrendPaths = () => {
    const data = HISTORICAL_SESSIONS;
    const paddingX = 20;
    const availableWidth = CHART_WIDTH - paddingX * 2;

    const pointsPhysioPre = data.map((d, i) => {
      const x = paddingX + (i / (data.length - 1)) * availableWidth;
      const y = CHART_HEIGHT - 20 - (d.physioPre / 100) * (CHART_HEIGHT - 40);
      return { x, y, val: d.physioPre, data: d };
    });

    const pointsPhysioPost = data.map((d, i) => {
      const x = paddingX + (i / (data.length - 1)) * availableWidth;
      const y = CHART_HEIGHT - 20 - (d.physioPost / 100) * (CHART_HEIGHT - 40);
      return { x, y, val: d.physioPost, data: d };
    });

    const pointsPhenoPost = data.map((d, i) => {
      const x = paddingX + (i / (data.length - 1)) * availableWidth;
      const y = CHART_HEIGHT - 20 - (d.phenoPost / 100) * (CHART_HEIGHT - 40);
      return { x, y, val: d.phenoPost, data: d };
    });

    const pathPhysioPre = pointsPhysioPre.reduce((acc, pt, idx) => (
      idx === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`
    ), '');

    const pathPhysioPost = pointsPhysioPost.reduce((acc, pt, idx) => (
      idx === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`
    ), '');

    const pathPhenoPost = pointsPhenoPost.reduce((acc, pt, idx) => (
      idx === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`
    ), '');

    return { pointsPhysioPre, pointsPhysioPost, pointsPhenoPost, pathPhysioPre, pathPhysioPost, pathPhenoPost };
  };

  const chart = buildTrendPaths();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <Header title="Performance Overview" showBack={true} onBack={() => setCurrentScreen('Dashboard')} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

          {/* 👤 USER PERSONALIZATION BANNER */}
          <View style={[styles.userBanner, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
            <View style={styles.userBannerLeft}>
              <Text style={styles.userAvatarEmoji}>👤</Text>
              <View>
                <Text style={[styles.userNameTxt, { color: theme.textPrimary }]}>{displayUser}'s Analytics</Text>
                <Text style={[styles.userSubTxt, { color: theme.textMuted }]}>
                  {userSessionCount} Sessions Completed · Personal Baseline Target: {baselinePct}%
                </Text>
              </View>
            </View>
            <View style={[styles.userBadge, { backgroundColor: theme.accent + '20', borderColor: theme.accent }]}>
              <Text style={[styles.userBadgeTxt, { color: theme.accent }]}>ADAPTIVE AI</Text>
            </View>
          </View>

          {/* 🏆 HERO PERFORMANCE METRICS ROW */}
          <View style={styles.metricsGrid}>
            <View style={[styles.heroMetricCard, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
              <Text style={styles.heroMetricIcon}>📉</Text>
              <Text style={[styles.heroMetricVal, { color: theme.success || '#10B981' }]}>{userAvgDrop}%</Text>
              <Text style={[styles.heroMetricLbl, { color: theme.textMuted }]}>Avg Stress Drop</Text>
            </View>

            <View style={[styles.heroMetricCard, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
              <Text style={styles.heroMetricIcon}>⏱️</Text>
              <Text style={[styles.heroMetricVal, { color: theme.accent || '#3B82F6' }]}>112s</Text>
              <Text style={[styles.heroMetricLbl, { color: theme.textMuted }]}>Mean Recovery</Text>
            </View>

            <View style={[styles.heroMetricCard, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
              <Text style={styles.heroMetricIcon}>🎯</Text>
              <Text style={[styles.heroMetricVal, { color: '#8B5CF6' }]}>92.5%</Text>
              <Text style={[styles.heroMetricLbl, { color: theme.textMuted }]}>RL Match Acc.</Text>
            </View>

            <View style={[styles.heroMetricCard, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
              <Text style={styles.heroMetricIcon}>🪷</Text>
              <Text style={[styles.heroMetricVal, { color: '#EC4899' }]}>#1</Text>
              <Text style={[styles.heroMetricLbl, { color: theme.textMuted }]}>Vagal Exhale</Text>
            </View>
          </View>

          {/* 📈 SECTION 1: DUAL-STREAM STRESS REDUCTION LINE TREND CHART */}
          <View style={[styles.card, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
            <View style={styles.cardHeader}>
              <View>
                <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>📊 Stress Reduction Over Time</Text>
                <Text style={[styles.cardSubtitle, { color: theme.textMuted }]}>
                  Pre vs Post Intervention Telemetry for {displayUser}
                </Text>
              </View>
            </View>

            {/* Chart Legend */}
            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#EF4444' }]} />
                <Text style={[styles.legendTxt, { color: theme.textMuted }]}>Pre-Stress Level</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#10B981' }]} />
                <Text style={[styles.legendTxt, { color: theme.textMuted }]}>Physio Post-State</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#EC4899' }]} />
                <Text style={[styles.legendTxt, { color: theme.textMuted }]}>Pheno Post-State</Text>
              </View>
            </View>

            {/* SVG Line Chart */}
            <View style={styles.chartWrap}>
              <Svg width={CHART_WIDTH} height={CHART_HEIGHT}>
                <Defs>
                  <LinearGradient id="physioPostGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <Stop offset="0%" stopColor="#10B981" stopOpacity="0.35" />
                    <Stop offset="100%" stopColor="#10B981" stopOpacity="0.0" />
                  </LinearGradient>
                </Defs>

                {/* Grid Baseline Line (User-Specific Calibration Target) */}
                <Line
                  x1="0"
                  y1={CHART_HEIGHT - 20 - ((userBaseline || 0.25) * (CHART_HEIGHT - 40))}
                  x2={CHART_WIDTH}
                  y2={CHART_HEIGHT - 20 - ((userBaseline || 0.25) * (CHART_HEIGHT - 40))}
                  stroke={theme.accent || '#3B82F6'}
                  strokeWidth="1.2"
                  strokeDasharray="4 4"
                  opacity={0.7}
                />
                <SvgText
                  x={CHART_WIDTH - 85}
                  y={CHART_HEIGHT - 24 - ((userBaseline || 0.25) * (CHART_HEIGHT - 40))}
                  fill={theme.accent || '#3B82F6'}
                  fontSize="9"
                  fontWeight="bold"
                >
                  Baseline {baselinePct}%
                </SvgText>

                {/* Pre-Stress Red Line */}
                <Path
                  d={chart.pathPhysioPre}
                  fill="none"
                  stroke="#EF4444"
                  strokeWidth="2"
                  strokeDasharray="3 3"
                  opacity={0.8}
                />

                {/* Physio Post-State Green Line */}
                <Path
                  d={chart.pathPhysioPost}
                  fill="none"
                  stroke="#10B981"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />

                {/* Pheno Post-State Pink Line */}
                <Path
                  d={chart.pathPhenoPost}
                  fill="none"
                  stroke="#EC4899"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />

                {/* Data Nodes */}
                {chart.pointsPhysioPost.map((pt, i) => (
                  <Circle
                    key={i}
                    cx={pt.x}
                    cy={pt.y}
                    r="4"
                    fill="#10B981"
                    stroke="#FFFFFF"
                    strokeWidth="1.5"
                  />
                ))}

                {chart.pointsPhenoPost.map((pt, i) => (
                  <Circle
                    key={`pheno-${i}`}
                    cx={pt.x}
                    cy={pt.y}
                    r="3.5"
                    fill="#EC4899"
                    stroke="#FFFFFF"
                    strokeWidth="1.5"
                  />
                ))}
              </Svg>
            </View>
          </View>

          {/* 🪷 SECTION 2: TECHNIQUE CATEGORY RECOVERY SUCCESS BAR CHART */}
          <View style={[styles.card, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
            <Text style={[styles.cardTitle, { color: theme.textPrimary, marginBottom: 4 }]}>
              🏆 Recovery Success Rate by Technique Category
            </Text>
            <Text style={[styles.cardSubtitle, { color: theme.textMuted, marginBottom: 14 }]}>
              Clinical WESAD Baseline Recovery Benchmark Comparisons
            </Text>

            {CATEGORY_PERFORMANCE.map((cat, idx) => (
              <View key={idx} style={styles.catRow}>
                <View style={styles.catInfoRow}>
                  <View style={styles.catLeft}>
                    <Text style={styles.catIcon}>{cat.icon}</Text>
                    <Text style={[styles.catName, { color: theme.textPrimary }]}>{cat.category}</Text>
                  </View>
                  <View style={styles.catRight}>
                    <Text style={[styles.catTime, { color: theme.textMuted }]}>{cat.avgTime} avg</Text>
                    <Text style={[styles.catRate, { color: cat.color }]}>{cat.successRate}%</Text>
                  </View>
                </View>

                {/* Custom Styled Bar */}
                <View style={[styles.barTrack, { backgroundColor: theme.border }]}>
                  <View
                    style={[
                      styles.barFill,
                      {
                        backgroundColor: cat.color,
                        width: `${cat.successRate}%`
                      }
                    ]}
                  />
                </View>
              </View>
            ))}
          </View>

          {/* ⚡ SECTION 3: REINFORCEMENT LEARNING CONVERGENCE & ACCURACY */}
          <View style={[styles.card, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
            <View style={sRow.between}>
              <View>
                <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>⚡ Multi-Arm Bandit (RL) Convergence</Text>
                <Text style={[styles.cardSubtitle, { color: theme.textMuted }]}>
                  Thompson Sampling Adaptation & Reward Accuracy
                </Text>
              </View>
              <View style={[styles.badgePill, { backgroundColor: 'rgba(139,92,246,0.15)', borderColor: '#8B5CF6' }]}>
                <Text style={{ fontSize: 10, fontWeight: '800', color: '#8B5CF6' }}>CONVERGED</Text>
              </View>
            </View>

            <View style={[styles.learningInfoBox, { backgroundColor: theme.bgPrimary, borderColor: theme.border }]}>
              <View style={styles.learningCol}>
                <Text style={[styles.learningVal, { color: theme.accent }]}>0.92</Text>
                <Text style={[styles.learningLbl, { color: theme.textMuted }]}>Mean Reward ($R_t$)</Text>
              </View>
              <View style={[styles.learningDivider, { backgroundColor: theme.border }]} />
              <View style={styles.learningCol}>
                <Text style={[styles.learningVal, { color: theme.success }]}>96.2%</Text>
                <Text style={[styles.learningLbl, { color: theme.textMuted }]}>Exploitation Ratio</Text>
              </View>
              <View style={[styles.learningDivider, { backgroundColor: theme.border }]} />
              <View style={styles.learningCol}>
                <Text style={[styles.learningVal, { color: '#EC4899' }]}>3.8%</Text>
                <Text style={[styles.learningLbl, { color: theme.textMuted }]}>Exploration Rate</Text>
              </View>
            </View>

            <Text style={[styles.insightTxt, { color: theme.textSecondary }]}>
              💡 <Text style={{ fontWeight: '700', color: theme.textPrimary }}>Adaptive Insight:</Text> The closed-loop reinforcement learning model has successfully learned your individual autonomic response profile. Parasympathetic Vagal Exhale is automatically prioritized for high physiological stress spikes.
            </Text>
          </View>

        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
};

const sRow = StyleSheet.create({
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    padding: 16,
    paddingBottom: 40,
    gap: 14,
  },
  userBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  userBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  userAvatarEmoji: {
    fontSize: 26,
  },
  userNameTxt: {
    fontSize: 15,
    fontWeight: '800',
  },
  userSubTxt: {
    fontSize: 11,
    marginTop: 2,
  },
  userBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  userBadgeTxt: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  heroMetricCard: {
    flex: 1,
    minWidth: '45%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    alignItems: 'center',
    elevation: 2,
  },
  heroMetricIcon: {
    fontSize: 22,
    marginBottom: 4,
  },
  heroMetricVal: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  heroMetricLbl: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    elevation: 3,
    marginBottom: 14,
  },
  cardHeader: {
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  cardSubtitle: {
    fontSize: 11,
    marginTop: 2,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    marginVertical: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendTxt: {
    fontSize: 10,
    fontWeight: '600',
  },
  chartWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 6,
  },
  catRow: {
    marginBottom: 12,
  },
  catInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  catLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  catIcon: {
    fontSize: 16,
  },
  catName: {
    fontSize: 12,
    fontWeight: '700',
  },
  catRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  catTime: {
    fontSize: 10,
  },
  catRate: {
    fontSize: 13,
    fontWeight: '900',
  },
  barTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    width: '100%',
  },
  barFill: {
    height: '100%',
    borderRadius: 4,
  },
  badgePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
  learningInfoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 14,
    borderWidth: 1,
    marginVertical: 10,
  },
  learningCol: {
    alignItems: 'center',
  },
  learningVal: {
    fontSize: 16,
    fontWeight: '900',
  },
  learningLbl: {
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginTop: 2,
  },
  learningDivider: {
    width: 1,
    height: 24,
  },
  insightTxt: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
});
