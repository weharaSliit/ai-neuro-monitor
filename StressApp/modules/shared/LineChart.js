import React, { useState, useRef, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Dimensions } from 'react-native';
import Svg, { Circle, Line as SvgLine } from 'react-native-svg';
import { LineChart as GiftedLineChart } from 'react-native-gifted-charts';
import { COLORS } from '../physiological/config/theme';

function ReferenceLine({ value, label, color, height, maxValue, labelSide }) {
    if (value === undefined || value === null || !maxValue) return null;
    const top = height * (1 - Math.min(1, Math.max(0, value / maxValue)));
    const labelBelow = top < 16;
    return (
        <View pointerEvents="none" style={[styles.baseline, { top, borderTopColor: color }]}>
            {label ? (
                <Text
                    style={[
                        styles.baselineLabel,
                        { color },
                        labelBelow ? { top: 4 } : { top: -16 },
                        labelSide === 'left' ? { left: 0 } : { right: 0 },
                    ]}
                >
                    {label}
                </Text>
            ) : null}
        </View>
    );
}

const X_LABEL_HEIGHT = 16;
const LEGEND_HEIGHT = 20;
const DETAIL_HEIGHT = 18;
const MIN_POINT_GAP = 28;
const EDGE_PAD = 12;

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
    fitToWidth = false,
}) {
    const [selectedIndex, setSelectedIndex] = useState(null);
    const scrollRef = useRef(null);

    // Calculate content width based on points count. fitToWidth (used for
    // aggregated/bucketed data) always compresses points into the given
    // width instead of forcing a horizontal scroll -- avoids making the
    // viewer swipe through thousands of raw windows to see a trend.
    const minContentWidth = raw.length > 1
        ? Math.max(width, (raw.length - 1) * MIN_POINT_GAP + EDGE_PAD * 2)
        : width;
    const contentWidth = fitToWidth ? width : minContentWidth;
    const isScrollable = !fitToWidth && contentWidth > width;

    const times = raw.map((p) => (p.date ? new Date(p.date).getTime() : null));
    const haveAllTimes = times.every((t) => t !== null && !Number.isNaN(t));
    const totalSpan = haveAllTimes ? times[times.length - 1] - times[0] : 0;

    const plotUsableWidth = contentWidth - EDGE_PAD * 2;
    const xs = [];
    raw.forEach((_p, i) => {
        if (i === 0) { xs.push(EDGE_PAD); return; }
        let spacing;
        if (fitToWidth) {
            // Bucketed/aggregated data: each point represents a time SLOT,
            // not a precise instant, so space evenly across the width
            // instead of by raw elapsed time. Real windows are rarely
            // evenly spread through the day (bursts of use, then hours of
            // silence) -- proportional spacing on real gaps stretches those
            // silent stretches into large dead zones and crowds everything
            // else into a sliver. Even spacing keeps the chart compact and
            // fully used regardless of how clustered the real activity was.
            spacing = plotUsableWidth / (raw.length - 1);
        } else if (haveAllTimes && totalSpan > 0) {
            const frac = (times[i] - times[i - 1]) / totalSpan;
            spacing = Math.max(MIN_POINT_GAP * 0.6, frac * plotUsableWidth);
        } else {
            spacing = Math.max(MIN_POINT_GAP, plotUsableWidth / (raw.length - 1));
        }
        xs.push(xs[i - 1] + spacing);
    });

    // Auto-scroll to the latest reading (end) when new points arrive
    useEffect(() => {
        if (isScrollable && scrollRef.current) {
            const t = setTimeout(() => {
                scrollRef.current?.scrollToEnd({ animated: true });
            }, 150);
            return () => clearTimeout(t);
        }
    }, [raw.length, isScrollable]);

    const PAD_Y = 8;
    const clamp01 = (v) => Math.min(1, Math.max(0, v));
    const valueToY = (v) => PAD_Y + (height - PAD_Y * 2) * (1 - clamp01(v / maxValue));
    const ys = raw.map((p) => valueToY(p.value));

    const zoneOf = (v) => (
        v >= baselineValue ? 'high' : ((baseline2Value != null && v >= baseline2Value) ? 'mid' : 'low')
    );
    const zoneColorOf = (z) => (z === 'high' ? zoneHighColor : z === 'mid' ? zoneMidColor : zoneLowColor);
    const zoneLabelOf = (z) => (z === 'high' ? 'Stress' : z === 'mid' ? 'Trending' : 'Normal');
    const zones = raw.map((p) => zoneOf(p.value));

    const targetLabelCount = Math.max(3, Math.round(contentWidth / 90));
    const labelStep = Math.max(1, Math.ceil(raw.length / targetLabelCount));

    // Precompute non-overlapping label indices (minimum 62px gap between labels)
    const visibleLabelIndices = [];
    if (haveAllTimes && raw.length > 0) {
        let lastX = -999;
        raw.forEach((_p, i) => {
            const isEndpoint = i === 0 || i === raw.length - 1;
            const isStep = i % labelStep === 0;
            if (isStep || isEndpoint) {
                if (xs[i] - lastX >= 62) {
                    visibleLabelIndices.push(i);
                    lastX = xs[i];
                } else if (i === raw.length - 1 && visibleLabelIndices.length > 0) {
                    const prevPrevX = visibleLabelIndices.length > 1 ? xs[visibleLabelIndices[visibleLabelIndices.length - 2]] : -999;
                    if (xs[i] - prevPrevX >= 62) {
                        visibleLabelIndices[visibleLabelIndices.length - 1] = i;
                    }
                }
            }
        });
    }

    const baselineY = valueToY(baselineValue);
    const baseline2Y = baseline2Value != null ? valueToY(baseline2Value) : null;

    const selected = selectedIndex != null ? raw[selectedIndex] : null;
    let detailNode = null;
    if (selected) {
        const zone = zones[selectedIndex];
        const dColor = zoneColorOf(zone);
        const time = selected.date
            ? new Date(selected.date).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
            : '';
        let devText = '';
        if (baseline2Value != null) {
            const dev = Math.round(selected.value - baseline2Value);
            devText = dev === 0 ? ' · at baseline'
                : dev > 0 ? ` · +${dev}%`
                    : ` · -${Math.abs(dev)}%`;
        }
        const windowText = selected.windowCount ? ` · avg of ${selected.windowCount} windows` : '';
        detailNode = (
            <Text style={styles.detailText} numberOfLines={1}>
                <Text style={{ color: dColor, fontWeight: '800' }}>{zoneLabelOf(zone)} ({selected.value}%)</Text>
                <Text style={{ color: COLORS.light.textMuted }}>{devText}{windowText} · {time}</Text>
            </Text>
        );
    } else if (isScrollable) {
        detailNode = (
            <View style={styles.detailRow}>
                <Text style={[styles.detailHint, { color: COLORS.light.textMuted }]}>
                    ← Swipe horizontally to view history
                </Text>
                <View style={styles.scrollBadge}>
                    <Text style={styles.scrollBadgeText}>Scrollable ⇄</Text>
                </View>
            </View>
        );
    }

    return (
        <View style={{ width, overflow: 'hidden' }}>
            {detailNode && <View style={styles.detailBar}>{detailNode}</View>}

            <ScrollView
                ref={scrollRef}
                horizontal
                scrollEnabled={isScrollable}
                showsHorizontalScrollIndicator={isScrollable}
                style={{ width }}
                contentContainerStyle={{ width: contentWidth }}
                nestedScrollEnabled={true}
                overScrollMode="never"
                bounces={false}
                scrollEventThrottle={16}
            >
                <View style={{ width: contentWidth, height: height + X_LABEL_HEIGHT }}>
                    <Svg width={contentWidth} height={height} style={{ position: 'absolute', top: 0, left: 0 }}>
                        <SvgLine x1={0} y1={0} x2={0} y2={height} stroke={COLORS.light.border} strokeWidth={1} />
                        <SvgLine x1={0} y1={height} x2={contentWidth} y2={height} stroke={COLORS.light.border} strokeWidth={1} />

                        {haveAllTimes && visibleLabelIndices.map((i) => (
                            <SvgLine key={`grid-${i}`} x1={xs[i]} y1={0} x2={xs[i]} y2={height}
                                stroke={COLORS.light.borderSoft} strokeWidth={1} />
                        ))}

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
                                <Circle cx={xs[i]} cy={ys[i]} r={12} fill={zoneColorOf(zones[i])} fillOpacity={0.001}
                                    onPress={() => setSelectedIndex(i)} />
                                <Circle cx={xs[i]} cy={ys[i]} r={selectedIndex === i ? 5.5 : 3.5} fill={zoneColorOf(zones[i])}
                                    stroke={selectedIndex === i ? COLORS.light.card : undefined}
                                    strokeWidth={selectedIndex === i ? 2 : 0}
                                    onPress={() => setSelectedIndex(i)} />
                            </React.Fragment>
                        ))}
                    </Svg>

                    <View pointerEvents="none" style={{ position: 'absolute', top: height + 2, left: 0, width: contentWidth, height: X_LABEL_HEIGHT }}>
                        {haveAllTimes && visibleLabelIndices.map((i) => {
                            const p = raw[i];
                            const clampedX = Math.min(contentWidth - 52, Math.max(0, xs[i] - 26));
                            return (
                                <Text key={`xlabel-${i}`} style={[styles.xLabel, { left: clampedX, color: COLORS.light.textMuted }]}>
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
                <LegendSwatch color={baselineColor} label={baselineLabel || 'Stress threshold'} />
            </View>
        </View>
    );
}

function MultiLineChart({
    points, width, height, maxValue,
    seriesColors, seriesLabels,
    baselineValue, baselineLabel, baselineColor,
}) {
    const scrollRef = useRef(null);
    const minContentWidth = points.length > 1
        ? Math.max(width, (points.length - 1) * MIN_POINT_GAP + EDGE_PAD * 2)
        : width;
    const contentWidth = minContentWidth;
    const isScrollable = contentWidth > width;

    const times = points.map((p) => (p.date ? new Date(p.date).getTime() : null));
    const haveAllTimes = times.every((t) => t !== null && !Number.isNaN(t));
    const totalSpan = haveAllTimes ? times[times.length - 1] - times[0] : 0;

    const plotUsableWidth = contentWidth - EDGE_PAD * 2;
    const xs = [];
    points.forEach((_p, i) => {
        if (i === 0) { xs.push(EDGE_PAD); return; }
        let spacing;
        if (haveAllTimes && totalSpan > 0) {
            const frac = (times[i] - times[i - 1]) / totalSpan;
            spacing = Math.max(MIN_POINT_GAP * 0.6, frac * plotUsableWidth);
        } else {
            spacing = Math.max(MIN_POINT_GAP, plotUsableWidth / (points.length - 1));
        }
        xs.push(xs[i - 1] + spacing);
    });

    useEffect(() => {
        if (isScrollable && scrollRef.current) {
            const t = setTimeout(() => {
                scrollRef.current?.scrollToEnd({ animated: true });
            }, 150);
            return () => clearTimeout(t);
        }
    }, [points.length, isScrollable]);

    const PAD_Y = 8;
    const clamp01 = (v) => Math.min(1, Math.max(0, v));
    const valueToY = (v) => PAD_Y + (height - PAD_Y * 2) * (1 - clamp01(v / maxValue));

    const targetLabelCount = Math.max(3, Math.round(contentWidth / 90));
    const labelStep = Math.max(1, Math.ceil(points.length / targetLabelCount));

    // Precompute non-overlapping label indices (minimum 62px gap)
    const visibleLabelIndices = [];
    if (haveAllTimes && points.length > 0) {
        let lastX = -999;
        points.forEach((_p, i) => {
            const isEndpoint = i === 0 || i === points.length - 1;
            const isStep = i % labelStep === 0;
            if (isStep || isEndpoint) {
                if (xs[i] - lastX >= 62) {
                    visibleLabelIndices.push(i);
                    lastX = xs[i];
                } else if (i === points.length - 1 && visibleLabelIndices.length > 0) {
                    const prevPrevX = visibleLabelIndices.length > 1 ? xs[visibleLabelIndices[visibleLabelIndices.length - 2]] : -999;
                    if (xs[i] - prevPrevX >= 62) {
                        visibleLabelIndices[visibleLabelIndices.length - 1] = i;
                    }
                }
            }
        });
    }

    const baselineY = baselineValue != null ? valueToY(baselineValue) : null;

    return (
        <View style={{ width, overflow: 'hidden' }}>
            <ScrollView
                ref={scrollRef}
                horizontal
                showsHorizontalScrollIndicator={isScrollable}
                style={{ width }}
                contentContainerStyle={{ width: contentWidth }}
                nestedScrollEnabled={true}
                overScrollMode="never"
                bounces={false}
                scrollEventThrottle={16}
            >
                <View style={{ width: contentWidth, height: height + X_LABEL_HEIGHT }}>
                    <Svg width={contentWidth} height={height} style={{ position: 'absolute', top: 0, left: 0 }}>
                        <SvgLine x1={0} y1={0} x2={0} y2={height} stroke={COLORS.light.border} strokeWidth={1} />
                        <SvgLine x1={0} y1={height} x2={contentWidth} y2={height} stroke={COLORS.light.border} strokeWidth={1} />

                        {haveAllTimes && visibleLabelIndices.map((i) => (
                            <SvgLine key={`grid-${i}`} x1={xs[i]} y1={0} x2={xs[i]} y2={height}
                                stroke={COLORS.light.borderSoft} strokeWidth={1} />
                        ))}

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
                        {haveAllTimes && visibleLabelIndices.map((i) => {
                            const p = points[i];
                            const clampedX = Math.min(contentWidth - 52, Math.max(0, xs[i] - 26));
                            return (
                                <Text key={`xlabel-${i}`} style={[styles.xLabel, { left: clampedX, color: COLORS.light.textMuted }]}>
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
    points, color, width: propWidth, height, fallback, maxValue, suffix, hideValues = false,
    baselineValue, baselineLabel, baselineColor = COLORS.stress,
    baseline2Value, baseline2Label, baseline2Color = COLORS.brand,
    colorZones = false,
    zoneLowColor = COLORS.normal, zoneMidColor = COLORS.warning, zoneHighColor = COLORS.stress,
    multiLine = false, seriesColors, seriesLabels,
    fitToWidth = false,
}) {
    const raw = points || [];
    const windowWidth = Dimensions.get('window').width;
    const defaultWidth = Math.max(260, windowWidth - 80);
    const width = propWidth || defaultWidth;

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
                fitToWidth={fitToWidth}
            />
        );
    }

    const times = raw.map((p) => (p.date ? new Date(p.date).getTime() : null));
    const haveAllTimes = times.every((t) => t !== null && !Number.isNaN(t));
    const totalSpan = haveAllTimes ? times[times.length - 1] - times[0] : 0;
    const targetLabelCount = 4;
    const labelStep = Math.max(1, Math.ceil(raw.length / targetLabelCount));

    // GiftedLineChart width & height constraint:
    // Total rendered width = plotWidth + yAxisLabelWidth + initialSpacing + endSpacing
    // We strictly calibrate plotWidth so total rendered width matches `width` exactly without spilling out of the card.
    const yAxisLabelWidth = hideValues ? 0 : (suffix ? 52 : 38);
    const initialSpacing = 8;
    const endSpacing = 8;
    const plotWidth = Math.max(60, width - yAxisLabelWidth - initialSpacing - endSpacing);
    const containerHeight = (haveAllTimes && !hideValues) ? height + 22 : height;

    const xPositions = [initialSpacing];
    for (let i = 1; i < raw.length; i++) {
        let spacing;
        if (haveAllTimes && totalSpan > 0) {
            const frac = (times[i] - times[i - 1]) / totalSpan;
            spacing = Math.max(4, frac * plotWidth);
        } else {
            spacing = Math.max(2, plotWidth / (raw.length - 1));
        }
        xPositions.push(xPositions[i - 1] + spacing);
    }

    let lastLabelX = -999;
    const data = raw.map((p, i) => {
        const point = { value: p.value };
        if (i > 0) {
            point.spacing = xPositions[i] - xPositions[i - 1];
        }
        if (haveAllTimes && p.date && (i % labelStep === 0 || i === raw.length - 1)) {
            if (xPositions[i] - lastLabelX >= 55) {
                point.label = new Date(p.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                lastLabelX = xPositions[i];
            }
        }
        return point;
    });

    return (
        <View style={{ width, height: containerHeight, overflow: 'hidden' }}>
            {haveAllTimes && !hideValues && (
                <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
                    {raw.map((_p, i) => {
                        if (data[i]?.label == null) return null;
                        return (
                            <SvgLine key={`grid-${i}`} x1={xPositions[i] + yAxisLabelWidth} y1={0} x2={xPositions[i] + yAxisLabelWidth} y2={height}
                                stroke={COLORS.light.borderSoft} strokeWidth={1} />
                        );
                    })}
                </Svg>
            )}
            <GiftedLineChart
                data={data}
                width={plotWidth}
                height={height}
                color={color}
                thickness={2.5}
                curved
                areaChart
                startFillColor={color}
                endFillColor={color}
                startOpacity={0.22}
                endOpacity={0.02}
                dataPointsColor={color}
                dataPointsRadius={raw.length <= 30 ? 3 : 0}
                yAxisLabelWidth={yAxisLabelWidth}
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
                initialSpacing={initialSpacing}
                endSpacing={endSpacing}
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
        fontSize: 9,
        fontWeight: '700',
    },
    xLabel: {
        position: 'absolute',
        width: 52,
        fontSize: 9,
        textAlign: 'center',
    },
    detailBar: {
        height: DETAIL_HEIGHT,
        marginBottom: 6,
        justifyContent: 'center',
    },
    detailRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    detailHint: {
        fontSize: 10,
        fontStyle: 'italic',
    },
    detailText: {
        fontSize: 11,
    },
    scrollBadge: {
        backgroundColor: COLORS.brandSoft,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    scrollBadgeText: {
        fontSize: 9,
        color: COLORS.brandDark,
        fontWeight: '700',
    },
    legendRow: {
        marginTop: LEGEND_HEIGHT - 12,
        flexDirection: 'row',
        flexWrap: 'wrap',
        rowGap: 6,
        columnGap: 14,
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
