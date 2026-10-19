// Data layer for the "Evidence" view on the Relaxation guide page.
//
// It only READS Firebase (the same Realtime Database the app and the backend use):
//   relaxation_evidence/{user}/{session}            written by the mobile app while a session runs
//   relaxation_evidence_index/{user}/{session}      light index written by the mobile app
//   relaxation_intervention/{user}/{session}        written by the Relaxation Guide backend (recommendation + outcome)
//   intervention_system/bandit_distributions/{user} what the backend has learned (cluster beliefs)
//   intervention_system/policy_state/{user}         per-technique continuous model state
import { useEffect, useMemo, useState } from 'react';
import { get, onValue, ref } from 'firebase/database';
import { db } from './firebase';

const DB_URL = 'https://stress-monitor-c39ee-default-rtdb.asia-southeast1.firebasedatabase.app';

// The evidence view is available to every signed-in account.
export const isEvidenceAdmin = (userId) => !!userId;
export const isRelaxationAdmin = (userId) => {
  const id = String(userId || '').toLowerCase();
  return id === 'ojani' || id.includes('ojani') || id === 'admin' || id.includes('admin');
};

export const NATURAL_TAU_SEC = 600;      // same assumption as the backend reward (no-technique recovery speed)
export const BASELINE_MARGIN = 0.03;

const arr = (obj) => (obj && typeof obj === 'object' ? Object.values(obj) : []);

// ── helpers ────────────────────────────────────────────────────────────────
async function shallowKeys(path) {
  try {
    const res = await fetch(`${DB_URL}/${path}.json?shallow=true`);
    if (!res.ok) return [];
    const json = await res.json();
    return json && typeof json === 'object' ? Object.keys(json) : [];
  } catch { return []; }
}

const toMs = (sec) => (Number.isFinite(sec) ? sec * 1000 : null);

export function excessArea(ts, ps, baseline) {
  let area = 0;
  for (let i = 1; i < ts.length; i += 1) {
    const a = Math.max(0, ps[i - 1] - baseline);
    const b = Math.max(0, ps[i] - baseline);
    area += ((a + b) / 2) * (ts[i] - ts[i - 1]);
  }
  return area;
}

export function naturalCurve(t0Sec, durationSec, s0, baseline, steps = 40) {
  const pts = [];
  for (let i = 0; i <= steps; i += 1) {
    const dt = (durationSec * i) / steps;
    pts.push({ t: t0Sec + dt, p: baseline + (s0 - baseline) * Math.exp(-dt / NATURAL_TAU_SEC) });
  }
  return pts;
}

export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function spearman(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const rank = (v) => {
    const idx = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(n);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j += 1;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k += 1) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs); const ry = rank(ys);
  const mx = mean(rx); const my = mean(ry);
  let num = 0; let dx = 0; let dy = 0;
  for (let i = 0; i < n; i += 1) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}

// ── list of every user that has any relaxation data ────────────────────────
export function useEvidenceUsers(refreshMs = 20000) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const lists = await Promise.all([
        shallowKeys('relaxation_evidence_index'),
        shallowKeys('relaxation_intervention'),
        shallowKeys('intervention_system/policy_state'),
        shallowKeys('intervention_system/bandit_distributions'),
      ]);
      if (cancelled) return;
      setUsers([...new Set(lists.flat())].sort());
      setLoading(false);
    };
    load();
    const t = setInterval(load, refreshMs);
    return () => { cancelled = true; clearInterval(t); };
  }, [refreshMs]);
  return { users, loading };
}

// ── small per-user summary for the list and the cross-user comparison ──────
export function useUsersSummary(userIds, refreshMs = 30000) {
  const [summary, setSummary] = useState({});
  const key = userIds.join('|');
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const out = {};
      await Promise.all(userIds.slice(0, 20).map(async (u) => {
        try {
          const [back, evid] = await Promise.all([
            get(ref(db, `relaxation_intervention/${u}`)),
            get(ref(db, `relaxation_evidence_index/${u}`)),
          ]);
          const sessions = arr(back.val()).filter((s) => s && typeof s === 'object');
          const outcomes = sessions.filter((s) => Number.isFinite(s.reward));
          const counts = {};
          sessions.forEach((s) => {
            const t = s.technique_id || s.recommended_technique_id;
            if (t) counts[t] = (counts[t] || 0) + 1;
          });
          const index = arr(evid.val());
          out[u] = {
            sessions: Math.max(sessions.length, index.length),
            outcomes: outcomes.length,
            meanReward: mean(outcomes.map((s) => s.reward)),
            meanRecovery: mean(outcomes.map((s) => s.recovery_percentage).filter(Number.isFinite)),
            techniqueCounts: counts,
            lastAtMs: Math.max(0, ...sessions.map((s) => toMs(s.timestamp) || 0), ...index.map((i) => i.at || 0)) || null,
            system: index.filter((i) => i.condition === 'system').length,
            manual: index.filter((i) => i.condition === 'manual').length,
          };
        } catch { out[u] = null; }
      }));
      if (!cancelled) setSummary(out);
    };
    load();
    const t = setInterval(load, refreshMs);
    return () => { cancelled = true; clearInterval(t); };
  }, [key, refreshMs]); // eslint-disable-line react-hooks/exhaustive-deps
  return summary;
}

// ── everything for one user, live ──────────────────────────────────────────
function useRtdb(path, enabled) {
  const [state, setState] = useState({ value: null, error: null, ready: false });
  useEffect(() => {
    if (!enabled) { setState({ value: null, error: null, ready: false }); return undefined; }
    const unsub = onValue(
      ref(db, path),
      (snap) => setState({ value: snap.val(), error: null, ready: true }),
      (err) => setState({ value: null, error: err?.message || 'Read failed', ready: true }),
    );
    return () => unsub();
  }, [path, enabled]);
  return state;
}

export function normaliseSessions(evidence, backend) {
  const keys = new Set([...Object.keys(evidence || {}), ...Object.keys(backend || {})]);
  const sessions = [];
  keys.forEach((key) => {
    const ev = evidence?.[key] || {};
    const be = backend?.[key] || {};
    const meta = ev.meta || {};
    const events = arr(ev.events).filter((e) => e && Number.isFinite(e.t)).sort((a, b) => a.t - b.t);
    const samples = arr(ev.samples).filter((s) => s && Number.isFinite(s.t) && Number.isFinite(s.p)).sort((a, b) => a.t - b.t);
    const result = ev.result || null;
    const comps = result?.reward_components || be.reward_components || null;

    const startSec = meta.started_at ?? events.find((e) => e.type === 'started')?.t ?? samples[0]?.t
      ?? meta.recommended_at ?? be.timestamp ?? null;
    const endSec = result?.ended_at ?? events.filter((e) => e.type === 'finished' || e.type === 'rated').slice(-1)[0]?.t
      ?? samples[samples.length - 1]?.t ?? null;
    const baseline = meta.context?.baseline ?? 0.3;

    sessions.push({
      key,
      startSec,
      endSec,
      startMs: toMs(startSec),
      technique: meta.technique_id || be.technique_id || be.recommended_technique_id || null,
      recommended: meta.recommended_technique_id || be.recommended_technique_id || null,
      title: meta.title || null,
      condition: meta.condition || (be.recommended_technique_id ? 'system' : 'unknown'),
      reason: meta.reason || null,
      reasonCodes: meta.reason_codes || [],
      context: meta.context || null,
      streamsUsed: meta.streams_used || null,
      clusterId: meta.cluster_id ?? be.context_cluster_id ?? null,
      baseline,
      events,
      samples,
      hasResult: !!(result || Number.isFinite(be.reward)),
      measured: result?.measured ?? !!comps,
      reward: result?.reward ?? be.reward ?? null,
      recovery: result?.recovery_percentage ?? be.recovery_percentage ?? null,
      stars: result?.stars ?? be.star_rating ?? null,
      comps,
      reachedBaseline: result?.is_normal_reached ?? null,
      nextTechnique: result?.next_technique_id ?? null,
      webOnly: !Object.keys(ev).length,   // played from the web page or before logging existed
    });
  });
  return sessions.sort((a, b) => (a.startMs || 0) - (b.startMs || 0));
}

export function useUserEvidence(userId) {
  const enabled = !!userId;
  const evidence = useRtdb(`relaxation_evidence/${userId}`, enabled);
  const backend = useRtdb(`relaxation_intervention/${userId}`, enabled);
  const bandit = useRtdb(`intervention_system/bandit_distributions/${userId}`, enabled);
  const policy = useRtdb(`intervention_system/policy_state/${userId}`, enabled);

  const sessions = useMemo(
    () => normaliseSessions(evidence.value, backend.value),
    [evidence.value, backend.value],
  );

  // How much the backend currently trusts each technique: cluster beliefs pooled, weighted by evidence.
  const trust = useMemo(() => {
    const totals = {};
    const dists = bandit.value;
    const clusters = Array.isArray(dists) ? dists.map((v, i) => [i, v]) : Object.entries(dists || {});
    clusters.forEach(([, techs]) => {
      Object.entries(techs || {}).forEach(([tech, p]) => {
        if (!p || !Number.isFinite(p.alpha) || !Number.isFinite(p.beta)) return;
        const t = totals[tech] || { alpha: 0, beta: 0 };
        t.alpha += p.alpha - 1; t.beta += p.beta - 1;       // remove the uniform prior
        totals[tech] = t;
      });
    });
    return Object.entries(totals).map(([tech, t]) => ({
      technique: tech,
      trials: t.alpha + t.beta,
      trust: (t.alpha + 1) / (t.alpha + t.beta + 2),
    }));
  }, [bandit.value]);

  const modelObs = useMemo(() => {
    const lin = policy.value?.linear || {};
    return Object.entries(lin).map(([tech, m]) => ({ technique: tech, n: m?.n ?? 0 }));
  }, [policy.value]);

  return {
    sessions, trust, modelObs,
    loading: !(evidence.ready && backend.ready),
    error: evidence.error || backend.error || bandit.error || policy.error,
  };
}
