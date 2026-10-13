import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import physiologicalApi from '../physiological/api/client';
import { eegClient } from './eegApiClient';
import { COLORS } from '../physiological/config/theme';

// ============================================================
// LiveCalibrationGraphs -- twin of the website's
// web/src/components/LiveCalibrationGraphs.jsx.
//
// Real-time waves while calibrating (phase 'baseline') or taking the
// personal-limit test (phase 'task'): heart rate (per beat), skin
// response and brain-signal amplitude. The services expose, through the
// status routes the screens already poll, what has arrived so far in the
// block being captured (`live`) plus the finished blocks. Polled every
// second; nothing is stored.
// ============================================================

const POLL_MS = 1000;
const H = 130;
const PAD = { l: 38, r: 10, t: 10, b: 8 };

function useStatus(fetcher, enabled, key) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetcher();
        if (!cancelled) setState(res.data);
      } catch { /* next poll retries */ }
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);
  return state;
}

function smooth(pts) {
  if (pts.length < 2) return '';
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i += 1) {
    const [x0, y0] = pts[i - 1]; const [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    d += ` C ${cx.toFixed(1)} ${y0.toFixed(1)}, ${cx.toFixed(1)} ${y1.toFixed(1)}, ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  return d;
}

function WaveCard({ title, unit, points, color, fmt, avg, minSpan, t }) {
  const [width, setWidth] = useState(0);
  const last = points.length ? points[points.length - 1].v : null;
  let body = null;
  if (width > 0) {
    if (points.length < 2) {
      body = (
        <Svg width={width} height={H}>
          <SvgText x={width / 2} y={H / 2} textAnchor="middle" fontSize="12" fill={t.textMuted}>—</SvgText>
        </Svg>
      );
    } else {
      const vals = points.map((p) => p.v);
      let lo = Math.min(...vals, avg ?? Infinity); let hi = Math.max(...vals, avg ?? -Infinity);
      if (hi - lo < minSpan) { const m = (hi + lo) / 2; lo = m - minSpan / 2; hi = m + minSpan / 2; }
      const pad = (hi - lo) * 0.18; lo -= pad; hi += pad;
      const plotW = width - PAD.l - PAD.r; const plotH = H - PAD.t - PAD.b;
      const x = (f) => PAD.l + f * plotW;
      const y = (v) => PAD.t + (1 - (v - lo) / (hi - lo)) * plotH;
      const xy = points.map((p) => [x(p.x), y(p.v)]);
      const lastPt = xy[xy.length - 1];
      body = (
        <Svg width={width} height={H}>
          {[0, 0.5, 1].map((f) => {
            const v = lo + f * (hi - lo);
            return (
              <React.Fragment key={f}>
                <Line x1={PAD.l} x2={width - PAD.r} y1={y(v)} y2={y(v)} stroke={t.border} strokeWidth={1} />
                <SvgText x={PAD.l - 5} y={y(v) + 4} textAnchor="end" fontSize="10" fontWeight="700" fill={t.textMuted}>{fmt(v)}</SvgText>
              </React.Fragment>
            );
          })}
          {avg != null && (
            <Line x1={PAD.l} x2={width - PAD.r} y1={y(avg)} y2={y(avg)} stroke={color} strokeOpacity={0.55}
              strokeDasharray="6 5" strokeWidth={2} />
          )}
          <Path d={smooth(xy)} stroke={color} strokeWidth={2.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <Circle cx={lastPt[0]} cy={lastPt[1]} r={4.5} fill={color} stroke="#fff" strokeWidth={2} />
        </Svg>
      );
    }
  }
  return (
    <View style={[styles.chartCard, { borderColor: t.border, backgroundColor: t.card }]}>
      <View style={styles.chartHead}>
        <Text style={[styles.chartTitle, { color: t.text }]}>{title}</Text>
        <Text style={[styles.chartValue, { color }]}>{last != null ? `${fmt(last)}${unit}` : '—'}</Text>
      </View>
      <View onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))} style={{ width: '100%' }}>
        {body}
      </View>
    </View>
  );
}

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

export default function LiveCalibrationGraphs({
  phase = 'baseline', ringOnline = true, eegOnline = true, token, collapsible = false, defaultOpen = true, theme,
}) {
  const t = useMemo(() => ({
    text: theme?.text || '#231F20',
    textMuted: theme?.textMuted || '#989294',
    border: theme?.border || '#EAE5DA',
    card: theme?.card || '#FFFFFF',
  }), [theme]);
  const [open, setOpen] = useState(defaultOpen);
  const path = phase === 'task' ? '/calibrate/threshold/status' : '/calibrate/status';
  const headers = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : {}), [token]);

  const ring = useStatus(() => physiologicalApi.get(path), ringOnline && open, `r${path}`);
  const eeg = useStatus(() => eegClient.get(path, { headers }), eegOnline && open, `e${path}${token}`);

  // Keep the last wave on screen once capture ends (the services stop
  // sending `live` when they finish), so the graphs don't go blank.
  const [held, setHeld] = useState({ ibi: [], gsr: [], rms: [] });
  useEffect(() => { setHeld({ ibi: [], gsr: [], rms: [] }); }, [phase]);
  useEffect(() => {
    const l = ring?.live;
    if (!l) return;
    setHeld((h) => ({
      ...h,
      ibi: (l.ibi_ms || []).length >= 2 ? l.ibi_ms : h.ibi,
      gsr: (l.gsr_us || []).length >= 2 ? l.gsr_us : h.gsr,
    }));
  }, [ring?.live]);
  useEffect(() => {
    const l = eeg?.live;
    if (!l) return;
    setHeld((h) => ({ ...h, rms: (l.rms_uv || []).length >= 2 ? l.rms_uv : h.rms }));
  }, [eeg?.live]);

  // Heart rate: one point per beat, spaced by the beat intervals.
  const ibi = held.ibi;
  let hrPoints = [];
  if (ibi.length >= 2) {
    const total = ibi.reduce((a, b) => a + b, 0);
    let acc = 0;
    hrPoints = ibi.map((m) => { acc += m; return { x: acc / total, v: 60000 / m }; });
  }
  const gsr = held.gsr;
  const gsrPoints = gsr.length >= 2 ? gsr.map((v, i) => ({ x: i / (gsr.length - 1), v })) : [];
  const rms = held.rms;
  const rmsPoints = rms.length >= 2 ? rms.map((v, i) => ({ x: i / (rms.length - 1), v })) : [];

  const blocks = (ring?.blocks || []).filter((b) => b && b.valid);
  const hrAvg = mean(blocks.map((b) => b.hr).filter((v) => v != null && v > 0));
  const gsrAvg = mean(blocks.map((b) => b.gsr).filter((v) => v != null));

  return (
    <View style={styles.wrap}>
      {collapsible && (
        <TouchableOpacity activeOpacity={0.7} onPress={() => setOpen((o) => !o)} style={styles.head}>
          <Text style={[styles.title, { color: t.text }]}>Live graphs</Text>
          <Text style={[styles.chev, { color: t.textMuted }]}>{open ? '▾' : '▸'}</Text>
        </TouchableOpacity>
      )}
      {open && (
        <View style={{ gap: 10, marginTop: collapsible ? 10 : 0 }}>
          <WaveCard t={t} title="Heart rate" unit=" bpm" points={hrPoints} color={COLORS.hrv}
            fmt={(v) => Math.round(v)} avg={hrAvg} minSpan={10} />
          <WaveCard t={t} title="Skin response" unit=" µS" points={gsrPoints} color={COLORS.gsr}
            fmt={(v) => v.toFixed(2)} avg={gsrAvg} minSpan={0.1} />
          <WaveCard t={t} title="Brain activity" unit=" µV" points={rmsPoints} color={COLORS.eeg}
            fmt={(v) => Math.round(v)} minSpan={10} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 14 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { fontSize: 15, fontWeight: '800' },
  chev: { fontSize: 18, fontWeight: '800' },
  chartCard: { borderWidth: 1, borderRadius: 14, padding: 12 },
  chartHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 },
  chartTitle: { fontSize: 13, fontWeight: '800' },
  chartValue: { fontSize: 17, fontWeight: '900' },
});
