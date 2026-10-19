import { Card, CardHead, Badge } from './ui';
import { COLORS } from '../lib/levels';
import { useState } from 'react';
import StroopStressor from './StroopStressor';
import MentalArithmetic from './MentalArithmetic';

// Shown on "My wellbeing" instead of the dashboard while a calibration the user
// asked for is running (useCondition gate.recalibrating): the four phases, which
// one the user is in, what to do now, and the ring's progress. When it finishes
// the dashboard comes back by itself. eeg / ring: eeg_recalibration/{sid},
// ring_recalibration/{uid} (written by the bridge, or by the live stimulator).
const BLOCK_SEC = 25;
const PHASES = [
  { key: 'settle', icon: '🪑', name: 'Settle', what: 'Sit comfortably and keep still while the sensors settle.', unit: null },
  { key: 'rest', icon: '😌', name: 'Rest', what: 'Relax with your eyes open. This sets your personal calm level.', unit: 'block' },
  { key: 'task', icon: '🧩', name: 'Task', what: 'Focus on the task. This shows how your mind and body react to load.', unit: 'block' },
  { key: 'recovery', icon: '🌿', name: 'Recovery', what: 'Relax again. This confirms you come back to calm.', unit: 'block' },
];

const mmss = (sec) => { const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function phaseOf(rec) {
  if (!rec) return null;
  if (rec.status === 'requested') return 'settle';
  return PHASES.some((p) => p.key === rec.phase) ? rec.phase : rec.status === 'saving' ? 'recovery' : null;
}

// The high-load task: mental arithmetic, then the Stroop colour test (about half the task time
// each); the person can switch round any time. In simulation it is a demo: the stimulator
// supplies the readings.
function TaskRounds({ left, simulated }) {
  const [round, setRound] = useState('math');
  const total = Math.max(60, left ?? 240);
  const SUB = { math: 'Solve each sum before its bar runs out. Type the answer, don’t say it.',
    stroop: 'Tap the INK colour, not the word. Keep the phone or keyboard still.' };
  return (
    <Card style={{ marginTop: 20 }}>
      <CardHead title={`Your task · ${round === 'math' ? 'Round 1: mental arithmetic' : 'Round 2: Stroop colour'}`}
        sub={simulated ? 'Simulation: the stimulator supplies the readings (the task is shown as a demo).' : SUB[round]}
        right={(
          <div className="seg">
            {[['math', 'Mental arithmetic'], ['stroop', 'Stroop colour']].map(([k, l]) => (
              <button key={k} type="button" className={round === k ? 'on' : ''} onClick={() => setRound(k)}>{l}</button>
            ))}
          </div>
        )} />
      {round === 'math'
        ? <MentalArithmetic durationSec={Math.round(total / 2)} onDone={() => setRound('stroop')} />
        : <StroopStressor durationSec={Math.max(30, Math.round(left ?? total / 2))} roundLabel="Round 2" />}
    </Card>
  );
}

export default function CalibrationOnboarding({ eeg, ring, now, onShowDashboard }) {
  const phase = phaseOf(eeg) || phaseOf(ring) || 'settle';
  const at = PHASES.findIndex((p) => p.key === phase);
  const cur = PHASES[at];
  const simulated = (eeg?.source || ring?.source) === 'stimulator';
  const saving = eeg?.status === 'saving';

  // progress inside the current phase
  const need = eeg?.blocks_needed ?? null;
  const got = eeg?.blocks_captured ?? 0;
  const settleLeft = eeg?.settle_until ? eeg.settle_until - now / 1000 : null;
  const left = phase === 'settle' ? settleLeft : need != null ? (need - got) * BLOCK_SEC : null;
  const frac = phase === 'settle' ? (settleLeft == null ? 0 : 1 - Math.max(0, settleLeft) / (eeg?.settle_sec || 120))
    : need ? Math.min(1, got / need) : 0;
  const totalLeft = [
    phase === 'settle' ? Math.max(0, settleLeft ?? 120) : 0,
    at <= 1 ? (phase === 'rest' ? Math.max(0, (need ?? 10) - got) : 10) * BLOCK_SEC : 0,
    at <= 2 ? (phase === 'task' ? Math.max(0, (need ?? 19) - got) : (eeg?.task_blocks_needed ?? 19)) * BLOCK_SEC : 0,
    (phase === 'recovery' ? Math.max(0, (need ?? 7) - got) : (eeg?.recovery_blocks_needed ?? 7)) * BLOCK_SEC,
  ].reduce((a, b) => a + b, 0);

  return (
    <div className="onb">
      <div className="hero onb-hero">
        <div>
          <div className="orb pulse">{cur.icon}</div>
          <div className="word">Calibrating · {cur.name}</div>
          <p className="line">{saving ? 'Saving your personal calm level and limits…' : cur.what}</p>
        </div>
        <div className="foot">
          <span className="tip onb-left">{left != null && left > 0 ? `${mmss(left)} left in this step` : 'Almost there'}</span>
          <span className="when">about {Math.max(1, Math.round(totalLeft / 60))} min to go{simulated ? ' · simulated' : ''}</span>
        </div>
      </div>

      <ol className="onb-steps" aria-label="Calibration steps">
        {PHASES.map((p, i) => (
          <li key={p.key} className={i < at ? 'done' : i === at ? 'now' : ''}>
            <span className="onb-dot">{i < at ? '✓' : p.icon}</span>
            <b>{p.name}</b>
            <em>{i < at ? 'done' : i === at ? 'now' : p.key === 'settle' ? '2 min' : p.key === 'rest' ? '4 min' : p.key === 'task' ? '8 min' : '3 min'}</em>
            {i === at && <span className="onb-bar"><i style={{ width: `${Math.round(Math.max(0.03, frac) * 100)}%` }} /></span>}
          </li>
        ))}
      </ol>

      {phase === 'task' && !saving && <TaskRounds key={eeg?.requested_at || 'task'} left={left} simulated={simulated} />}

      <div className="grid grid-2" style={{ marginTop: 20 }}>
        <Card>
          <CardHead title="Mind · headband" right={<Badge color={COLORS.eeg} dot live>{cur.name}</Badge>} />
          <p className="body">{phase === 'settle' ? 'Waiting for the signal to settle.'
            : need ? `${got} of ${need} readings in this step` : 'Collecting readings…'}</p>
        </Card>
        <Card>
          <CardHead title="Body · ring" right={ring ? <Badge color={COLORS.hrv} dot live>{PHASES.find((p) => p.key === ring.phase)?.name || (ring.status === 'done' ? 'Done' : '—')}</Badge> : <Badge color={COLORS.normal}>Ready</Badge>} />
          <p className="body">{!ring || ring.status === 'done' ? 'Ring calibration done.'
            : ring.blocks_needed ? `${ring.blocks_captured ?? 0} of ${ring.blocks_needed} windows in this step` : 'Collecting readings…'}</p>
        </Card>
      </div>

      <p style={{ textAlign: 'center', marginTop: 20 }}>
        <a href="#" onClick={(e) => { e.preventDefault(); onShowDashboard(); }}>Show my dashboard anyway →</a>
      </p>
    </div>
  );
}
