import { useCallback, useEffect, useRef, useState } from 'react';
import FlowerMeadow from './games/FlowerMeadow';
import LilyPond from './games/LilyPond';
import Meditation from './games/Meditation';
import Cognitive from './games/Cognitive';
import { PMR, EMDR, BioGSR } from './games/Innovative';
import DailyQuests from './DailyQuests';
import { bumpQuest } from '../lib/quests';
import './games/games.css';

// One Relaxation Guide session, same flow as the app: GamePlayer (header, Zen
// XP / streak / time, boosters) -> Reward chest -> Post-session evaluation
// (SAM + usability) -> Thank you / recovery.

const SAM = [
  { val: 1, emoji: '🧘', label: 'Deeply Calm', color: '#10B981' },
  { val: 2, emoji: '😌', label: 'Very Relaxed', color: '#10B981' },
  { val: 3, emoji: '🙂', label: 'Peaceful', color: '#34D399' },
  { val: 4, emoji: '😐', label: 'Mildly Calm', color: '#38BDF8' },
  { val: 5, emoji: '😐', label: 'Neutral', color: '#60A5FA' },
  { val: 6, emoji: '😕', label: 'Slightly Tense', color: '#FBBF24' },
  { val: 7, emoji: '😟', label: 'Moderate Stress', color: '#F59E0B' },
  { val: 8, emoji: '😫', label: 'High Stress', color: '#F87171' },
  { val: 9, emoji: '😱', label: 'Extreme Anxiety', color: '#EF4444' },
];
const SUS = [
  { id: 'q1', icon: '🎮', text: '1. The relaxation game was easy and engaging to follow.' },
  { id: 'q2', icon: '🌊', text: '2. The visual biofeedback helped me calm down.' },
  { id: 'q3', icon: '📱', text: '3. The app interface felt fast, smooth, and responsive.' },
  { id: 'q4', icon: '✨', text: '4. I felt zero mental frustration during the session.' },
];

function Gauge({ pct }) {
  const c = pct >= 95 ? '#10B981' : pct >= 50 ? '#F59E0B' : '#EF4444';
  return (
    <div className="rg-gauge-card" style={{ borderColor: `${c}55` }}>
      <span style={{ fontSize: 40 }}>{pct >= 95 ? '🏆' : pct >= 50 ? '🌟' : '💪'}</span>
      <b style={{ color: c }}>{Math.round(pct)}%</b>
      <small>Calm Meter</small>
      <span className="rg-gauge-track"><i style={{ width: `${pct}%`, background: c }} /></span>
    </div>
  );
}

export default function RelaxGame({ technique, userId, preLabel, onClose, onSwitch, onFinish }) {
  const [stage, setStage] = useState('play'); // play | chest | rate | thanks
  const [paused, setPaused] = useState(false);
  const [score, setScore] = useState(350);
  const [combo, setCombo] = useState(2);
  const [time, setTime] = useState(0);
  const [ripples, setRipples] = useState(2);
  const [elixirs, setElixirs] = useState(2);
  const [quests, setQuests] = useState(false);
  const [sam, setSam] = useState(2);
  const [sus, setSus] = useState({ q1: 5, q2: 5, q3: 5, q4: 4 });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const total = technique.suggestedMin * 60;
  const finished = useRef(false);
  const lilySecs = useRef(0);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    if (technique.engine === 'box') bumpQuest(userId, 'box', 1);
    setStage('chest');
  }, [technique, userId]);

  // Session clock
  useEffect(() => {
    if (stage !== 'play' || paused) return undefined;
    const iv = setInterval(() => {
      setTime((t) => {
        const next = t + 1;
        if (next % 15 === 0) setScore((s) => s + 50);
        if (technique.engine === 'lily') {
          lilySecs.current += 1;
          if (lilySecs.current % 60 === 0) bumpQuest(userId, 'lily_min', 1);
        }
        if (next >= total) setTimeout(finish, 0);
        return next;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [stage, paused, total, finish, technique, userId]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && stage === 'play') setPaused(true); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage]);

  const tally = useCallback(() => { setScore((s) => s + 50); setCombo((c) => c + 1); }, []);
  const onEvent = useCallback((name) => {
    if (name === 'flower') bumpQuest(userId, 'flowers', 1);
  }, [userId]);

  const useRipple = () => { if (ripples > 0) { setRipples((c) => c - 1); setScore((s) => s + 100); } };
  const useElixir = () => {
    if (elixirs > 0) {
      setElixirs((c) => c - 1); setScore((s) => s + 150); setCombo((c) => c + 1);
      bumpQuest(userId, 'elixir', 1);
    }
  };

  const submit = async () => {
    setBusy(true);
    const preArousal = preLabel === 'high_stress' ? 8.5 : preLabel === 'stress' ? 7.5 : 4.0;
    const rating = sam <= 2 ? 5 : sam <= 4 ? 4 : sam <= 6 ? 3 : sam <= 7 ? 2 : 1;
    const postState = sam <= 4 ? 'normal' : 'stress';
    const susRaw = Object.values(sus).reduce((a, b) => a + b, 0);
    let res = null;
    try {
      res = await onFinish({
        stars: rating, better: postState === 'normal', postState, postArousal: sam,
        preArousal, arousalDelta: Number((sam - preArousal).toFixed(1)), susScore: Math.round((susRaw / 20) * 100),
      });
    } catch { /* the page keeps its own log; show the thank-you regardless */ }
    setResult({ ...res, postState });
    setBusy(false);
    setStage('thanks');
  };

  let engine;
  const gp = { paused, onTally: tally, onEvent };
  switch (technique.engine) {
    case 'flower': engine = <FlowerMeadow {...gp} />; break;
    case 'lily': engine = <LilyPond {...gp} />; break;
    case 'box': case 'belly': case 'bodyscan': engine = <Meditation mode={technique.engine} {...gp} />; break;
    case 'colormatch': case 'warmth': case 'stroop': engine = <Cognitive mode={technique.engine} {...gp} />; break;
    case 'pmr': engine = <PMR {...gp} />; break;
    case 'emdr': engine = <EMDR {...gp} />; break;
    default: engine = <BioGSR {...gp} />;
  }

  const samSel = SAM.find((s) => s.val === sam) || SAM[1];
  const isNormal = result?.is_normal_reached ?? result?.is_normal ?? (result?.postState === 'normal');
  const recoveryPct = isNormal ? 100 : (result?.recovery_percentage ?? 80);
  const mm = String(Math.floor(time / 60)); const ss = String(time % 60).padStart(2, '0');

  return (
    <div className="rg-modal">
      <div className="rg-shell">
        {stage === 'play' && (
          <>
            <div className="rg-topbar">
              <div className="rg-top-row">
                <button type="button" className="rg-icon-btn" onClick={onClose} aria-label="Back">←</button>
                <div className="rg-title"><span>{technique.icon}</span><b>{technique.title}</b></div>
                <div className="rg-top-right">
                  <button type="button" className="rg-quest-btn" onClick={() => { setPaused(true); setQuests(true); }}>📜 Quests</button>
                  <button type="button" className="rg-icon-btn" onClick={() => setPaused((p) => !p)} aria-label={paused ? 'Resume' : 'Pause'}>
                    {paused ? '▶' : '❚❚'}
                  </button>
                </div>
              </div>
              <small style={{ color: technique.color }}>{technique.meaningTitle}</small>
            </div>

            <div className="rg-stats" style={{ borderColor: technique.color }}>
              <div><small>⭐ ZEN XP</small><b style={{ color: '#F59E0B' }}>{score}</b></div>
              <i />
              <div><small>🔥 CALM STREAK</small><b style={{ color: '#EC4899' }}>x{combo}</b></div>
              <i />
              <div><small>⏱ TIME</small><b>{mm}:{ss}</b></div>
            </div>

            <div className="rg-canvas">
              {paused ? (
                <div className="rg-pause">
                  <div>
                    <div style={{ fontSize: 36 }}>⏸️</div>
                    <h3>Session Paused</h3>
                    <button type="button" className="btn" style={{ background: technique.color }} onClick={() => setPaused(false)}>Resume ▶</button>
                  </div>
                </div>
              ) : engine}
            </div>

            <div className="rg-boosters">
              <button type="button" className="rg-boost purple" onClick={useRipple}>🪷 Zen Ripple ({ripples})</button>
              <button type="button" className="rg-boost amber" onClick={useElixir}>🧪 Elixir ({elixirs})</button>
              <button type="button" className="rg-boost done"
                style={{ background: `linear-gradient(90deg, ${technique.gradient.join(', ')})` }} onClick={finish}>
                ✔ Complete Level ▶
              </button>
            </div>
          </>
        )}

        {stage === 'chest' && (
          <div className="rg-center">
            <div className="rg-card rg-chest">
              <div style={{ fontSize: 52 }}>🎁</div>
              <h3>Quest Reward Unlocked!</h3>
              <p>You have earned rewards for completing your task.</p>
              <div className="rg-rewards">
                <span><i>🧪</i><b>+2</b><small>Serenity Elixir</small></span>
                <span><i>🪷</i><b>+2</b><small>Lotus Gems</small></span>
              </div>
              <button type="button" className="btn" onClick={() => setStage('rate')}>Claim Rewards</button>
            </div>
          </div>
        )}

        {stage === 'rate' && (
          <div className="rg-scroll">
            <div className="rg-hero">
              <b>🏆 Post-Session Evaluation</b>
              <p>Two quick questions about how you feel after {technique.title}. Your answers help the guide pick better exercises for you.</p>
            </div>

            <div className="rg-card">
              <h4>🧘 1. How stressed or calm do you feel right now?</h4>
              <div className="rg-sam-now">
                <span style={{ fontSize: 44 }}>{samSel.emoji}</span>
                <b style={{ color: samSel.color }}>{samSel.val}/9 · {samSel.label}</b>
              </div>
              <div className="rg-sam">
                {SAM.map((s) => (
                  <button key={s.val} type="button" className={s.val === sam ? 'on' : ''}
                    style={s.val === sam ? { background: s.color, borderColor: s.color } : undefined}
                    onClick={() => setSam(s.val)}>{s.val}</button>
                ))}
              </div>
              <div className="between"><small style={{ color: '#10B981' }}>1 = Extremely Calm</small><small style={{ color: '#EF4444' }}>9 = Extreme Stress</small></div>
            </div>

            <div className="rg-card">
              <h4>⭐ 2. How was the experience? (1 = Poor, 5 = Excellent)</h4>
              {SUS.map((q) => (
                <div key={q.id} className="rg-sus">
                  <p>{q.icon} {q.text}</p>
                  <div>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} type="button" className={sus[q.id] === n ? 'on' : ''}
                        onClick={() => setSus((s) => ({ ...s, [q.id]: n }))}>{n}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="row" style={{ justifyContent: 'center', gap: 12, padding: '4px 0 24px' }}>
              <button type="button" className="btn ghost" onClick={onClose}>Skip</button>
              <button type="button" className="btn" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Submit feedback ▶'}</button>
            </div>
          </div>
        )}

        {stage === 'thanks' && (
          <div className="rg-center">
            <div className="rg-card rg-chest">
              <div style={{ fontSize: 52 }}>🎉</div>
              <h3>Thank you!</h3>
              <p>Your feedback was saved. The guide will use it to suggest better exercises next time.</p>
              <Gauge pct={recoveryPct} />
              <span className="rg-xp-earned">⭐ +200 Calm XP Earned!</span>
              <button type="button" className="btn" onClick={onClose}>Return to Relaxation Guide</button>
            </div>
          </div>
        )}
      </div>

      {quests && (
        <DailyQuests userId={userId}
          onClose={() => setQuests(false)}
          onStart={(id) => { setQuests(false); if (onSwitch) onSwitch(id); }}
          onOpenChest={() => { setQuests(false); finish(); }} />
      )}
    </div>
  );
}
