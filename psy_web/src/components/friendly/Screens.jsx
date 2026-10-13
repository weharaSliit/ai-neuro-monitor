import { useEffect, useMemo, useState } from 'react';
import Face from './Face';
import { FaceLine, LiveWave, LoadBars, MoodLegend, bucketize } from './MoodCharts';
import { BLOCK_SEC, N_CALIBRATION_BLOCKS, POPULATION_HIGH_LOAD_P } from '../../lib/config';
import {
  MOODS, MOOD_ORDER, RHYTHMS, clockShort, friendlyAgo, greeting, headbandOf, load, moodOf, sessionLabel, signalOf,
} from '../../lib/friendly';

// ── shared helpers ─────────────────────────────────────────────────
function useReading(sessionData, profile) {
  const { blocks } = sessionData;
  const latest = blocks[blocks.length - 1] || null;
  const lastScored = [...blocks].reverse().find((b) => b.task_state_score != null) || null;
  const threshold = lastScored?.effective_high_load_p ?? latest?.effective_high_load_p
    ?? profile?.personal_high_load_p ?? POPULATION_HIGH_LOAD_P;
  const mood = moodOf(lastScored?.task_state_score, threshold);
  return { blocks, latest, lastScored, threshold, mood };
}

function Dot({ kind }) {
  return <i className={`fdot fdot-${kind}`} aria-hidden="true" />;
}

function Tile({ tone, icon, title, value, foot, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className={`tile tone-${tone}`} onClick={onClick}>
      <div className="tile-head"><span className="tile-icon" aria-hidden="true">{icon}</span><span className="serif">{title}</span></div>
      <div className="tile-value">{value}</div>
      {foot && <div className="tile-foot">{foot}</div>}
    </Tag>
  );
}

function ScreenTitle({ children, sub }) {
  return (
    <div className="screen-title">
      <h1 className="serif">{children}</h1>
      {sub && <p>{sub}</p>}
    </div>
  );
}

// What should the person do right now? One clear sentence.
function stageOf({ raw, now, sessionData, reading }) {
  const head = headbandOf(raw, now);
  const c = sessionData.calibration;
  if (head.kind !== 'good' && !reading.latest) {
    return { key: 'off', title: 'Put on your headband', text: 'Place the sensors on both temples and switch the headband on. This page connects by itself.' };
  }
  if (!c) {
    return { key: 'calibrating', title: 'Getting to know your calm', text: `Sit still and relax for about ${Math.round((N_CALIBRATION_BLOCKS * BLOCK_SEC) / 60 * 10) / 10} minutes while the system learns what your resting mind looks like.` };
  }
  if (!reading.lastScored) {
    return { key: 'first', title: 'Almost there', text: `Your first reading arrives about every ${BLOCK_SEC} seconds. Keep the headband on.` };
  }
  return { key: 'live', title: null, text: null };
}

// ── Home ───────────────────────────────────────────────────────────
export function HomeScreen({ raw, now, sessionData, profile, picker, go, openBreathing }) {
  const reading = useReading(sessionData, profile);
  const { latest, lastScored, mood, threshold } = reading;
  const head = headbandOf(raw, now);
  const signal = signalOf(latest);
  const stage = stageOf({ raw, now, sessionData, reading });
  const needBreak = lastScored && (lastScored.high_load_alert || lastScored.micro_break_recommended || mood.key === 'overloaded');
  const name = picker.userId || 'there';
  const c = sessionData.calibration;

  return (
    <>
      <div className="hello">
        <div>
          <p className="muted-s">{greeting()},</p>
          <h1 className="serif">{name}</h1>
        </div>
        <span className={`chip chip-${head.kind}`}><Dot kind={head.kind} />Headband {head.word.toLowerCase()}</span>
      </div>

      <section className="fcard center">
        <p className="serif q">How is your mind right now?</p>
        <div className="face-row" role="list">
          {MOOD_ORDER.map((k) => (
            <div key={k} role="listitem" className={`face-pick${mood.key === k ? ' on' : ''}`} title={MOODS[k].word}>
              <Face mood={k} size={mood.key === k ? 54 : 40} />
              <span>{MOODS[k].short}</span>
            </div>
          ))}
        </div>

        {stage.key === 'live' ? (
          <div className="now" style={{ background: mood.soft }}>
            <div className="now-main">
              <Face mood={mood.key} size={64} />
              <div>
                <h2 className="serif">{mood.word}</h2>
                <p>{mood.desc}</p>
              </div>
            </div>
            <div className="meter" aria-label={`Mind load ${load(lastScored.task_state_score)} out of 100`}>
              <div className="meter-track">
                <span className="meter-fill" style={{ width: `${load(lastScored.task_state_score)}%`, background: mood.color }} />
                <span className="meter-limit" style={{ left: `${threshold * 100}%` }} title="Your break-alert level" />
              </div>
              <div className="meter-labels">
                <span>Mind load <b>{load(lastScored.task_state_score)}</b> / 100</span>
                <span>Alert level {Math.round(threshold * 100)}</span>
              </div>
            </div>
            <p className="muted-s">Updated {friendlyAgo(lastScored.timestamp_end * 1000, now)}{latest?.skipped ? ' · the newest reading was unclear, so this is the one before it' : ''}</p>
          </div>
        ) : (
          <div className="now waiting">
            <div className="pulse" aria-hidden="true"><Face mood="relaxed" size={56} /></div>
            <h2 className="serif">{stage.title}</h2>
            <p>{stage.text}</p>
          </div>
        )}
      </section>

      <section className={`fcard help ${needBreak ? 'alert' : ''}`}>
        <p className="serif q">{needBreak ? 'Your mind has been working hard' : 'Need a moment to reset?'}</p>
        <button type="button" className="pill" onClick={openBreathing}><span aria-hidden="true">🍃</span> 1-minute breathing break</button>
      </section>

      <div className="tiles">
        <Tile tone="pink" icon="💗" title="Mind tracker" value={lastScored ? mood.word : 'Waiting'}
          foot={lastScored ? `🕒 ${friendlyAgo(lastScored.timestamp_end * 1000, now)}` : 'No reading yet'} onClick={() => go('progress')} />
        <Tile tone="blue" icon="🎧" title="Headband" value={head.word} foot={head.tip} onClick={() => go('waves')} />
        <Tile tone="peach" icon="🧭" title="Calibration"
          value={!c ? 'Not yet' : c.status === 'ok' ? 'Done' : c.status === 'degraded' ? 'Done (rough)' : c.status === 'capturing' ? 'In progress' : 'Try again'}
          foot={c?.updated_at ? friendlyAgo(c.updated_at * 1000, now) : 'Learns your calm baseline'} onClick={() => go('calibrate')} />
        <Tile tone="green" icon="📶" title="Signal" value={signal.word} foot={signal.tip} onClick={() => go('waves')} />
      </div>
    </>
  );
}

// ── Progress ───────────────────────────────────────────────────────
const RANGES = [
  { key: '5', label: 'Last 5 min', sec: 300 },
  { key: '15', label: 'Last 15 min', sec: 900 },
  { key: 'all', label: 'Whole session', sec: null },
];

export function ProgressScreen({ sessionData, profile, now }) {
  const reading = useReading(sessionData, profile);
  const [range, setRange] = useState('all');
  const sel = RANGES.find((r) => r.key === range);
  const lastEnd = reading.blocks.length ? reading.blocks[reading.blocks.length - 1].timestamp_end : null;
  const blocks = sel.sec && lastEnd ? reading.blocks.filter((b) => b.timestamp_end >= lastEnd - sel.sec) : reading.blocks;
  const scored = blocks.filter((b) => b.task_state_score != null);
  const loads = scored.map((b) => b.task_state_score * 100);
  const avg = loads.length ? loads.reduce((a, b) => a + b, 0) / loads.length : null;
  const t = reading.threshold;

  const bars = useMemo(() => bucketize(blocks, 12, t, moodOf), [blocks, t]);
  const line = useMemo(() => bucketize(blocks, 8, t, moodOf), [blocks, t]);

  const counts = Object.fromEntries(MOOD_ORDER.map((k) => [k, 0]));
  scored.forEach((b) => { counts[moodOf(b.task_state_score, t).key] += 1; });
  const calmPct = scored.length ? Math.round(((counts.very_relaxed + counts.relaxed) / scored.length) * 100) : null;
  const peak = scored.reduce((m, b) => (!m || b.task_state_score > m.task_state_score ? b : m), null);
  const skipped = blocks.length - scored.length;
  const breaks = blocks.filter((b) => b.micro_break_recommended || b.high_load_alert).length;
  let streak = 0; let best = 0;
  scored.forEach((b) => { const k = moodOf(b.task_state_score, t).key; streak = k === 'relaxed' || k === 'very_relaxed' ? streak + 1 : 0; best = Math.max(best, streak); });
  const minutes = Math.round((blocks.length * BLOCK_SEC) / 60);

  return (
    <>
      <ScreenTitle sub="How hard your mind has been working">Your progress</ScreenTitle>
      <div className="seg-pills" role="tablist">
        {RANGES.map((r) => (
          <button key={r.key} type="button" role="tab" aria-selected={range === r.key} className={range === r.key ? 'on' : ''} onClick={() => setRange(r.key)}>{r.label}</button>
        ))}
      </div>

      {!scored.length ? (
        <section className="fcard"><div className="fempty" style={{ height: 160 }}>No clear readings in this period yet.</div></section>
      ) : (
        <>
          <section className="fcard">
            <div className="between">
              <div>
                <h2 className="serif">Mind load tracker</h2>
                <div className="big">{Math.round(Math.min(...loads))}–{Math.round(Math.max(...loads))}</div>
                <p className="muted-s">Range of mind load · average {Math.round(avg)} / 100</p>
              </div>
              <Face mood={moodOf(avg / 100, t).key} size={52} />
            </div>
            <LoadBars buckets={bars} />
            <MoodLegend />
          </section>

          <section className="fcard">
            <h2 className="serif">Mood analysis</h2>
            <p className="muted-s">Each face is one moment of your session. Hover a face to see its details.</p>
            <FaceLine buckets={line} />
          </section>

          <section className="fcard">
            <h2 className="serif"><span aria-hidden="true">🔍</span> Pattern insights</h2>
            <ul className="insights">
              <li><Face mood="relaxed" size={28} /><span>You were <b>relaxed for {calmPct}%</b> of this time.</span></li>
              {peak && <li><Face mood={moodOf(peak.task_state_score, t).key} size={28} /><span>Your mind worked hardest at <b>{clockShort(peak.timestamp_end)}</b> ({Math.round(peak.task_state_score * 100)} / 100).</span></li>}
              <li><span className="ins-icon">☕</span><span>{breaks ? <>The system suggested <b>{breaks} break{breaks === 1 ? '' : 's'}</b>.</> : 'No breaks were needed. Nice and steady.'}</span></li>
              {skipped > 0 && <li><span className="ins-icon">📶</span><span>{skipped} reading{skipped === 1 ? ' was' : 's were'} skipped because the signal was unclear.</span></li>}
            </ul>
          </section>

          <section className="fcard">
            <h2 className="serif"><span aria-hidden="true">🏆</span> Session summary</h2>
            <div className="badges">
              <div className="badge"><span>⏱️</span><b>{minutes} min</b><small>Monitored</small></div>
              <div className="badge"><span>🧠</span><b>{scored.length}</b><small>Clear readings</small></div>
              <div className="badge"><span>🍃</span><b>{Math.round((best * BLOCK_SEC) / 60 * 10) / 10} min</b><small>Longest calm stretch</small></div>
              <div className="badge"><span>☕</span><b>{breaks}</b><small>Break reminders</small></div>
            </div>
            <p className="muted-s" style={{ marginTop: 10 }}>Last reading {lastEnd ? friendlyAgo(lastEnd * 1000, now) : '—'}.</p>
          </section>
        </>
      )}
    </>
  );
}

// ── Brainwaves ─────────────────────────────────────────────────────
export function WavesScreen({ raw, now, sessionData }) {
  const head = headbandOf(raw, now);
  const withFeat = sessionData.blocks.filter((b) => b.features_eeg?.bipolar);
  const latest = withFeat[withFeat.length - 1];
  const f = latest?.features_eeg?.bipolar;
  const signal = signalOf(sessionData.blocks[sessionData.blocks.length - 1]);
  const rows = RHYTHMS.map((r) => ({ ...r, v: f?.[`${r.key}_rel_power`] ?? null }));
  const top = f ? rows.reduce((m, r) => (r.v != null && (!m || r.v > m.v) ? r : m), null) : null;

  return (
    <>
      <ScreenTitle sub="What your headband is picking up">Your brainwaves</ScreenTitle>
      <section className="fcard">
        <div className="between">
          <h2 className="serif">Live from your headband</h2>
          <span className={`chip chip-${head.kind}`}><Dot kind={head.kind} />{head.word}</span>
        </div>
        <LiveWave samples={raw.samples} />
        <p className="muted-s">{head.kind === 'good' ? 'This wiggly line is your brain’s electrical activity in the last 5 seconds, measured between your temples.' : head.tip}</p>
      </section>

      <section className="fcard">
        <h2 className="serif">Your brain rhythms</h2>
        <p className="muted-s">Your brain hums at several speeds at once. Longer bars mean more of that rhythm{latest ? `, measured ${friendlyAgo(latest.timestamp_end * 1000, now)}` : ''}.</p>
        {!f ? <div className="fempty" style={{ height: 120 }}>Rhythms appear after the first reading.</div> : (
          <>
            <div className="rhythms">
              {rows.map((r) => (
                <div key={r.key} className={`rhythm${top?.key === r.key ? ' top' : ''}`} title={r.meaning}>
                  <span className="r-icon" aria-hidden="true">{r.icon}</span>
                  <div className="r-text"><b>{r.plain}</b><small>{r.name} · {r.meaning}</small></div>
                  <div className="r-bar"><span style={{ width: `${Math.max(2, (r.v ?? 0) * 100)}%` }} /></div>
                  <span className="r-val">{r.v == null ? '—' : `${Math.round(r.v * 100)}%`}</span>
                </div>
              ))}
            </div>
            {top && <p className="callout">Strongest right now: <b>{top.plain}</b> ({top.name}). {top.meaning}.</p>}
          </>
        )}
      </section>

      <section className="fcard tone-green-card">
        <h2 className="serif"><span aria-hidden="true">📶</span> Signal: {signal.word}</h2>
        <ul className="tips">
          <li>Keep both sensors flat against your temples</li>
          <li>Sit still. Talking, chewing and frowning all add noise.</li>
          <li>Keep your hair out from under the sensors</li>
        </ul>
      </section>
    </>
  );
}

// ── Calibrate ──────────────────────────────────────────────────────
export function CalibrateScreen({ sessionData, profile, raw, now }) {
  const c = sessionData.calibration;
  const tr = sessionData.threshold;
  const head = headbandOf(raw, now);
  const personal = profile?.personal_high_load_p ?? c?.personal_high_load_p ?? null;
  // resting_mean / resting_calibrated_p are raw model probabilities; the
  // mind load shown everywhere else is raw − baseline_shift (pipeline.py),
  // so put resting on that same scale.
  const restRaw = tr?.resting_mean ?? c?.resting_calibrated_p;
  const shift = c?.baseline_shift ?? profile?.baseline_shift ?? 0;
  const restingLoad = restRaw == null ? null : Math.round(Math.min(1, Math.max(0, restRaw - shift)) * 100);
  const done = !c ? (head.kind === 'good' ? 1 : 0) : c.status === 'capturing' ? 2 : c.status === 'failed' ? 1 : 3 + (personal != null ? 1 : 0);
  const steps = [
    { icon: '🎧', title: 'Put on the headband', text: 'Sensors on both temples, then switch it on.' },
    { icon: '🧘', title: 'Relax for about a minute', text: 'Sit comfortably, breathe normally and stay still.' },
    { icon: '🧭', title: 'Calm baseline saved', text: 'The system now knows what your resting mind looks like.' },
    { icon: '🎯', title: 'Personal alert level (optional)', text: 'A short set of puzzles shows how your brain looks when you’re working hard.' },
  ];
  const statusWord = !c ? 'Not calibrated yet' : c.status === 'ok' ? 'Calibrated' : c.status === 'degraded' ? 'Calibrated, but the signal was weak' : c.status === 'capturing' ? 'Calibrating…' : 'Calibration didn’t work. Try again.';

  return (
    <>
      <ScreenTitle sub="Teaching the system what your calm looks like">Calibration</ScreenTitle>
      <section className="fcard hero-cal">
        <Face mood={c?.status === 'ok' ? 'very_relaxed' : 'relaxed'} size={72} />
        <div>
          <h2 className="serif">{statusWord}</h2>
          <p>Everyone’s brain is different. Calibration measures you while you are calm, so the readings that follow compare you with yourself and not with an average person.</p>
        </div>
      </section>

      <section className="fcard">
        <ol className="fsteps">
          {steps.map((s, i) => (
            <li key={s.title} className={i < done ? 'done' : i === done ? 'current' : ''}>
              <span className="fs-icon" aria-hidden="true">{i < done ? '✓' : s.icon}</span>
              <div><b>{s.title}</b><p>{s.text}</p></div>
            </li>
          ))}
        </ol>
      </section>

      <section className="fcard">
        <h2 className="serif">Your personal settings</h2>
        <div className="settings">
          <div className="setting tone-peach">
            <small>Break alert level</small>
            <b>{Math.round((personal ?? POPULATION_HIGH_LOAD_P) * 100)} / 100</b>
            <span>{personal != null ? 'Set from your own puzzle session' : 'Standard level (puzzle step not done yet)'}</span>
          </div>
          <div className="setting tone-blue">
            <small>Your resting mind load</small>
            <b>{restingLoad == null ? '—' : `${restingLoad} / 100`}</b>
            <span>What “calm” looks like for you</span>
          </div>
          <div className="setting tone-green">
            <small>Last calibrated</small>
            <b>{profile?.calibrated_at ? friendlyAgo(profile.calibrated_at * 1000, now) : c?.updated_at ? friendlyAgo(c.updated_at * 1000, now) : '—'}</b>
            <span>{c?.skip_ahead_used ? 'Your saved calm baseline was reused' : 'Measured in this session'}</span>
          </div>
        </div>
        {tr?.status === 'not_separated' && (
          <p className="callout">The puzzle session didn’t show a clear difference from your calm state, so the standard alert level is used. That’s common, and you can try again later.</p>
        )}
        <p className="muted-s" style={{ marginTop: 12 }}>To calibrate again, start a new session in the MindPulse app. This page only shows results and never changes anything.</p>
      </section>
    </>
  );
}

// ── Profile ────────────────────────────────────────────────────────
export function ProfileScreen({ picker, sessionData, profile, now, openTech, openWelcome, openBreathing }) {
  const reading = useReading(sessionData, profile);
  const scored = reading.blocks.filter((b) => b.task_state_score != null);
  const calm = scored.filter((b) => ['relaxed', 'very_relaxed'].includes(moodOf(b.task_state_score, reading.threshold).key)).length;
  const initial = (picker.userId || '?').slice(0, 1).toUpperCase();

  return (
    <>
      <section className="profile-hero">
        <h1 className="serif">Profile</h1>
        <div className="avatar" aria-hidden="true">{initial}</div>
        <h2 className="serif">{picker.userId || 'Nobody selected'}</h2>
        <p className="muted-s">{picker.sessionId ? `Session from ${sessionLabel(picker.sessionId)}` : 'No session selected'}</p>
        <div className="pstats">
          <div><b>🧠 {scored.length}</b><small>Readings</small></div>
          <div><b>🍃 {scored.length ? Math.round((calm / scored.length) * 100) : 0}%</b><small>Calm</small></div>
          <div><b>🗓️ {picker.sessions.length}</b><small>Sessions</small></div>
        </div>
      </section>

      <section className="fcard">
        <h2 className="serif">Whose readings to show</h2>
        <label className="fswitch">
          <input type="checkbox" checked={picker.follow} onChange={(e) => picker.setFollow(e.target.checked)} />
          <span className="track" aria-hidden="true"><span /></span>
          <span>Show whoever is wearing the headband now</span>
        </label>
        <div className="fselects">
          <label>
            <span>Person</span>
            <select value={picker.userId || ''} onChange={(e) => picker.choose({ userId: e.target.value || null, sessionId: null })}>
              <option value="">Choose…</option>
              {[...new Set([...(picker.userId ? [picker.userId] : []), ...picker.users])].map((u) => (
                <option key={u} value={u}>{u}{u === picker.liveUser ? ' (wearing now)' : ''}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Session</span>
            <select value={picker.sessionId || ''} onChange={(e) => picker.choose({ userId: picker.userId, sessionId: e.target.value || null })}>
              <option value="">Choose…</option>
              {[...new Set([...(picker.sessionId ? [picker.sessionId] : []), ...picker.sessions])].map((s) => (
                <option key={s} value={s}>{sessionLabel(s)}{s === picker.liveSession ? ' (live)' : ''}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="fcard">
        <h2 className="serif">Quick actions</h2>
        <div className="actions">
          <button type="button" className="action tone-blue" onClick={openBreathing}><span>🍃</span>Breathing break</button>
          <button type="button" className="action tone-peach" onClick={openWelcome}><span>👋</span>Show welcome again</button>
          <button type="button" className="action tone-pink" onClick={openTech}><span>🔬</span>Technical view</button>
        </div>
        <p className="muted-s" style={{ marginTop: 10 }}>The technical view shows the raw signal, all 29 measurements and the model details, for researchers.</p>
      </section>
      <p className="disclaimer">MindPulse estimates how hard your mind is working (cognitive load). It is not a medical device and does not diagnose stress or any condition. Last update {reading.latest ? friendlyAgo(reading.latest.timestamp_end * 1000, now) : '—'}.</p>
    </>
  );
}

// ── Welcome + breathing overlays ───────────────────────────────────
export function Welcome({ onStart }) {
  return (
    <div className="overlay welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="welcome-art" aria-hidden="true">
        <div className="bubble b1" /><div className="bubble b2" /><div className="bubble b3" />
        <Face mood="very_relaxed" size={150} />
      </div>
      <div className="welcome-card">
        <h1 id="welcome-title" className="serif">Welcome to your personal mind monitor</h1>
        <p>A simple, private view of how hard your mind is working, live from your Wearable 02 headband.</p>
        <button type="button" className="pill wide" onClick={onStart}>Get started</button>
      </div>
    </div>
  );
}

const BREATH_SEC = 60;
export function Breathing({ onClose }) {
  const [left, setLeft] = useState(BREATH_SEC);
  useEffect(() => {
    const id = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { clearInterval(id); window.removeEventListener('keydown', onKey); };
  }, [onClose]);
  const phase = (BREATH_SEC - left) % 8 < 4 ? 'Breathe in…' : 'Breathe out…';
  return (
    <div className="overlay breathing" role="dialog" aria-modal="true" aria-label="Breathing exercise">
      <div className="breath-card">
        <button type="button" className="close" onClick={onClose} aria-label="Close">×</button>
        <p className="muted-s">Now playing</p>
        <h2 className="serif">1-minute breathing</h2>
        {left > 0 ? (
          <>
            <div className="breath-circle"><span>{phase}</span></div>
            <p className="big">{left}s</p>
          </>
        ) : (
          <>
            <Face mood="very_relaxed" size={110} />
            <p className="serif q">Well done 🌿</p>
          </>
        )}
        <button type="button" className="pill wide" onClick={onClose}>{left > 0 ? 'Stop' : 'Done'}</button>
      </div>
    </div>
  );
}

export const TABS = [
  { key: 'home', label: 'Home', icon: 'M3 11 L12 4 L21 11 V20 H15 V14 H9 V20 H3 Z' },
  { key: 'progress', label: 'Progress', icon: 'M4 20 V12 M10 20 V6 M16 20 V10 M22 20 V4' },
  { key: 'waves', label: 'Brainwaves', icon: 'M2 12 C4 6 6 6 8 12 S12 18 14 12 S18 6 20 12 L22 12' },
  { key: 'calibrate', label: 'Calibrate', icon: 'M3 12 a9 9 0 1 0 18 0 a9 9 0 1 0 -18 0 M12 7 V12 L15 14' },
  { key: 'profile', label: 'Profile', icon: 'M8 8 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0 M4 21 C5 15 19 15 20 21' },
];

export function NavBar({ tab, setTab }) {
  return (
    <nav className="navbar" aria-label="Main">
      {TABS.map((t) => (
        <button key={t.key} type="button" className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)} aria-current={tab === t.key ? 'page' : undefined}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d={t.icon} fill={tab === t.key && t.key === 'home' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
