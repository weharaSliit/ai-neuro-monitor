// Personal limits for mind (EEG), body (HRV/GSR) and fused, shared by the
// Calibration, scores & alerts dashboard and the Fusion engine monitor so
// both always show the same thresholds. Mirrors the backend methods:
// backend/psychological/sam40/decision.py (EEG, log-odds) and
// backend/physiological/predictor.py (ring) -- see each function.
import { effectiveThreshold } from './ring';
import { PERSONAL_THRESHOLD_MIN_SEPARATION } from './config';

export const SIGMA_LOGIT = 0.55;
export const K_ALERT = 0.84;
export const Z_CAP = 3;
export const RING_SCALE = 0.1;            // HRV/GSR threshold_scale in fusion

export const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
// Exact log-odds (log p - log(1-p)): no clamp at 1e-9, so headband scores of 1e-12..1e-9 stay distinct.
export const lgt = (p) => { const q = Math.min(Math.max(p, 1e-300), 1 - 1e-16); return Math.log(q) - Math.log1p(-q); };
export const sig = (x) => 1 / (1 + Math.exp(-x));
export const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
// Same rule as sam40/decision.py plausible_logit_score(): |log-odds| <= 40.
export const plausible = (p) => p != null && p > 0 && p < 1 && Math.abs(lgt(p)) <= 40;

export const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
export const sdOf = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((t, v) => t + (v - m) ** 2, 0) / (a.length - 1)); };
export const clampD = (d) => Math.max(-Z_CAP, Math.min(Z_CAP, d));
export const TASK_SKIP_EEG = 5;   // blocks (~2 min) of task ramp-up skipped -- sam40/decision.py TASK_RAMP_SKIP_BLOCKS
export const TASK_SKIP_RING = 2;  // windows (2 min) -- physiological/predictor.py TASK_RAMP_SKIP_WINDOWS

// ── Midpoint calibration (backend: sam40/decision.py, physiological/predictor.py)
//   baseline = median(rest), task level = mean(task after the ramp-up),
//   limit = midpoint, responsive if task - baseline >= 1 spread.
// A calibration made by the new backend carries its own values (src 'backend');
// for older ones the same method is computed here from the stored scores
// (src 'computed' -- redeploy so the live system uses it too).
export const newBackend = (cal, thr) => Boolean(thr?.threshold_method || cal?.sigma_source);

export function restLevel(cal) {          // baseline, log-odds
  if (!cal) return null;
  if (cal.sigma_source && num(cal.mu_rest_logit) != null) return num(cal.mu_rest_logit);
  const rs = (cal.rest_scores || []).map(num).filter(plausible);
  if (rs.length) return median(rs.map(lgt));
  const mu = num(cal.mu_rest) ?? num(cal.resting_calibrated_p);
  return plausible(mu) ? lgt(mu) : null;
}
export function restSigma(cal) {          // spread, log-odds: own rest SD (>= 5 blocks, floor 0.55), else 0.55
  if (cal?.sigma_source && num(cal.sigma)) return num(cal.sigma);
  const L = (cal?.rest_scores || []).map(num).filter(plausible).map(lgt);
  return L.length < 5 ? SIGMA_LOGIT : Math.max(SIGMA_LOGIT, sdOf(L));
}
export function eegLimitInfo(cal, thr) {
  const level = restLevel(cal); const sd = restSigma(cal);
  if (level == null) return null;
  const provisional = { level, sd, limitL: level + K_ALERT * sd, taskL: null, responsive: null,
    method: 'provisional · rest + 0.84 spread', src: newBackend(cal, thr) ? 'backend' : 'computed' };
  if (thr?.threshold_method) {
    const ok = thr.responsive && num(thr.limit_logit) != null;
    return { ...provisional, limitL: ok ? num(thr.limit_logit) : provisional.limitL, taskL: num(thr.task_level_logit),
      responsive: thr.responsive, sepSd: num(thr.separation_sd), used: thr.n_task_used, skipped: thr.n_task_skipped,
      method: ok ? 'midpoint of rest and task' : provisional.method, src: 'backend' };
  }
  const task = (thr?.task_scores || []).map(num).filter(plausible);
  if (!task.length) return provisional;
  const k = Math.min(TASK_SKIP_EEG, Math.floor(task.length / 2));
  const taskL = mean(task.slice(k).map(lgt));
  const responsive = taskL > level && taskL - level >= sd;
  return { ...provisional, taskL, responsive, sepSd: (taskL - level) / sd, used: task.length - k, skipped: k,
    limitL: responsive ? (level + taskL) / 2 : provisional.limitL,
    method: responsive ? 'midpoint of rest and task' : provisional.method, src: 'computed' };
}
// EEG score -> distance from the limit in spreads -> fusion scale (limit = 0.5).
export const eegD = (p, info) => (info == null || !plausible(p) ? null : (lgt(p) - info.limitL) / info.sd);
export const dShow = (d) => (d == null ? null : sig(clampD(d)));
export const eegAligned = (p, info) => dShow(eegD(p, info));

export function ringLimitInfo(ring) {
  const t = ring.thresholds;
  const rest = (t?.resting_scores || []).map(num).filter((v) => v != null);
  const task = (t?.task_scores || []).map(num).filter((v) => v != null);
  const population = effectiveThreshold({ ...(t || {}), personal_stress_threshold: undefined }, ring.baseline).value;
  const base = rest.length ? median(rest) : null;
  if (t?.task_result?.method) {
    const personal = num(t.personal_stress_threshold);
    return { base: num(t.task_result.baseline) ?? base, taskLevel: num(t.task_result.task_level), limit: personal ?? population,
      personal: personal != null, needed: num(t.task_result.needed_separation), src: 'backend', ran: true };
  }
  if (task.length && base != null) {
    const k = Math.min(TASK_SKIP_RING, Math.floor(task.length / 2));
    const taskLevel = mean(task.slice(k));
    const needed = Math.max(sdOf(rest), PERSONAL_THRESHOLD_MIN_SEPARATION);
    const ok = taskLevel - base >= needed;
    return { base, taskLevel, limit: ok ? (base + taskLevel) / 2 : population, personal: ok, needed, src: 'computed', ran: true };
  }
  return { base, taskLevel: null, limit: num(t?.personal_stress_threshold) ?? population, personal: num(t?.personal_stress_threshold) != null,
    needed: null, src: 'backend', ran: false };
}
// 2 of the last 3 above the limit (persistent condition).
export const persistent = (flags) => { const r = flags.filter((f) => f != null).slice(-3); return r.length ? r.filter(Boolean).length >= 2 : null; };

// HRV/GSR prob -> fusion scale.
export const ringAligned = (p, thr) => (p == null || thr == null ? null
  : sig(Math.max(-Z_CAP, Math.min(Z_CAP, (p - thr) / RING_SCALE))));

// ── EEG (fusion scale) ─────────────────────────────────────────────
// The calibration in use (this session's, else the user's latest usable one)
// and the high-load threshold that belongs to IT: same session, and not older
// than the calibration -- a recalibration replaces the resting level, so a
// task run against the previous one no longer applies.
export function pickEeg(eeg, history, sid) {
  const ok = (c) => c && (c.status === 'ok' || c.status === 'degraded') && restLevel(c) != null;
  const item = ok(eeg.calibration) ? { sid, cal: eeg.calibration, thr: eeg.threshold }
    : [...history.items].reverse().find((i) => ok(i.cal)) || null;
  const cal = item?.cal || null;
  let thr = item?.thr || null;
  if (thr && cal && num(thr.updated_at) != null && num(cal.updated_at) != null && thr.updated_at < cal.updated_at) thr = null;
  return { cal, thr, fromSid: item?.sid || null };
}

