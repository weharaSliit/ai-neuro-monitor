import { useEffect, useState } from 'react';

// A simple 4s-in / 4s-out breathing pacer -- the quick web counterpart to
// the app's Relaxation Guide (the full guided audio stays in the app).
const PHASE_MS = 4000;

export default function BreathingModal({ onClose }) {
  const [phase, setPhase] = useState(0);
  const inhale = phase % 2 === 0;
  const breaths = Math.floor(phase / 2);

  useEffect(() => {
    const id = setInterval(() => setPhase((p) => p + 1), PHASE_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <span className="micro">One-minute reset</span>
        <h2 className="display" style={{ marginTop: 6 }}>{inhale ? 'Breathe in…' : 'Breathe out…'}</h2>
        <div className="breath" style={{ transform: `scale(${inhale ? 1.12 : 0.72})` }}>
          {inhale ? 'Inhale' : 'Exhale'}
        </div>
        <p className="body">
          {breaths < 6 ? `Breath ${breaths + 1} of 6 — follow the circle.` : 'Nicely done. Keep going as long as you like.'}
        </p>
        <button className="btn" style={{ marginTop: 18 }} onClick={onClose}>I feel better</button>
      </div>
    </div>
  );
}
