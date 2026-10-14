import { useCallback, useEffect, useRef, useState } from 'react';
import { preprocess, spectralFeatures } from '../lib/dsp';
import { SOURCE_FS } from '../lib/config';

// Live validation features from the raw MQTT stream: every STEP_MS, filter
// the buffered signal (same chain as the backend, unclamped) and measure the
// last WINDOW_SEC. Each point is stamped with the condition the viewer had
// marked (eyes open/closed, low/high load), so the charts and the summary can
// compare conditions. Kept in memory only; exportable as CSV.
const STEP_MS = 1000;
const WINDOW_SEC = 4;       // 2 Welch segments of 2 s, 50% overlap -> 3 averages
const MIN_BUFFER_SEC = 6;   // filter on >= 6 s so the window isn't at the filter's edge
const HISTORY_MAX = 3600;   // 1 h of 1 s points
const WAVE_SEC = 5;

export const CONDITIONS = {
  eyes_open: { label: 'Eyes open', test: 'eyes' },
  eyes_closed: { label: 'Eyes closed', test: 'eyes' },
  low_load: { label: 'Low load', test: 'load' },
  high_load: { label: 'High load', test: 'load' },
};

export default function useLiveSpectral(raw) {
  const samplesRef = useRef(raw.samples);
  samplesRef.current = raw.samples;
  const condRef = useRef(null);
  const [condition, setConditionState] = useState(null); // {key, start}
  const [segments, setSegments] = useState([]);           // [{key, start, end}]
  const [history, setHistory] = useState([]);
  const [latest, setLatest] = useState(null);             // {freqs, psd, wave, ...features}
  const sums = useRef({});                                // condition -> {n, psd: Float64Array}
  const [avgSpectra, setAvgSpectra] = useState({});

  const setCondition = useCallback((key) => {
    const now = Date.now();
    setSegments((segs) => {
      const out = segs.map((s) => (s.end == null ? { ...s, end: now } : s));
      return key ? [...out, { key, start: now, end: null }] : out;
    });
    condRef.current = key ? { key, start: now } : null;
    setConditionState(condRef.current);
  }, []);

  const reset = useCallback(() => {
    setHistory([]); setSegments([]); sums.current = {}; setAvgSpectra({});
    condRef.current = null; setConditionState(null);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const s = samplesRef.current;
      if (s.length < MIN_BUFFER_SEC * SOURCE_FS) return;
      const lastMillis = s[s.length - 1].millis;
      const uv = s.map((x) => x.uv);
      const filtered = preprocess(uv, SOURCE_FS);
      const win = filtered.subarray(filtered.length - WINDOW_SEC * SOURCE_FS);
      const f = spectralFeatures(win, SOURCE_FS);
      if (!f) return;
      const t = Date.now();
      const cond = condRef.current;
      // A window counts for a condition only if all WINDOW_SEC of it were
      // recorded after that condition was marked.
      const condKey = cond && t - cond.start >= WINDOW_SEC * 1000 ? cond.key : null;
      const { freqs, psd, ...feat } = f;
      setHistory((h) => {
        const next = h.length >= HISTORY_MAX ? h.slice(h.length - HISTORY_MAX + 1) : h.slice();
        next.push({ x: t, deviceMillis: lastMillis, condition: condKey, ...feat });
        return next;
      });
      if (condKey && f.out_of_range <= 0.05) {
        const acc = sums.current[condKey] || { n: 0, psd: new Float64Array(psd.length) };
        for (let k = 0; k < psd.length; k += 1) acc.psd[k] += psd[k];
        acc.n += 1;
        sums.current[condKey] = acc;
        setAvgSpectra(Object.fromEntries(Object.entries(sums.current).map(([k, a]) => [k, { n: a.n, psd: Float64Array.from(a.psd, (v) => v / a.n) }])));
      }
      setLatest({ ...feat, freqs, psd, wave: filtered.slice(filtered.length - WAVE_SEC * SOURCE_FS), t });
    }, STEP_MS);
    return () => clearInterval(id);
  }, []);

  return { history, latest, condition, segments, setCondition, reset, avgSpectra, windowSec: WINDOW_SEC };
}
