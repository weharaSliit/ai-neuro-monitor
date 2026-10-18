// ============================================================
// SimulatedBanner.js — "SIMULATED DATA" strip on the session screen.
// App twin of psy_web/src/components/StimulatorBanner.jsx (short form).
//
// Read-only: listens to stimulator/status, which only
// backend/simulation/live_stimulator.py writes. Renders nothing unless the
// stimulator is online, running, and streaming for this user, so real
// sessions look exactly as before.
// ============================================================
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ref, onValue } from 'firebase/database';
import { db } from '../fusion/firebase';
import { COLORS } from '../physiological/config/theme';
import { TYPE, SPACE, RADIUS } from './theme/tokens';

const ONLINE_SEC = 20; // same heartbeat window as psy_web useStimulator

const PHASE_TEXT = {
  settle: 'Calibration 1/4 · settling',
  rest: 'Calibration 2/4 · resting baseline',
  task: 'Calibration 3/4 · high-load task',
  recovery: 'Calibration 4/4 · recovery rest',
  calm: 'Live · calm',
  demand: 'Live · demand period',
};

export default function SimulatedBanner({ userId, sessionId }) {
  const [status, setStatus] = useState(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => onValue(ref(db, 'stimulator/status'),
    (s) => setStatus(s.val()), () => setStatus(null)), []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const online = Boolean(status?.online && status?.ts && now / 1000 - status.ts < ONLINE_SEC);
  if (!online || !status.running) return null;
  if (userId && status.uid && status.uid !== userId) return null;
  if (sessionId && status.sid && status.sid !== sessionId) return null;

  const phase = status.phase || (status.stage || '').replace('live: ', '');
  const demandOn = status.demand >= 0.5 || status.body_demand >= 0.5;

  return (
    <View style={[styles.wrap, demandOn && styles.wrapTask]} accessibilityRole="alert">
      <View style={styles.row}>
        <Text style={styles.badge}>SIMULATED DATA</Text>
        <Text style={styles.phase}>{PHASE_TEXT[phase] || phase}</Text>
      </View>
      <Text style={styles.body}>
        A virtual person is streaming through the real pipeline, not your devices.
        {demandOn ? ' Simulated demand is ON.' : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: SPACE.md,
    padding: SPACE.md,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.warningSoft,
    borderWidth: 1,
    borderColor: COLORS.warning,
  },
  wrapTask: { backgroundColor: COLORS.stressSoft, borderColor: COLORS.stress },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  badge: {
    ...TYPE.micro,
    color: '#fff',
    backgroundColor: COLORS.warningDark,
    paddingHorizontal: SPACE.sm,
    paddingVertical: 2,
    borderRadius: RADIUS.sm,
    overflow: 'hidden',
    marginRight: SPACE.sm,
  },
  phase: { ...TYPE.subtitle, color: COLORS.warningDark },
  body: { ...TYPE.body, color: COLORS.warningDark, marginTop: SPACE.xs },
});
