import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useCalibration, useDeviceStatus, useLivePointer, useNow } from '../hooks/useLive';
import { useEegBlocks, useFusion, useRingHistory } from '../hooks/useStreams';
import {
  COLORS, levelOf, LEVEL_COLOR, MIND_WORDS, BODY_WORDS, OVERALL_WORDS, sliderPosition,
  DEFAULT_RING_THRESHOLD, DEFAULT_EEG_THRESHOLD, timeAgo, EEG_BASIS,
} from '../lib/levels';
import { Card, CardHead, ActionTile, DeviceChip, Stat, Seg, Badge } from '../components/ui';
import BalanceRing from '../components/BalanceRing';
import LevelSlider from '../components/LevelSlider';
import Chart, { toRows } from '../components/Chart';
import { alignedOf, fusedAligned } from '../lib/aligned';
import LiveSignals from '../components/LiveSignals';
import TakeOverBanner from '../components/TakeOverBanner';
import BreathingModal from '../components/BreathingModal';
import BaselineDriftCard from '../components/BaselineDriftCard';
import useCondition from '../hooks/useCondition';
import StimulatorCard, { StimulatorBanner } from '../components/Stimulator';

const LIVE_WINDOW_MS = 3 * 60 * 1000;
const fmtS = (v) => (v == null ? '—' : Math.abs(v) < 0.01 && v !== 0 ? v.toExponential(1) : v.toFixed(2));

// Same plain-language copy as the app's Fusion hub.
const HERO = {
  calm:   { word: 'Calm',          line: 'Your mind and body are settled.',                       tip: 'All good — keep going',          icon: '😊' },
  rising: { word: 'Rising',        line: 'Stress is building up a little.',                       tip: 'A short pause would help',       icon: '😐' },
  high:   { word: 'Stressed',      line: 'Your body and mind are under strain right now.',        tip: 'Try a 1-minute breathing break', icon: '😟' },
  idle:   { word: 'Not connected', line: 'Put on your ring or headband to see how you’re doing.', tip: 'Waiting for devices',            icon: '🔌' },
  // Condition from mind x body, each against its own calibrated limit (useCondition).
  mental:  { word: 'High mental load', line: 'You’re concentrating hard.', tip: 'Short pause when you can', icon: '🧠' },
  arousal: { word: 'Physical arousal', line: 'Your body is activated (movement, caffeine, emotion?).', tip: 'Slow breathing helps', icon: '💓' },
  calibrating: { word: 'Calibrating', line: 'Your personal calm level and limits are being set. Readings are judged after this.', tip: 'Sit still and relax', icon: '⏳' },
  stale:  { word: 'Recalibrate',   line: 'Your skin signal is far from your saved calm level, so the stress reading can’t be trusted.', tip: 'Recalibrate to fix this', icon: '🔄' },
};
const HERO_GRAD = {
  calm: 'linear-gradient(135deg, #7CB878 0%, #5E935A 100%)',
  rising: 'linear-gradient(135deg, #F2BC62 0%, #E8A238 100%)',
  high: 'linear-gradient(135deg, #EE8A71 0%, #E56B4E 100%)',
  idle: 'linear-gradient(135deg, #A29DD4 0%, #6E68B2 100%)',
  stale: 'linear-gradient(135deg, #B9B3A6 0%, #8C8678 100%)',
  mental: 'linear-gradient(135deg, #7FA7E8 0%, #4F7FD0 100%)',
  arousal: 'linear-gradient(135deg, #F2A277 0%, #E07B4C 100%)',
  calibrating: 'linear-gradient(135deg, #A29DD4 0%, #6E68B2 100%)',
};

const BANDS = [
  { key: 'delta_rel_power', name: 'Deep rest', color: '#94A3B8' },
  { key: 'theta_rel_power', name: 'Daydream',  color: '#A78BFA' },
  { key: 'alpha_rel_power', name: 'Relaxed',   color: '#5E935A' },
  { key: 'beta_rel_power',  name: 'Focused',   color: '#E8A238' },
  { key: 'gamma_rel_power', name: 'Intense',   color: '#E56B4E' },
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function UserDashboard() {
  const navigate = useNavigate();
  const { user, token, sessionMode } = useAuth();
  const userId = user?.userId;
  const now = useNow(20000);
  const pointer = useLivePointer();
  const liveSid = pointer.userId === userId ? pointer.sessionId : null;

  const { ring: ringCal, eeg: eegCal, loading: ringCalLoading } = useCalibration(userId, token);
  const { ringOnline, eegOnline, eegSessionId } = useDeviceStatus(userId);
  const fusion = useFusion(userId, liveSid);
  const ring = useRingHistory(userId, { pollMs: 10000 });
  const eeg = useEegBlocks(userId, pointer.userId === userId ? eegSessionId : null);
  // Mind / body / condition against the calibrated baseline and limits (decisions only after calibration).
  const cond = useCondition(userId, pointer.userId === userId ? eegSessionId : null, eeg.blocks, ring.windows);

  const [rhythmTab, setRhythmTab] = useState('all');
  const [bodyTab, setBodyTab] = useState('stress');
  const [breathing, setBreathing] = useState(false);

  // ── Current state (same rules as FusionSessionScreen) ──
  const latest = fusion.latest;
  const ringLatest = ring.windows[ring.windows.length - 1] || null;
  const isLive = fusion.latestMs != null && now - fusion.latestMs < LIVE_WINDOW_MS;

  let heroKey;
  if (latest) {
    if (latest.fused_label === 1) heroKey = 'high';
    else if (latest.stress_trend === 'increasing' || latest.stress_phase === 'trending_towards_stress') heroKey = 'rising';
    else heroKey = 'calm';
  } else if (ringLatest) {
    heroKey = ringLatest.label === 'Stress' ? 'high' : 'calm';
  } else {
    heroKey = ringOnline || eegOnline ? 'calm' : 'idle';
  }
  // The ring's newest reading is far from the saved baseline: the stress
  // label would be unreliable, so say so instead of showing "Stressed".
  const baselineStale = (fusion.latestBody?.baseline_stale ?? ringLatest?.baseline_stale) === true;
  if (cond.condition) {
    heroKey = { relaxed: 'calm', mental: 'mental', arousal: 'arousal', stress: 'high' }[cond.condition.key];
  } else if (cond.gate.paused && (cond.recal.eeg?.status === 'capturing' || cond.recal.ring?.status === 'capturing')) {
    heroKey = 'calibrating';
  }
  if (baselineStale && heroKey !== 'idle' && heroKey !== 'calibrating') heroKey = 'stale';
  const hero = HERO[heroKey];
  const lastMs = fusion.latestMs ?? fusion.lastAnyMs ?? (ringLatest ? new Date(ringLatest.timestamp).getTime() : null);
  const heroWhen = isLive ? 'Live · updated just now' : lastMs ? `Last reading ${timeAgo(lastMs)}` : 'No readings yet';

  const ringThr = cond.body.limit ?? ringCal?.personal_stress_threshold ?? DEFAULT_RING_THRESHOLD;
  const eegThr = eegCal?.personal_high_load_p ?? DEFAULT_EEG_THRESHOLD;

  // Mind and body on the 0-1 scale where each one's OWN calibrated limit is 0.50
  // (the raw EEG score is often ~1e-9..1e-3 on this headband, so comparing raw
  // values made the ring read "Relaxed" whatever happened).
  const mindP = cond.mind.value;
  const mindLevel = levelOf(mindP, 0.5);
  // Non-calibrated EEG (weak signal, no personal baseline) still shows, but
  // labelled -- it only enters fusion at reduced weight.
  const mindBasis = EEG_BASIS[fusion.latestMind?.eeg_basis] || null;
  const mindCaveat = mindBasis && fusion.latestMind?.eeg_basis !== 'calibrated' ? mindBasis.word : null;
  const bodyP = cond.body.value;
  const bodyLevel = levelOf(bodyP, 0.5);
  const fusedP = latest?.fused_probability ?? null;
  const fusedT = latest?.fused_threshold ?? DEFAULT_RING_THRESHOLD;
  const fusedLevel = levelOf(fusedP, fusedT);

  // ── Rhythm chart (fused / mind / body), each against its own limit ──
  // Windows fused on the aligned scale (fusion_engin.py) carry each model's
  // value with its own limit at 0.5 -- plot Mind/Body on that same scale so
  // all three tabs are comparable and the limit is 50 for each.
  const aligned = fusion.rows.some((r) => r.w.fused_scale === 'aligned');
  const rhythm = useMemo(() => {
    // All three on one shared scale (each model's own limit = 50), like the
    // fusion view of the technical dashboard: Mind, Body and the fused value.
    if (rhythmTab === 'all') {
      const rows = fusion.rows
        .map((r) => ({
          date: r.date,
          // Fused first so it is drawn underneath: when only one input is
          // reporting the fused value equals it, and the line stays visible.
          values: [fusedAligned(r.w), alignedOf(r.w, 'eeg'), alignedOf(r.w, 'hrv')]
            .map((v) => (v == null ? null : Math.round(v * 100))),
        }))
        .filter((r) => r.values.some((v) => v != null));
      return { rows, limit: 50, multi: true };
    }
    const pick = {
      overall: { f: 'fused_probability', t: 'fused_threshold', fb: DEFAULT_RING_THRESHOLD },
      mind: aligned ? { f: 'eeg_aligned', t: null, fb: 0.5 } : { f: 'prob_eeg', t: 'threshold_eeg', fb: eegThr },
      body: aligned ? { f: 'hrv_gsr_aligned', t: null, fb: 0.5 } : { f: 'prob_hrv_gsr', t: 'threshold_hrv_gsr', fb: ringThr },
    }[rhythmTab];
    const pts = fusion.rows
      .filter((r) => r.w[pick.f] != null)
      .map((r) => ({ date: r.date, value: Math.round(r.w[pick.f] * 100) }));
    const lastWithThr = pick.t ? [...fusion.rows].reverse().find((r) => r.w[pick.t] != null) : null;
    const limit = Math.round((lastWithThr?.w[pick.t] ?? pick.fb) * 100);
    return { rows: toRows(pts), limit };
  }, [fusion.rows, rhythmTab, eegThr, ringThr, aligned]);

  // ── Body detail (ring) -- same Stress / Heart / Skin tabs as the app's Ring screen ──
  const BODY_TABS = {
    stress: { name: 'Stress', color: COLORS.brand, suffix: '%', sub: 'Higher means more stress · dashed line is your limit' },
    heart: { name: 'Heart rate', color: COLORS.hrv, suffix: ' bpm', sub: 'Average heart rate per minute' },
    skin: { name: 'Skin response', color: COLORS.gsr, suffix: ' µS', sub: 'Skin response — rises with tension or excitement' },
  };
  const bodySeries = useMemo(() => {
    if (bodyTab === 'stress') {
      return toRows(ring.windows
        .filter((w) => w.prob_stress != null)
        .map((w) => ({ date: new Date(w.timestamp), value: Math.round(w.prob_stress * 100) })));
    }
    const key = bodyTab === 'heart' ? 'MeanHR' : 'SCL_mean';
    return toRows(ring.windows
      .filter((w) => w.features?.[key] != null)
      .map((w) => ({ date: new Date(w.timestamp), value: Number(w.features[key].toFixed(bodyTab === 'heart' ? 0 : 2)) })));
  }, [ring.windows, bodyTab]);
  const bodyCfg = BODY_TABS[bodyTab];
  const hr = ringLatest?.features?.MeanHR;
  const scl = ringLatest?.features?.SCL_mean;

  // ── Mind detail (EEG) ──
  const eegLatest = eeg.latest || eeg.blocks[eeg.blocks.length - 1] || null;

  // Trusted scores and provisional (weak-signal) scores as two series, so a
  // session with imperfect contact still shows a trace -- clearly separate.
  // Mental load against this user's calibrated limit (0-1 scale, limit = 50%).
  const loadRows = useMemo(() => cond.mind.rows.filter((r) => r.v != null)
    .map((r) => ({ date: new Date(r.t), values: [Math.round(r.v * 100)] })), [cond.mind.rows]);

  const firstName = (user?.name || userId || '').split(/[\s_.]/)[0];
  const displayName = firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1) : 'there';

  return (
    <>
      <div className="greet">
        <h1>{greeting()}, <b>{displayName}</b></h1>
        <p>How are you doing today?</p>
      </div>

      {!ringCalLoading && !ringCal?.exists && !eegCal?.exists && (
        <div className="banner info" style={{ marginBottom: 20, justifyContent: 'space-between' }}>
          <span>✨ Set up your personal baseline so readings are judged against <b>your</b> body.</span>
          <button className="btn sm" onClick={() => navigate('/setup')}>Start setup</button>
        </div>
      )}
      <StimulatorBanner />
      {sessionMode === 'view' && (
        <TakeOverBanner holder={pointer.userId} style={{ marginBottom: 20 }} />
      )}
      {latest?.stress_alert_message && (
        <div className={`banner ${heroKey === 'high' ? 'stress' : 'warning'}`} style={{ marginBottom: 20 }}>
          ⚠️ {latest.stress_alert_message}
        </div>
      )}

      <div className="grid grid-hero">
        <div className="hero" style={{ background: HERO_GRAD[heroKey] }}>
          <div>
            <div className={`orb ${isLive ? 'pulse' : ''}`}>{hero.icon}</div>
            <div className="word">{hero.word}</div>
            <p className="line">{hero.line}</p>
          </div>
          <div className="foot">
            <button className="tip" onClick={() => setBreathing(true)}>{hero.tip} →</button>
            <span className="when">
              <span className={`dot ${isLive ? 'live' : ''}`} style={{ background: '#fff' }} />
              {heroWhen}
            </span>
          </div>
        </div>

        <Card>
          <CardHead title="Your balance" sub="Judged against your own calibrated calm level and limit (50 = your limit)" />
          <div className="rings">
            <BalanceRing title="Mind" value={mindP != null ? mindP * 100 : null}
              word={mindLevel ? MIND_WORDS[mindLevel] : undefined}
              color={mindCaveat ? COLORS.textMuted : (LEVEL_COLOR[mindLevel] || COLORS.eeg)} />
            <BalanceRing title="Body" value={bodyP != null ? bodyP * 100 : null}
              word={BODY_WORDS[bodyLevel]} color={LEVEL_COLOR[bodyLevel] || COLORS.hrv} />
          </div>
          <div className="limits-row">
            <div><span>Mind calm level · limit</span><b>{fmtS(cond.mind.baseline)} · {fmtS(cond.mind.limit)}</b>
              <em>{cond.eegInfo ? (cond.mind.personal ? 'personal limit' : 'provisional limit') : 'not calibrated'}</em></div>
            <div><span>Body calm level · limit</span><b>{fmtS(cond.body.baseline)} · {fmtS(cond.body.limit)}</b>
              <em>{cond.body.hasBaseline ? (cond.body.personal ? 'personal limit' : 'population limit') : 'not calibrated'}</em></div>
          </div>
          <div className={`condition ${cond.condition?.key || 'none'}`}>
            <span>Your condition</span>
            <b>{cond.condition ? cond.condition.label : cond.gate.paused ? 'Calibrating…' : '—'}</b>
            <em>{cond.condition ? (cond.condition.message || 'Mind and body below their limits.') + (cond.condition.partial ? ` (${cond.condition.partial})` : '')
              : 'Shown once calibration is done.'}</em>
          </div>
          <LevelSlider title="Overall stress" position={sliderPosition(fusedP, fusedT)}
            word={OVERALL_WORDS[fusedLevel]} color={LEVEL_COLOR[fusedLevel]} />
        </Card>
      </div>

      <Card style={{ marginTop: 20 }}>
        <CardHead
          title="Your stress rhythm"
          sub="Last few sessions · hover the line to see any moment"
          right={<Seg value={rhythmTab} onChange={setRhythmTab} options={[
            { value: 'all', label: 'All' }, { value: 'overall', label: 'Overall' },
            { value: 'mind', label: 'Mind' }, { value: 'body', label: 'Body' },
          ]} />}
        />
        {rhythm.multi ? (
          <Chart key="all" rows={rhythm.rows} limit={rhythm.limit} limitLabel="Your limit" zones={false}
            series={[
              { name: 'Fused', color: COLORS.text, width: 7, opacity: 0.22 },
              { name: 'Mind', color: COLORS.eeg },
              { name: 'Body', color: COLORS.hrv },
            ]}
            domain={[0, 100]} suffix="%" height={260}
            empty="Your rhythm will appear here after your first session with the devices." />
        ) : (
          <Chart key={rhythmTab} rows={rhythm.rows} series={[{ name: 'Stress', color: COLORS.brand }]} limit={rhythm.limit}
            domain={[0, 100]} suffix="%" height={240}
            empty="Your rhythm will appear here after your first session with the devices." />
        )}
        {rhythm.multi && (
          <p className="caption" style={{ marginTop: 8 }}>
            Each line is shown against its own limit, so 50% means "at your limit" for Mind, Body and Fused alike.
            A gap means that input did not report in that window.
          </p>
        )}
      </Card>

      {sessionMode !== 'view' && (
        <div style={{ marginTop: 20 }}><LiveSignals /></div>
      )}

      <div className="grid grid-2" style={{ marginTop: 20 }}>
        <Card>
          <CardHead title="Body" sub="From your ring"
            right={<Seg value={bodyTab} onChange={setBodyTab} options={[
              { value: 'stress', label: 'Stress' }, { value: 'heart', label: 'Heart' }, { value: 'skin', label: 'Skin' },
            ]} />} />
          <div className="grid grid-2" style={{ gap: 12, marginBottom: 14 }}>
            <Stat label="Heart rate" value={hr != null ? Math.round(hr) : null} unit="bpm" tint={COLORS.hrv} />
            <Stat label="Skin response" value={scl != null ? scl.toFixed(1) : null} unit="µS" tint={COLORS.gsr} />
          </div>
          <p className="caption" style={{ margin: '0 0 8px' }}>{bodyCfg.sub}</p>
          {/* key: each tab is its own chart, so switching opens on the newest readings. */}
          <Chart key={bodyTab} rows={bodySeries}
            series={[{ name: bodyCfg.name, color: bodyCfg.color }]}
            suffix={bodyCfg.suffix} height={190}
            {...(bodyTab === 'stress' ? { domain: [0, 100], limit: Math.round(ringThr * 100) } : {})}
            empty="Wear your ring to see this." />
        </Card>

        <Card>
          <CardHead title="Mind" sub="From your headband · 50% = your calibrated limit"
            right={eegLatest ? <Badge color={eegLatest.eeg_quality_flag ? COLORS.normal : COLORS.warning} dot>
              {eegLatest.eeg_quality_flag ? 'Good contact' : 'Adjust headband'}</Badge> : null} />
          {!eegLatest && <p className="body">Put on your headband to see this.</p>}
          <div style={{ marginTop: 12 }}>
            <Chart
              rows={loadRows}
              series={[{ name: 'Mental load', color: COLORS.eeg }]}
              limit={50}
              domain={[0, 100]} suffix="%" height={190} empty="No headband readings yet." />
          </div>
        </Card>
      </div>

      <div className="grid grid-2" style={{ marginTop: 20 }}>
        <ActionTile lead="Take a" bold="breathing" tail="break" caption="One calm minute" icon="🌬️"
          tint={COLORS.brand} onClick={() => setBreathing(true)} />
        <div className="stack" style={{ gap: 12 }}>
          <DeviceChip icon="💍" tint={COLORS.hrv} name="Ring" online={ringOnline}
            detail={ringOnline ? 'Streaming heart & skin' : 'Not connected'} />
          <DeviceChip icon="🧠" tint={COLORS.eeg} name="Headband" online={eegOnline}
            detail={eegOnline ? 'Streaming brainwaves' : 'Not connected'} />
        </div>
      </div>

      <div style={{ marginTop: 20 }}><StimulatorCard loggedIn={pointer.userId || null} /></div>

      <div style={{ marginTop: 20 }}>
        <BaselineDriftCard userId={userId} ringCal={ringCal} />
      </div>

      {breathing && <BreathingModal onClose={() => setBreathing(false)} />}
    </>
  );
}
