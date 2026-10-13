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
import BreathingModal from '../components/BreathingModal';
import BaselineDriftCard from '../components/BaselineDriftCard';

const LIVE_WINDOW_MS = 3 * 60 * 1000;

// Same plain-language copy as the app's Fusion hub.
const HERO = {
  calm:   { word: 'Calm',          line: 'Your mind and body are settled.',                       tip: 'All good — keep going',          icon: '😊' },
  rising: { word: 'Rising',        line: 'Stress is building up a little.',                       tip: 'A short pause would help',       icon: '😐' },
  high:   { word: 'Stressed',      line: 'Your body and mind are under strain right now.',        tip: 'Try a 1-minute breathing break', icon: '😟' },
  idle:   { word: 'Not connected', line: 'Put on your ring or headband to see how you’re doing.', tip: 'Waiting for devices',            icon: '🔌' },
  stale:  { word: 'Recalibrate',   line: 'Your skin signal is far from your saved calm level, so the stress reading can’t be trusted.', tip: 'Recalibrate to fix this', icon: '🔄' },
};
const HERO_GRAD = {
  calm: 'linear-gradient(135deg, #7CB878 0%, #5E935A 100%)',
  rising: 'linear-gradient(135deg, #F2BC62 0%, #E8A238 100%)',
  high: 'linear-gradient(135deg, #EE8A71 0%, #E56B4E 100%)',
  idle: 'linear-gradient(135deg, #A29DD4 0%, #6E68B2 100%)',
  stale: 'linear-gradient(135deg, #B9B3A6 0%, #8C8678 100%)',
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

  const [rhythmTab, setRhythmTab] = useState('overall');
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
  if (baselineStale && heroKey !== 'idle') heroKey = 'stale';
  const hero = HERO[heroKey];
  const lastMs = fusion.latestMs ?? fusion.lastAnyMs ?? (ringLatest ? new Date(ringLatest.timestamp).getTime() : null);
  const heroWhen = isLive ? 'Live · updated just now' : lastMs ? `Last reading ${timeAgo(lastMs)}` : 'No readings yet';

  const ringThr = ringCal?.personal_stress_threshold ?? DEFAULT_RING_THRESHOLD;
  const eegThr = eegCal?.personal_high_load_p ?? DEFAULT_EEG_THRESHOLD;

  const mindP = fusion.latestMind?.prob_eeg ?? null;
  const mindT = fusion.latestMind?.threshold_eeg ?? latest?.threshold_eeg ?? eegThr;
  const mindLevel = levelOf(mindP, mindT);
  // Non-calibrated EEG (weak signal, no personal baseline) still shows, but
  // labelled -- it only enters fusion at reduced weight.
  const mindBasis = EEG_BASIS[fusion.latestMind?.eeg_basis] || null;
  const mindCaveat = mindBasis && fusion.latestMind?.eeg_basis !== 'calibrated' ? mindBasis.word : null;
  const bodyP = fusion.latestBody?.prob_hrv_gsr ?? (latest ? null : ringLatest?.prob_stress ?? null);
  const bodyT = fusion.latestBody?.threshold_hrv_gsr ?? latest?.threshold_hrv_gsr ?? ringThr;
  const bodyLevel = levelOf(bodyP, bodyT);
  const fusedP = latest?.fused_probability ?? null;
  const fusedT = latest?.fused_threshold ?? DEFAULT_RING_THRESHOLD;
  const fusedLevel = levelOf(fusedP, fusedT);

  // ── Rhythm chart (fused / mind / body), each against its own limit ──
  const rhythm = useMemo(() => {
    const pick = {
      overall: { f: 'fused_probability', t: 'fused_threshold', fb: DEFAULT_RING_THRESHOLD },
      mind: { f: 'prob_eeg', t: 'threshold_eeg', fb: eegThr },
      body: { f: 'prob_hrv_gsr', t: 'threshold_hrv_gsr', fb: ringThr },
    }[rhythmTab];
    const pts = fusion.rows
      .filter((r) => r.w[pick.f] != null)
      .map((r) => ({ date: r.date, value: Math.round(r.w[pick.f] * 100) }));
    const lastWithThr = [...fusion.rows].reverse().find((r) => r.w[pick.t] != null);
    const limit = Math.round((lastWithThr?.w[pick.t] ?? pick.fb) * 100);
    return { rows: toRows(pts), limit };
  }, [fusion.rows, rhythmTab, eegThr, ringThr]);

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
  const bands = BANDS.map((b) => ({ ...b, v: eegLatest?.features_eeg?.bipolar?.[b.key] })).filter((b) => b.v > 0);
  const bandTotal = bands.reduce((s, b) => s + b.v, 0);
  const topBand = bands.length ? bands.reduce((a, b) => (b.v > a.v ? b : a)) : null;

  // Trusted scores and provisional (weak-signal) scores as two series, so a
  // session with imperfect contact still shows a trace -- clearly separate.
  const loadRows = useMemo(() => eeg.blocks
    .filter((b) => b.task_state_score != null || b.provisional_task_state_score != null)
    .map((b) => ({
      date: new Date(b.timestamp_end * 1000),
      values: [
        b.task_state_score != null ? Math.round(b.task_state_score * 100) : null,
        b.task_state_score == null && b.provisional_task_state_score != null
          ? Math.round(b.provisional_task_state_score * 100) : null,
      ],
    })), [eeg.blocks]);
  const hasProvisional = loadRows.some((r) => r.values[1] != null);

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
      {sessionMode === 'view' && (
        <div className="banner info" style={{ marginBottom: 20 }}>
          👀 Someone else is wearing the devices right now — you’re seeing your own past readings.
        </div>
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
          <CardHead title="Your balance" sub="Judged against your own personal limits" />
          <div className="rings">
            <BalanceRing title="Mind" value={mindP != null ? mindP * 100 : null}
              word={mindLevel ? `${MIND_WORDS[mindLevel]}${mindCaveat ? ` · ${mindCaveat.toLowerCase()}` : ''}` : undefined}
              color={mindCaveat ? COLORS.textMuted : (LEVEL_COLOR[mindLevel] || COLORS.eeg)} />
            <BalanceRing title="Body" value={bodyP != null ? bodyP * 100 : null}
              word={BODY_WORDS[bodyLevel]} color={LEVEL_COLOR[bodyLevel] || COLORS.hrv} />
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
            { value: 'overall', label: 'Overall' }, { value: 'mind', label: 'Mind' }, { value: 'body', label: 'Body' },
          ]} />}
        />
        <Chart key={rhythmTab} rows={rhythm.rows} series={[{ name: 'Stress', color: COLORS.brand }]} limit={rhythm.limit}
          domain={[0, 100]} suffix="%" height={240}
          empty="Your rhythm will appear here after your first session with the devices." />
      </Card>

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
          <CardHead title="Mind" sub="From your headband"
            right={eegLatest ? <Badge color={eegLatest.eeg_quality_flag ? COLORS.normal : COLORS.warning} dot>
              {eegLatest.eeg_quality_flag ? 'Good contact'
                : eegLatest.provisional_task_state_score != null ? 'Weak signal · provisional' : 'Adjust headband'}</Badge> : null} />
          {bands.length ? (
            <>
              <p className="body">Mostly <b style={{ color: topBand.color }}>{topBand.name.toLowerCase()}</b> brainwaves right now.</p>
              <div className="bandbar">
                {bands.map((b) => <div key={b.key} title={`${b.name} ${Math.round((b.v / bandTotal) * 100)}%`}
                  style={{ width: `${(b.v / bandTotal) * 100}%`, background: b.color }} />)}
              </div>
              <div className="legend">
                {bands.map((b) => <span key={b.key}><i style={{ background: b.color }} />{b.name} {Math.round((b.v / bandTotal) * 100)}%</span>)}
              </div>
            </>
          ) : <p className="body">Put on your headband to see your brainwave mix.</p>}
          <div style={{ marginTop: 16 }}>
            <Chart
              rows={loadRows}
              series={[{ name: 'Mental load', color: COLORS.eeg }, { name: 'Provisional (weak signal)', color: COLORS.textMuted }]}
              limit={Math.round((eegLatest?.effective_high_load_p ?? eegThr) * 100)}
              domain={[0, 100]} suffix="%" height={150} empty="No headband readings yet." />
            {(hasProvisional || mindCaveat) && (
              <p className="caption" style={{ marginTop: 6 }}>
                Grey points are provisional readings from blocks with a weak signal. They're shown and included in your
                overall level at reduced weight, but aren't used for alerts.
                {mindBasis?.note && mindCaveat ? ` Latest: ${mindBasis.note}.` : ''}
              </p>
            )}
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

      <div style={{ marginTop: 20 }}>
        <BaselineDriftCard userId={userId} ringCal={ringCal} />
      </div>

      {breathing && <BreathingModal onClose={() => setBreathing(false)} />}
    </>
  );
}
