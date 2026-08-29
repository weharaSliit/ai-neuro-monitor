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
import { ref, onValue, off, get } from 'firebase/database';
import { db } from '../firebase';
import ScreenBackground from '../../shared/ScreenBackground';
import Card from '../../shared/Card';
import StatusDot from '../../shared/StatusDot';
import Icon, { NAMES } from '../../shared/Icon';
import MoodBadge from '../../shared/MoodBadge';
import { useTheme } from '../../physiological/config/ThemeContext';
import { COLORS } from '../../physiological/config/theme';
import { useAuth } from '../../../context/AuthContext';
import { TASK_STATE_LABELS } from '../config/config';

// live_raw is overwritten roughly every 1s while wearable02 is genuinely
// streaming (backend/psychological/mqtt_bridge.py's _post_live_raw()) --
// 10s gives generous margin for jitter/a slow poll cycle while still
// flipping "connected" off promptly once the device actually drops,
// rather than staying stuck at whatever the last successful write said.
const LIVE_RAW_STALE_SEC = 10;

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
      <Text style={[styles.distVal, { color }]}>{value} ({pct.toFixed(0)}%)</Text>
    </View>
  );
}

export default function EegSummaryScreen() {
  const { theme, COLORS } = useTheme();
  const { user } = useAuth();
  const userId = user?.userId;

  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [hasSession, setHasSession] = useState(false);
  const [sessionWindows, setSessionWindows] = useState(null);
  const [recentSessions, setRecentSessions] = useState([]);
  const [sessionDist, setSessionDist] = useState({ normal: 0, stress: 0 });

  useEffect(() => {
    if (!userId) return;
    const pRef = ref(db, 'psychological/current_session_id');
    const h = onValue(pRef, (snap) => {
      setCurrentSessionId(snap.val() || null);
    });
    return () => off(pRef, 'value', h);
  }, [userId]);

  // hasSession reflects whether wearable02 is genuinely streaming right
  // now. The session pointer alone isn't enough -- it's never cleared, so
  // it stays truthy forever once any session has existed. live_raw's own
  // existence isn't enough either -- it's overwritten in place, so once
  // written it stays "there" even after the device goes offline for the
  // rest of that session. Only the write's own timestamp actually tells
  // you whether it's still live -- recomputed on an interval since a
  // Firebase listener alone won't notice time passing with no new writes.
  const [lastRawTs, setLastRawTs] = useState(null);

  useEffect(() => {
    if (!userId || !currentSessionId) {
      setLastRawTs(null);
      return;
    }
    const rawRef = ref(db, `psychological/${userId}/${currentSessionId}/live_raw`);
    const h = onValue(rawRef, (snap) => setLastRawTs(snap.val()?.timestamp ?? null));
    return () => off(rawRef, 'value', h);
  }, [userId, currentSessionId]);

  useEffect(() => {
    const evaluate = () => {
      setHasSession(lastRawTs != null && (Date.now() / 1000 - lastRawTs) < LIVE_RAW_STALE_SEC);
    };
    evaluate();
    const t = setInterval(evaluate, 3000);
    return () => clearInterval(t);
  }, [lastRawTs]);

  useEffect(() => {
    if (!userId || !currentSessionId) {
      setSessionWindows(null);
      return;
    }
    const sRef = ref(db, `psychological/${userId}/${currentSessionId}`);
    const h = onValue(sRef, (snap) => setSessionWindows(snap.val()));
    return () => off(sRef, 'value', h);
  }, [userId, currentSessionId]);

  const latest = latestWindow(sessionWindows);

  useEffect(() => {
    if (!userId) return;
    const userRef = ref(db, `psychological/${userId}`);
    get(userRef).then((snap) => {
      const all = snap.val() || {};
      const sids = Object.keys(all);
      let nNorm = 0;
      let nStress = 0;
      const recents = [];
      sids.forEach((sid) => {
        const sObj = all[sid];
        if (!sObj || typeof sObj !== 'object') return;
        const keys = Object.keys(sObj).filter((k) => /^\d+$/.test(k));
        if (!keys.length) return;
        keys.sort((a, b) => Number(a) - Number(b));
        const lastW = sObj[keys[keys.length - 1]];
        if (lastW?.task_state_label === 1) nStress++;
        else if (lastW?.task_state_label === 0) nNorm++;
        recents.push({
          sid,
          label: lastW?.task_state_label,
          windowCount: keys.length,
        });
      });
      setSessionDist({ normal: nNorm, stress: nStress });
      setRecentSessions(recents.slice(-5).reverse());
    }).catch(() => {});
  }, [userId, hasSession]);

  const t = theme;
  const qualityScore = latest?.eeg_quality_score;
  const qualityTrusted = latest?.eeg_quality_flag;

  return (
    <ScreenBackground>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Device Status */}
        <Card accentColor={hasSession ? COLORS.normal : COLORS.warning} elevated style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={styles.rowGap}>
              <Icon name={NAMES.device} size={18} color={hasSession ? COLORS.normal : COLORS.warning} />
              <Text style={[styles.cardTitle, { color: t.text, marginBottom: 0 }]}>Headband Telemetry</Text>
            </View>
            <View style={[styles.statusPill, { backgroundColor: hasSession ? COLORS.normalSoft : COLORS.warningSoft }]}>
              <StatusDot color={hasSession ? COLORS.normal : COLORS.warning} active={hasSession} size={8} />
              <Text style={[styles.statusPillText, { color: hasSession ? COLORS.normalDark : COLORS.warningDark }]}>
                {hasSession ? 'Streaming' : 'Standby'}
              </Text>
            </View>
          </View>
          <Text style={[styles.cardSub, { color: t.textMuted, marginTop: 10 }]}>
            {hasSession ? 'EEG headband actively streaming neural channels (wearable02)' : 'Put on the headband to begin measuring mental workload'}
          </Text>
        </Card>

        {/* Current State & Quality */}
        {hasSession && qualityScore !== undefined && qualityScore !== null && (
          <Card accentColor={qualityTrusted ? COLORS.normal : COLORS.warning} elevated style={styles.card}>
            <Text style={[styles.cardTitle, { color: t.text, marginBottom: 8 }]}>Electrode Contact Quality</Text>
            <View style={[styles.qualityBox, { backgroundColor: qualityTrusted ? COLORS.normalSoft : COLORS.warningSoft }]}>
              <Icon name={NAMES.signal} size={18} color={qualityTrusted ? COLORS.normalDark : COLORS.warningDark} />
              <Text style={[styles.qualityText, { color: qualityTrusted ? COLORS.normalDark : COLORS.warningDark }]}>
                Electrode Contact Quality: {qualityScore.toFixed(0)}% · {qualityTrusted ? 'Optimal Signal' : 'Adjust Placement'}
              </Text>
            </View>
          </Card>
        )}

        {/* Session Distribution */}
        {(sessionDist.normal + sessionDist.stress) > 0 && (
          <Card style={styles.card}>
            <Text style={[styles.cardTitle, { color: t.text, marginBottom: 6 }]}>Session Distribution</Text>
            <DistBar label="Low Load" value={sessionDist.normal} total={sessionDist.normal + sessionDist.stress} color={COLORS.normal} muted={t.textMuted} />
            <DistBar label="High Load" value={sessionDist.stress} total={sessionDist.normal + sessionDist.stress} color={COLORS.stress} muted={t.textMuted} />
          </Card>
        )}

        {/* Recent Sessions */}
        {recentSessions.length > 0 && (
          <Card style={styles.card}>
            <Text style={[styles.cardTitle, { color: t.text, marginBottom: 6 }]}>Recent Sessions</Text>
            {recentSessions.map((s, i) => {
              const color = s.label === 1 ? COLORS.stress : COLORS.normal;
              return (
                <View key={s.sid} style={[styles.activityRow, i === recentSessions.length - 1 && { borderBottomWidth: 0 }, { borderBottomColor: t.border }]}>
                  <MoodBadge stressed={s.label === 1} color={color} size={36} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[styles.activityLabel, { color: t.text }]}>{TASK_STATE_LABELS[s.label]}</Text>
                    <Text style={[styles.activitySub, { color: t.textMuted }]}>{s.windowCount} windows captured</Text>
                  </View>
                  <View style={[styles.windowBadge, { backgroundColor: color + '15' }]}>
                    <Text style={[styles.windowBadgeText, { color }]}>{s.label === 1 ? 'High' : 'Low'}</Text>
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
  scroll: { paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  headerIconCircle: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '900', letterSpacing: -0.2 },
  subtitle: { fontSize: 12, marginTop: 2 },
  card: { marginHorizontal: 20, marginVertical: 8, padding: 18, borderRadius: 22 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '800' },
  cardSub: { fontSize: 12 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusPillText: { fontSize: 11, fontWeight: '800' },
  stateLabel: { fontSize: 19, fontWeight: '900', letterSpacing: -0.2 },
  readingSub: { fontSize: 12, marginTop: 2 },
  waitingBlock: { paddingVertical: 10 },
  readingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  qualityBox: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 14, marginTop: 14 },
  qualityText: { fontSize: 12, fontWeight: '700' },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  distBarBg: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  distBarFill: { height: 8, borderRadius: 4 },
  distVal: { fontSize: 12, fontWeight: '800', minWidth: 60, textAlign: 'right' },
  distValue: { width: 22, fontSize: 13, fontWeight: '800', textAlign: 'right' },
  distLabel: { width: 65, fontSize: 11, fontWeight: '600' },
  activityRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1 },
  activityLabel: { fontSize: 13, fontWeight: '700' },
  activitySub: { fontSize: 11, marginTop: 1 },
  windowBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  windowBadgeText: { fontSize: 11, fontWeight: '700' },
});

