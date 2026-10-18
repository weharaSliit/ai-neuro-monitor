import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useLivePointer, useNow } from '../hooks/useLive';
import { useFusion, useRingHistory } from '../hooks/useStreams';
import { DEFAULT_RING_THRESHOLD, timeAgo } from '../lib/levels';
import { TECHNIQUES, findTechnique } from '../lib/techniques';
import {
  getBanditState, getIntervention, submitRating, validateIntervention, webTechniqueIdFromRecommendation,
} from '../lib/relaxApi';
import { latestPhenoScore, newWebSessionKey, relaxLog } from '../lib/relaxEvidenceLog';
import RelaxWhy from '../components/RelaxWhy';
import RelaxLoopBanner from '../components/RelaxLoopBanner';
import { Card, CardHead, Badge } from '../components/ui';
import RelaxGame from '../components/RelaxGame';
import RelaxEvidence from '../components/RelaxEvidence';
import { isEvidenceAdmin } from '../lib/relaxEvidence';
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
  const canSeeEvidence = isEvidenceAdmin(userId);
  const [showEvidence, setShowEvidence] = useState(false);
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
  // Same as the app: the game comes from the recommended sub-option, not from the technique family.
  const recommended = (rec?.source === 'service'
    ? findTechnique(webTechniqueIdFromRecommendation(rec))
    : findTechnique(rec?.technique_id)) || TECHNIQUES[1];

  // Evidence log: what was recommended and why (read by the admin evidence view).
  useEffect(() => {
    if (!userId || rec?.source !== 'service' || !rec.session_id) return;
    relaxLog.meta(userId, rec.session_id, {
      condition: 'system',
      recommended_technique_id: rec.technique_id,
      technique_id: rec.technique_id,
      title: rec.title,
      reason: rec.reason || null,
      reason_codes: rec.reason_codes || null,
      context: rec.context || null,
      streams_used: rec.streams_used || null,
      cluster_id: rec.context_cluster_id ?? null,
      recommended_at: Date.now() / 1000,
      platform: 'web',
    });
    relaxLog.event(userId, rec.session_id, 'recommended', { technique_id: rec.technique_id, reason: rec.reason || null });
  }, [userId, rec?.session_id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── One intervention session, recorded the same way as in the app ──
  // { key, startSec, samples:[{t,p}], tried:[family ids], currentTechnique, condition: 'system' | 'manual' }
  const sessionRef = useRef(null);
  const latestRef = useRef({ prob: null, live: false });
  latestRef.current = { prob: probability, live: isLive };

  const startSession = (t, source) => {
    if (!sessionRef.current) {
      const fromRec = source === 'system' && rec?.source === 'service' && !!rec.session_id;
      const key = fromRec ? rec.session_id : newWebSessionKey();
      const technique = fromRec ? rec.technique_id : t.id;
      sessionRef.current = {
        key, startSec: Date.now() / 1000, samples: [], tried: [technique], currentTechnique: technique,
        condition: fromRec ? 'system' : 'manual',
      };
      relaxLog.meta(userId, key, {
        condition: sessionRef.current.condition,
        technique_id: technique,
        title: t.title,
        recommended_technique_id: rec?.technique_id ?? null,
        reason: fromRec ? rec.reason || null : null,
        reason_codes: fromRec ? rec.reason_codes || null : null,
        context: fromRec ? rec.context || null : null,
        streams_used: fromRec ? rec.streams_used || null : null,
        cluster_id: fromRec ? rec.context_cluster_id ?? null : null,
        started_at: sessionRef.current.startSec,
        platform: 'web',
      });
      relaxLog.event(userId, key, 'started', { condition: sessionRef.current.condition, technique_id: technique });
    }
    setActive(t);
  };

  const abandonSession = () => {
    const s = sessionRef.current;
    if (s) relaxLog.event(userId, s.key, 'abandoned', { elapsed: Date.now() / 1000 - s.startSec });
    sessionRef.current = null;
  };

  // Stress curve of the session: ring/earbud when live, otherwise the phone-behaviour (phenotyping) stream.
  const hasActive = !!active;
  useEffect(() => {
    if (!hasActive || !userId) return undefined;
    const iv = setInterval(async () => {
      const s = sessionRef.current;
      if (!s) return;
      let p = null; let src = null;
      const { prob, live } = latestRef.current;
      if (live && Number.isFinite(prob)) { p = prob; src = 'physio'; } else {
        const ph = await latestPhenoScore(userId);
        if (Number.isFinite(ph)) { p = ph; src = 'phenotyping'; }
      }
      if (p == null) return;
      s.samples.push({ t: Date.now() / 1000, p });
      relaxLog.sample(userId, s.key, p, src);
    }, 5000);
    return () => clearInterval(iv);
  }, [hasActive, userId]);

  const switchTo = (next) => {
    const s = sessionRef.current;
    const t = findTechnique(webTechniqueIdFromRecommendation(next));
    if (!s || !t) return;
    relaxLog.event(userId, s.key, 'switched', { from: s.currentTechnique, to: next.technique_id });
    s.currentTechnique = next.technique_id;
    s.tried.push(next.technique_id);
    setActive(t);
  };

  const finish = useCallback(async ({ stars, better, postState, postArousal, susScore }) => {
    const t = active;
    const postLabel = postState || (better ? 'normal' : preLabel);
    const entry = { id: t.id, title: t.title, icon: t.icon, stars, better, postArousal, susScore, at: Date.now() };
    const next = [entry, ...readLog(userId)];
    writeLog(userId, next);
    setLog(next);
    submitRating(userId, token, t.id, stars);

    const s = sessionRef.current;
    const res = await validateIntervention(userId, token, {
      techniqueId: s?.currentTechnique || t.id,
      preLabel,
      postLabel,
      contextClusterId: rec?.context_cluster_id ?? 0,
      stars,
      sessionId: s?.condition === 'system' ? s.key : undefined,
      stressTrajectory: s ? s.samples : undefined,
      durationSeconds: s ? Date.now() / 1000 - s.startSec : undefined,
    });
    if (s) {
      relaxLog.event(userId, s.key, 'rated', { stars });
      relaxLog.result(userId, s.key, {
        technique_id: s.currentTechnique,
        stars,
        measured: !!res?.measured,
        reward: res?.reward ?? null,
        recovery_percentage: res?.recovery_percentage ?? null,
        reward_components: res?.reward_components ?? null,
        is_normal_reached: res?.is_normal_reached ?? null,
        next_technique_id: res?.alternative_recommendation?.technique_id ?? null,
        ended_at: Date.now() / 1000,
      });
      sessionRef.current = null;
    }
    return res;
  }, [active, userId, token, preLabel, rec]);

  const todayCount = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    return log.filter((r) => r.at >= d.getTime()).length;
  }, [log]);

  const questState = readQuests(userId);
  const questsDone = QUESTS.filter((q) => (questState[q.counter] || 0) >= q.target).length;
  const recent = log.slice(0, 6);
  const learned = bandit?.preference_history?.recent_interventions;

  // Admin-only evidence view: what the intervention system did for every user.
  if (showEvidence && canSeeEvidence) {
    return (
      <div className="stack">
        <div className="greet">
          <span className="micro">Relaxation guide · your evidence</span>
          <h1 className="display" style={{ marginTop: 4 }}>Your intervention system evidence</h1>
          <button className="btn" style={{ marginTop: 10 }} onClick={() => setShowEvidence(false)}>Back to relaxation</button>
        </div>
        <RelaxEvidence userId={userId} />
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="greet">
        {canSeeEvidence && (
          <button className="btn" style={{ float: 'right' }} onClick={() => setShowEvidence(true)}>My evidence</button>
        )}
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
          <RelaxWhy rec={rec} />
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn" onClick={() => startSession(recommended, 'system')}>Start · {recommended.minutes} min</button>
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
            <button key={t.id} className="tech-card" style={{ borderColor: `${t.color}50` }} onClick={() => startSession(t, 'manual')}>
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
          onClose={() => { abandonSession(); setActive(null); }}
          onSwitch={(id) => { const t = findTechnique(id); if (t) startSession(t, 'manual'); }}
          onFinish={finish}
        />
      )}

      {active && sessionRef.current && (
        <RelaxLoopBanner
          userId={userId}
          token={token}
          techniqueId={sessionRef.current.currentTechnique}
          getElapsed={() => Date.now() / 1000 - (sessionRef.current?.startSec || Date.now() / 1000)}
          getTried={() => sessionRef.current?.tried || []}
          onCheck={(step) => {
            const s = sessionRef.current;
            if (!s) return;
            relaxLog.event(userId, s.key, 'loop_check', {
              elapsed: Date.now() / 1000 - s.startSec,
              action: step?.action || 'continue',
              reason: step?.reason || '',
              level: step?.context?.combined ?? null,
              slope: step?.context?.slope_per_min ?? null,
              next: step?.next_recommendation?.technique_id ?? null,
            });
          }}
          onSwitch={switchTo}
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
