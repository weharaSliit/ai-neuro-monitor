// Browser-side preprocessing + spectral features for the live validation
// view. Mirrors the backend so the numbers line up with what the model uses:
//   preprocessing  realtime/pipeline.py::preprocess_bipolar_block_unclamped()
//                  (linear detrend -> +-2000 uV despike -> 50 Hz notch -> 1-45 Hz
//                  zero-phase Butterworth band-pass; the backend's extra MAD
//                  despike/resample-to-128 Hz steps are omitted here)
//   band powers    sam40/features.py::_band_powers() -- Welch, 2 s
//                  segments, relative power = band / total
//   spectral slope sam40/features.py::_spectral_slope() -- least-squares
//                  slope of log10(power) on log10(frequency), 1-45 Hz

export const BANDS = {
  delta: [0.5, 4],
  theta: [4, 8],
  alpha: [8, 13],
  beta: [13, 30],
  gamma: [30, 45],
};
export const RANGE_UV = 100; // quality_gate.py RANGE_UV -- SAM40 training never exceeds it
const WIDE_DESPIKE_UV = 2000; // pipeline.py WIDE_DESPIKE_UV

// ── IIR filters (RBJ cookbook biquads) ────────────────────────────────
function biquad(type, f0, fs, q) {
  const w = (2 * Math.PI * f0) / fs;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  let b;
  if (type === 'lowpass') b = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
  else if (type === 'highpass') b = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
  else b = [1, -2 * cos, 1]; // notch
  const a0 = 1 + alpha;
  return { b: b.map((v) => v / a0), a: [1, (-2 * cos) / a0, (1 - alpha) / a0] };
}

function runBiquad(x, { b, a }) {
  const y = new Float64Array(x.length);
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
  for (let i = 0; i < x.length; i += 1) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

// 4th-order Butterworth = two cascaded biquads with these Qs.
const BUTTER4_Q = [0.5411961, 1.3065630];

function cascade(fs) {
  return [
    biquad('notch', 50, fs, 30),
    ...BUTTER4_Q.map((q) => biquad('highpass', 1.0, fs, q)), // BIPOLAR_HIGHPASS_HZ
    ...BUTTER4_Q.map((q) => biquad('lowpass', 45, fs, q)),
  ];
}

// Zero-phase forward-backward filtering with odd-reflection padding at both
// ends (scipy's filtfilt/sosfiltfilt approach) so the newest samples -- the
// ones on screen -- aren't distorted by the backward pass's start-up.
function filtfilt(x, stages, pad) {
  const n = x.length;
  const p = Math.min(pad, n - 1);
  const ext = new Float64Array(n + 2 * p);
  for (let i = 0; i < p; i += 1) ext[i] = 2 * x[0] - x[p - i];
  ext.set(x, p);
  for (let i = 0; i < p; i += 1) ext[p + n + i] = 2 * x[n - 1] - x[n - 2 - i];
  let y = ext;
  for (const s of stages) y = runBiquad(y, s);
  y.reverse();
  for (const s of stages) y = runBiquad(y, s);
  y.reverse();
  return y.subarray(p, p + n);
}

// µV samples -> filtered, UNCLAMPED µV (same signal the quality gate judges).
export function preprocess(uv, fs) {
  if (uv.length < fs) return new Float64Array(0);
  // Linear detrend + 3 s padding, as the backend (pipeline.py EDGE_PAD_SEC):
  // removing only the mean leaves electrode drift as a ramp that rings at
  // the window edges.
  const n = uv.length;
  let sx = 0; let sy = 0; let sxx = 0; let sxy = 0;
  for (let i = 0; i < n; i += 1) { sx += i; sy += uv[i]; sxx += i * i; sxy += i * uv[i]; }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const icpt = (sy - slope * sx) / n;
  const x = Float64Array.from(uv, (v, i) => Math.max(-WIDE_DESPIKE_UV, Math.min(WIDE_DESPIKE_UV, v - (icpt + slope * i))));
  return filtfilt(x, cascade(fs), Math.round(3 * fs));
}

// ── DFT + Welch PSD ───────────────────────────────────────────────────
// Direct DFT of the one-sided bins (any length, so the segment length can
// match scipy's exactly). Tables cached per length; a 2 s / 500-sample
// segment costs ~125k multiply-adds -- trivial at one window per second.
const dftTables = new Map();
function dftPower(seg) {
  const n = seg.length;
  const nfreq = Math.floor(n / 2) + 1;
  let t = dftTables.get(n);
  if (!t) {
    t = { cos: new Float64Array(n), sin: new Float64Array(n) };
    for (let i = 0; i < n; i += 1) { t.cos[i] = Math.cos((2 * Math.PI * i) / n); t.sin[i] = Math.sin((2 * Math.PI * i) / n); }
    dftTables.set(n, t);
  }
  const out = new Float64Array(nfreq);
  for (let k = 0; k < nfreq; k += 1) {
    let re = 0; let im = 0; let idx = 0;
    for (let i = 0; i < n; i += 1) {
      re += seg[i] * t.cos[idx]; im -= seg[i] * t.sin[idx];
      idx += k; if (idx >= n) idx -= n;
    }
    out[k] = re * re + im * im;
  }
  return out;
}

// One-sided periodic-Hann Welch PSD (density, µV²/Hz), 50% overlap, per-
// segment mean removal -- scipy.signal.welch defaults.
export function welch(x, fs, nperseg) {
  const win = Float64Array.from({ length: nperseg }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / nperseg));
  const wss = win.reduce((s, w) => s + w * w, 0);
  const nfreq = Math.floor(nperseg / 2) + 1;
  const psd = new Float64Array(nfreq);
  const step = Math.floor(nperseg / 2);
  let nseg = 0;
  for (let start = 0; start + nperseg <= x.length; start += step) {
    let m = 0;
    for (let i = 0; i < nperseg; i += 1) m += x[start + i];
    m /= nperseg;
    const seg = new Float64Array(nperseg);
    for (let i = 0; i < nperseg; i += 1) seg[i] = (x[start + i] - m) * win[i];
    const pw = dftPower(seg);
    for (let k = 0; k < nfreq; k += 1) psd[k] += pw[k];
    nseg += 1;
  }
  if (!nseg) return null;
  const freqs = Float64Array.from({ length: nfreq }, (_, k) => (k * fs) / nperseg);
  for (let k = 0; k < nfreq; k += 1) {
    psd[k] /= nseg * fs * wss;
    if (k > 0 && !(nperseg % 2 === 0 && k === nfreq - 1)) psd[k] *= 2;
  }
  return { freqs, psd };
}

function trapz(freqs, psd, lo, hi) {
  let s = 0;
  let prev = null;
  for (let k = 0; k < freqs.length; k += 1) {
    if (freqs[k] < lo || freqs[k] >= hi) { prev = null; continue; }
    if (prev !== null) s += ((psd[prev] + psd[k]) / 2) * (freqs[k] - freqs[prev]);
    prev = k;
  }
  return s;
}

function slope(freqs, psd, fmin = 1, fmax = 45) {
  const xs = []; const ys = [];
  for (let k = 0; k < freqs.length; k += 1) {
    if (freqs[k] >= fmin && freqs[k] <= fmax && psd[k] > 0) { xs.push(Math.log10(freqs[k])); ys.push(Math.log10(psd[k])); }
  }
  if (xs.length < 3) return { slope: null, intercept: null };
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0; let den = 0;
  for (let i = 0; i < xs.length; i += 1) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  const b = num / den;
  return { slope: b, intercept: my - b * mx };
}

// Features of one filtered window -- same definitions as the backend.
export function spectralFeatures(filtered, fs) {
  const nperseg = Math.min(filtered.length, Math.round(fs * 2)); // 2 s -- scipy welch(nperseg=fs*2)
  const w = welch(filtered, fs, nperseg);
  if (!w) return null;
  const { freqs, psd } = w;
  const total = trapz(freqs, psd, 0, Infinity) || Number.EPSILON;
  const out = { total };
  for (const [band, [lo, hi]] of Object.entries(BANDS)) {
    const p = trapz(freqs, psd, lo, hi);
    out[band] = p;
    out[`${band}_rel`] = p / total;
  }
  out.theta_alpha = out.theta / (out.alpha || Number.EPSILON);
  const fit = slope(freqs, psd);
  out.slope = fit.slope;
  out.slopeIntercept = fit.intercept;
  let oor = 0;
  for (const v of filtered) if (Math.abs(v) > RANGE_UV) oor += 1;
  out.out_of_range = oor / filtered.length;
  let s2 = 0;
  for (const v of filtered) s2 += v * v;
  out.rms = Math.sqrt(s2 / filtered.length);
  return { ...out, freqs, psd };
}
