import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import ScreenBackground from './ScreenBackground';
import Card from './Card';
import StatusDot from './StatusDot';
import Icon, { NAMES } from './Icon';
import LineChart from './LineChart';
import { eegClient } from './eegApiClient';
import physiologicalApi from '../physiological/api/client';
import { COLORS } from '../physiological/config/theme';
import { useAuth } from '../../context/AuthContext';

// View-only page: proves baseline + threshold calibration are actually
// progressing for both devices by polling all four status endpoints
// independently and plotting each one's block/window counter as a live
// trend. Never POSTs a /calibrate/*/start itself -- it only ever reads
// whatever capture is already running elsewhere (AccountSetupScreen's
// CalibrateBreathingCard for baseline, EegThresholdTaskScreen for
// threshold), so it's safe to open at any time without disturbing it.
const POLL_INTERVAL_MS = 2000;
const MAX_POINTS = 60;
const IN_PROGRESS_STATUSES = ['settling', 'capturing', 'window_skipped', 'saving'];

function statusMeta(status) {
  if (!status || status === 'idle') {
    return { label: 'Not started', color: COLORS.light.textMuted, active: false };
  }
  if (status === 'error') {
    return { label: 'Failed', color: COLORS.stress, active: false };
  }
  if (IN_PROGRESS_STATUSES.includes(status)) {
    const label = status === 'settling' ? 'Settling…'
      : status === 'saving' ? 'Saving…'
        : status === 'window_skipped' ? 'Capturing (window skipped)…'
          : 'Capturing…';
    return { label, color: COLORS.warning, active: true };
  }
  // Terminal, non-error states show up under different names depending on
  // the endpoint ('done', 'ok', 'not_separated', ...) -- all of them just
  // mean "capture finished".
  return { label: 'Done ✓', color: COLORS.normalDark, active: false };
}

// One poll loop per stream. `fetchFn` must be a stable (useCallback'd)
// function so the interval isn't torn down/recreated every render.
function useCalibrationPoll(fetchFn) {
  const [state, setState] = useState({ status: 'idle', points: [], total: null, message: null });
  const lastIdxRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetchFn();
        if (cancelled) return;
        const data = res.data || {};
        const idx = data.block_idx ?? data.window_idx ?? null;
        const total = data.n_blocks ?? data.n_windows ?? null;
        setState((s) => {
          const next = {
            status: data.status || 'idle',
            total: total ?? s.total,
            message: data.message || data.error || null,
            points: s.points,
          };
          if (idx != null && idx !== lastIdxRef.current) {
            lastIdxRef.current = idx;
            next.points = [...s.points, { value: idx, date: new Date().toISOString() }].slice(-MAX_POINTS);
          }
          return next;
        });
      } catch {
        // A single missed poll doesn't mean anything failed -- the next
        // tick tries again; keep showing the last-known state.
      }
    };

    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [fetchFn]);

  return state;
}

function TrendCard({ icon, iconColor, title, poll }) {
  const meta = statusMeta(poll.status);
  const latest = poll.points[poll.points.length - 1];

  return (
    <Card elevated style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <Icon name={icon} size={18} color={iconColor} />
          <Text style={styles.cardTitle}>{title}</Text>
        </View>
        <View style={styles.statusPill}>
          <StatusDot color={meta.color} active={meta.active} size={7} />
          <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>

      {poll.message ? <Text style={styles.messageText}>{poll.message}</Text> : null}

      <LineChart
        points={poll.points}
        height={110}
        maxValue={poll.total || (latest ? latest.value : 1)}
        color={iconColor}
        fallback={(
          <Text style={styles.fallbackText}>
            {meta.active ? 'Capturing… (progress detail not available yet)' : 'Not started yet'}
          </Text>
        )}
      />

      {latest && poll.total != null && (
        <Text style={styles.progressCaption}>{latest.value} / {poll.total} windows captured</Text>
      )}
    </Card>
  );
}

export default function CalibrationTrendScreen() {
  const { token } = useAuth();

  const fetchEegBaseline = useCallback(() => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    return eegClient.get('/calibrate/status', { headers });
  }, [token]);
  const fetchEegThreshold = useCallback(() => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    return eegClient.get('/calibrate/threshold/status', { headers });
  }, [token]);
  const fetchRingBaseline = useCallback(() => physiologicalApi.get('/calibrate/status'), []);
  const fetchRingThreshold = useCallback(() => physiologicalApi.get('/calibrate/threshold/status'), []);

  const eegBaseline = useCalibrationPoll(fetchEegBaseline);
  const eegThreshold = useCalibrationPoll(fetchEegThreshold);
  const ringBaseline = useCalibrationPoll(fetchRingBaseline);
  const ringThreshold = useCalibrationPoll(fetchRingThreshold);

  return (
    <ScreenBackground edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Calibration Progress</Text>
        <Text style={styles.subtitle}>
          Live trend of your baseline and personal-threshold calibration, updating every couple of
          seconds straight from each device's current capture. Keep this open alongside the
          calibration steps to watch it happen in real time.
        </Text>

        <TrendCard icon={NAMES.my} iconColor={COLORS.brand} title="Ring — Baseline" poll={ringBaseline} />
        <TrendCard icon={NAMES.eeg} iconColor={COLORS.warning} title="EEG — Baseline" poll={eegBaseline} />
        <TrendCard icon={NAMES.my} iconColor={COLORS.brand} title="Ring — Personal Threshold" poll={ringThreshold} />
        <TrendCard icon={NAMES.eeg} iconColor={COLORS.warning} title="EEG — Personal Threshold" poll={eegThreshold} />
      </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.3,
    color: COLORS.light.text,
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.light.textMuted,
    marginTop: 6,
    marginBottom: 18,
  },
  card: {
    padding: 16,
    borderRadius: 20,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.light.text,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  messageText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.stressDark,
    marginBottom: 8,
  },
  fallbackText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.light.textMuted,
    paddingVertical: 24,
    textAlign: 'center',
  },
  progressCaption: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.light.textMuted,
    marginTop: 8,
    textAlign: 'right',
  },
});
