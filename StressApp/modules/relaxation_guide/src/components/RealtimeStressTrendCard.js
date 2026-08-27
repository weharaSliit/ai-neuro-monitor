import React, { useContext, useRef, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing, TouchableOpacity } from 'react-native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';

export const RealtimeStressTrendCard = () => {
  const {
    stressProbability = 0.15,
    stressTrendHistory = [],
    userBaseline = 0.35,
    stressState = 'normal',
    hasLivePacket = true,
    currentScreen
  } = useContext(AppContext);
  const { theme } = useContext(ThemeContext);

  const [isExpanded, setIsExpanded] = useState(false);

  // Pulse animation for live status dot
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.3, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.0, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();
  }, []);

  // Calculate live trend metrics
  const currentPct = (stressProbability * 100).toFixed(1);
  const history = stressTrendHistory.length > 0 ? stressTrendHistory : [stressProbability];
  const initialPct = (history[0] * 100).toFixed(1);
  const diffPct = (currentPct - initialPct).toFixed(1);
  const isReducing = diffPct < 0;

  const hasBaseline = typeof userBaseline === 'number' && userBaseline > 0;
  const baselinePct = hasBaseline ? (userBaseline * 100).toFixed(1) : null;
  const isAtBaseline = hasLivePacket && hasBaseline && (stressProbability <= userBaseline);

  const statusColor = !hasLivePacket
    ? theme.textMuted
    : isAtBaseline
    ? theme.success
    : stressProbability > 0.70
    ? theme.danger
    : theme.warning;

  // Screens that default to compact mode to keep full space for interactive elements
  const compactScreens = ['GamePlayer', 'Rating', 'Recovery', 'UserProfile'];
  const showCompact = !isExpanded && compactScreens.includes(currentScreen);

  return (
    <View style={[
      styles.container,
      { backgroundColor: theme.bgSecondary, borderColor: theme.border },
      showCompact && styles.compactContainer
    ]}>
      {/* Header / Main Row (Tap to expand/collapse) */}
      <TouchableOpacity
        style={styles.headerRow}
        onPress={() => setIsExpanded(prev => !prev)}
        activeOpacity={0.8}
      >
        <View style={styles.titleWrap}>
          <Text style={styles.headerIcon}>📈</Text>
          <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>Live Recovery Card</Text>
          <View style={[styles.liveBadge, { backgroundColor: hasLivePacket ? statusColor + '20' : theme.warning + '20', borderColor: hasLivePacket ? statusColor : theme.warning }]}>
            <Animated.View style={[styles.liveDot, { backgroundColor: hasLivePacket ? statusColor : theme.warning, opacity: pulseAnim }]} />
            <Text style={[styles.liveText, { color: hasLivePacket ? statusColor : theme.warning }]}>
              {hasLivePacket ? 'LIVE 2s' : 'STREAM'}
            </Text>
          </View>
        </View>

        <View style={styles.rightControls}>
          {/* Quick inline metric summary */}
          <View style={styles.compactMetrics}>
            <Text style={[styles.compactVal, { color: hasLivePacket ? statusColor : theme.textMuted }]}>
              {hasLivePacket ? `${currentPct}%` : '--'}
            </Text>
            <Text style={[styles.compactBaseline, { color: theme.textMuted }]}>
              {hasBaseline ? ` / ${baselinePct}%` : ' (Waiting baseline...)'}
            </Text>
          </View>

          {/* Dynamic Delta Badge */}
          <View style={[styles.deltaBadge, { backgroundColor: hasLivePacket ? (isReducing ? theme.success + '20' : theme.danger + '20') : theme.border + '30' }]}>
            <Text style={[styles.deltaText, { color: hasLivePacket ? (isReducing ? theme.success : theme.danger) : theme.textMuted }]}>
              {hasLivePacket ? (isReducing ? `📉 ${diffPct}%` : `📈 +${diffPct}%`) : '⏳ AWAITING'}
            </Text>
          </View>

          <Text style={[styles.toggleIcon, { color: theme.textMuted }]}>
            {isExpanded ? '▲' : '▼'}
          </Text>
        </View>
      </TouchableOpacity>

      {/* Detailed Card Body (Shown when expanded or on standard screens) */}
      {(!showCompact || isExpanded) && (
        <>
          {/* Main Metrics Summary */}
          <View style={styles.metricsRow}>
            <View style={styles.metricCol}>
              <Text style={[styles.metricLabel, { color: theme.textMuted }]}>FUSED PROBABILITY</Text>
              <Text style={[styles.metricVal, { color: hasLivePacket ? statusColor : theme.textMuted }]}>
                {hasLivePacket ? `${currentPct}%` : '--'}
              </Text>
            </View>
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            <View style={styles.metricCol}>
              <Text style={[styles.metricLabel, { color: theme.textMuted }]}>TARGET BASELINE</Text>
              <Text style={[styles.metricVal, { color: hasBaseline ? theme.accent : theme.warning }]}>
                {hasBaseline ? `${baselinePct}%` : '⏳ WAITING FOR BASELINE'}
              </Text>
            </View>
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            <View style={styles.metricCol}>
              <Text style={[styles.metricLabel, { color: theme.textMuted }]}>INTERVENTION VALIDATION</Text>
              <Text style={[styles.statusTxt, { color: hasLivePacket ? statusColor : theme.textMuted }]}>
                {!hasLivePacket
                  ? '⏳ AWAITING STREAM'
                  : !hasBaseline
                  ? '⏳ WAITING FOR BASELINE'
                  : isAtBaseline
                  ? '🟢 BASELINE REACHED'
                  : isReducing
                  ? '⚡ REDUCING STRESS'
                  : '⚠️ HIGH AROUSAL'}
              </Text>
            </View>
          </View>

          {/* Real-time Sparkline Bars Chart (2s Firebase Data) */}
          <View style={styles.chartContainer}>
            {/* Dashed Baseline Reference Line */}
            {hasBaseline && (
              <View style={[styles.baselineLine, { bottom: `${Math.min(90, Math.max(10, userBaseline * 100))}%`, borderColor: theme.accent + '80' }]} pointerEvents="none">
                <Text style={[styles.baselineTag, { color: theme.accent }]}>Baseline ({baselinePct}%)</Text>
              </View>
            )}

            {/* Live Sparkline Bars */}
            <View style={styles.barsRow}>
              {history.map((val, idx) => {
                const hPct = Math.max(8, Math.min(100, val * 100));
                const barColor = val > 0.70 ? theme.danger : val >= 0.35 ? theme.warning : theme.success;
                const isLatest = idx === history.length - 1;

                return (
                  <View key={idx} style={styles.barCol}>
                    <View style={[styles.barWrapper, { backgroundColor: theme.border + '30' }]}>
                      <View
                        style={[
                          styles.barFill,
                          {
                            height: `${hPct}%`,
                            backgroundColor: hasLivePacket ? barColor : theme.border,
                            opacity: hasLivePacket ? (isLatest ? 1.0 : 0.6 + (idx / history.length) * 0.4) : 0.3,
                          }
                        ]}
                      />
                    </View>
                    <Text style={[styles.barLabel, { color: hasLivePacket ? (isLatest ? theme.textPrimary : theme.textMuted) : theme.textMuted }]}>
                      {hasLivePacket ? `${(val * 100).toFixed(0)}%` : '--'}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Footer Validation Subtext */}
          <Text style={[styles.footerText, { color: theme.textMuted }]}>
            ℹ️ {hasLivePacket ? 'Live bio-feedback validated every 2s from Firebase stream.' : 'Waiting for first live reading packet from active session...'}
          </Text>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 12,
    marginTop: 6,
    marginBottom: 4,
    borderRadius: 14,
    borderWidth: 1,
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },
  compactContainer: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    marginBottom: 2,
    marginTop: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rightControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  compactMetrics: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  compactVal: {
    fontSize: 12,
    fontWeight: '900',
  },
  compactBaseline: {
    fontSize: 10,
    fontWeight: '600',
  },
  toggleIcon: {
    fontSize: 10,
    marginLeft: 2,
  },
  titleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerIcon: {
    fontSize: 16,
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 12,
    borderWidth: 1,
    gap: 5,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  liveText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  deltaBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  deltaText: {
    fontSize: 11,
    fontWeight: '800',
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    marginBottom: 8,
  },
  metricCol: {
    flex: 1,
    alignItems: 'center',
  },
  divider: {
    width: 1,
    height: 24,
  },
  metricLabel: {
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  metricVal: {
    fontSize: 15,
    fontWeight: '900',
  },
  statusTxt: {
    fontSize: 10,
    fontWeight: '800',
  },
  chartContainer: {
    height: 70,
    width: '100%',
    justifyContent: 'flex-end',
    position: 'relative',
    marginTop: 4,
    marginBottom: 4,
  },
  baselineLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderBottomWidth: 1,
    borderStyle: 'dashed',
    zIndex: 2,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  baselineTag: {
    fontSize: 8,
    fontWeight: '800',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 4,
    borderRadius: 3,
    marginTop: -10,
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: '100%',
    width: '100%',
    paddingHorizontal: 4,
  },
  barCol: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginHorizontal: 2,
  },
  barWrapper: {
    width: '100%',
    height: '80%',
    justifyContent: 'flex-end',
    borderRadius: 4,
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    borderRadius: 4,
  },
  barLabel: {
    fontSize: 8,
    fontWeight: '700',
    marginTop: 2,
  },
  footerText: {
    fontSize: 9,
    textAlign: 'center',
    marginTop: 4,
  },
});
