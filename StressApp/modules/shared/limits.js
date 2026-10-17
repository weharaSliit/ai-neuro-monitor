// Personal limits for mind (EEG), body (HRV/GSR) and fused -- port of
// psy_web/src/lib/limits.js (keep the two in step), so the app shows the
// same baseline and threshold as the Calibration, scores & alerts dashboard.
// Mirrors backend/psychological/sam40/decision.py and
// backend/physiological/predictor.py.
const STRESS_DECISION_THRESHOLD = 0.6447;   // ring population limit (with a baseline)
const RAW_DECISION_THRESHOLD = 0.7141;      // ring raw model limit (no baseline)
const PERSONAL_THRESHOLD_MIN_SEPARATION = 0.10;   // predictor.py
function effectiveThreshold(thresholds, baseline) {
  const personal = thresholds?.personal_stress_threshold;
  if (personal != null) return { value: personal, source: 'personal' };
  if (baseline) return { value: STRESS_DECISION_THRESHOLD, source: 'population' };
  return { value: RAW_DECISION_THRESHOLD, source: 'raw model (no baseline)' };
}

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
export const newBackend = (cal, thr) => Boolean(thr ? thr.calibration_status : cal?.sigma_source);

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
// Direction-aware ABA rule (sam40/decision.py midpoint_threshold_logit()):
// the task may move this person's score UP or DOWN from rest; responsive if
// |task - rest| >= 1 spread AND recovery comes back towards rest by >= 0.5
// spread (otherwise 'drift_suspected'). For a person whose score falls
// (dir -1) everything is mirrored around their resting level, so on the
// returned ORIENTED scale higher = more load and limitL >= level always.
// rawLimitL / rawTaskL are the model's own values, for display.
export const MIN_RECOVERY_REVERSAL_SD = 0.5;
export function eegLimitInfo(cal, thr) {
  const level = restLevel(cal); const sd = restSigma(cal);
  if (level == null) return null;
  const provisional = { level, sd, dir: 1, limitL: level + K_ALERT * sd, rawLimitL: level + K_ALERT * sd, taskL: null, rawTaskL: null,
    responsive: null, status: null, method: 'provisional · rest + 0.84 spread', src: newBackend(cal, thr) ? 'backend' : 'computed' };
  const finish = (o) => {
    const dir = o.responsive ? o.dir : 1;
    const orient = (L) => (L == null ? null : level + dir * (L - level));
    return { ...o, dir, taskL: orient(o.rawTaskL), limitL: o.responsive ? orient(o.rawLimitL) : provisional.limitL,
      rawLimitL: o.responsive ? o.rawLimitL : provisional.limitL,
      method: o.responsive ? `midpoint of rest and task${dir < 0 ? ' · score falls under load' : ''}` : provisional.method };
  };
  // Only a direction-aware backend (calibration_status) is taken as-is; older
  // results are recomputed here with the current rule.
  if (thr?.calibration_status) {
    const dir = num(thr.personal_direction) === -1 ? -1 : 1;
    return finish({ ...provisional, dir, rawTaskL: num(thr.task_level_logit), rawLimitL: num(thr.limit_logit),
      responsive: Boolean(thr.responsive && num(thr.limit_logit) != null), sepSd: num(thr.separation_sd),
      reversalSd: num(thr.reversal_sd), aba: thr.aba_confirmed ?? null,
      status: thr.calibration_status || (thr.responsive ? 'ok' : 'not_separated'),
      used: thr.n_task_used, skipped: thr.n_task_skipped, src: 'backend' });
  }
  const task = (thr?.task_scores || []).map(num).filter(plausible);
  if (!task.length) return provisional;
  const k = Math.min(TASK_SKIP_EEG, Math.floor(task.length / 2));
  const taskL = mean(task.slice(k).map(lgt));
  const dir = taskL >= level ? 1 : -1;
  const sepSd = (taskL - level) / sd;
  const rec = (thr?.recovery_scores || []).map(num).filter(plausible).map(lgt);
  const reversalSd = rec.length ? (dir * (taskL - median(rec))) / sd : null;
  const aba = reversalSd == null ? null : reversalSd >= MIN_RECOVERY_REVERSAL_SD;
  const separated = Math.abs(sepSd) >= 1;
  const responsive = separated && aba !== false;
  return finish({ ...provisional, dir, rawTaskL: taskL, rawLimitL: (level + taskL) / 2, responsive, sepSd, reversalSd, aba,
    status: responsive ? 'ok' : separated ? 'drift_suspected' : 'not_separated', used: task.length - k, skipped: k, src: 'computed' });
}
// Log-odds of a score on the ORIENTED scale. Stored calibration scores are
// raw; live block scores from the new backend are already oriented (they
// carry personal_direction) -- pass oriented=true for those.
export const eegL = (p, info, oriented = false) => {
  if (info == null || !plausible(p)) return null;
  const L = lgt(p);
  return oriented ? L : info.level + info.dir * (L - info.level);
};
// EEG score -> distance from the limit in spreads -> fusion scale (limit = 0.5).
export const eegD = (p, info, oriented = false) => { const L = eegL(p, info, oriented); return L == null ? null : (L - info.limitL) / info.sd; };
export const dShow = (d) => (d == null ? null : sig(clampD(d)));
export const eegAligned = (p, info, oriented = false) => dShow(eegD(p, info, oriented));
// A live block record: its score is already oriented if the backend wrote personal_direction.
export const blockAligned = (b, info) => eegAligned(b?.task_state_score, info, b?.personal_direction != null);
// Plain-language calibration outcome.
export const eegStatusText = (info) => (!info || info.status == null ? null
  : info.status === 'ok' ? (info.dir < 0 ? 'responsive · score falls under load' : 'responsive')
    : info.status === 'drift_suspected' ? 'drift suspected: recovery did not come back'
      : 'not separated from rest');

export function ringLimitInfo(ring) {
  const t = ring.thresholds;
  const rest = (t?.resting_scores || []).map(num).filter((v) => v != null);
  const task = (t?.task_scores || []).map(num).filter((v) => v != null);
  const population = effectiveThreshold({ ...(t || {}), personal_stress_threshold: undefined }, ring.baseline).value;
  const base = rest.length ? median(rest) : null;
  if (t?.task_result?.method) {
    const personal = num(t.personal_stress_threshold);
    return { base: num(t.task_result.baseline) ?? base, taskLevel: num(t.task_result.task_level), limit: personal ?? population,
      personal: personal != null, needed: num(t.task_result.needed_separation), aba: t.task_result.aba_confirmed ?? null,
      status: t.task_result.status, src: 'backend', ran: true };
  }
  if (task.length && base != null) {
    const k = Math.min(TASK_SKIP_RING, Math.floor(task.length / 2));
    const taskLevel = mean(task.slice(k));
    const needed = Math.max(sdOf(rest), PERSONAL_THRESHOLD_MIN_SEPARATION);
    const separated = taskLevel - base >= needed;
    // ABA check (predictor.py MIN_RECOVERY_REVERSAL): recovery must come back down.
    const rec = (t?.task_result?.recovery_scores || []).map(num).filter((v) => v != null);
    const aba = rec.length ? taskLevel - median(rec) >= 0.5 * needed : null;
    const ok = separated && aba !== false;
    return { base, taskLevel, limit: ok ? (base + taskLevel) / 2 : population, personal: ok, needed, aba,
      status: ok ? 'ok' : separated ? 'drift_suspected' : 'not_separated', src: 'computed', ran: true };
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


// Every calibration phase for mind, body and fused. EEG and body are put on
// the fusion scale (own limit = 0.50); fused = their equal-weight average,
// windows matched by position within each phase (the two calibrations don't
// share timestamps). With one input the fused value is that input, as in the
// fusion engine when the other has weight 0.
export function calibrationPhases(cal, thr, eegInfo, ring, ringInfo) {
  const P = (a) => (a || []).map(num);
  const out = {};
  if (eegInfo) {
    const d = (arr) => P(arr).map((p) => eegD(p, eegInfo)).filter((v) => v != null);
    const at = (L) => (L == null ? null : dShow((L - eegInfo.limitL) / eegInfo.sd));
    const recP = P(thr?.recovery_scores).filter(plausible);
    const rest = d(thr?.rest_scores || cal?.rest_scores); const task = d(thr?.task_scores); const recovery = d(thr?.recovery_scores);
    out.mind = { rest, task, recovery, skip: eegInfo.skipped || 0, show: dShow, limit: 0.5,
      // recovery level = mean score, as the backend judges recovery
      levels: { rest: at(eegInfo.level), task: at(eegInfo.taskL), recovery: recP.length ? dShow(eegD(mean(recP), eegInfo)) : null } };
  }
  const t = ring.thresholds;
  const rr = P(t?.resting_scores).filter((v) => v != null); const rt = P(t?.task_scores).filter((v) => v != null);
  const rc = P(t?.task_result?.recovery_scores).filter((v) => v != null);
  if (rr.length) {
    const skip = rt.length ? Math.min(TASK_SKIP_RING, Math.floor(rt.length / 2)) : 0;
    out.bodyRaw = { rest: rr, task: rt, recovery: rc, skip, limit: ringInfo.limit,
      levels: { rest: ringInfo.base, task: ringInfo.taskLevel, recovery: rc.length ? mean(rc) : null } };
    const al = (v) => ringAligned(v, ringInfo.limit);
    out.body = { rest: rr.map(al), task: rt.map(al), recovery: rc.map(al), skip, limit: 0.5,
      levels: { rest: al(ringInfo.base), task: ringInfo.taskLevel == null ? null : al(ringInfo.taskLevel), recovery: rc.length ? al(mean(rc)) : null } };
  }
  const m = out.mind && { rest: out.mind.rest.map(dShow), task: out.mind.task.map(dShow), recovery: out.mind.recovery.map(dShow) };
  const b = out.body;
  if (m || b) {
    const pair = (x = [], y = []) => {
      const n = Math.max(x.length, y.length);
      return Array.from({ length: n }, (_, i) => mean([x.length ? x[Math.floor((i * x.length) / n)] : null,
        y.length ? y[Math.floor((i * y.length) / n)] : null].filter((v) => v != null)));
    };
    const rest = pair(m?.rest, b?.rest); const task = pair(m?.task, b?.task); const recovery = pair(m?.recovery, b?.recovery);
    const frac = Math.max(m?.task.length ? out.mind.skip / m.task.length : 0, b?.task.length ? b.skip / b.task.length : 0);
    const skip = Math.min(Math.round(task.length * frac), Math.floor(task.length / 2));
    out.fused = { rest, task, recovery, skip, limit: 0.5, inputs: m && b ? 'mind + body' : m ? 'mind only' : 'body only',
      levels: { rest: rest.length ? median(rest) : null, task: task.length > skip ? mean(task.slice(skip)) : null,
        recovery: recovery.length ? mean(recovery) : null } };
  }
  return out;
}
