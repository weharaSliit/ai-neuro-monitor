// ============================================================
// EegSummaryScreen.js
// Consumer-facing EEG detail: connection + current reading + real signal-
// quality score, calibration freshness, and a session-distribution/recent-
// activity history built straight from Firebase (there's no EEG history
// REST route -- psychological/{userId}/{sessionId} already accumulates one
// child per session, the same pattern fusion_en/{userId}/... uses). No raw
// µV charts or the 29-feature bipolar grid -- that detail lives in Admin.
// ============================================================
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import axios from 'axios';
import { ref, onValue, off, get } from 'firebase/database';
import { db } from '../firebase';
import ScreenBackground from '../../shared/ScreenBackground';
import Card from '../../shared/Card';
import StatusDot from '../../shared/StatusDot';
import Icon, { NAMES } from '../../shared/Icon';
import MoodBadge from '../../shared/MoodBadge';
import { useTheme } from '../../physiological/config/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { TASK_STATE_LABELS } from '../config/config';

const EEG_API_BASE = 'https://mindpulse-eeg.onrender.com';
const eegClient = axios.create({ baseURL: EEG_API_BASE, timeout: 45000 });

function latestWindow(windowsObj) {
  if (!windowsObj) return null;
  const keys = Object.keys(windowsObj).filter((k) => /^\d+$/.test(k));
  if (keys.length === 0) return null;
  keys.sort((a, b) => Number(a) - Number(b));
  return windowsObj[keys[keys.length - 1]];
}

function DistBar({ label, value, total, color, muted }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <View style={styles.distRow}>
      <View style={[styles.distBarBg, { backgroundColor: muted + '30' }]}>
        <View style={[styles.distBarFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <Text style={[styles.distValue, { color }]}>{value}</Text>
      <Text style={[styles.distLabel, { color: muted }]}>{label}</Text>
    </View>
  );
}

export default function EegSummaryScreen() {
  const { COLORS, theme } = useTheme();
  const { user, token } = useAuth();
  const userId = user?.userId;

  const [calib, setCalib] = useState(null);
  const [latest, setLatest] = useState(null);
  const [hasSession, setHasSession] = useState(false);
  const [sessionDist, setSessionDist] = useState({ normal: 0, stress: 0 });
  const [recentSessions, setRecentSessions] = useState([]);

  const loadCalib = useCallback(async () => {
    if (!token) return;
    try {
      const res = await eegClient.get('/calibration/status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setCalib(res.data);
    } catch {
      setCalib(null);
    }
  }, [token]);

  useEffect(() => { loadCalib(); }, [loadCalib]);

  // Watches the current live session, same pointer EegSessionScreen.js
  // used, just no raw-signal subscription -- only the derived task-state
  // label + real quality score, so this stays lightweight.
  useEffect(() => {
    if (!userId) return;
    const pointerRef = ref(db, 'psychological/current_session_id');
    let sessionRef = null;
    let sessionHandler = null;
    const pointerHandler = onValue(pointerRef, (snap) => {
      const sessionId = snap.val();
      if (sessionRef) off(sessionRef, 'value', sessionHandler);
      if (!sessionId) { setHasSession(false); setLatest(null); return; }
      sessionRef = ref(db, `psychological/${userId}/${sessionId}`);
      sessionHandler = onValue(sessionRef, (s) => {
        const data = s.val();
        setHasSession(!!data);
        setLatest(latestWindow(data));
      });
    });
    return () => {
      off(pointerRef, 'value', pointerHandler);
      if (sessionRef) off(sessionRef, 'value', sessionHandler);
    };
  }, [userId]);

  // Session history -- one-time read of every past session under this
  // user (there's no history REST route for EEG), majority-voted per
  // session same as Ring/Admin's derivation.
  useEffect(() => {
    if (!userId) return;
    get(ref(db, `psychological/${userId}`)).then((snap) => {
      const data = snap.val() || {};
      const sids = Object.keys(data).sort();
      const dist = { normal: 0, stress: 0 };
      const recents = [];
      sids.forEach((sid) => {
        const windowsObj = data[sid];
        const keys = Object.keys(windowsObj || {}).filter((k) => /^\d+$/.test(k));
        const preds = keys.map((k) => windowsObj[k]).filter((w) => w && !w.skipped && w.task_state_label !== undefined);
        if (preds.length === 0) return;
        const stressCount = preds.filter((w) => w.task_state_label === 1).length;
        const majority = stressCount > preds.length / 2 ? 1 : 0;
        if (majority === 1) dist.stress++; else dist.normal++;
        recents.push({ sid, label: majority, windowCount: preds.length, last: preds[preds.length - 1] });
      });
      setSessionDist(dist);
      setRecentSessions(recents.slice(-5).reverse());
    }).catch(() => {});
  }, [userId, hasSession]);

  const t = theme;
  const calibrated = calib?.exists;
  const calibColor = calibrated ? COLORS.normal : COLORS.warning;
  const label = latest?.task_state_label;
  const stateColor = label !== undefined && label !== null ? (label === 1 ? COLORS.stress : COLORS.normal) : COLORS.brand;
  const qualityScore = latest?.eeg_quality_score;
  const qualityTrusted = latest?.eeg_quality_flag;

  return (
    <ScreenBackground>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Icon name={NAMES.eeg} size={26} color={COLORS.warning} />
          <View style={{ marginLeft: 10 }}>
            <Text style={[styles.title, { color: t.text }]}>EEG Headband</Text>
            <Text style={[styles.subtitle, { color: t.textMuted }]}>Connection, signal quality & calibration</Text>
          </View>
        </View>

        <Card accentColor={hasSession ? COLORS.normal : COLORS.stress} elevated>
          <View style={styles.rowBetween}>
            <View style={styles.rowGap}>
              <Icon name={NAMES.device} size={18} color={hasSession ? COLORS.normal : COLORS.stress} />
              <Text style={[styles.cardTitle, { color: t.text, marginBottom: 0 }]}>Device Status</Text>
            </View>
            <StatusDot color={hasSession ? COLORS.normal : COLORS.stress} active={hasSession} size={10} />
          </View>
          <Text style={[styles.statusValue, { color: hasSession ? COLORS.normal : COLORS.stress }]}>
            {hasSession ? 'Connected' : 'Not Connected'}
          </Text>
          <Text style={[styles.cardSub, { color: t.textMuted }]}>
            {hasSession ? 'EEG headband streaming (wearable02)' : 'Put the headband on to start a session'}
          </Text>
        </Card>

        <Card accentColor={stateColor} elevated>
          <Text style={[styles.cardTitle, { color: t.text }]}>Current Reading</Text>
          {!hasSession ? (
            <Text style={[styles.stateLabel, { color: t.textMuted, fontSize: 15 }]}>
              No active session right now.
            </Text>
          ) : (
            <>
              <View style={styles.readingRow}>
                <MoodBadge stressed={label === 1} color={stateColor} size={52} />
                <Text style={[styles.stateLabel, { color: stateColor, marginLeft: 12 }]}>
                  {label !== undefined && label !== null ? TASK_STATE_LABELS[label] : 'Scoring…'}
                </Text>
              </View>
              {qualityScore !== undefined && qualityScore !== null && (
                <View style={styles.qualityRow}>
                  <Icon name={NAMES.signal} size={16} color={qualityTrusted ? COLORS.normal : COLORS.warning} />
                  <Text style={[styles.cardSub, { color: t.textMuted, marginLeft: 6 }]}>
                    Signal quality {qualityScore.toFixed(0)} · {qualityTrusted ? 'good electrode contact' : 'check electrode contact'}
                  </Text>
                </View>
              )}
            </>
          )}
        </Card>

        <Card accentColor={calibColor}>
          <View style={styles.rowBetween}>
            <Text style={[styles.cardTitle, { color: t.text, marginBottom: 0 }]}>Calibration</Text>
            <Icon name={NAMES.calibration} size={18} color={calibColor} />
          </View>
          <Text style={[styles.cardSub, { color: t.textMuted, marginTop: 6 }]}>
            {calibrated
              ? `Last calibrated ${Math.floor(calib.age_days ?? 0)} days ago.`
              : 'Calibrates automatically in the first ~75s of a session — just wear the headband.'}
          </Text>
        </Card>

        {(sessionDist.normal + sessionDist.stress) > 0 && (
          <Card>
            <Text style={[styles.cardTitle, { color: t.text }]}>Session History</Text>
            <DistBar label="Low Load" value={sessionDist.normal} total={sessionDist.normal + sessionDist.stress} color={COLORS.normal} muted={t.textMuted} />
            <DistBar label="High Load" value={sessionDist.stress} total={sessionDist.normal + sessionDist.stress} color={COLORS.stress} muted={t.textMuted} />
          </Card>
        )}

        {recentSessions.length > 0 && (
          <Card>
            <Text style={[styles.cardTitle, { color: t.text }]}>Recent Sessions</Text>
            {recentSessions.map((s, i) => {
              const color = s.label === 1 ? COLORS.stress : COLORS.normal;
              return (
                <View key={s.sid} style={[styles.activityRow, i === recentSessions.length - 1 && { borderBottomWidth: 0 }, { borderBottomColor: t.border }]}>
                  <MoodBadge stressed={s.label === 1} color={color} size={32} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={[styles.activityLabel, { color: t.text }]}>{TASK_STATE_LABELS[s.label]}</Text>
                    <Text style={[styles.activitySub, { color: t.textMuted }]}>{s.windowCount} windows</Text>
                  </View>
                </View>
              );
            })}
          </Card>
        )}
      </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 22, fontWeight: '900' },
  subtitle: { fontSize: 12, marginTop: 2 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '800' },
  cardSub: { fontSize: 12 },
  statusValue: { fontSize: 18, fontWeight: '900', marginTop: 8 },
  stateLabel: { fontSize: 18, fontWeight: '900' },
  readingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  qualityRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  distBarBg: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  distBarFill: { height: 8, borderRadius: 4 },
  distValue: { width: 22, fontSize: 13, fontWeight: '800', textAlign: 'right' },
  distLabel: { width: 65, fontSize: 11 },
  activityRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1 },
  activityLabel: { fontSize: 13, fontWeight: '700' },
  activitySub: { fontSize: 11, marginTop: 1 },
});
