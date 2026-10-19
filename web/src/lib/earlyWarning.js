// Early warning ("rising towards high load") for the mind (EEG) and the fused
// value -- exact port of backend/common/early_warning.py (same rules, same
// Theil-Sen); checked against backend/common/test_vectors_early_warning.json.
// The body (HRV/GSR) keeps its prediction-vs-limit rule (no trend).
//
//   band        b + 0.5 s <= value < limit
//   per block, last N=6: >=5 valid, EWMA(0.3) in the band, >=4 at/above the
//   band floor, Theil-Sen slope > 0 and slope x 5 >= 0.5 s; 2 blocks in a row
//   -> early_warning. Clears when slope <= 0 and EWMA below the band for 2
//   blocks, or HIGH (2-of-3) takes over; cooldown 7 blocks. 'limited' when
//   the calibration can't support a band (reason given).
export const EW_DEFAULT = { n: 6, k: 4, bufferSpreads: 0.5, riseSpreads: 0.5, alpha: 0.3, persist: 2, clearBlocks: 2, cooldownBlocks: 7 };

export function theilSen(xs, ys) {
  const slopes = [];
  for (let i = 0; i < xs.length; i += 1) {
    for (let j = i + 1; j < xs.length; j += 1) if (xs[j] !== xs[i]) slopes.push((ys[j] - ys[i]) / (xs[j] - xs[i]));
  }
  if (!slopes.length) return 0;
  slopes.sort((a, b) => a - b);
  const m = slopes.length;
  return m % 2 ? slopes[(m - 1) / 2] : 0.5 * (slopes[m / 2 - 1] + slopes[m / 2]);
}

export class EarlyWarning {
  constructor(baseline, limit, spread, params = EW_DEFAULT) {
    this.p = params;
    this.b = baseline; this.th = limit; this.s = spread;
    this.lo = baseline + params.bufferSpreads * spread;
    this.rise = params.riseSpreads * spread;
    this.win = [];
    this.ewma = null;
    this.state = 'normal';
    this.hits = 0; this.clearHits = 0; this.cooldown = 0;
  }

  update(value, { valid = true, suppressed = null, highAlert = false } = {}) {
    const p = this.p;
    const ok = valid && value != null && Number.isFinite(value);
    this.win.push(ok ? value : null);
    if (this.win.length > p.n) this.win.shift();
    if (ok) this.ewma = this.ewma == null ? value : p.alpha * value + (1 - p.alpha) * this.ewma;
    const pts = this.win.map((v, i) => [i, v]).filter(([, v]) => v != null);
    const vals = pts.map(([, v]) => v);
    const slope = pts.length >= 3 ? theilSen(pts.map(([i]) => i), vals) : 0;
    const enough = vals.length >= p.n - 1;
    const above = vals.filter((v) => v >= this.lo).length;
    const inBand = this.ewma != null && this.ewma >= this.lo && this.ewma < this.th;
    const rising = slope > 0 && slope * (p.n - 1) >= this.rise;
    const cond = enough && inBand && above >= p.k && rising;
    const zone = this.ewma == null ? null : this.ewma >= this.th ? 'above' : this.ewma >= this.lo ? 'band' : 'below';
    let reason = null;
    if (highAlert) {
      this.state = 'high'; this.hits = 0; this.clearHits = 0;
    } else if (suppressed) {
      this.state = 'limited'; this.hits = 0; this.clearHits = 0; reason = suppressed;
    } else {
      if (this.state === 'high') this.state = this.ewma != null && this.ewma >= this.lo ? 'recovering' : 'normal';
      else if (this.state === 'limited') this.state = 'normal';
      if (this.state === 'normal' || this.state === 'recovering') {
        if (this.state === 'recovering' && (this.ewma == null || this.ewma < this.lo)) this.state = 'normal';
        if (this.cooldown) this.cooldown -= 1;
        this.hits = cond && this.cooldown === 0 ? this.hits + 1 : 0;
        if (this.hits >= p.persist) { this.state = 'early_warning'; this.hits = 0; this.clearHits = 0; }
      } else if (this.state === 'early_warning') {
        const below = this.ewma != null && this.ewma < this.lo;
        this.clearHits = slope <= 0 && below ? this.clearHits + 1 : 0;
        if (this.clearHits >= p.clearBlocks) { this.state = 'normal'; this.clearHits = 0; this.cooldown = p.cooldownBlocks; }
      }
      if (!enough && this.state === 'normal') reason = 'not enough valid blocks';
    }
    return { state: this.state, ewma: this.ewma, slope, blocksAbove: above, nValid: vals.length, zone, reason, band: [this.lo, this.th] };
  }
}

// Pre-stress signature: mind in early warning / high while the body is still below its own limit.
export const mindLed = (mindState, bodyValue, bodyLimit = 0.5) =>
  (mindState === 'early_warning' || mindState === 'high') && bodyValue != null && bodyValue < bodyLimit;

export const STATE_TEXT = {
  normal: 'Normal', early_warning: 'Early warning', high: 'High', recovering: 'Recovering', limited: 'Limited',
  calibrating: 'Calibrating',
};
