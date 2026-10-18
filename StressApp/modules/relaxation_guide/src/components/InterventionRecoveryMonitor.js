import React, { useContext } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { scaleSeries } from '../utils/trend';

// Plots stress itself: a falling line means stress is reducing.
const getPoints = (history) => {
  const scaled = scaleSeries(history);
  return scaled.map((value, index) => {
    const x = scaled.length > 1 ? (index / (scaled.length - 1)) * 96 + 2 : 50;
    const y = 28 - value * 24;
    return `${x},${y}`;
  });
};

const RecoveryStream = ({ title, color, stressLabel, stressScore, history, isLive }) => {
  const points = getPoints(history);
  const point = points[points.length - 1]?.split(',').map(Number);

  return (
    <View style={styles.stream}>
      <View style={styles.streamHeading}>
        <Text style={[styles.streamTitle, { color }]} numberOfLines={1}>{title}</Text>
        <Text style={[styles.liveText, { color: isLive ? '#10B981' : '#F59E0B' }]}>
          {isLive ? 'LIVE' : 'WAIT'}
        </Text>
      </View>
      <Text style={styles.recoveryValue}>
        {isLive ? Number(stressScore).toFixed(2) : '--'}
        <Text style={styles.stressValue}>
          {isLive ? '  stress score' : '  no signal'}
        </Text>
      </Text>
      <Svg width="100%" height={30} viewBox="0 0 100 30" preserveAspectRatio="none">
        {points.length > 1 && (
          <Polyline
            points={points.join(' ')}
            fill="none"
            stroke={color}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {points.length === 1 && point && (
          <Circle cx={point[0]} cy={point[1]} r={3} fill={color} />
        )}
      </Svg>
    </View>
  );
};

export const InterventionRecoveryMonitor = () => {
  const {
    stressProbability,
    stressState,
    stressTrendHistory,
    hasLivePacket,
    phenoStressProbability,
    phenoStressLabel,
    phenoTrendHistory,
    hasLivePhenoPacket,
  } = useContext(AppContext);
  const { theme } = useContext(ThemeContext);

  return (
    <View style={[styles.card, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
      <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>LIVE RECOVERY</Text>
      <View style={styles.streams}>
        <RecoveryStream
          title="PHYSIO"
          color="#F87171"
          stressLabel={String(stressState || 'normal').toUpperCase()}
          stressScore={stressProbability}
          history={stressTrendHistory || []}
          isLive={hasLivePacket && Number.isFinite(stressProbability)}
        />
        <RecoveryStream
          title="PHENOTYPING"
          color="#38BDF8"
          stressLabel={String(phenoStressLabel || 'normal').toUpperCase()}
          stressScore={phenoStressProbability}
          history={phenoTrendHistory || []}
          isLive={hasLivePhenoPacket && Number.isFinite(phenoStressProbability)}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 10,
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderRadius: 12,
  },
  cardTitle: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 4,
  },
  streams: {
    flexDirection: 'row',
    gap: 10,
  },
  stream: {
    flex: 1,
    minWidth: 0,
  },
  streamHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  streamTitle: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  liveText: {
    fontSize: 8,
    fontWeight: '900',
  },
  recoveryValue: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '900',
    marginTop: 1,
  },
  stressValue: {
    color: '#94A3B8',
    fontSize: 8,
    fontWeight: '600',
  },
});
