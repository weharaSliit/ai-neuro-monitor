// Ring check: the guided validation run and its analysis.
// A run is saved to ring_validation/{userId}/{runId}:
//   { id, user_id, session_id, started_at, ended_at, steps: [{key, label, start, end}],
//     refs: [{t, bpm, step}], samples_csv: "t,us,acc,finger,hr\n..." }
// t is epoch milliseconds from the browser clock; ring windows come from
// physiological/predictions/{user}/{session} (backend clock), so their times are matched
// to the run's time range (see windowTime).

// What the person is asked to do. `ref`: ask for a Heart Rate app reading every minute.
export const PROTOCOL = [
  { key: 'ready', label: 'Get ready', sec: 60, ref: false, kind: 'setup',
    say: 'Get ready. Sit down, ring on your finger, Heart Rate app open on your phone.',
    text: 'Sit down. Ring on, Heart Rate app open on your phone (use the OTHER hand for the phone camera).' },
  { key: 'rest', label: 'Rest', sec: 300, ref: true, kind: 'rest',
    say: 'Rest. Sit still and do not talk for five minutes.',
    text: 'Sit still, breathe normally, do not talk. Take a Heart Rate app reading when asked.' },
  { key: 'breathing', label: 'Slow breathing', sec: 120, ref: true, kind: 'rest',
    say: 'Slow breathing. In for four seconds, out for six.',
    text: 'Breathe in for 4 seconds, out for 6 seconds.' },
  { key: 'quiz', label: 'Mental task', sec: 180, ref: true, kind: 'task',
    say: 'Mental task. Answer the sums on the screen as fast as you can.',
    text: 'Answer the sums as fast as you can. Keep still.' },
  { key: 'walk', label: 'Walk', sec: 180, ref: false, kind: 'task',
    say: 'Walk now. Walk briskly or climb stairs for three minutes. A beep tells you when to come back and sit.',
    text: 'Walk briskly or climb stairs. Come back and sit when you hear the beep.' },
  { key: 'recovery', label: 'Recovery', sec: 180, ref: true, kind: 'rest',
    say: 'Sit down and recover. Breathe normally.',
    text: 'Sit down, breathe normally. Take a Heart Rate app reading when asked.' },
  { key: 'shake', label: 'Shake hand', sec: 120, ref: false, kind: 'artefact',
    say: 'Shake the hand wearing the ring, vigorously, for two minutes.',
    text: 'Shake or wave the hand that wears the ring, hard and continuously.' },
  { key: 'settle1', label: 'Still', sec: 60, ref: false, kind: 'rest',
    say: 'Hold still.', text: 'Hold the hand still on your lap.' },
  { key: 'cold', label: 'Cold bottle', sec: 120, ref: false, kind: 'artefact',
    say: 'Hold the cold water bottle in the hand that wears the ring. Wrap all your fingers around it.',
    text: 'Wrap the ring hand around a cold, wet water bottle (straight from the fridge). Ring finger touching the cold wet surface.' },
  { key: 'settle2', label: 'Still', sec: 60, ref: false, kind: 'rest',
    say: 'Put the bottle down. Hold still.', text: 'Put the bottle down, dry your hand, hold still.' },
  { key: 'off', label: 'Finger off', sec: 90, ref: false, kind: 'artefact',
    say: 'Take the ring off your finger and put it on the table.',
    text: 'Take the ring off and leave it on the table. Put it back on when the run ends.' },
];
// Short run: only the steps that change the person's state, three minutes each.
export const SHORT_PROTOCOL = ['rest', 'quiz', 'walk', 'recovery'].map((k) => ({ ...PROTOCOL.find((p) => p.key === k), sec: 180 }));
export const TOTAL_SEC = PROTOCOL.reduce((s, p) => s + p.sec, 0);
export const WINDOW_MS = 60000;
export const SLIDE_MS = 20000;

export const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
export const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y); const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export function corr(x, y) {
  const n = x.length; if (n < 3) return null;
  const mx = mean(x); const my = mean(y);
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < n; i += 1) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

export function samplesToCsv(rows) {
  return `t,us,acc,finger,hr\n${rows.map((r) => [r.t, r.us ?? '', r.acc ?? '', r.finger == null ? '' : r.finger ? 1 : 0, r.hr ?? ''].join(',')).join('\n')}`;
}
export function parseSamples(csv) {
  if (!csv) return [];
  return csv.split('\n').slice(1).filter(Boolean).map((l) => {
    const [t, us, acc, finger, hr] = l.split(',');
    const n = (v) => (v === '' || v == null ? null : Number(v));
    return { t: Number(t), us: n(us), acc: n(acc), finger: finger === '' ? null : finger === '1', hr: n(hr) };
  });
}

// Backend window times are naive (UTC on the server, local on a laptop): take whichever
// reading falls closest to the run, not "closest to now" (the run may be hours old).
export function windowTime(iso, anchor) {
  if (!iso) return null;
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(iso)) return Date.parse(iso);
  const c = [Date.parse(`${iso}Z`), Date.parse(iso)].filter(Number.isFinite);
  if (!c.length) return null;
  return c.sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor))[0];
}

export function runWindows(windows, run) {
  if (!run?.started_at) return [];
  const lo = run.started_at - 2 * WINDOW_MS; const hi = (run.ended_at || Date.now()) + 2 * WINDOW_MS;
  return (windows || []).map((w) => ({
    t: windowTime(w.timestamp, run.started_at),
    hr: w.features?.MeanHR ?? null,
    scl: w.features?.SCL_mean ?? null,
    q: w.quality?.signal_quality ?? w.signal_quality ?? null,
  })).filter((w) => w.t != null && w.t >= lo && w.t <= hi).sort((a, b) => a.t - b.t);
}

export const stepList = (run) => (run?.steps || []).filter((s) => s.start);

// The ring window (end time t) that covers reading time x, if any.
function windowAt(wins, x) {
  let best = null; let bd = Infinity;
  for (const w of wins) {
    if (w.hr == null || x > w.t + 5000 || x < w.t - WINDOW_MS - 5000) continue;
    const d = Math.abs(w.t - WINDOW_MS / 2 - x);
    if (d < bd) { bd = d; best = w; }
  }
  return best;
}
const liveAt = (samples, x, half = 10000) => median(samples.filter((s) => s.hr != null && Math.abs(s.t - x) <= half).map((s) => s.hr));

function agreeStats(pairs, key) {
  const p = pairs.filter((r) => r[key] != null);
  const err = p.map((r) => r[key] - r.ref);
  if (!p.length) return { n: 0 };
  return {
    n: p.length, bias: mean(err), mae: mean(err.map(Math.abs)),
    r: corr(p.map((r) => r.ref), p.map((r) => r[key])),
    within5: err.filter((e) => Math.abs(e) <= 5).length / err.length,
    within10: err.filter((e) => Math.abs(e) <= 10).length / err.length,
  };
}

// Heart Rate app readings vs the ring: its 60 s window and its live beats around the same moment.
export function agreement(run, wins, samples) {
  const pairs = (run?.refs || []).map((r) => ({
    t: r.t, ref: r.bpm, step: r.step, win: windowAt(wins, r.t)?.hr ?? null, live: liveAt(samples, r.t),
  }));
  return { pairs, window: agreeStats(pairs, 'win'), live: agreeStats(pairs, 'live') };
}

// One row per step: what the ring saw, and how many of the windows it should have produced it kept.
export function stepStats(run, wins, samples) {
  return stepList(run).map((s) => {
    const end = s.end || Date.now();
    const inS = samples.filter((x) => x.t >= s.start && x.t <= end);
    const w = wins.filter((x) => x.t > s.start && x.t <= end + 10000);
    const expected = Math.max(0, Math.floor((end - s.start) / SLIDE_MS));
    const spec = PROTOCOL.find((p) => p.key === s.key);
    const off = inS.filter((x) => x.finger === false).length;
    return {
      key: s.key, label: s.label, kind: spec?.kind, start: s.start, end, sec: (end - s.start) / 1000,
      winHr: mean(w.map((x) => x.hr).filter((v) => v != null)),
      liveHr: median(inS.map((x) => x.hr).filter((v) => v != null)),
      us: mean(inS.map((x) => x.us).filter((v) => v != null)),
      scl: mean(w.map((x) => x.scl).filter((v) => v != null)),
      accMean: mean(inS.map((x) => x.acc).filter((v) => v != null)),
      accPeak: inS.length ? Math.max(...inS.map((x) => x.acc ?? 0)) : null,
      fingerOffPct: inS.length ? off / inS.length : null,
      quality: mean(w.map((x) => x.q).filter((v) => v != null)),
      kept: w.length, expected, withheld: Math.max(0, expected - w.length),
    };
  });
}

// The headline numbers for the slide.
export function headline(rows, ag) {
  const by = (k) => rows.find((r) => r.key === k);
  const rest = by('rest'); const quiz = by('quiz'); const walk = by('walk');
  const art = rows.filter((r) => r.kind === 'artefact');
  const hrRest = rest?.liveHr ?? rest?.winHr; const hrWalk = walk?.liveHr ?? walk?.winHr;
  return {
    agree: ag.live.n ? ag.live : ag.window,
    agreeFrom: ag.live.n ? 'live beats' : '60 s window',
    walkRise: hrRest != null && hrWalk != null ? hrWalk - hrRest : null,
    quizGsr: rest?.us != null && quiz?.us != null ? quiz.us - rest.us : null,
    quizHr: (rest?.liveHr ?? rest?.winHr) != null && (quiz?.liveHr ?? quiz?.winHr) != null
      ? (quiz.liveHr ?? quiz.winHr) - (rest.liveHr ?? rest.winHr) : null,
    expected: art.reduce((s, r) => s + r.expected, 0), withheld: art.reduce((s, r) => s + r.withheld, 0),
    offPct: by('off')?.fingerOffPct ?? null, shakePeak: by('shake')?.accPeak ?? null,
  };
}
