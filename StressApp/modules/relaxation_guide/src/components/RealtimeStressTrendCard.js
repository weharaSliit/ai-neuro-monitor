import { getContentWidth } from '../../../shared/theme/layout';
import React, { useContext, useRef, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing, TouchableOpacity, Platform } from 'react-native';
import Svg, { Path, Circle, Line, Defs, LinearGradient, Stop } from 'react-native-svg';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { scaleSeries } from '../utils/trend';

export const RealtimeStressTrendCard = () => {
  const {
    userId,
    username,
    stressProbability = 0.15,
    stressTrendHistory = [],
    stressState = 'normal',
    hasLivePacket = false,
    // Phenotyping state from AppContext
    phenoSensorEnabled = false,
    phenoCalibStatus = { dayNumber: 6, displayDays: 'Day 6 of 7', progressPct: 86, title: 'Calibrating baseline', isCalibrated: false },
    phenoStressLabel = 'normal',
    phenoStressProbability = 0.15,
    hasLivePhenoPacket = false,
    phenoTrendHistory = [],
    phenoLastUpdateMs = null,
    openPhenoSensorSettings,
    markPhenoCalibrated,
    resetPhenoCalibration,
  } = useContext(AppContext);
  const { theme } = useContext(ThemeContext);

  const [activeTab, setActiveTab] = useState('pheno'); // Default to pheno or active

  // Phenotyping predictions arrive when a behaviour window is processed (not every 2 s), so show their age.
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);
  const phenoAgeText = (() => {
    if (!phenoLastUpdateMs) return null;
    const sec = Math.max(0, Math.round((nowMs - phenoLastUpdateMs) / 1000));
    if (sec < 90) return `updated ${sec}s ago`;
    if (sec < 5400) return `updated ${Math.round(sec / 60)} min ago`;
    return `updated ${Math.round(sec / 3600)} h ago`;
  })();
  const displayName = username ? (username.charAt(0).toUpperCase() + username.slice(1)) : (phenoCalibStatus?.userName || userId || 'You');

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

  // Physio metrics (Smart Ring + Earbud)
  const isPhysioLive = !!hasLivePacket;
  const physioBadgeText = isPhysioLive ? 'LIVE 2s' : 'AWAITING';
  const physioStatusColor = isPhysioLive ? (theme.success || '#10B981') : (theme.warning || '#F59E0B');
  const physioHistory = stressTrendHistory && stressTrendHistory.length > 0 ? stressTrendHistory : [stressProbability];

  // Pheno metrics (Smartphone Behavioral Data)
  const isPhenoCalibrated = !!phenoCalibStatus?.isCalibrated;
  let phenoBadgeText = 'SENSOR OFF';
  let phenoStatusColor = theme.danger || '#EF4444';

  if (!phenoSensorEnabled) {
    phenoBadgeText = 'SENSOR OFF';
    phenoStatusColor = theme.danger || '#EF4444';
  } else if (!isPhenoCalibrated) {
    phenoBadgeText = 'CALIBRATING';
    phenoStatusColor = '#0EA5E9'; // Sky blue for 7-day calibration
  } else if (hasLivePhenoPacket) {
    phenoBadgeText = 'LIVE';
    phenoStatusColor = theme.success || '#10B981';
  } else {
    phenoBadgeText = 'AWAITING LOGS';
    phenoStatusColor = theme.warning || '#F59E0B';
  }

  // The line shows stress itself: falling = stress reducing, rising = stress increasing.
  const phenoHistory = phenoTrendHistory && phenoTrendHistory.length > 0 ? phenoTrendHistory : [phenoStressProbability];

  // SVG Line Chart Dimensions
  const chartWidth = CHART_W;
  const chartHeight = 32;

  const buildChart = (dataArr, isLive) => {
    if (!dataArr || dataArr.length === 0 || !isLive) return null;
    const points = dataArr.map((val, idx) => {
      const x = (idx / Math.max(1, dataArr.length - 1)) * chartWidth;
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

  const physioChartData = buildChart(scaleSeries(physioHistory), isPhysioLive);
  const phenoChartData = buildChart(scaleSeries(phenoHistory), isPhenoCalibrated && hasLivePhenoPacket);

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
          <Text style={{ fontSize: 11, fontWeight: '700', color: activeTab === 'physio' ? '#FFFFFF' : theme.textPrimary }}>Physio Trend</Text>
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
          <Text style={{ fontSize: 11, fontWeight: '700', color: activeTab === 'pheno' ? '#FFFFFF' : theme.textPrimary }}>Pheno Trend</Text>
        </TouchableOpacity>
      </View>

      {/* ACTIVE TAB CARD CONTENT */}
      {activeTab === 'physio' ? (
        /* 🫀 PHYSIOLOGICAL RECOVERY CARD (Fusion Engine: Ring + Earbud) */
        <View style={[styles.card, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
          <View style={styles.mainRow}>
            <View style={styles.leftInfo}>
              <View style={styles.titleRow}>
                <Animated.View style={[styles.liveDot, { backgroundColor: physioStatusColor, opacity: pulseAnim }]} />
                <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Physiological Stress Trend</Text>
                <Text style={[styles.stateBadge, { color: physioStatusColor, backgroundColor: `${physioStatusColor}1A`, borderColor: physioStatusColor }]}>
                  {physioBadgeText}
                </Text>
              </View>

              <View style={styles.metricRow}>
                <Text style={[styles.probVal, { color: physioStatusColor }]}>
                  {isPhysioLive ? stressProbability.toFixed(2) : '--'}
                </Text>
                <Text style={[styles.baseVal, { color: theme.textMuted }]}>
                  {isPhysioLive ? ' Stress score' : ' Awaiting Fusion Stream'}
                </Text>
              </View>
            </View>

            <View style={styles.chartWrap}>
              {physioChartData ? (
                <Svg width={chartWidth} height={chartHeight}>
                  <Defs>
                    <LinearGradient id="lineGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                      <Stop offset="0%" stopColor={physioStatusColor} stopOpacity="0.45" />
                      <Stop offset="100%" stopColor={physioStatusColor} stopOpacity="0.0" />
                    </LinearGradient>
                  </Defs>
                  <Path d={physioChartData.areaD} fill="url(#lineGrad)" />
                  <Path d={physioChartData.pathD} fill="none" stroke={physioStatusColor} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  {physioChartData.lastPt && (
                    <Circle cx={physioChartData.lastPt.x} cy={physioChartData.lastPt.y} r="3.5" fill={physioStatusColor} stroke="#FFFFFF" strokeWidth="1.5" />
                  )}
                </Svg>
              ) : (
                <Text style={{ fontSize: 9.5, color: theme.textMuted, fontStyle: 'italic' }}>
                  Smart ring/earbud idle
                </Text>
              )}
            </View>
          </View>
        </View>
      ) : (
        /* ⌨️ PHENOTYPING RECOVERY CARD (Smartphone Behavioral Data) */
        <View style={[styles.card, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
          <View style={styles.mainRow}>
            <View style={styles.leftInfo}>
              <View style={styles.titleRow}>
                <Animated.View style={[styles.liveDot, { backgroundColor: phenoStatusColor, opacity: pulseAnim }]} />
                <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Phenotyping Stress Trend</Text>
                <Text style={[styles.userBadge, { color: theme.accent || '#38BDF8', borderColor: `${theme.accent || '#38BDF8'}40`, backgroundColor: `${theme.accent || '#38BDF8'}14` }]}>
                  {displayName}
                </Text>
                <Text style={[styles.stateBadge, { color: phenoStatusColor, backgroundColor: `${phenoStatusColor}1A`, borderColor: phenoStatusColor }]}>
                  {phenoBadgeText}
                </Text>
              </View>

              {!phenoSensorEnabled ? (
                /* Sensor disabled: prompt user to turn on sensor */
                <TouchableOpacity activeOpacity={0.8} onPress={openPhenoSensorSettings} style={styles.metricRow}>
                  <Text style={[styles.probVal, { color: phenoStatusColor }]}>--</Text>
                  <Text style={[styles.baseVal, { color: phenoStatusColor, fontWeight: '700' }]}>
                    {' Tap to Turn On Sensor ➔'}
                  </Text>
                </TouchableOpacity>
              ) : !isPhenoCalibrated ? (
                /* 7-Day Calibration in progress with user personalization */
                <View style={{ marginTop: 2 }}>
                  <View style={styles.metricRow}>
                    <Text style={[styles.probVal, { color: phenoStatusColor }]}>
                      {phenoCalibStatus?.displayDays || 'Day 6 of 7'}
                    </Text>
                    <Text style={[styles.baseVal, { color: theme.textMuted }]}>
                      {` ${phenoCalibStatus?.title || 'Calibrating baseline'} (${phenoCalibStatus?.daysRemaining || 1}d remaining)`}
                    </Text>
                  </View>
                  {/* Visual 7-day progress bar */}
                  <View style={{ width: 150, height: 4, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 2, marginTop: 4, overflow: 'hidden' }}>
                    <View style={{ width: `${phenoCalibStatus?.progressPct || 86}%`, height: '100%', backgroundColor: phenoStatusColor, borderRadius: 2 }} />
                  </View>

                  {/* Calibration Action */}
                  {markPhenoCalibrated && (
                    <TouchableOpacity
                      onPress={markPhenoCalibrated}
                      activeOpacity={0.85}
                      style={[styles.activateCalibBtn, { borderColor: `${phenoStatusColor}60`, backgroundColor: `${phenoStatusColor}14` }]}
                    >
                      <Text style={[styles.activateCalibBtnText, { color: phenoStatusColor }]}>
                        ⚡ Complete Calibration & Activate Live AI ➔
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                /* Calibrated: Live stress recovery rate from personalized AI */
                <View style={{ marginTop: 2 }}>
                  <View style={styles.metricRow}>
                    <Text style={[styles.probVal, { color: phenoStatusColor }]}>
                      {hasLivePhenoPacket ? phenoStressProbability.toFixed(2) : '--'}
                    </Text>
                    <Text style={[styles.baseVal, { color: theme.textMuted }]}>
                      {hasLivePhenoPacket ? ` Stress score${phenoAgeText ? ' · ' + phenoAgeText : ''}` : ' Awaiting Behavioral Data'}
                    </Text>
                  </View>

                  {/* Option to toggle/reset back to calibration for review */}
                  {resetPhenoCalibration && (
                    <TouchableOpacity onPress={resetPhenoCalibration} activeOpacity={0.7} style={{ marginTop: 3 }}>
                      <Text style={{ fontSize: 9, color: theme.textMuted, textDecorationLine: 'underline' }}>
                        ↺ Revisit 7-Day Calibration Roadmap
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>

            <View style={styles.chartWrap}>
              {isPhenoCalibrated && phenoChartData ? (
                <Svg width={chartWidth} height={chartHeight}>
                  <Defs>
                    <LinearGradient id="phenoGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                      <Stop offset="0%" stopColor={phenoStatusColor} stopOpacity="0.45" />
                      <Stop offset="100%" stopColor={phenoStatusColor} stopOpacity="0.0" />
                    </LinearGradient>
                  </Defs>
                  <Path d={phenoChartData.areaD} fill="url(#phenoGrad)" />
                  <Path d={phenoChartData.pathD} fill="none" stroke={phenoStatusColor} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  {phenoChartData.lastPt && (
                    <Circle cx={phenoChartData.lastPt.x} cy={phenoChartData.lastPt.y} r="3.5" fill={phenoStatusColor} stroke="#FFFFFF" strokeWidth="1.5" />
                  )}
                </Svg>
              ) : !isPhenoCalibrated ? (
                <View style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 10, color: phenoStatusColor, fontWeight: '800' }}>
                    {`${phenoCalibStatus?.progressPct || 86}% Calibrated`}
                  </Text>
                  <Text style={{ fontSize: 9, color: theme.textMuted }}>7-day baseline</Text>
                  <Text style={{ fontSize: 8.5, color: '#38BDF8', fontWeight: '700', marginTop: 2 }}>Personalized Model</Text>
                </View>
              ) : (
                <View style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 10, color: phenoStatusColor, fontWeight: '800' }}>Personalized Model</Text>
                  <Text style={{ fontSize: 9, color: theme.textMuted }}>Streaming cadence</Text>
                </View>
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
    flex: 1,
    flexShrink: 1,
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
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
  userBadge: {
    fontSize: 8,
    fontWeight: '800',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
    borderWidth: 1,
  },
  activateCalibBtn: {
    marginTop: 5,
    paddingVertical: 3,
    paddingHorizontal: 7,
    borderRadius: 6,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  activateCalibBtnText: {
    fontSize: 9,
    fontWeight: '800',
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
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
    flexShrink: 1,
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
