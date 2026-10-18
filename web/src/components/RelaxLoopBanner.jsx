import { useEffect, useState } from 'react';
import { loopStep } from '../lib/relaxApi';

// Closed loop inside a session, same behaviour as the app's game screen: every 20 s the Relaxation
// Guide looks at the filtered stress level and its slope and answers continue / switch / stop.
// Nothing changes without a click: "switch" offers another technique, "stop" says baseline is reached.
const CHECK_EVERY_MS = 20000;

export default function RelaxLoopBanner({ userId, token, techniqueId, getElapsed, getTried, onCheck, onSwitch }) {
  const [hint, setHint] = useState(null);

  useEffect(() => {
    if (!userId || !techniqueId) return undefined;
    let cancelled = false;
    const check = async () => {
      const tried = getTried();
      const step = await loopStep(userId, token, { techniqueId, elapsedSeconds: getElapsed(), tried });
      if (cancelled) return;
      if (onCheck) onCheck(step);
      setHint(step && step.action && step.action !== 'continue' ? step : null);
    };
    const iv = setInterval(check, CHECK_EVERY_MS);
    return () => { cancelled = true; clearInterval(iv); };
  }, [userId, token, techniqueId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!hint) return null;
  const next = hint.next_recommendation;
  return (
    <div style={{
      position: 'fixed', left: '50%', bottom: 18, transform: 'translateX(-50%)', zIndex: 10000, maxWidth: 520, width: 'calc(100% - 32px)',
      background: '#0F172A', color: '#E2E8F0', border: '1px solid rgba(56,189,248,0.5)', borderRadius: 14, padding: 14,
      boxShadow: '0 10px 30px rgba(0,0,0,0.35)', textAlign: 'center',
    }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>
        {hint.reason}{hint.action === 'switch' && next ? ` Try ${next.title}?` : ''}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 10 }}>
        {hint.action === 'switch' && next && (
          <button className="btn" onClick={() => { onSwitch(next); setHint(null); }}>Switch</button>
        )}
        <button className="btn" style={{ background: 'transparent', color: '#94A3B8', boxShadow: 'none' }} onClick={() => setHint(null)}>
          Keep going
        </button>
      </div>
    </div>
  );
}
