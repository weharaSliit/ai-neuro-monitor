import { useCallback, useEffect, useRef, useState } from 'react';
import { api, eegApi, deviceApi, DEVICE_ID } from '../lib/api';
import { COLORS } from '../lib/levels';

// Web port of StressApp/modules/shared/CalibrateBreathingCard.js -- same
// endpoints, same rules (one Start runs Ring + Headband, whichever are
// online; completion waits for every online device), same presentation:
// a calm circle inside a progress ring, plus one plain-language progress
// bar per device.
//
// Calibration protocol (backend/common/config.py, psychological/mqtt_bridge.py):
// 2 min settle (discarded), then a 4 min resting baseline with NATURAL
// breathing and eyes open -- no paced-breathing guide: slow paced breathing
// raises HRV well above a normal resting level, so the baseline wouldn't
// describe ordinary rest. Ring 120 s + 4 x 60 s; headband 120 s + 10 x 25 s.
const IN_PROGRESS = ['settling', 'capturing', 'saving'];
const POLL_MS = 2000;
const SETTLE_SEC = 120;
const EXPECTED_SEC = { ring: 120 + 4 * 60, eeg: 120 + 10 * 25 };
const ORB = 210;
const STROKE = 9;

function useCaptureRunner(onUpdate) {
  const poll = useRef(null);
  const stop = useCallback(() => { if (poll.current) { clearInterval(poll.current); poll.current = null; } }, []);
  const run = useCallback(async (startFn, statusFn) => {
    onUpdate({ status: 'settling' });
    try {
      await startFn();
    } catch (e) {
      if (e?.response?.status !== 409) {
        onUpdate({ status: 'error', message: e?.response?.data?.error || e.message });
        return;
      }
    }
    poll.current = setInterval(async () => {
      try {
        const res = await statusFn();
        onUpdate(res.data);
        if (res.data?.status && !IN_PROGRESS.includes(res.data.status)) stop();
      } catch { /* next tick retries */ }
    }, POLL_MS);
  }, [onUpdate, stop]);
  useEffect(() => stop, [stop]);
  return run;
}

// Ring reports capture progress as window_idx/n_windows, the EEG service as
// block_idx/n_blocks (eeg_calibration_capture.py) -- accept either.
function captureStep(state) {
  const idx = state.window_idx ?? state.block_idx;
  const total = state.n_windows ?? state.n_blocks;
  return idx != null && total ? { idx, total } : null;
}

// EEG's 'done' nests the real calibration outcome; 'degraded' means no
// block cleared the quality bar and the best weak one was used instead.
function isDegraded(state) {
  return state.status === 'done' && state.outcome?.status === 'degraded';
}

function deviceProgress(state, expected, elapsedSec, totalSec) {
  if (!expected) return null;
  if (!state.triggered || state.status === 'error') return 0;
  if (!IN_PROGRESS.includes(state.status)) return 1;
  const timeFrac = Math.min(0.95, elapsedSec / totalSec);
  if (state.status === 'saving') return 0.97;
  const step = captureStep(state);
  if (state.status === 'capturing' && step) {
    return Math.min(0.96, Math.max(timeFrac, 0.15 + 0.8 * (step.idx / step.total)));
  }
  return timeFrac;
}

function deviceWords(state, expected) {
  if (!expected) return 'Not connected — skipped';
  if (!state.triggered) return 'Getting ready…';
  if (state.status === 'error') return state.message || 'Something went wrong';
  if (state.status === 'settling') return 'Settling — the first 2 minutes are not used…';
  if (state.status === 'capturing') {
    const step = captureStep(state);
    return step ? `Learning your calm (${step.idx} of ${step.total})` : 'Learning your calm…';
  }
  if (state.status === 'saving') return 'Saving…';
  if (isDegraded(state)) return 'Done, but the signal was weak — recalibrate later for better accuracy';
  return 'Done ✓';
}

function freshnessLine(ring, eeg) {
  const sides = [ring, eeg].filter((s) => s?.exists && s.age_days != null);
  if (!sides.length) return { text: 'Not calibrated yet — this takes about 6 minutes.', warn: true };
  const days = Math.floor(Math.min(...sides.map((s) => s.age_days)));
  const when = days < 1 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  const stale = sides.some((s) => s.is_stale_soft);
  return { text: `Last calibrated ${when}${stale ? ' — time to recalibrate.' : ' — recalibrate about once a week.'}`, warn: stale };
}

function DeviceRow({ icon, tint, label, words, progress, failed }) {
  const off = progress == null;
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', flex: 'none',
        background: (off ? COLORS.border : tint) + '22', filter: off ? 'grayscale(1)' : 'none' }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="between"><b style={{ fontSize: 13 }}>{label}</b>{!off && <span className="caption">{Math.round(progress * 100)}%</span>}</div>
        <div className="caption" style={{ color: failed ? COLORS.stressDark : undefined }}>{words}</div>
        {!off && (
          <div style={{ height: 8, borderRadius: 4, background: COLORS.borderSoft, marginTop: 6, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.round(progress * 100)}%`, borderRadius: 4,
              background: failed ? COLORS.stress : tint, transition: 'width 0.8s ease' }} />
          </div>
        )}
      </div>
    </div>
  );
}

export default function BreathingCalibration({ ringOnline, eegOnline, eegSessionId, onComplete, disabled, ringCal, eegCal }) {
  const [stage, setStage] = useState('idle'); // idle | running | complete | error
  const [ringState, setRingState] = useState({ triggered: false, status: 'idle' });
  const [eegState, setEegState] = useState({ triggered: false, status: 'idle' });
  const [errorMsg, setErrorMsg] = useState(null);
  const [finger, setFinger] = useState(null);
  const [startedAt, setStartedAt] = useState(null);
  const [now, setNow] = useState(Date.now());

  const runRing = useCaptureRunner(useCallback((d) => setRingState((r) => ({ ...r, ...d })), []));
  const runEeg = useCaptureRunner(useCallback((d) => setEegState((e) => ({ ...e, ...d })), []));

  const ringExpected = ringOnline;
  const eegExpected = eegOnline && !!eegSessionId;

  const startRing = useCallback(() => {
    setRingState((r) => ({ ...r, triggered: true }));
    runRing(() => api.post('/calibrate/start', {}), () => api.get('/calibrate/status'));
  }, [runRing]);
  const startEeg = useCallback(() => {
    setEegState((e) => ({ ...e, triggered: true }));
    runEeg(() => eegApi.post('/calibrate/start', { session_id: eegSessionId }), () => eegApi.get('/calibrate/status'));
  }, [runEeg, eegSessionId]);

  const start = () => {
    if (!ringOnline && !eegOnline) {
      setErrorMsg('No device detected — turn on and wear your ring or headband first.');
      setStage('error');
      return;
    }
    setErrorMsg(null);
    setStartedAt(Date.now());
    setStage('running');
  };

  useEffect(() => {
    if (stage !== 'running') return;
    if (ringExpected && !ringState.triggered) startRing();
    if (eegExpected && !eegState.triggered) startEeg();
  }, [stage, ringExpected, eegExpected, ringState.triggered, eegState.triggered, startRing, startEeg]);

  useEffect(() => {
    if (stage !== 'running' || (!ringState.triggered && !eegState.triggered)) return;
    const ringDone = !ringExpected || (ringState.triggered && !IN_PROGRESS.includes(ringState.status));
    const eegDone = !eegExpected || (eegState.triggered && !IN_PROGRESS.includes(eegState.status));
    if (!ringDone || !eegDone) return;
    const failed = (ringState.triggered && ringState.status === 'error') || (eegState.triggered && eegState.status === 'error');
    if (failed) {
      setErrorMsg((ringState.status === 'error' && ringState.message) || (eegState.status === 'error' && eegState.message) || 'Calibration failed');
      setStage('error');
    } else {
      setStage('complete');
      onComplete?.();
    }
  }, [stage, ringState, eegState, ringExpected, eegExpected, onComplete]);

  useEffect(() => {
    if (stage !== 'running') return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [stage]);

  useEffect(() => {
    if (!(ringState.triggered && IN_PROGRESS.includes(ringState.status))) { setFinger(null); return undefined; }
    let cancelled = false;
    const poll = () => deviceApi.get(`/devices/${DEVICE_ID}/status`)
      .then((r) => { if (!cancelled) setFinger(r.data?.finger_detected === undefined ? null : !!r.data.finger_detected); })
      .catch(() => {});
    poll();
    const id = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [ringState.triggered, ringState.status]);

  const retry = () => {
    setStage('idle'); setErrorMsg(null); setStartedAt(null);
    setRingState({ triggered: false, status: 'idle' });
    setEegState({ triggered: false, status: 'idle' });
  };

  const running = stage === 'running';
  const elapsedSec = startedAt ? (now - startedAt) / 1000 : 0;
  const ringP = deviceProgress(ringState, ringExpected, elapsedSec, EXPECTED_SEC.ring);
  const eegP = deviceProgress(eegState, eegExpected, elapsedSec, EXPECTED_SEC.eeg);
  const parts = [ringP, eegP].filter((p) => p != null);
  const overall = stage === 'complete' ? 1 : parts.length ? Math.min(...parts) : 0;
  const longest = Math.max(ringExpected ? EXPECTED_SEC.ring : 0, eegExpected ? EXPECTED_SEC.eeg : 0);
  const leftSec = Math.max(0, Math.round(longest - elapsedSec));
  const leftText = leftSec > 60 ? `about ${Math.ceil(leftSec / 60)} min left` : leftSec > 0 ? `about ${leftSec}s left` : 'finishing up…';
  const settling = running && elapsedSec < SETTLE_SEC;
  const settleLeft = Math.max(0, Math.round(SETTLE_SEC - elapsedSec));
  const R = (ORB - STROKE) / 2;
  const C = 2 * Math.PI * R;
  const fresh = freshnessLine(ringCal, eegCal);
  const orbColor = stage === 'complete' ? COLORS.normal : stage === 'error' ? COLORS.stress : COLORS.brand;

  return (
    <div style={{ textAlign: 'center' }}>
      {stage === 'idle' && (
        <div className={`banner ${fresh.warn ? 'warning' : 'info'}`} style={{ textAlign: 'left' }}>
          {fresh.warn ? '⏰' : '✅'} {fresh.text}
        </div>
      )}

      {/* Breathing orb inside a progress ring */}
      <div style={{ position: 'relative', width: ORB, height: ORB, margin: '18px auto' }}>
        <svg width={ORB} height={ORB} style={{ position: 'absolute', inset: 0 }}>
          <circle cx={ORB / 2} cy={ORB / 2} r={R} fill="none" stroke={COLORS.borderSoft} strokeWidth={STROKE} />
          {(running || stage === 'complete') && (
            <circle cx={ORB / 2} cy={ORB / 2} r={R} fill="none" stroke={stage === 'complete' ? COLORS.normal : COLORS.brand}
              strokeWidth={STROKE} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - overall)}
              transform={`rotate(-90 ${ORB / 2} ${ORB / 2})`} style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
          )}
        </svg>
        <div style={{
          position: 'absolute', inset: 22, borderRadius: '50%', display: 'grid', placeContent: 'center',
          background: `radial-gradient(circle at 35% 30%, ${orbColor}CC, ${orbColor})`, color: '#fff',
          boxShadow: '0 10px 24px rgba(79,73,148,0.28)',
          transform: `scale(${running ? 0.92 : 0.88})`,
          transition: 'transform 600ms ease-in-out',
          animation: stage === 'idle' || running ? 'pulse 6s ease-in-out infinite' : 'none',
        }}>
          <div style={{ fontSize: 20, fontWeight: 900 }}>{running ? (settling ? 'Settling' : 'Resting') : stage === 'complete' ? '✓' : stage === 'error' ? '!' : '🧘'}</div>
          {running && <div style={{ fontSize: 13, fontWeight: 800, opacity: 0.85, marginTop: 2 }}>{Math.round(overall * 100)}%</div>}
        </div>
      </div>

      {stage === 'idle' && (
        <>
          <p style={{ fontWeight: 800, margin: 0 }}>Sit comfortably, keep still, eyes open, and breathe normally.</p>
          <p className="body" style={{ marginTop: 4 }}>
            We learn what “calm” looks like for you: 2 minutes to settle, then 4 minutes of quiet rest. About 6 minutes in all.
          </p>
          <div className="row" style={{ justifyContent: 'center', margin: '14px 0', flexWrap: 'wrap' }}>
            <span className="badge" style={{ background: ringOnline ? COLORS.normalSoft : COLORS.pill, color: ringOnline ? COLORS.normalDark : COLORS.textMuted }}>💍 Ring {ringOnline ? 'ready' : 'off'}</span>
            <span className="badge" style={{ background: eegOnline ? COLORS.normalSoft : COLORS.pill, color: eegOnline ? COLORS.normalDark : COLORS.textMuted }}>🧠 Headband {eegOnline ? 'ready' : 'off'}</span>
          </div>
          <button className="btn" style={{ width: '100%', maxWidth: 360 }} onClick={start} disabled={disabled}>▶ Start calibration</button>
          {!ringOnline && !eegOnline && <p className="caption" style={{ marginTop: 8 }}>Turn on and wear at least one device first.</p>}
        </>
      )}

      {running && (
        <>
          <p style={{ fontWeight: 800, margin: 0 }}>
            {settling ? `Settling in — ${settleLeft}s (not recorded)` : 'Resting baseline — eyes open, breathe normally'}
          </p>
          <p className="caption" style={{ marginTop: 4 }}>{leftText} · keep still, look at one spot, don&apos;t talk</p>
          <div style={{ display: 'grid', gap: 14, marginTop: 18, textAlign: 'left' }}>
            <DeviceRow icon="💍" tint={COLORS.hrv} label="Ring" progress={ringP} words={deviceWords(ringState, ringExpected)} failed={ringState.status === 'error'} />
            <DeviceRow icon="🧠" tint={isDegraded(eegState) ? COLORS.warning : COLORS.eeg} label="Headband" progress={eegP} words={deviceWords(eegState, eegExpected)} failed={eegState.status === 'error'} />
          </div>
          {ringState.triggered && finger === false && (
            <div className="banner warning" style={{ marginTop: 14, textAlign: 'left' }}>⚠ No finger on the ring — adjust it for a clean reading.</div>
          )}
        </>
      )}

      {stage === 'complete' && (
        <>
          <p style={{ fontWeight: 800, margin: 0 }}>All done — your calm baseline is saved.</p>
          <p className="body" style={{ marginTop: 4 }}>Your readings are now judged against your own body.</p>
        </>
      )}

      {stage === 'error' && (
        <>
          <div className="error">{errorMsg || 'Calibration failed'}</div>
          <button className="btn" onClick={retry}>↻ Try again</button>
        </>
      )}
    </div>
  );
}
