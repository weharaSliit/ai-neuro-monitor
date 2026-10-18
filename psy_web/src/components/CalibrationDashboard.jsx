import { MultiLineChart } from './charts';
import { Card } from './panels';
import TechNav from './TechNav';
import { useFirebaseValue, useSessionData, useSessionPicker } from '../hooks/useData';
import { usePhysioData } from '../hooks/usePhysio';
import useEegCalibrations from '../hooks/useEegCalibrations';
import RecalibratePanel from './RecalibratePanel';
import LiveCalibrationCard from './LiveCalibrationCard';
import LimitsStrip from './LimitsStrip';
import StimulatorPanel from './StimulatorPanel';
import { decisionGate } from '../lib/simDemo';
import { calibratedLimits, mean } from '../lib/limits';

// Calibration (#calibration): how this user's baseline and high-load limit are
// set -- rest, then a high-load task, then recovery -- for mind, body and fused,
// the limits in use, recalibration and the live stimulator's controls.
const C = { eeg: 'var(--c1)', hrv: 'var(--c2)', fused: 'var(--c7)' };
const clock = (ms) => (ms == null ? '—' : new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

// All three trends on one chart (shared 0-1 scale: each component's own limit
// at 0.50); x = position within each phase, so different block/window counts
// line up phase by phase; lines are a 3-point running mean.
function TrendCard({ phases }) {
  const comps = [['mind', 'Mind (EEG)', C.eeg], ['body', 'Body (HRV + GSR)', C.hrv], ['fused', 'Fused', C.fused]]
    .filter(([k]) => phases[k]);
  const pts = [];
  comps.forEach(([k]) => {
    const p = phases[k]; const show = p.show || ((v) => v);
    [p.rest, p.task, p.recovery].forEach((arr, ph) => arr.forEach((_, i) => {
      const win = arr.slice(Math.max(0, i - 2), i + 1);
      pts.push({ x: ph + (i + 0.5) / arr.length, [k]: show(mean(win)) });
    }));
  });
  pts.sort((a, b) => a.x - b.x);
  const row = (k) => phases[k]?.levels;
  const f2 = (v) => (v == null ? '—' : v.toFixed(2));
  return (
    <Card title="Calibration trend: rest → task → recovery" subtitle="All three on the fusion scale: baseline below, each component's own limit at 0.50">
      {!comps.length ? <div className="chart-empty" style={{ height: 200 }}>No calibration yet. Recalibrate below.</div> : (
        <MultiLineChart points={pts} height={260} yDomain={[0, 1]} xDomain={[0, 3]} xFormat={() => ''} yFormat={(v) => v.toFixed(2)}
          bands={[{ x0: 0, x1: 1, label: 'Rest', kind: 'a' }, { x0: 1, x1: 2, label: 'Task', kind: 'b' }, { x0: 2, x1: 3, label: 'Recovery', kind: 'a' }]}
          refLines={[{ y: 0.5, label: 'limit' }]} ariaLabel="Calibration trend for mind, body and fused"
          series={comps.map(([k, l, c]) => ({ key: k, label: l, color: c, width: k === 'fused' ? 3 : 2, dash: k === 'fused', connect: true }))} />
      )}
      {comps.length > 0 && (
        <table className="phase-table">
          <thead><tr><th /><th>Baseline</th><th>Sustained task</th><th>Recovery</th><th>Rose in task</th><th>Dropped after</th></tr></thead>
          <tbody>
            {comps.map(([k, l]) => {
              const L = row(k); const up = L.task != null && L.task > L.rest && L.task >= 0.5;
              const dn = L.recovery != null && L.task != null && L.recovery < L.task && L.recovery < 0.5;
              return (
                <tr key={k}>
                  <th>{l}{k === 'fused' ? <small> · {phases.fused.inputs}</small> : null}</th>
                  <td>{f2(L.rest)}</td><td>{f2(L.task)}</td><td>{f2(L.recovery)}</td>
                  <td className={L.task == null ? 'muted' : up ? 'ok' : 'bad'}>{L.task == null ? '—' : up ? 'yes' : 'no'}</td>
                  <td className={L.recovery == null ? 'muted' : dn ? 'ok' : 'bad'}>{L.recovery == null ? '—' : dn ? 'yes' : 'no'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export default function CalibrationDashboard({ now, go }) {
  const picker = useSessionPicker();
  const uid = picker.userId; const sid = picker.sessionId;
  const eeg = useSessionData(uid, sid);
  const ring = usePhysioData(uid, sid);
  const history = useEegCalibrations(uid, `${sid}|${eeg.calibration?.updated_at ?? ''}|${eeg.threshold?.updated_at ?? ''}`);
  const device = useFirebaseValue('eeg_devices/wearable02');
  const streaming = device?.last_seen != null && now / 1000 - device.last_seen < 60;
  const limits = calibratedLimits({ eeg, history, sid, ring });
  const { cal, thr, phases } = limits;
  const recalReq = useFirebaseValue(sid ? `eeg_recalibration/${sid}` : null);
  const ringReq = useFirebaseValue(uid ? `ring_recalibration/${uid}` : null);
  const gate = decisionGate({ cal, thr, ringThresholds: ring.thresholds, ringPresent: ring.windows.length > 0 || Boolean(ring.baseline),
    eegRecal: recalReq, ringRecal: ringReq, nowMs: now });

  return (
    <div className="page">
      <TechNav page="calibration" go={go} picker={picker} title="Calibration"
        subtitle="Rest, a high-load task, then recovery: each component's own baseline and limit. They are used for every decision until the user recalibrates." />
      {gate.paused ? <p className="sd-gate">⏳ <b>Not calibrated yet.</b> Recalibrate below (with the headband and ring on).</p>
        : gate.recalibrating ? <p className="sd-gate">⏳ <b>Recalibrating</b>: follow the steps below; the limits update when it finishes.</p>
          : <p className="sd-gate ok">✓ Calibrated {clock(gate.startMs)}.{limits.mind?.keptOver ? ' A later resting baseline made by the bridge alone (service restart / new session) is not used.' : ''}</p>}
      <LimitsStrip limits={limits} />
      <TrendCard phases={phases} />
      <LiveCalibrationCard sid={sid} uid={uid} />
      <RecalibratePanel picker={picker} now={now} streaming={streaming} />
      <div id="stimulator"><StimulatorPanel now={now} /></div>
    </div>
  );
}
