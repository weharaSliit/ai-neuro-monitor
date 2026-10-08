import { getContentWidth } from '../../../shared/theme/layout';
import React, { useContext, useRef, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing, TouchableOpacity, Platform } from 'react-native';
import Svg, { Path, Circle, Line, Defs, LinearGradient, Stop } from 'react-native-svg';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';

export const RealtimeStressTrendCard = () => {
  const {
    stressProbability = 0.15,
    stressTrendHistory = [],
    stressState = 'normal',
    hasLivePacket = false,
    isCalibrated = true,
  } = useContext(AppContext);
  const { theme } = useContext(ThemeContext);

  const [activeTab, setActiveTab] = useState('physio'); // 'physio' | 'pheno'
  const [isExpanded, setIsExpanded] = useState(false);

  // Pulse animation for live status dot
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.25, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.0, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();
  }, []);

  let statusBadgeText = 'OFFLINE';
  let statusColor = theme.danger || '#EF4444';

  if (!hasLivePacket) {
    statusBadgeText = 'OFFLINE';
    statusColor = theme.danger || '#EF4444';
  } else {
    statusBadgeText = 'LIVE 2s';
    statusColor = theme.success || '#10B981';
  }

  // Calculate 2-second trend metrics for Physio
  const currentPct = (stressProbability * 100).toFixed(0);
  const history = stressTrendHistory && stressTrendHistory.length > 0 ? stressTrendHistory : [stressProbability];
  const initialPct = (history[0] * 100).toFixed(0);
  const diffPct = (currentPct - initialPct).toFixed(0);
  const isReducing = diffPct <= 0;

  // SVG Line Chart Dimensions
  // Scales with the screen instead of a fixed 110px.
  const chartWidth = CHART_W;
  const chartHeight = 32;

  const buildChart = () => {
    if (!history || history.length === 0 || !hasLivePacket) return null;
    const points = history.map((val, idx) => {
      const x = (idx / Math.max(1, history.length - 1)) * chartWidth;
      const normalizedVal = Math.max(0.05, Math.min(1.0, val));
      const y = chartHeight - (normalizedVal * (chartHeight - 10) + 5);
      return { x, y, val };
    });

    const pathD = points.reduce((acc, pt, idx) => (
      idx === 0 ? `M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}` : `${acc} L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`
    ), '');

    const areaD = `${pathD} L ${points[points.length - 1].x.toFixed(1)} ${chartHeight} L ${points[0].x.toFixed(1)} ${chartHeight} Z`;
    const lastPt = points[points.length - 1];

    return { pathD, areaD, lastPt };
  };

  const chartData = buildChart();

  return (
    <View style={{ marginHorizontal: 12, marginTop: Platform.OS === 'ios' ? 42 : 32, marginBottom: 8 }}>
      {/* Top Stream Channel Tabs */}
      <View style={{ flexDirection: 'row', gap: 6, marginBottom: 4 }}>
        <TouchableOpacity
          onPress={() => setActiveTab('physio')}
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            paddingVertical: 5,
            borderRadius: 8,
            backgroundColor: activeTab === 'physio' ? (theme.accent || '#3B82F6') : (theme.bgSecondary || 'rgba(255,255,255,0.06)'),
            borderWidth: 1,
            borderColor: activeTab === 'physio' ? (theme.accent || '#3B82F6') : theme.border,
            gap: 4,
          }}
          activeOpacity={0.8}
        >
          <Text style={{ fontSize: 11 }}>🫀</Text>
          <Text style={{ fontSize: 11, fontWeight: '700', color: activeTab === 'physio' ? '#FFFFFF' : theme.textPrimary }}>Physio Recovery</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setActiveTab('pheno')}
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            paddingVertical: 5,
            borderRadius: 8,
            backgroundColor: activeTab === 'pheno' ? (theme.accent || '#3B82F6') : (theme.bgSecondary || 'rgba(255,255,255,0.06)'),
            borderWidth: 1,
            borderColor: activeTab === 'pheno' ? (theme.accent || '#3B82F6') : theme.border,
            gap: 4,
          }}
          activeOpacity={0.8}
        >
          <Text style={{ fontSize: 11 }}>⌨️</Text>
          <Text style={{ fontSize: 11, fontWeight: '700', color: activeTab === 'pheno' ? '#FFFFFF' : theme.textPrimary }}>Pheno Recovery</Text>
        </TouchableOpacity>
      </View>

      {/* ACTIVE TAB CARD CONTENT */}
      {activeTab === 'physio' ? (
        /* 🫀 PHYSIOLOGICAL RECOVERY CARD */
        <View style={[styles.card, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
          <View style={styles.mainRow}>
            <View style={styles.leftInfo}>
              <View style={styles.titleRow}>
                <Animated.View style={[styles.liveDot, { backgroundColor: statusColor, opacity: pulseAnim }]} />
                <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Physiological Recovery</Text>
                <Text style={[styles.stateBadge, { color: statusColor, backgroundColor: `${statusColor}1A`, borderColor: statusColor }]}>
                  {statusBadgeText}
                </Text>
              </View>

              <View style={styles.metricRow}>
                <Text style={[styles.probVal, { color: statusColor }]}>
                  {hasLivePacket ? `${currentPct}%` : '--'}
                </Text>
                <Text style={[styles.baseVal, { color: theme.textMuted }]}>
                  {hasLivePacket ? ` State: ${(stressState || 'normal').toUpperCase()}` : ' Awaiting Stream'}
                </Text>
              </View>
            </View>

            <View style={styles.chartWrap}>
              {chartData && (
                <Svg width={chartWidth} height={chartHeight}>
                  <Defs>
                    <LinearGradient id="lineGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                      <Stop offset="0%" stopColor={statusColor} stopOpacity="0.45" />
                      <Stop offset="100%" stopColor={statusColor} stopOpacity="0.0" />
                    </LinearGradient>
                  </Defs>
                  <Path d={chartData.areaD} fill="url(#lineGrad)" />
                  <Path d={chartData.pathD} fill="none" stroke={statusColor} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  {chartData.lastPt && (
                    <Circle cx={chartData.lastPt.x} cy={chartData.lastPt.y} r="3.5" fill={statusColor} stroke="#FFFFFF" strokeWidth="1.5" />
                  )}
                </Svg>
              )}
            </View>
          </View>
        </View>
      ) : (
        /* ⌨️ PHENOTYPING RECOVERY CARD */
        <View style={[styles.card, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
          <View style={styles.mainRow}>
            <View style={styles.leftInfo}>
              <View style={styles.titleRow}>
                <Animated.View style={[styles.liveDot, { backgroundColor: statusColor, opacity: pulseAnim }]} />
                <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Phenotyping Recovery</Text>
                <Text style={[styles.stateBadge, { color: statusColor, backgroundColor: `${statusColor}1A`, borderColor: statusColor }]}>
                  {statusBadgeText}
                </Text>
              </View>

              <View style={styles.metricRow}>
                <Text style={[styles.probVal, { color: statusColor }]}>
                  {hasLivePacket ? `${currentPct}%` : '--'}
                </Text>
                <Text style={[styles.baseVal, { color: theme.textMuted }]}>
                  {hasLivePacket ? ` State: ${(stressState || 'normal').toUpperCase()}` : ' Awaiting Stream'}
                </Text>
              </View>
            </View>

            <View style={styles.chartWrap}>
              {chartData && (
                <Svg width={chartWidth} height={chartHeight}>
                  <Defs>
                    <LinearGradient id="phenoGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                      <Stop offset="0%" stopColor={statusColor} stopOpacity="0.45" />
                      <Stop offset="100%" stopColor={statusColor} stopOpacity="0.0" />
                    </LinearGradient>
                  </Defs>
                  <Path d={chartData.areaD} fill="url(#phenoGrad)" />
                  <Path d={chartData.pathD} fill="none" stroke={statusColor} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  {chartData.lastPt && (
                    <Circle cx={chartData.lastPt.x} cy={chartData.lastPt.y} r="3.5" fill={statusColor} stroke="#FFFFFF" strokeWidth="1.5" />
                  )}
                </Svg>
              )}
            </View>
          </View>
        </View>
      )}
    </View>
  );
};

const CHART_W = Math.round(Math.min(200, Math.max(110, getContentWidth() * 0.3)));
const styles = StyleSheet.create({
  card: {
    marginHorizontal: 0,
    marginVertical: 2,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    elevation: 3,
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  leftInfo: {
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  cardTitle: {
    fontSize: 11,
    fontWeight: '800',
  },
  stateBadge: {
    fontSize: 8,
    fontWeight: '800',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
    borderWidth: 1,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 2,
  },
  probVal: {
    fontSize: 14,
    fontWeight: '900',
  },
  baseVal: {
    fontSize: 9,
    fontWeight: '600',
    marginLeft: 3,
  },
  chartWrap: {
    height: 34,
    width: CHART_W + 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
  },
  rightWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  deltaBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  deltaTxt: {
    fontSize: 10,
    fontWeight: '800',
  },
  chevron: {
    fontSize: 9,
    marginLeft: 2,
  },
  expandedBox: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
  },
  detailsTxt: {
    fontSize: 10,
    lineHeight: 14,
  },
});
