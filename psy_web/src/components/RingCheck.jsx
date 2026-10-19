import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ref, set } from 'firebase/database';
import { db } from '../lib/firebase';
import { Card, Stat } from './panels';
import { MultiLineChart } from './charts';
import TechNav from './TechNav';
import useRingStream from '../hooks/useRingStream';
import { useFirebaseValue } from '../hooks/useData';
import { usePhysioData, usePhysioPicker } from '../hooks/usePhysio';
import {
  PROTOCOL, SHORT_PROTOCOL, agreement, headline, median, parseSamples, runWindows, samplesToCsv, stepList, stepStats,
} from '../lib/ringCheck';

// Ring check (#ringcheck): a guided validation run for the ring. It tells the person
// what to do and when (rest, slow breathing, mental task, walk, then three artefact
// tests), takes the Heart Rate app readings they type in, records the ring's live
// signal once a second, saves everything to ring_validation/{user}/{run}, and draws
// the evidence: ring vs reference heart rate, skin conductance per step, movement and
// finger contact, and how many windows the quality gate withheld.
const C = { ring: 'var(--c2)', live: 'var(--c1)', ref: 'var(--critical)', gsr: 'var(--c3)', acc: 'var(--c4)' };
const mmss = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
const f1 = (v) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(1));
const f2 = (v) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(2));
const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const signed = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}`);
const LAST_KEY = 'ring_check_last_run';

function beep(freq = 880, ms = 220) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC(); const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = freq; g.gain.value = 0.15; o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + ms / 1000); setTimeout(() => ctx.close(), ms + 100);
  } catch { /* no audio */ }
}
function say(text) {
  try { window.speechSynthesis?.cancel(); window.speechSynthesis?.speak(new SpeechSynthesisUtterance(text)); } catch { /* no speech */ }
}

// ---- mental task: arithmetic, one sum at a time, a time limit on each ----
function newSum(level) {
  const a = 20 + Math.floor(Math.random() * 70); const b = 6 + Math.floor(Math.random() * 14);
  const kind = Math.random();
  if (kind < 0.4) return { q: `${a} − ${b}`, ans: a - b };
  if (kind < 0.7) return { q: `${a} + ${b * 3}`, ans: a + b * 3 };
  return { q: `${6 + Math.floor(Math.random() * 7)} × ${6 + Math.floor(Math.random() * 7) + (level > 3 ? 3 : 0)}`, ans: null };
}
function Quiz() {
  const mk = useCallback((lvl) => { const s = newSum(lvl); if (s.ans == null) { const [x, , y] = s.q.split(' '); s.ans = Number(x) * Number(y); } return s; }, []);
  const [sum, setSum] = useState(() => mk(0));
  const [val, setVal] = useState('');
  const [score, setScore] = useState({ ok: 0, bad: 0 });
  const [left, setLeft] = useState(1);
  const [flash, setFlash] = useState(false);
  const limit = useRef(12000); const t0 = useRef(Date.now());
  const inputRef = useRef(null);
  const next = useCallback((ok) => {
    setScore((s) => ({ ok: s.ok + (ok ? 1 : 0), bad: s.bad + (ok ? 0 : 1) }));
    if (!ok) { beep(220, 250); setFlash(true); setTimeout(() => setFlash(false), 350); }
    limit.current = Math.max(6000, limit.current * (ok ? 0.93 : 1.08));
    setSum(mk(score.ok + 1)); setVal(''); t0.current = Date.now();
    inputRef.current?.focus();
  }, [mk, score.ok]);
  useEffect(() => {
    const id = setInterval(() => {
      const f = 1 - (Date.now() - t0.current) / limit.current;
      setLeft(Math.max(0, f)); if (f <= 0) next(false);
    }, 100);
    return () => clearInterval(id);
  }, [next]);
  useEffect(() => { inputRef.current?.focus(); }, []);
  return (
    <div className={`rc-quiz${flash ? ' bad' : ''}`}>
      <div className="rc-sum">{sum.q} = ?</div>
      <input ref={inputRef} inputMode="numeric" value={val} onChange={(e) => setVal(e.target.value.replace(/[^\d-]/g, ''))}
        onKeyDown={(e) => { if (e.key === 'Enter' && val !== '') next(Number(val) === sum.ans); }} placeholder="answer, then Enter" />
      <div className="rc-timebar"><i style={{ width: `${left * 100}%` }} /></div>
      <div className="caption">Correct {score.ok} · wrong or timed out {score.bad}</div>
    </div>
  );
}

// ---- charts and tables for one run ----
function Scatter({ pairs, k, label }) {
  const p = pairs.filter((r) => r[k] != null);
  if (!p.length) return <div className="chart-empty" style={{ height: 240 }}>No readings yet.</div>;
  const all = p.flatMap((r) => [r.ref, r[k]]); const lo = Math.floor(Math.min(...all) / 10) * 10 - 5; const hi = Math.ceil(Math.max(...all) / 10) * 10 + 5;
  const S = 260; const P = 38; const X = (v) => P + ((v - lo) / (hi - lo)) * (S - P - 8); const Y = (v) => S - P - ((v - lo) / (hi - lo)) * (S - P - 8);
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="rc-scatter" role="img" aria-label={label}>
      <line x1={X(lo)} y1={Y(lo)} x2={X(hi)} y2={Y(hi)} stroke="var(--ink-3, #999)" strokeDasharray="4 4" />
      {[lo, (lo + hi) / 2, hi].map((v) => (
        <g key={v}><text x={X(v)} y={S - P + 14} textAnchor="middle" fontSize="10" fill="var(--ink-2)">{Math.round(v)}</text>
          <text x={P - 6} y={Y(v) + 3} textAnchor="end" fontSize="10" fill="var(--ink-2)">{Math.round(v)}</text></g>
      ))}
      {p.map((r, i) => <circle key={i} cx={X(r.ref)} cy={Y(r[k])} r="5" fill={C.ring} fillOpacity="0.75" />)}
      <text x={S / 2} y={S - 6} textAnchor="middle" fontSize="11" fill="var(--ink-2)">Heart Rate app (bpm)</text>
      <text x="11" y={S / 2} textAnchor="middle" fontSize="11" fill="var(--ink-2)" transform={`rotate(-90 11 ${S / 2})`}>{label} (bpm)</text>
    </svg>
  );
}

function Results({ run }) {
  const physio = usePhysioData(run?.user_id, run?.session_id);
  const windows = physio.windows;
  const wins = useMemo(() => runWindows(windows, run), [windows, run]);
  const samples = useMemo(() => parseSamples(run?.samples_csv), [run?.samples_csv]);
  const steps = stepList(run);
  const rows = useMemo(() => stepStats(run, wins, samples), [run, wins, samples]);
  const ag = useMemo(() => agreement(run, wins, samples), [run, wins, samples]);
  const h = useMemo(() => headline(rows, ag), [rows, ag]);
  if (!run || !steps.length) return null;
  const t0 = run.started_at; const t1 = Math.max(run.ended_at || Date.now(), ...(samples.length ? [samples[samples.length - 1].t] : [0]));
  const mn = (t) => (t - t0) / 60000; const xDomain = [0, Math.max(1, mn(t1))];
  const bands = steps.map((s, i) => ({ x0: mn(s.start), x1: mn(s.end || t1), label: s.label,
    kind: PROTOCOL.find((p) => p.key === s.key)?.kind === 'artefact' ? 'stim' : i % 2 ? 'a' : 'b', center: true }));
  const xFormat = (v) => `${Math.round(v)} min`;

  // live heart rate: 5 s medians
  const live = []; for (let i = 0; i < samples.length; i += 5) {
    const m = median(samples.slice(i, i + 5).map((s) => s.hr).filter((v) => v != null));
    if (m != null) live.push({ x: mn(samples[i].t), live: m });
  }
  const hrPts = [
    ...live,
    ...wins.filter((w) => w.hr != null).map((w) => ({ x: mn(w.t), win: w.hr })),
    ...(run.refs || []).map((r) => ({ x: mn(r.t), ref: r.bpm })),
  ].sort((a, b) => a.x - b.x);
  const hrVals = hrPts.flatMap((p) => [p.live, p.win, p.ref]).filter((v) => v != null);
  const hrDom = hrVals.length ? [Math.max(30, Math.floor(Math.min(...hrVals) / 10) * 10 - 5), Math.min(210, Math.ceil(Math.max(...hrVals) / 10) * 10 + 5)] : [40, 140];

  const us = samples.filter((s) => s.us != null);
  const usPts = [
    ...us.filter((_, i) => i % 2 === 0).map((s) => ({ x: mn(s.t), us: s.us })),
    ...wins.filter((w) => w.scl != null).map((w) => ({ x: mn(w.t), scl: w.scl })),
  ].sort((a, b) => a.x - b.x);
  const usMax = usPts.length ? Math.max(...usPts.flatMap((p) => [p.us, p.scl]).filter((v) => v != null)) : 1;
  const accPts = samples.filter((s) => s.acc != null).map((s) => ({ x: mn(s.t), acc: s.acc }));
  const accMax = accPts.length ? Math.max(1.5, ...accPts.map((p) => p.acc)) : 1.5;
  const offBands = []; let cur = null;
  samples.forEach((s) => {
    if (s.finger === false) { if (!cur) cur = { x0: mn(s.t), x1: mn(s.t), label: '', kind: 'stim' }; else cur.x1 = mn(s.t); }
    else if (cur) { if (cur.x1 - cur.x0 > 0.1) offBands.push(cur); cur = null; }
  });
  if (cur && cur.x1 - cur.x0 > 0.1) offBands.push(cur);

  const A = h.agree;
  return (
    <>
      <div className="grid-4 rc-stats">
        <Stat label={`Heart rate vs Heart Rate app (${h.agreeFrom})`} value={A?.n ? `${f1(A.mae)} bpm` : '—'}
          sub={A?.n ? `mean error · bias ${signed(A.bias)} · r = ${f2(A.r)} · n = ${A.n}` : 'type in app readings during the run'} />
        <Stat label="Heart rate rise on walking" value={h.walkRise == null ? '—' : `${signed(h.walkRise, 0)} bpm`} sub="walk vs rest" />
        <Stat label="Skin conductance on mental task" value={h.quizGsr == null ? '—' : `${signed(h.quizGsr, 2)} µS`} sub={h.quizHr == null ? 'task vs rest' : `task vs rest · heart rate ${signed(h.quizHr, 0)} bpm`} />
        <Stat label="Artefact windows withheld" value={h.expected ? `${h.withheld} of ${h.expected}` : '—'}
          sub={`finger off ${pct(h.offPct)} of the time · shake peak ${h.shakePeak == null ? '—' : `${h.shakePeak.toFixed(1)} g`}`} />
      </div>

      <Card title="Heart rate: ring vs Heart Rate app">
        <MultiLineChart points={hrPts} height={320} yDomain={hrDom} xDomain={xDomain} xFormat={xFormat} yFormat={(v) => `${Math.round(v)}`}
          bands={bands} ariaLabel="Ring and reference heart rate over the run"
          series={[{ key: 'live', label: 'Ring, live beats (5 s)', color: C.live, width: 1.6, connect: true },
            { key: 'win', label: 'Ring, 60 s window', color: C.ring, width: 2.4, connect: true, dots: true },
            { key: 'ref', label: 'Heart Rate app', color: C.ref, width: 2, connect: false, dots: true }]} />
        <div className="grid-2 rc-scatters">
          <div><h3>Ring 60 s window vs app</h3><Scatter pairs={ag.pairs} k="win" label="Ring window" />
            <p className="caption">n {ag.window.n || 0} · mean error {f1(ag.window.mae)} bpm · bias {signed(ag.window.bias)} · r {f2(ag.window.r)} · within 5 bpm {pct(ag.window.within5)}</p></div>
          <div><h3>Ring live beats vs app</h3><Scatter pairs={ag.pairs} k="live" label="Ring live" />
            <p className="caption">n {ag.live.n || 0} · mean error {f1(ag.live.mae)} bpm · bias {signed(ag.live.bias)} · r {f2(ag.live.r)} · within 5 bpm {pct(ag.live.within5)}</p></div>
        </div>
      </Card>

      <div className="grid-2">
        <Card title="Skin conductance (GSR)">
          <MultiLineChart points={usPts} height={260} yDomain={[0, Math.ceil(usMax * 1.1 * 10) / 10 || 1]} xDomain={xDomain} xFormat={xFormat} yFormat={(v) => v.toFixed(1)}
            bands={bands} ariaLabel="Skin conductance over the run"
            series={[{ key: 'us', label: 'Live (µS)', color: C.gsr, width: 1.6, connect: true },
              { key: 'scl', label: 'Window level (µS)', color: C.ring, width: 2.4, connect: true, dots: true }]} />
        </Card>
        <Card title="Movement and finger contact">
          <MultiLineChart points={accPts} height={260} yDomain={[0, accMax]} xDomain={xDomain} xFormat={xFormat} yFormat={(v) => v.toFixed(1)}
            bands={[...bands.map((b) => ({ ...b, label: '' })), ...offBands.map((b) => ({ ...b, label: 'finger off' }))]} ariaLabel="Movement over the run"
            series={[{ key: 'acc', label: 'Movement (g)', color: C.acc, width: 1.6, connect: true }]} />
        </Card>
      </div>

      <Card title="Per step">
        <div className="rc-table">
          <table className="phase-table">
            <thead><tr><th>Step</th><th>Length</th><th>Heart rate (live)</th><th>Heart rate (window)</th><th>Skin (µS)</th><th>Movement avg / peak (g)</th><th>Finger off</th><th>Quality</th><th>Windows kept</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={r.kind === 'artefact' ? 'rc-art' : ''}>
                  <th>{r.label}</th><td>{mmss(r.sec)}</td><td>{f1(r.liveHr)}</td><td>{f1(r.winHr)}</td><td>{f2(r.us)}</td>
                  <td>{f2(r.accMean)} / {f2(r.accPeak)}</td><td>{pct(r.fingerOffPct)}</td><td>{r.quality == null ? '—' : f2(r.quality)}</td>
                  <td>{r.kept}/{r.expected}{r.withheld > 0 && r.kind === 'artefact' ? <b> · {r.withheld} withheld</b> : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="rc-refs">
          <h3>Heart Rate app readings</h3>
          {(run.refs || []).length === 0 ? <p className="muted">None logged.</p> : (
            <table className="phase-table">
              <thead><tr><th>Time</th><th>Step</th><th>App</th><th>Ring window</th><th>Ring live</th></tr></thead>
              <tbody>{ag.pairs.map((p, i) => (
                <tr key={i}><td>{new Date(p.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td><td>{PROTOCOL.find((x) => x.key === p.step)?.label || p.step}</td>
                  <td>{p.ref}</td><td>{f1(p.win)}</td><td>{f1(p.live)}</td></tr>))}</tbody>
            </table>
          )}
        </div>
      </Card>
    </>
  );
}

export default function RingCheck({ now: _now, go }) {
  const picker = usePhysioPicker();
  const uid = picker.userId; const sid = picker.sessionId;
  const ring = useRingStream();
  const ringRef = useRef(ring); ringRef.current = ring;

  const [status, setStatus] = useState('idle');     // idle | running | done
  const [, setTick] = useState(0);
  const runRef = useRef(null); const samplesRef = useRef([]); const idxRef = useRef(0);
  const askedRef = useRef(0); const [askRef, setAskRef] = useState(false);
  const [bpm, setBpm] = useState(''); const [ago, setAgo] = useState('0');
  const [saveMsg, setSaveMsg] = useState('');
  const [viewId, setViewId] = useState(null);
  const [mode, setMode] = useState('short');
  const planRef = useRef(PROTOCOL);

  const saved = useFirebaseValue(uid ? `ring_validation/${uid}` : null);
  const savedIds = useMemo(() => Object.keys(saved || {}).sort().reverse(), [saved]);

  const save = useCallback(async () => {
    const r = runRef.current; if (!r) return;
    const payload = JSON.parse(JSON.stringify({ ...r, samples_csv: samplesToCsv(samplesRef.current) }));
    try { window.localStorage.setItem(LAST_KEY, JSON.stringify(payload)); } catch { /* storage blocked */ }
    try { await set(ref(db, `ring_validation/${r.user_id}/${r.id}`), payload); setSaveMsg(`Saved ${new Date().toLocaleTimeString()}`); }
    catch (e) { setSaveMsg(`Not saved to the database (${e?.message || e}). Use "Download run".`); }
  }, []);

  const startStep = useCallback((i) => {
    const r = runRef.current; const spec = planRef.current[i]; const t = Date.now();
    r.steps.push({ key: spec.key, label: spec.label, start: t, end: null });
    idxRef.current = i; askedRef.current = 0; setAskRef(false);
    beep(i === 0 ? 660 : 880); say(spec.say);
  }, []);

  const finish = useCallback(() => {
    const r = runRef.current; const t = Date.now();
    const cur = r.steps[r.steps.length - 1]; if (cur && !cur.end) cur.end = t;
    r.ended_at = t; setStatus('done'); setAskRef(false);
    beep(520, 500); say('Run finished. Put the ring back on your finger.');
    save(); setViewId(null);
  }, [save]);

  const advance = useCallback(() => {
    const r = runRef.current; const cur = r.steps[r.steps.length - 1]; cur.end = Date.now();
    if (idxRef.current + 1 < planRef.current.length) { startStep(idxRef.current + 1); save(); } else finish();
  }, [finish, save, startStep]);

  const start = () => {
    if (!uid) return;
    runRef.current = { id: `run_${Date.now()}`, user_id: uid, session_id: sid || null, started_at: Date.now(), ended_at: null, steps: [], refs: [] };
    planRef.current = mode === 'short' ? SHORT_PROTOCOL : PROTOCOL;
    samplesRef.current = []; setSaveMsg(''); setBpm(''); setViewId(null);
    setStatus('running'); startStep(0);
  };
  const stop = () => { if (window.confirm('Stop the run now? What was recorded is kept.')) finish(); };

  // clock: step changes, reference prompts, autosave
  useEffect(() => {
    if (status !== 'running') return undefined;
    const id = setInterval(() => {
      setTick((n) => n + 1);
      const r = runRef.current; const cur = r.steps[r.steps.length - 1]; const spec = planRef.current[idxRef.current];
      const el = (Date.now() - cur.start) / 1000;
      if (el >= spec.sec) { advance(); return; }
      if (spec.ref) {
        const due = Math.floor((el + 5) / 60);       // 0:55, 1:55, ... into the step
        if (due > askedRef.current && el > 20) { askedRef.current = due; setAskRef(true); beep(1000, 150); say('Take a heart rate reading.'); }
      }
      if (Math.floor(el) % 30 === 0 && el > 1) save();
    }, 500);
    return () => clearInterval(id);
  }, [status, advance, save]);

  // the ring's live signal, once a second
  useEffect(() => {
    if (status !== 'running') return undefined;
    const id = setInterval(() => {
      const rg = ringRef.current; const t = Date.now();
      const m = rg.msgs?.[rg.msgs.length - 1]; const fresh = m && t - m.t < 3000;
      const hrs = (rg.beats || []).filter((b) => t - b.t < 8000 && b.hr > 30 && b.hr < 220).map((b) => b.hr);
      samplesRef.current.push({ t, us: fresh ? m.us : null, acc: fresh ? m.acc : null, finger: fresh ? m.finger : null, hr: hrs.length >= 3 ? median(hrs) : null });
    }, 1000);
    return () => clearInterval(id);
  }, [status]);

  const logRef = () => {
    const v = Number(bpm); if (!(v >= 30 && v <= 220) || !runRef.current) return;
    const r = runRef.current; const cur = r.steps[r.steps.length - 1];
    r.refs.push({ t: Date.now() - Number(ago || 0) * 60000, bpm: v, step: cur?.key || null });
    setBpm(''); setAskRef(false); save();
  };

  const download = () => {
    const r = viewRun || runRef.current; if (!r) return;
    const data = { ...r, samples_csv: r.samples_csv ?? samplesToCsv(samplesRef.current) };
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `${r.id}.json`; a.click();
  };

  // the run shown in the results: the live one while running, else a saved one
  const live = runRef.current && (status === 'running' || (status === 'done' && !viewId));
  const chosen = viewId ? saved?.[viewId] : (savedIds[0] ? saved?.[savedIds[0]] : null);
  const viewRun = live ? { ...runRef.current, samples_csv: samplesToCsv(samplesRef.current) } : chosen;
  const plan = planRef.current; const totalSec = plan.reduce((s, p) => s + p.sec, 0);
  const idx = idxRef.current; const spec = plan[idx] || plan[0];
  const cur = runRef.current?.steps[runRef.current.steps.length - 1];
  const elapsed = cur ? (Date.now() - cur.start) / 1000 : 0;
  const overall = runRef.current ? (Date.now() - runRef.current.started_at) / 1000 : 0;
  const connected = ring.conn.state === 'connected';
  const lastMsg = ring.msgs?.[ring.msgs.length - 1];
  const streaming = lastMsg && Date.now() - lastMsg.t < 4000;

  return (
    <div className="page rc-page">
      <TechNav page="ringcheck" go={go} picker={picker} title="Ring check" />

      <Card title="Run" right={<span className={`rc-dev ${streaming ? 'on' : ''}`}><i />{streaming ? `Ring streaming${lastMsg.finger === false ? ' · finger off' : ''}` : connected ? 'Ring not streaming' : 'Connecting…'}</span>}>
        {status !== 'running' ? (
          <div className="rc-start">
            <p>Checking <b>{uid || '—'}</b>{sid ? <> · <span className="muted">{sid}</span></> : null}. About {Math.round((mode === 'short' ? SHORT_PROTOCOL : PROTOCOL).reduce((s, p) => s + p.sec, 0) / 60)} minutes. Voice and beeps tell you each step.</p>
            <div className="dev-tabs" role="tablist">{[['short', 'Short run (rest, mental task, walk, recovery)'], ['full', 'Full run (with artefact tests)']].map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={mode === k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{l}</button>))}</div>
            <ol className="rc-plan">{(mode === 'short' ? SHORT_PROTOCOL : PROTOCOL).map((p) => <li key={p.key} className={p.kind}><b>{p.label}</b> <span>{mmss(p.sec)}</span></li>)}</ol>
            <div className="rc-actions">
              <button type="button" className="btn" onClick={start} disabled={!uid || !streaming}>{status === 'done' ? 'Start another run' : 'Start check'}</button>
              {!uid && <span className="muted">Pick the user first (top right).</span>}
              {uid && !streaming && <span className="muted">Waiting for the ring to stream.</span>}
              {runRef.current && <button type="button" className="btn ghost" onClick={download}>Download run</button>}
              {saveMsg && <span className="muted">{saveMsg}</span>}
            </div>
          </div>
        ) : (
          <div className="rc-run">
            <div className="rc-step-head">
              <span className="rc-step-no">Step {idx + 1} of {plan.length}</span>
              <h2>{spec.label}</h2>
              <div className="rc-count">{mmss(spec.sec - elapsed)}</div>
            </div>
            <div className="rc-timebar big"><i style={{ width: `${Math.min(100, (elapsed / spec.sec) * 100)}%` }} /></div>
            <p className={`rc-say ${spec.kind}`}>{spec.text}</p>
            {spec.key === 'quiz' && <Quiz />}
            {spec.key === 'breathing' && <div className="rc-breath"><i /></div>}
            {spec.ref && (
              <div className={`rc-ref${askRef ? ' ask' : ''}`}>
                <label>Heart Rate app reading (bpm)
                  <input inputMode="numeric" value={bpm} onChange={(e) => setBpm(e.target.value.replace(/\D/g, ''))}
                    onKeyDown={(e) => { if (e.key === 'Enter') logRef(); }} placeholder="e.g. 72" />
                </label>
                <label>taken
                  <select value={ago} onChange={(e) => setAgo(e.target.value)}>
                    <option value="0">just now</option><option value="0.5">30 s ago</option><option value="1">1 min ago</option><option value="2">2 min ago</option>
                  </select>
                </label>
                <button type="button" className="btn" onClick={logRef} disabled={!bpm}>Log</button>
                <span className="muted">{runRef.current.refs.length} logged{askRef ? ' · take a reading now' : ''}</span>
              </div>
            )}
            <div className="rc-actions">
              <button type="button" className="btn ghost" onClick={advance}>Next step</button>
              <button type="button" className="btn ghost" onClick={stop}>Stop</button>
              <span className="muted">{mmss(overall)} of {mmss(totalSec)} · {saveMsg}</span>
            </div>
          </div>
        )}
      </Card>

      {savedIds.length > 0 && status !== 'running' && (
        <div className="rc-pick">
          <label>Run{' '}
            <select value={viewId || (status === 'done' ? '' : savedIds[0])} onChange={(e) => setViewId(e.target.value || null)}>
              {status === 'done' && <option value="">This run</option>}
              {savedIds.map((id) => <option key={id} value={id}>{new Date(saved[id].started_at).toLocaleString()}</option>)}
            </select>
          </label>
          <button type="button" className="btn ghost" onClick={download}>Download run</button>
        </div>
      )}

      {viewRun ? <Results run={viewRun} />
        : <p className="muted">No run yet. Start one above.</p>}
    </div>
  );
}
