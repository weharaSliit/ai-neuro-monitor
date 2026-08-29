import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import Svg, { Circle, Line as SvgLine } from 'react-native-svg';
import { LineChart as GiftedLineChart } from 'react-native-gifted-charts';
import { COLORS } from '../physiological/config/theme';

function ReferenceLine({ value, label, color, height, maxValue, labelSide }) {
    if (value === undefined || value === null || !maxValue) return null;
    const top = height * (1 - Math.min(1, Math.max(0, value / maxValue)));
    return (
        <View pointerEvents="none" style={[styles.baseline, { top, borderTopColor: color }]}>
            {label ? (
                <Text style={[styles.baselineLabel, { color }, labelSide === 'left' ? { left: 0 } : { right: 0 }]}>
                    {label}
                </Text>
            ) : null}
        </View>
    );
}

const X_LABEL_HEIGHT = 16;
const LEGEND_HEIGHT = 20;
const DETAIL_HEIGHT = 18;
const MIN_POINT_GAP = 30;

function LegendSwatch({ color, label }) {
    return (
        <View style={styles.legendItem}>
            <View style={[styles.legendSwatch, { backgroundColor: color }]} />
            <Text style={[styles.legendText, { color: COLORS.light.textSub }]}>{label}</Text>
        </View>
    );
}

function ZoneChart({
    raw, width, height, maxValue,
    baselineLabel, baselineColor,
    baselineValue, baseline2Value, baseline2Label, baseline2Color,
    zoneLowColor, zoneMidColor, zoneHighColor,
}) {
    const [selectedIndex, setSelectedIndex] = useState(null);
    const contentWidth = Math.max(width, MIN_POINT_GAP * Math.max(1, raw.length - 1) + 20);
    const times = raw.map((p) => (p.date ? new Date(p.date).getTime() : null));
    const haveAllTimes = times.every((t) => t !== null && !Number.isNaN(t));
    const totalSpan = haveAllTimes ? times[times.length - 1] - times[0] : 0;

    const xs = [];
    raw.forEach((_p, i) => {
        if (i === 0) { xs.push(0); return; }
        let spacing;
        if (haveAllTimes && totalSpan > 0) {
            const frac = (times[i] - times[i - 1]) / totalSpan;
            spacing = Math.max(MIN_POINT_GAP * 0.6, frac * contentWidth);
        } else {
            spacing = Math.max(MIN_POINT_GAP, contentWidth / (raw.length - 1));
        }
        xs.push(xs[i - 1] + spacing);
    });

    const PAD_Y = 7;
    const clamp01 = (v) => Math.min(1, Math.max(0, v));
    const valueToY = (v) => PAD_Y + (height - PAD_Y * 2) * (1 - clamp01(v / maxValue));
    const ys = raw.map((p) => valueToY(p.value));

    const zoneOf = (v) => (
        v >= baselineValue ? 'high' : ((baseline2Value != null && v >= baseline2Value) ? 'mid' : 'low')
    );
    const zoneColorOf = (z) => (z === 'high' ? zoneHighColor : z === 'mid' ? zoneMidColor : zoneLowColor);
    const zoneLabelOf = (z) => (z === 'high' ? 'Stress' : z === 'mid' ? 'Trending' : 'Normal');
    const zones = raw.map((p) => zoneOf(p.value));

    const targetLabelCount = Math.max(4, Math.round(contentWidth / 90));
    const labelStep = Math.max(1, Math.ceil(raw.length / targetLabelCount));

    const baselineY = valueToY(baselineValue);
    const baseline2Y = baseline2Value != null ? valueToY(baseline2Value) : null;

    const selected = selectedIndex != null ? raw[selectedIndex] : null;
    let detailNode = (
        <Text style={[styles.detailHint, { color: COLORS.light.textMuted }]}>Tap a point for details</Text>
    );
    if (selected) {
        const zone = zones[selectedIndex];
        const dColor = zoneColorOf(zone);
        const time = selected.date
            ? new Date(selected.date).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
            : '';
        let devText = '';
        if (baseline2Value != null) {
            const dev = Math.round(selected.value - baseline2Value);
            devText = dev === 0 ? ' · at your baseline'
                : dev > 0 ? ` · ${dev} pts above your baseline`
                    : ` · ${Math.abs(dev)} pts below your baseline`;
        }
        detailNode = (
            <Text style={styles.detailText} numberOfLines={1}>
                <Text style={{ color: dColor, fontWeight: '800' }}>{zoneLabelOf(zone)}</Text>
                <Text style={{ color: COLORS.light.textMuted }}>{devText} · {time}</Text>
            </Text>
        );
    }

    return (
        <View style={{ width }}>
            <View style={styles.detailBar}>{detailNode}</View>

            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ width }}
                nestedScrollEnabled
                directionalLockEnabled
            >
                <View style={{ width: contentWidth, height: height + X_LABEL_HEIGHT }}>
                    <Svg width={contentWidth} height={height} style={{ position: 'absolute', top: 0, left: 0 }}>
                        <SvgLine x1={0} y1={0} x2={0} y2={height} stroke={COLORS.light.border} strokeWidth={1} />
                        <SvgLine x1={0} y1={height} x2={contentWidth} y2={height} stroke={COLORS.light.border} strokeWidth={1} />

                        {haveAllTimes && raw.map((_p, i) => {
                            if (!(i % labelStep === 0 || i === raw.length - 1)) return null;
                            return (
                                <SvgLine key={`grid-${i}`} x1={xs[i]} y1={0} x2={xs[i]} y2={height}
                                    stroke={COLORS.light.borderSoft} strokeWidth={1} />
                            );
                        })}

                        <SvgLine x1={0} y1={baselineY} x2={contentWidth} y2={baselineY}
                            stroke={baselineColor} strokeWidth={1.5} strokeDasharray="5,4" />
                        {baseline2Y !== null && (
                            <SvgLine x1={0} y1={baseline2Y} x2={contentWidth} y2={baseline2Y}
                                stroke={baseline2Color} strokeWidth={1.5} strokeDasharray="5,4" />
                        )}

                        {raw.length > 1 && xs.slice(1).map((x, idx) => {
                            const i = idx + 1;
                            const segColor = zoneColorOf(zones[i]);
                            const dashed = zones[i] === 'high';
                            return (
                                <SvgLine
                                    key={i}
                                    x1={xs[i - 1]} y1={ys[i - 1]} x2={x} y2={ys[i]}
                                    stroke={segColor} strokeWidth={2.5}
                                    strokeDasharray={dashed ? '6,4' : undefined}
                                    strokeLinecap="round"
                                />
                            );
                        })}

                        {raw.map((_p, i) => (
                            <React.Fragment key={i}>
                                <Circle cx={xs[i]} cy={ys[i]} r={8} fill={zoneColorOf(zones[i])} fillOpacity={0.001}
                                    onPress={() => setSelectedIndex(i)} />
                                <Circle cx={xs[i]} cy={ys[i]} r={selectedIndex === i ? 5 : 3} fill={zoneColorOf(zones[i])}
                                    stroke={selectedIndex === i ? COLORS.light.card : undefined}
                                    strokeWidth={selectedIndex === i ? 1.5 : 0}
                                    onPress={() => setSelectedIndex(i)} />
                            </React.Fragment>
                        ))}
                    </Svg>

                    {/* Timeline underneath -- orientation, not a stress number. */}
                    <View pointerEvents="none" style={{ position: 'absolute', top: height + 2, left: 0, width: contentWidth, height: X_LABEL_HEIGHT }}>
                        {haveAllTimes && raw.map((p, i) => {
                            if (!(i % labelStep === 0 || i === raw.length - 1)) return null;
                            return (
                                <Text key={i} style={[styles.xLabel, { left: xs[i] - 18, color: COLORS.light.textMuted }]}>
                                    {new Date(p.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </Text>
                            );
                        })}
                    </View>
                </View>
            </ScrollView>

            <View style={styles.legendRow}>
                {baseline2Value != null && (
                    <LegendSwatch color={baseline2Color} label={baseline2Label || 'Your baseline'} />
                )}
                <LegendSwatch color={baselineColor} label={baselineLabel || 'Stress level'} />
            </View>
        </View>
    );
}
function MultiLineChart({
    points, width, height, maxValue,
    seriesColors, seriesLabels,
    baselineValue, baselineLabel, baselineColor,
}) {
    const contentWidth = Math.max(width, MIN_POINT_GAP * Math.max(1, points.length - 1) + 20);

    const times = points.map((p) => (p.date ? new Date(p.date).getTime() : null));
    const haveAllTimes = times.every((t) => t !== null && !Number.isNaN(t));
    const totalSpan = haveAllTimes ? times[times.length - 1] - times[0] : 0;

    const xs = [];
    points.forEach((_p, i) => {
        if (i === 0) { xs.push(0); return; }
        let spacing;
        if (haveAllTimes && totalSpan > 0) {
            const frac = (times[i] - times[i - 1]) / totalSpan;
            spacing = Math.max(MIN_POINT_GAP * 0.6, frac * contentWidth);
        } else {
            spacing = Math.max(MIN_POINT_GAP, contentWidth / (points.length - 1));
        }
        xs.push(xs[i - 1] + spacing);
    });

    const PAD_Y = 7;
    const clamp01 = (v) => Math.min(1, Math.max(0, v));
    const valueToY = (v) => PAD_Y + (height - PAD_Y * 2) * (1 - clamp01(v / maxValue));

    const targetLabelCount = Math.max(4, Math.round(contentWidth / 90));
    const labelStep = Math.max(1, Math.ceil(points.length / targetLabelCount));

    const baselineY = baselineValue != null ? valueToY(baselineValue) : null;

    return (
        <View style={{ width }}>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ width }}
                nestedScrollEnabled
                directionalLockEnabled
            >
                <View style={{ width: contentWidth, height: height + X_LABEL_HEIGHT }}>
                    <Svg width={contentWidth} height={height} style={{ position: 'absolute', top: 0, left: 0 }}>
                        <SvgLine x1={0} y1={0} x2={0} y2={height} stroke={COLORS.light.border} strokeWidth={1} />
                        <SvgLine x1={0} y1={height} x2={contentWidth} y2={height} stroke={COLORS.light.border} strokeWidth={1} />

                        {haveAllTimes && points.map((_p, i) => {
                            if (!(i % labelStep === 0 || i === points.length - 1)) return null;
                            return (
                                <SvgLine key={`grid-${i}`} x1={xs[i]} y1={0} x2={xs[i]} y2={height}
                                    stroke={COLORS.light.borderSoft} strokeWidth={1} />
                            );
                        })}

                        {baselineY !== null && (
                            <SvgLine x1={0} y1={baselineY} x2={contentWidth} y2={baselineY}
                                stroke={baselineColor} strokeWidth={1.5} strokeDasharray="5,4" />
                        )}

                        {seriesColors.map((seriesColor, s) => (
                            <React.Fragment key={`series-${s}`}>
                                {points.slice(1).map((_p, idx) => {
                                    const i = idx + 1;
                                    const v0 = points[i - 1].values[s];
                                    const v1 = points[i].values[s];
                                    if (v0 == null || v1 == null) return null;
                                    return (
                                        <SvgLine
                                            key={`seg-${s}-${i}`}
                                            x1={xs[i - 1]} y1={valueToY(v0)} x2={xs[i]} y2={valueToY(v1)}
                                            stroke={seriesColor} strokeWidth={2.5} strokeLinecap="round"
                                        />
                                    );
                                })}
                                {points.map((p, i) => {
                                    const v = p.values[s];
                                    if (v == null) return null;
                                    return (
                                        <Circle key={`dot-${s}-${i}`} cx={xs[i]} cy={valueToY(v)} r={2.5} fill={seriesColor} />
                                    );
                                })}
                            </React.Fragment>
                        ))}
                    </Svg>

                    <View pointerEvents="none" style={{ position: 'absolute', top: height + 2, left: 0, width: contentWidth, height: X_LABEL_HEIGHT }}>
                        {haveAllTimes && points.map((p, i) => {
                            if (!(i % labelStep === 0 || i === points.length - 1)) return null;
                            return (
                                <Text key={i} style={[styles.xLabel, { left: xs[i] - 18, color: COLORS.light.textMuted }]}>
                                    {new Date(p.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </Text>
                            );
                        })}
                    </View>
                </View>
            </ScrollView>

            <View style={styles.legendRow}>
                {seriesLabels.map((label, s) => (
                    <LegendSwatch key={label} color={seriesColors[s]} label={label} />
                ))}
                {baselineValue != null && (
                    <LegendSwatch color={baselineColor} label={baselineLabel || 'Threshold'} />
                )}
            </View>
        </View>
    );
}

export default function LineChart({
    points, color, width, height, fallback, maxValue, suffix, hideValues = false,
    baselineValue, baselineLabel, baselineColor = COLORS.stress,
    baseline2Value, baseline2Label, baseline2Color = COLORS.brand,
    colorZones = false,
    zoneLowColor = COLORS.normal, zoneMidColor = COLORS.warning, zoneHighColor = COLORS.stress,
    multiLine = false, seriesColors, seriesLabels,
}) {
    const raw = points || [];
    if (raw.length === 0) {
        return fallback || null;
    }

    if (multiLine && seriesColors && seriesLabels) {
        return (
            <MultiLineChart
                points={raw} width={width} height={height} maxValue={maxValue || 100}
                seriesColors={seriesColors} seriesLabels={seriesLabels}
                baselineValue={baselineValue} baselineLabel={baselineLabel} baselineColor={baselineColor}
            />
        );
    }

    if (colorZones && maxValue && baselineValue !== undefined && baselineValue !== null) {
        return (
            <ZoneChart
                raw={raw} width={width} height={height} maxValue={maxValue}
                baselineValue={baselineValue} baselineLabel={baselineLabel} baselineColor={baselineColor}
                baseline2Value={baseline2Value} baseline2Label={baseline2Label} baseline2Color={baseline2Color}
                zoneLowColor={zoneLowColor} zoneMidColor={zoneMidColor} zoneHighColor={zoneHighColor}
            />
        );
    }

    const times = raw.map((p) => (p.date ? new Date(p.date).getTime() : null));
    const haveAllTimes = times.every((t) => t !== null && !Number.isNaN(t));
    const totalSpan = haveAllTimes ? times[times.length - 1] - times[0] : 0;
    const targetLabelCount = 4;
    const labelStep = Math.max(1, Math.ceil(raw.length / targetLabelCount));
    const xPositions = [10];
    const data = raw.map((p, i) => {
        const point = { value: p.value };
        if (haveAllTimes && p.date && (i % labelStep === 0 || i === raw.length - 1)) {
            point.label = new Date(p.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        if (i > 0) {
            let spacing;
            if (haveAllTimes && totalSpan > 0) {
                const frac = (times[i] - times[i - 1]) / totalSpan;
                spacing = Math.max(4, frac * width);
            } else {
                spacing = Math.max(2, width / (raw.length - 1));
            }
            point.spacing = spacing;
            xPositions.push(xPositions[i - 1] + spacing);
        }
        return point;
    });

    return (
        <View style={{ width, height }}>
            {haveAllTimes && (
                <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
                    {raw.map((_p, i) => {
                        if (!(i % labelStep === 0 || i === raw.length - 1)) return null;
                        return (
                            <SvgLine key={`grid-${i}`} x1={xPositions[i]} y1={0} x2={xPositions[i]} y2={height}
                                stroke={COLORS.light.borderSoft} strokeWidth={1} />
                        );
                    })}
                </Svg>
            )}
            <GiftedLineChart
                data={data}
                width={width}
                height={height}
                color={color}
                thickness={3}
                curved
                areaChart
                startFillColor={color}
                endFillColor={color}
                startOpacity={0.25}
                endOpacity={0.02}
                dataPointsColor={color}
                dataPointsRadius={raw.length <= 40 ? 3.5 : 0}
                yAxisTextStyle={{ fontSize: 9, color: COLORS.light.textMuted }}
                xAxisLabelTextStyle={{ fontSize: 9, color: COLORS.light.textMuted }}
                yAxisLabelSuffix={suffix || ''}
                hideYAxisText={hideValues}
                hideRules={hideValues}
                hideOrigin={hideValues}
                yAxisExtraHeight={0}
                noOfSections={4}
                {...(maxValue !== undefined ? { maxValue } : {})}
                xAxisColor={COLORS.light.borderSoft}
                xAxisThickness={1}
                yAxisColor="transparent"
                rulesColor={COLORS.light.borderSoft}
                rulesType="solid"
                backgroundColor="transparent"
                initialSpacing={10}
                endSpacing={10}
            />
            <ReferenceLine value={baselineValue} label={baselineLabel} color={baselineColor}
                height={height} maxValue={maxValue} labelSide="right" />
            <ReferenceLine value={baseline2Value} label={baseline2Label} color={baseline2Color}
                height={height} maxValue={maxValue} labelSide="left" />
        </View>
    );
}

const styles = StyleSheet.create({
    baseline: {
        position: 'absolute',
        left: 0,
        right: 0,
        borderTopWidth: 1.5,
        borderStyle: 'dashed',
    },
    baselineLabel: {
        position: 'absolute',
        top: -16,
        fontSize: 9,
        fontWeight: '700',
    },
    xLabel: {
        position: 'absolute',
        width: 36,
        fontSize: 9,
        textAlign: 'center',
    },
    detailBar: {
        height: DETAIL_HEIGHT,
        marginBottom: 4,
        justifyContent: 'center',
    },
    detailHint: {
        fontSize: 10,
        fontStyle: 'italic',
    },
    detailText: {
        fontSize: 11,
    },
    legendRow: {
        marginTop: LEGEND_HEIGHT - 14,
        flexDirection: 'row',
        gap: 14,
    },
    legendItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    legendSwatch: {
        width: 12,
        height: 2.5,
        borderRadius: 1,
    },
    legendText: {
        fontSize: 10,
        fontWeight: '600',
    },
});
