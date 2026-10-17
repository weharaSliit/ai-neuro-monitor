import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useLivePointer, useNow } from '../hooks/useLive';
import { useFusion, useRingHistory } from '../hooks/useStreams';
import { DEFAULT_RING_THRESHOLD, timeAgo } from '../lib/levels';
import { TECHNIQUES, findTechnique } from '../lib/techniques';
import { getBanditState, getIntervention, submitRating, validateIntervention } from '../lib/relaxApi';
import { Card, CardHead, Badge } from '../components/ui';
import RelaxGame from '../components/RelaxGame';
import DailyQuests from '../components/DailyQuests';
import { QUESTS, readQuests } from '../lib/quests';

const LIVE_WINDOW_MS = 3 * 60 * 1000;
const LOG_KEY = (uid) => `mindpulse.relax.log.${uid}`;

const STATE = {
  calm:   { word: 'Calm',          line: 'You are doing well. A short exercise keeps it that way.', color: '#5E935A', icon: '😊' },
  rising: { word: 'Rising',        line: 'Stress is building a little. A short pause helps now.',    color: '#E8A238', icon: '😐' },
  high:   { word: 'Stressed',      line: 'Your body and mind are under strain. Try one of these.',   color: '#E56B4E', icon: '😟' },
  idle:   { word: 'Not connected', line: 'Connect your ring or headband for suggestions that fit the moment.', color: '#6E68B2', icon: '🔌' },
};

function readLog(uid) {
  try { return JSON.parse(localStorage.getItem(LOG_KEY(uid)) || '[]'); } catch { return []; }
}
function writeLog(uid, rows) {
  try { localStorage.setItem(LOG_KEY(uid), JSON.stringify(rows.slice(0, 30))); } catch { /* storage blocked */ }
}

export default function RelaxPage() {
  const { user, token } = useAuth();
  const userId = user?.userId;
  const now = useNow(20000);
  const pointer = useLivePointer();
  const liveSid = pointer.userId === userId ? pointer.sessionId : null;
  const fusion = useFusion(userId, liveSid);
  const ring = useRingHistory(userId, { pollMs: 15000 });

  // ── Current state (same rules as the Home page) ──
  const latest = fusion.latest;
  const ringLatest = ring.windows[ring.windows.length - 1] || null;
  const isLive = fusion.latestMs != null && now - fusion.latestMs < LIVE_WINDOW_MS;
  let stateKey = 'idle';
  if (latest) {
    if (latest.fused_label === 1) stateKey = 'high';
    else if (latest.stress_trend === 'increasing' || latest.stress_phase === 'trending_towards_stress') stateKey = 'rising';
    else stateKey = 'calm';
  } else if (ringLatest) {
    stateKey = ringLatest.label === 'Stress' ? 'high' : 'calm';
  }
  const probability = latest?.fused_probability ?? ringLatest?.prob_stress ?? null;
  const state = STATE[stateKey];

  // ── Recommendation from the Relaxation Guide service ──
  const [rec, setRec] = useState(null);
  const [recLoading, setRecLoading] = useState(false);
  const preLabel = stateKey === 'high' ? 'stress' : 'normal';
  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    setRecLoading(true);
    getIntervention(userId, token, { label: preLabel, probability: probability ?? 0.4 })
      .then((r) => { if (!cancelled) setRec(r); })
      .finally(() => { if (!cancelled) setRecLoading(false); });
    return () => { cancelled = true; };
  }, [userId, token, preLabel, probability == null ? 'n' : probability >= 0.7 ? 'h' : probability >= 0.5 ? 'm' : 'l']); // eslint-disable-line react-hooks/exhaustive-deps
  const recommended = findTechnique(rec?.technique_id) || TECHNIQUES[1];

  // ── Sessions: remembered on this device, plus what the service has learned ──
  const [log, setLog] = useState(() => readLog(userId));
  const [bandit, setBandit] = useState(null);
  useEffect(() => { setLog(readLog(userId)); }, [userId]);
  useEffect(() => {
    let cancelled = false;
    if (userId) getBanditState(userId, token).then((s) => { if (!cancelled) setBandit(s); });
    return () => { cancelled = true; };
  }, [userId, token, log.length]);

  const [active, setActive] = useState(null);
  const [questsOpen, setQuestsOpen] = useState(false);

  const finish = useCallback(async ({ stars, better, postState, postArousal, susScore }) => {
    const t = active;
    const postLabel = postState || (better ? 'normal' : preLabel);
    const entry = { id: t.id, title: t.title, icon: t.icon, stars, better, postArousal, susScore, at: Date.now() };
    const next = [entry, ...readLog(userId)];
    writeLog(userId, next);
    setLog(next);
    submitRating(userId, token, t.id, stars);
    return validateIntervention(userId, token, {
      techniqueId: t.id, preLabel, postLabel, contextClusterId: rec?.context_cluster_id ?? 0, stars,
    });
  }, [active, userId, token, preLabel, rec]);

  const todayCount = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    return log.filter((r) => r.at >= d.getTime()).length;
  }, [log]);

  const questState = readQuests(userId);
  const questsDone = QUESTS.filter((q) => (questState[q.counter] || 0) >= q.target).length;
  const recent = log.slice(0, 6);
  const learned = bandit?.preference_history?.recent_interventions;

  return (
    <div className="stack">
      <div className="greet">
        <span className="micro">Relaxation guide</span>
        <h1 className="display" style={{ marginTop: 4 }}>Take a moment</h1>
        <p className="body" style={{ marginTop: 4 }}>Short exercises that fit how you are right now. The guide learns what works for you.</p>
      </div>

      <div className="grid grid-hero">
        <Card>
          <CardHead title="How you are now" right={<Badge color={state.color} dot live={isLive}>{isLive ? 'Live' : 'Last known'}</Badge>} />
          <div className="row" style={{ gap: 14, alignItems: 'center' }}>
            <div className="tech-icon big" style={{ background: `${state.color}22` }}>{state.icon}</div>
            <div>
              <h2 className="display" style={{ color: state.color }}>{state.word}</h2>
              <p className="body">{state.line}</p>
            </div>
          </div>
          <p className="caption" style={{ marginTop: 14 }}>
            {fusion.latestMs ? `Last reading ${timeAgo(fusion.latestMs)}` : ringLatest ? `Ring reading ${timeAgo(new Date(ringLatest.timestamp).getTime())}` : 'No readings yet'}
            {probability != null && ` · stress ${Math.round(probability * 100)}% (your limit about ${Math.round(DEFAULT_RING_THRESHOLD * 100)}%)`}
          </p>
        </Card>

        <Card>
          <CardHead title="Recommended for you" right={rec?.source === 'service' ? <Badge color="#5E935A">Personalised</Badge> : <Badge color="#989294">Suggested</Badge>} />
          {recLoading && !rec ? (
            <div className="spinner" />
          ) : (
            <div className="row" style={{ gap: 14, alignItems: 'center' }}>
              <div className="tech-icon big" style={{ background: `${recommended.color}22` }}>{recommended.icon}</div>
              <div style={{ minWidth: 0 }}>
                <h3 className="title">{recommended.title}</h3>
                <p className="body">{recommended.description}</p>
              </div>
            </div>
          )}
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn" onClick={() => setActive(recommended)}>Start · {recommended.minutes} min</button>
            <span className="caption">{todayCount} done today</span>
          </div>
        </Card>
      </div>

      <Card>
        <CardHead title="Relaxation Arcade" sub="Choose a technique. Each one is a short interactive game." />
        <button type="button" className="quest-row" onClick={() => setQuestsOpen(true)}>
          <span className="tech-icon" style={{ background: '#3B82F622' }}>📜</span>
          <span className="tech-text">
            <b>Daily Tasks &amp; Quests</b>
            <span>{questsDone} of {QUESTS.length} done today · complete tasks for rewards</span>
          </span>
          <span className="tech-go" style={{ background: '#3B82F6' }}>Open</span>
        </button>
        <div className="tech-grid" style={{ marginTop: 'var(--sp-md)' }}>
          {TECHNIQUES.map((t) => (
            <button key={t.id} className="tech-card" style={{ borderColor: `${t.color}50` }} onClick={() => setActive(t)}>
              <span className="tech-icon" style={{ background: `${t.color}18` }}>{t.icon}</span>
              <span className="tech-text">
                <b>{t.listTitle || t.title}</b>
                <span>{t.description}</span>
              </span>
              <span className="tech-go" style={{ background: t.color }}>Play</span>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <CardHead title="Your recent sessions" sub="Saved on this device" />
        {recent.length === 0 ? (
          <p className="body">No sessions yet. Try one above and rate it. The guide uses your ratings to pick better exercises.</p>
        ) : (
          <ul className="timeline">
            {recent.map((r) => (
              <li key={r.at}>
                <span style={{ fontSize: 20 }}>{r.icon}</span>
                <div style={{ flex: 1 }}>
                  <b>{r.title}</b>
                  <div className="caption">{timeAgo(r.at)} · {r.better ? 'felt better' : 'about the same'}</div>
                </div>
                <span className="stars-static">{'★'.repeat(r.stars)}<i>{'★'.repeat(5 - r.stars)}</i></span>
              </li>
            ))}
          </ul>
        )}
        {Array.isArray(learned) && learned.length > 0 && (
          <p className="caption" style={{ marginTop: 10 }}>The guide has learned from {learned.length} of your earlier sessions.</p>
        )}
      </Card>

      {active && (
        <RelaxGame
          key={active.id}
          technique={active}
          userId={userId}
          preLabel={preLabel}
          onClose={() => setActive(null)}
          onSwitch={(id) => { const t = findTechnique(id); if (t) setActive(t); }}
          onFinish={finish}
        />
      )}

      {questsOpen && !active && (
        <DailyQuests
          userId={userId}
          onClose={() => setQuestsOpen(false)}
          onStart={(id) => { setQuestsOpen(false); const t = findTechnique(id); if (t) setActive(t); }}
        />
      )}
    </div>
  );
}
