import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Platform } from 'react-native';
import Svg, { Circle, Line as SvgLine, Path, Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import { COLORS } from '../physiological/config/theme';

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const styleId = 'linechart-hide-scrollbar-style';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .linechart-no-scroll::-webkit-scrollbar,
      [data-noscroll="true"]::-webkit-scrollbar,
      [data-noscroll="true"] *::-webkit-scrollbar {
        display: none !important;
        width: 0 !important;
        height: 0 !important;
      }
      .linechart-no-scroll,
      [data-noscroll="true"] {
        scrollbar-width: none !important;
        -ms-overflow-style: none !important;
      }
    `;
    document.head.appendChild(style);
  }
}

// ============================================================
// LineChart -- React Native twin of the website's chart
// (web/src/components/Chart.jsx), so app and website draw every graph
// the same way.
//
//  - Self-sizing: measures its own container (onLayout) and fits it, so
//    it never overflows a card on any phone or tablet. `width` is only a
//    first-frame hint.
//  - Every point gets at least MIN_GAP px. When there are more points
//    than fit, the plot swipes sideways (opening on the newest readings)
//    while the y-axis stays pinned on the left -- nothing is squashed.
//  - Tap a point -> its value/time pops up. Tap again anywhere on the
//    chart, swipe it, or wait a few seconds -> the pop-up goes away.
//  - colorZones: line coloured green / amber / red around the person's
//    own limit (baselineValue); amber band = baseline2Value if given,
//    otherwise the 12-point band below the limit (same as levels.js).
//  - multiLine: several series on one time axis (gaps break the line).
//  - x is index-based so time between sessions doesn't leave huge empty
//    gaps; a dashed separator marks where one session ends.
//
// Same props as before, so no caller needed to change.
// ============================================================

const AXIS_W = 36;
const PAD = { l: 10, r: 14, t: 12, b: 24 };
const MIN_GAP = 24; // px per point -- wide enough to read each reading; charts swipe when they don't fit
const GAP_MS = 15 * 60 * 1000;
const BAND = 12;
const TIP_W = 156;
const TIP_HIDE_MS = 4000;

const fmtTime = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDay = (d) => d.toLocaleDateString([], { day: 'numeric', month: 'short' });

function fmtNum(v) {
    const a = Math.abs(v);
    if (a >= 100) return v.toFixed(0);
    if (a >= 10) return v.toFixed(1);
    return v.toFixed(2);
}

function toDate(d) {
    if (d == null) return null;
    if (d instanceof Date) return d;
    const x = new Date(d);
    return Number.isNaN(x.getTime()) ? null : x;
}

function Legend({ items, hint }) {
    return (
        <View style={styles.legendRow}>
            {items.map((it) => (
                <View key={it.label} style={styles.legendItem}>
                    <View style={[styles.legendSwatch, { backgroundColor: it.color }, it.dashed && styles.legendDashed]} />
                    <Text style={styles.legendText}>{it.label}</Text>
                </View>
            ))}
            {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        </View>
    );
}

function LineChart({
    points, color = COLORS.brand, width: hintWidth, height = 160, fallback, maxValue, suffix = '',
    baselineValue, baselineLabel, baselineColor = COLORS.stress,
    baseline2Value, baseline2Label, baseline2Color = COLORS.brand,
    colorZones = false,
    zoneLowColor = COLORS.normal, zoneMidColor = COLORS.warning, zoneHighColor = COLORS.stress,
    multiLine = false, seriesColors, seriesLabels,
    // Waveforms / dense signals pass a smaller minGap (px per point).
    minGap = MIN_GAP,
    variant = 'default',
    continuous = false,
    solidDots = false,
    hideScrollbar = false,
}) {
    const [width, setWidth] = useState(hintWidth || 300);
    const [sel, setSel] = useState(null);
    const scrollRef = useRef(null);
    const isPheno = variant === 'phenotyping';
    const isContinuous = continuous || isPheno;
    const useSolidDots = solidDots || isPheno;
    const shouldHideScrollbar = hideScrollbar || isPheno;
    const chartId = useRef(`c_${Math.random().toString(36).slice(2, 7)}`).current;
    const zoneGradientId = `zone_${chartId}`;
    const areaGradientId = `area_${chartId}`;

    const isMulti = multiLine && seriesColors && seriesLabels;
    const series = useMemo(() => (isMulti
        ? seriesColors.map((c, i) => ({ color: c, name: seriesLabels[i] }))
        : [{ color, name: '' }]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isMulti, color, isMulti ? seriesColors.join() : '', isMulti ? seriesLabels.join() : '']);

    const rows = useMemo(() => (points || []).map((p) => ({
        date: toDate(p.date),
        values: isMulti ? p.values : [p.value],
        windowCount: p.windowCount,
    })), [points, isMulti]);

    const zoned = colorZones && !isMulti && baselineValue != null;
    const midValue = zoned ? (baseline2Value != null ? baseline2Value : baselineValue - BAND) : null;

    const g = useMemo(() => {
        const n = rows.length;
        const viewW = Math.max(60, width - AXIS_W);
        const contentW = Math.max(viewW, PAD.l + PAD.r + Math.max(0, n - 1) * minGap);
        const plotW = contentW - PAD.l - PAD.r;
        const plotH = Math.max(10, height - PAD.t - PAD.b);

        let lo; let hi;
        if (maxValue != null) { lo = 0; hi = maxValue; } else {
            lo = Infinity; hi = -Infinity;
            rows.forEach((r) => r.values.forEach((v) => { if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }));
            [baselineValue, baseline2Value].forEach((v) => { if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
            if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
            if (hi === lo) { lo -= 1; hi += 1; }
            const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
        }
        const x = (i) => PAD.l + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
        const y = (v) => PAD.t + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * plotH;

        // Session breaks: only gaps far larger than this series' normal
        // spacing (so weekly/daily series still draw one continuous line).
        // In continuous mode (phenotyping), gaps never split the line into isolated dots.
        const breaks = [];
        if (!isContinuous) {
            const diffs = [];
            for (let i = 1; i < n; i += 1) {
                const a = rows[i - 1].date; const b = rows[i].date;
                if (a && b) diffs.push(b - a);
            }
            const sortedDiffs = [...diffs].sort((a, b) => a - b);
            const typical = sortedDiffs.length ? sortedDiffs[Math.floor(sortedDiffs.length / 2)] : 0;
            const gapLimit = Math.max(GAP_MS, typical * 6);
            for (let i = 1; i < n; i += 1) {
                const a = rows[i - 1].date; const b = rows[i].date;
                if (a && b && b - a > gapLimit) breaks.push(i);
            }
        }
        const breakSet = new Set(breaks);
        const spanMs = n > 1 && rows[0].date && rows[n - 1].date ? rows[n - 1].date - rows[0].date : 0;

        const paths = series.map((_, si) => {
            let d = ''; let area = ''; let open = false; let segStart = 0; let lastX = 0;
            const close = () => { if (open) area += ` L${lastX.toFixed(1)} ${(PAD.t + plotH).toFixed(1)} L${segStart.toFixed(1)} ${(PAD.t + plotH).toFixed(1)} Z`; };
            rows.forEach((r, i) => {
                const v = r.values[si];
                if (v == null || breakSet.has(i)) { close(); open = false; if (v == null) return; }
                const px = x(i); const py = y(v);
                const seg = `${open ? ' L' : ' M'}${px.toFixed(1)} ${py.toFixed(1)}`;
                d += seg; area += seg;
                if (!open) segStart = px;
                open = true; lastX = px;
            });
            close();
            return { d, area };
        });

        const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + f * (hi - lo));
        const multiDay = n > 1 && rows[0].date && rows[n - 1].date && fmtDay(rows[0].date) !== fmtDay(rows[n - 1].date);
        const fmtX = (d) => (spanMs > 2 * 86400000 ? fmtDay(d) : multiDay ? `${fmtDay(d)} ${fmtTime(d)}` : fmtTime(d));
        const labelW = spanMs > 2 * 86400000 ? 54 : multiDay ? 92 : 50;
        const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / labelW))));
        const xLabels = [];
        for (let i = 0; i < n; i += step) if (rows[i].date) xLabels.push(i);
        if (n > 1 && rows[n - 1].date && xLabels[xLabels.length - 1] !== n - 1) {
            if (xLabels.length && n - 1 - xLabels[xLabels.length - 1] < step / 2) xLabels.pop();
            xLabels.push(n - 1);
        }
        return { n, viewW, contentW, plotW, plotH, lo, hi, x, y, breaks, paths, ticks, xLabels, fmtX, scrollable: contentW > viewW + 1 };
    }, [rows, series, width, height, maxValue, baselineValue, baseline2Value, minGap]);

    // Open on (and follow) the newest readings when the series grows.
    const prevN = useRef(0);
    useEffect(() => {
        const grew = g.n > prevN.current;
        prevN.current = g.n;
        if (!grew || !g.scrollable || !scrollRef.current) return undefined;
        const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 30);
        return () => clearTimeout(t);
    }, [g.n, g.scrollable, g.contentW]);

    // The pop-up hides itself after a few seconds.
    useEffect(() => {
        if (sel == null) return undefined;
        const t = setTimeout(() => setSel(null), TIP_HIDE_MS);
        return () => clearTimeout(t);
    }, [sel]);

    if (!rows.length) return fallback || null;

    const levelColor = (v) => (!zoned ? series[0].color
        : v >= baselineValue ? zoneHighColor : v >= midValue ? zoneMidColor : zoneLowColor);
    const frac = (v) => Math.min(1, Math.max(0, (g.hi - v) / (g.hi - g.lo)));
    const { n, x, y, contentW } = g;
    const s = sel != null && sel < n ? sel : null;
    const hv = s != null ? rows[s] : null;

    // Tap: if a pop-up is showing, any tap dismisses it; otherwise select
    // the nearest point.
    const onPress = (e) => {
        if (s != null) { setSel(null); return; }
        const px = e.nativeEvent.locationX;
        const i = n <= 1 ? 0 : Math.round(((px - PAD.l) / g.plotW) * (n - 1));
        setSel(Math.max(0, Math.min(n - 1, i)));
    };

    const legend = [];
    if (isMulti) series.forEach((se) => legend.push({ color: se.color, label: se.name }));
    if (baseline2Value != null) legend.push({ color: baseline2Color, label: baseline2Label || 'Your baseline', dashed: true });
    if (baselineValue != null) legend.push({ color: baselineColor, label: baselineLabel || 'Stress threshold', dashed: true });

    const tipW = Math.min(TIP_W, g.viewW - 8);
    const tipLeft = hv ? Math.min(contentW - tipW - 4, Math.max(4, x(s) - tipW / 2)) : 0;
    const hvFirst = hv ? hv.values.find((v) => v != null) : null;
    // Pop-up goes above the point, or below it when the point is near the top.
    const tipTop = hv && hvFirst != null ? (y(hvFirst) > 70 ? Math.max(0, y(hvFirst) - 62) : Math.min(height - 60, y(hvFirst) + 12)) : 0;

    return (
        <View style={{ width: '100%' }} onLayout={(e) => {
            const w = Math.floor(e.nativeEvent.layout.width);
            if (w > 0 && Math.abs(w - width) > 1) setWidth(w);
        }}>
            <View style={styles.row}>
                {/* Pinned y-axis */}
                <Svg width={AXIS_W} height={height}>
                    {g.ticks.map((t, i) => (
                        <SvgText key={`a${i}`} x={AXIS_W - 5} y={y(t) + 3} fontSize={9} fontWeight="700"
                            fill={COLORS.light.textMuted} textAnchor="end">
                            {fmtNum(t)}
                        </SvgText>
                    ))}
                </Svg>

                <ScrollView
                    ref={scrollRef}
                    horizontal
                    scrollEnabled={g.scrollable}
                    showsHorizontalScrollIndicator={shouldHideScrollbar ? false : g.scrollable}
                    style={[
                        { width: g.viewW },
                        Platform.OS === 'web' && shouldHideScrollbar && {
                            scrollbarWidth: 'none',
                            msOverflowStyle: 'none',
                        },
                    ]}
                    {...(Platform.OS === 'web' && shouldHideScrollbar ? { 'data-noscroll': 'true', className: 'linechart-no-scroll' } : {})}
                    nestedScrollEnabled
                    bounces={false}
                    overScrollMode="never"
                    onScrollBeginDrag={() => setSel(null)}
                >
                    <Pressable onPress={onPress} style={{ width: contentW, height }}>
                        <Svg width={contentW} height={height}>
                            <Defs>
                                {zoned && (
                                    <LinearGradient id={zoneGradientId} x1="0" y1={PAD.t} x2="0" y2={PAD.t + g.plotH} gradientUnits="userSpaceOnUse">
                                        <Stop offset={0} stopColor={zoneHighColor} />
                                        <Stop offset={frac(baselineValue)} stopColor={zoneHighColor} />
                                        <Stop offset={frac(baselineValue)} stopColor={zoneMidColor} />
                                        <Stop offset={frac(midValue)} stopColor={zoneMidColor} />
                                        <Stop offset={frac(midValue)} stopColor={zoneLowColor} />
                                        <Stop offset={1} stopColor={zoneLowColor} />
                                    </LinearGradient>
                                )}
                                <LinearGradient id={areaGradientId} x1="0" y1="0" x2="0" y2="1">
                                    <Stop offset="0" stopColor={zoned ? COLORS.brand : series[0].color} stopOpacity={0.16} />
                                    <Stop offset="1" stopColor={zoned ? COLORS.brand : series[0].color} stopOpacity={0} />
                                </LinearGradient>
                            </Defs>

                            {/* Vertical grid lines behind points for phenotyping (reference style) */}
                            {isPheno && g.xLabels.map((i) => (
                                <SvgLine
                                    key={`vx${i}`}
                                    x1={x(i)}
                                    x2={x(i)}
                                    y1={PAD.t}
                                    y2={PAD.t + g.plotH}
                                    stroke="#E2E8F0"
                                    strokeWidth={1}
                                    strokeOpacity={0.7}
                                />
                            ))}

                            {g.ticks.map((t, i) => (
                                <SvgLine key={`t${i}`} x1={0} x2={contentW} y1={y(t)} y2={y(t)} stroke={COLORS.light.borderSoft} strokeWidth={1} />
                            ))}

                            {g.breaks.map((i) => {
                                const bx = (x(i) + x(i - 1)) / 2;
                                return <SvgLine key={`b${i}`} x1={bx} x2={bx} y1={PAD.t} y2={PAD.t + g.plotH} stroke={COLORS.light.border} strokeDasharray="3,4" />;
                            })}

                            {baseline2Value != null && (
                                <SvgLine x1={0} x2={contentW} y1={y(baseline2Value)} y2={y(baseline2Value)}
                                    stroke={baseline2Color} strokeOpacity={0.8} strokeWidth={1.5} strokeDasharray="5,4" />
                            )}
                            {baselineValue != null && (
                                <SvgLine x1={0} x2={contentW} y1={y(baselineValue)} y2={y(baselineValue)}
                                    stroke={baselineColor} strokeOpacity={0.8} strokeWidth={1.5} strokeDasharray="5,4" />
                            )}

                            {g.paths.map((p, si) => (
                                <React.Fragment key={`p${si}`}>
                                    {!isMulti && !isPheno && <Path d={p.area} fill={`url(#${areaGradientId})`} />}
                                    <Path d={p.d} fill="none" strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round"
                                        stroke={zoned ? `url(#${zoneGradientId})` : series[si].color} />
                                </React.Fragment>
                            ))}

                            {/* Every point is visible -- MIN_GAP guarantees room for a dot. */}
                            {minGap >= 8 && series.map((se, si) => rows.map((r, i) => (r.values[si] == null ? null : (
                                <Circle
                                    key={`d${si}-${i}`}
                                    cx={x(i)}
                                    cy={y(r.values[si])}
                                    r={useSolidDots ? 3.5 : 2.4}
                                    fill={useSolidDots ? (zoned ? levelColor(r.values[si]) : se.color) : "#FFFFFF"}
                                    stroke={zoned ? levelColor(r.values[si]) : se.color}
                                    strokeWidth={useSolidDots ? 1 : 1.5}
                                />
                            ))))}

                            {g.xLabels.map((i, k) => {
                                const anchor = k === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
                                const lx = anchor === 'start' ? Math.max(2, x(i) - 4) : anchor === 'end' ? Math.min(contentW - 2, x(i) + 4) : x(i);
                                return (
                                    <SvgText key={`x${i}`} x={lx} y={height - 6}
                                        fontSize={9} fontWeight="700" fill={COLORS.light.textMuted} textAnchor={anchor}>
                                        {g.fmtX(rows[i].date)}
                                    </SvgText>
                                );
                            })}

                            {hv && (
                                <>
                                    <SvgLine x1={x(s)} x2={x(s)} y1={PAD.t} y2={PAD.t + g.plotH} stroke={COLORS.light.text} strokeOpacity={0.2} />
                                    {series.map((se, si) => (hv.values[si] == null ? null : (
                                        <Circle key={`h${si}`} cx={x(s)} cy={y(hv.values[si])} r={5.5}
                                            fill={zoned ? levelColor(hv.values[si]) : se.color} stroke="#FFFFFF" strokeWidth={2} />
                                    )))}
                                </>
                            )}
                        </Svg>

                        {hv && (
                            <View pointerEvents="none" style={[styles.tip, { left: tipLeft, top: tipTop, width: tipW }]}>
                                {series.map((se, si) => (hv.values[si] == null ? null : (
                                    <Text key={si} style={styles.tipText} numberOfLines={1}>
                                        {isMulti ? <Text style={{ color: se.color }}>● </Text> : null}
                                        {isMulti ? `${se.name}: ` : ''}{fmtNum(hv.values[si])}{suffix}
                                        {zoned ? (hv.values[si] >= baselineValue ? '  · high' : hv.values[si] >= midValue ? '  · rising' : '  · calm') : ''}
                                    </Text>
                                )))}
                                {hv.date ? (
                                    <Text style={styles.tipSub} numberOfLines={1}>
                                        {fmtDay(hv.date)} · {fmtTime(hv.date)}{hv.windowCount ? ` · avg of ${hv.windowCount}` : ''}
                                    </Text>
                                ) : null}
                            </View>
                        )}
                    </Pressable>
                </ScrollView>
            </View>

            {(legend.length > 0 || g.scrollable) && (
                <Legend items={legend} hint={g.scrollable ? '← swipe for earlier' : null} />
            )}
        </View>
    );
}

// Re-render only when something other than `fallback`'s identity changed.
function propsEqual(prev, next) {
    const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
    for (const k of keys) {
        if (k === 'fallback') continue;
        if (prev[k] !== next[k]) {
            if (Array.isArray(prev[k]) && Array.isArray(next[k]) && k !== 'points'
                && prev[k].length === next[k].length && prev[k].every((v, i) => v === next[k][i])) continue;
            return false;
        }
    }
    return true;
}

export default React.memo(LineChart, propsEqual);

const styles = StyleSheet.create({
    row: { flexDirection: 'row', width: '100%' },
    tip: {
        position: 'absolute',
        backgroundColor: COLORS.light.text, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6,
        shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 8, elevation: 5,
    },
    tipText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
    tipSub: { color: '#FFFFFFB3', fontSize: 10, fontWeight: '600', marginTop: 1 },
    legendRow: { marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', rowGap: 6, columnGap: 14 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    legendSwatch: { width: 14, height: 3, borderRadius: 2 },
    legendDashed: { opacity: 0.7 },
    legendText: { fontSize: 10, fontWeight: '700', color: COLORS.light.textSub },
    hint: { marginLeft: 'auto', fontSize: 10, fontWeight: '600', color: COLORS.light.textMuted },
});
