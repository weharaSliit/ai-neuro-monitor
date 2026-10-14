import { useEffect, useRef, useState } from 'react';

export const rand = (min, max) => min + Math.random() * (max - min);
let counter = 0;
export const uid = () => `${Date.now()}_${(counter += 1)}_${Math.random().toString(36).slice(2, 8)}`;

// Stage-relative pointer position.
export function relPoint(e, el) {
  const r = el.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

// Walks through breathing phases ([key] -> ms). Calls onEnter(key) when a
// phase starts (not for the first one). Stops while `paused`.
export function useBreathPhases(timing, order, { paused = false, onEnter } = {}) {
  const [phase, setPhase] = useState(order[0]);
  const [left, setLeft] = useState(Math.round(timing[order[0]] / 1000));
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const enter = useRef(onEnter);
  enter.current = onEnter;

  useEffect(() => {
    if (paused) return undefined;
    setLeft(Math.round(timing[phase] / 1000));
    setStartedAt(Date.now());
    const iv = setInterval(() => setLeft((l) => (l > 1 ? l - 1 : 1)), 1000);
    const t = setTimeout(() => {
      const next = order[(order.indexOf(phase) + 1) % order.length];
      setPhase(next);
      if (enter.current) enter.current(next);
    }, timing[phase]);
    return () => { clearInterval(iv); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, paused]);

  return { phase, left, startedAt };
}

// Short-lived items (ripples, bursts, floating text) that remove themselves.
export function useTransients(ms = 1200) {
  const [items, setItems] = useState([]);
  const timers = useRef([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const add = (item, life = ms) => {
    const id = uid();
    setItems((prev) => [...prev.slice(-12), { ...item, id }]);
    timers.current.push(setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== id)), life));
  };
  return [items, add];
}

export function EvidenceChip({ title, text, accent = '#FDE68A' }) {
  const [open, setOpen] = useState(false);
  return (
    <button type="button" className="rg-chip" onClick={() => setOpen((o) => !o)}>
      <span className="rg-chip-row">
        <i style={{ background: accent }} />
        <b>{title}</b>
        <small>{open ? 'hide' : 'why it works'}</small>
      </span>
      {open && <span className="rg-chip-text">{text}</span>}
    </button>
  );
}
