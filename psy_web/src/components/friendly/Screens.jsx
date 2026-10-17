import { useEffect, useMemo, useState } from 'react';
import Face from './Face';
import CalibrationRun from './CalibrationRun';
import { useFirebaseValue } from '../../hooks/useData';
import { isTestAccount } from '../../lib/testAccounts';
import { FaceLine, LiveWave, LoadBars, MoodLegend, bucketize } from './MoodCharts';
import { BLOCK_SEC, CALIBRATION_SETTLE_SEC, N_CALIBRATION_BLOCKS, POPULATION_HIGH_LOAD_P } from '../../lib/config';
import { mindOrientedP } from '../../lib/limits';
import {
  MOODS, MOOD_ORDER, RHYTHMS, clockShort, friendlyAgo, greeting, headbandOf, load, moodOf, sessionLabel, signalOf,
} from '../../lib/friendly';

// ── shared helpers ─────────────────────────────────────────────────
// limits: the calibrated baseline / threshold every dashboard uses (lib/limits
// calibratedLimits). With a calibration, mind load and alert level are on the
// model's scale oriented so higher = more load (mindOrientedP); without one, the
// stored score vs the backend / population threshold.
function useReading(sessionData, profile, limits) {
  const { blocks } = sessionData;
  const latest = blocks[blocks.length - 1] || null;
  const lastScored = [...blocks].reverse().find((b) => b.task_state_score != null) || null;
  const m = limits?.mind;
  const p = m ? (b) => (b?.task_state_score == null ? null : mindOrientedP(b, limits.eegInfo)) : (b) => b?.task_state_score ?? null;
  const threshold = m ? m.thresholdOriented : lastScored?.effective_high_load_p ?? latest?.effective_high_load_p
    ?? profile?.personal_high_load_p ?? POPULATION_HIGH_LOAD_P;
  const mood = moodOf(p(lastScored), threshold);
  return { blocks, latest, lastScored, threshold, mood, p, baseline: m?.baseline ?? null, personal: m ? m.personal : null };
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
    return { key: 'calibrating', title: 'Getting to know your calm', text: `Sit still, eyes open, and breathe normally for about ${Math.round((CALIBRATION_SETTLE_SEC + N_CALIBRATION_BLOCKS * BLOCK_SEC) / 60)} minutes (2 to settle, then about 4 of quiet rest) while the system learns what your resting mind looks like.` };
  }
  if (!reading.lastScored) {
    return { key: 'first', title: 'Almost there', text: `Your first reading arrives about every ${BLOCK_SEC} seconds. Keep the headband on.` };
  }
  return { key: 'live', title: null, text: null };
}

// ── Home ───────────────────────────────────────────────────────────
export function HomeScreen({ raw, now, sessionData, profile, picker, limits, go, openBreathing }) {
  const reading = useReading(sessionData, profile, limits);
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
            <div className="meter" aria-label={`Mind load ${load(reading.p(lastScored))} out of 100`}>
              <div className="meter-track">
                <span className="meter-fill" style={{ width: `${load(reading.p(lastScored))}%`, background: mood.color }} />
                <span className="meter-limit" style={{ left: `${threshold * 100}%` }} title="Your break-alert level" />
              </div>
              <div className="meter-labels">
                <span>Mind load <b>{load(reading.p(lastScored))}</b> / 100</span>
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

export function ProgressScreen({ sessionData, profile, limits, now }) {
  const reading = useReading(sessionData, profile, limits);
  const [range, setRange] = useState('all');
  const sel = RANGES.find((r) => r.key === range);
  const lastEnd = reading.blocks.length ? reading.blocks[reading.blocks.length - 1].timestamp_end : null;
  const blocks = sel.sec && lastEnd ? reading.blocks.filter((b) => b.timestamp_end >= lastEnd - sel.sec) : reading.blocks;
  const sc = reading.p;
  const scored = blocks.filter((b) => sc(b) != null);
  const loads = scored.map((b) => sc(b) * 100);
  const avg = loads.length ? loads.reduce((a, b) => a + b, 0) / loads.length : null;
  const t = reading.threshold;

  const bars = useMemo(() => bucketize(blocks, 12, t, moodOf, sc), [blocks, t, limits]);
  const line = useMemo(() => bucketize(blocks, 8, t, moodOf, sc), [blocks, t, limits]);

  const counts = Object.fromEntries(MOOD_ORDER.map((k) => [k, 0]));
  scored.forEach((b) => { counts[moodOf(sc(b), t).key] += 1; });
  const calmPct = scored.length ? Math.round(((counts.very_relaxed + counts.relaxed) / scored.length) * 100) : null;
  const peak = scored.reduce((m, b) => (!m || sc(b) > sc(m) ? b : m), null);
  const skipped = blocks.length - scored.length;
  const breaks = blocks.filter((b) => b.micro_break_recommended || b.high_load_alert).length;
  let streak = 0; let best = 0;
  scored.forEach((b) => { const k = moodOf(sc(b), t).key; streak = k === 'relaxed' || k === 'very_relaxed' ? streak + 1 : 0; best = Math.max(best, streak); });
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
              {peak && <li><Face mood={moodOf(sc(peak), t).key} size={28} /><span>Your mind worked hardest at <b>{clockShort(peak.timestamp_end)}</b> ({Math.round(sc(peak) * 100)} / 100).</span></li>}
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
export function CalibrateScreen({ sessionData, limits, profile, picker, now }) {
  const c = sessionData.calibration;
  const statusWord = !c ? 'Not calibrated yet' : c.status === 'ok' ? 'Calibrated' : c.status === 'degraded' ? 'Calibrated, but the signal was weak' : c.status === 'capturing' ? 'Calibrating…' : 'Calibration didn’t work. Try again.';

  return (
    <>
      <ScreenTitle sub="Teaching the system what your calm and your stress look like">Calibration</ScreenTitle>
      <section className="fcard hero-cal">
        <Face mood={c?.status === 'ok' ? 'very_relaxed' : 'relaxed'} size={72} />
        <div>
          <h2 className="serif">{statusWord}</h2>
          <p>Everyone’s brain and body are different. The calibration measures you while you are calm, then while you do a short set of quick rounds, so the readings that follow compare you with yourself and not with an average person. It takes about 17 minutes, for the headband and the ring together.</p>
        </div>
      </section>
      <CalibrationRun picker={picker} now={now} limits={limits} profile={profile} />
    </>
  );
}

// ── Profile ────────────────────────────────────────────────────────
export function ProfileScreen({ picker, sessionData, profile, limits, now, openTech, openWelcome, openBreathing }) {
  const stimStatus = useFirebaseValue('stimulator/status');
  const simUser = stimStatus?.uid || null;
  const reading = useReading(sessionData, profile, limits);
  const scored = reading.blocks.filter((b) => reading.p(b) != null);
  const calm = scored.filter((b) => ['relaxed', 'very_relaxed'].includes(moodOf(reading.p(b), reading.threshold).key)).length;
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
        {simUser && isTestAccount(simUser) && simUser !== picker.userId && (
          <button type="button" className="pill" style={{ marginTop: 12 }} onClick={() => picker.choose({ userId: simUser, sessionId: stimStatus?.sid || null })}>
            Switch to the simulation user ({simUser})
          </button>
        )}
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
                <option key={u} value={u}>{u}{isTestAccount(u) ? ' (test)' : ''}{u === picker.liveUser ? ' (wearing now)' : ''}</option>
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
