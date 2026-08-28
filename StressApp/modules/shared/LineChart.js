import React from 'react';
import { LineChart as GiftedLineChart } from 'react-native-gifted-charts';
import { COLORS } from '../physiological/config/theme';

// Pure-JS/SVG chart (react-native-gifted-charts) -- works inside plain
// Expo Go on every platform with no custom native build required, unlike
// @shopify/react-native-skia, which needs Skia's native module compiled
// into the app binary and was crashing with "installTurboModule" errors
// on a stock Expo Go client (no android/ dir, no expo-dev-client).
//
// `points` keeps the same {value, date}[] shape every caller already
// produces (originally for react-native-graph's GraphPoint). `date` used
// to be accepted but silently ignored -- every point got equal visual
// spacing regardless of the real time gap between readings, so a fast rise
// and a slow rise over the same number of windows looked identical. Now
// each gap's on-screen width is proportional to the real elapsed time
// between consecutive points (falling back to equal spacing only when a
// point is missing a usable `date`, so a caller that never passed dates
// still renders exactly as before).
//
// `maxValue`/`suffix` are optional -- callers plotting a real 0-100%
// probability (Ring/Fusion/HrvGsr) pass maxValue={100} suffix="%"; callers
// plotting something else entirely (EEG's raw µV signal chart) leave them
// unset and get gifted-charts' own data-driven auto-scaling instead. Y-axis
// numbers/rules are always shown now (previously hidden unconditionally via
// hideYAxisText/hideRules), so every caller gets a real scale to judge
// magnitude by, in whatever unit it actually plots.
export default function LineChart({ points, color, width, height, fallback, maxValue, suffix }) {
    const raw = points || [];
    if (raw.length === 0) {
        return fallback || null;
    }

    const times = raw.map((p) => (p.date ? new Date(p.date).getTime() : null));
    const haveAllTimes = times.every((t) => t !== null && !Number.isNaN(t));
    const totalSpan = haveAllTimes ? times[times.length - 1] - times[0] : 0;

    const data = raw.map((p, i) => {
        const point = { value: p.value };
        if (i > 0) {
            // gifted-charts' `spacing` prop is a single global gap value, not
            // per-point -- so an uneven-time series is built with explicit
            // per-point x-offsets via `spacing` on EACH point past the first,
            // which gifted-charts does honor individually.
            if (haveAllTimes && totalSpan > 0) {
                // sum(frac_i) across the whole series is exactly 1, so
                // sum(spacing_i) must be `width` for the chart to fill its
                // container correctly -- multiplying by (raw.length - 1)
                // here was a real bug: it made the series overshoot its
                // container by that factor (e.g. 4x too wide for 5
                // points), which is what was actually causing charts to
                // look squished/misaligned/off-scale.
                const frac = (times[i] - times[i - 1]) / totalSpan;
                point.spacing = Math.max(4, frac * width);
            } else {
                point.spacing = Math.max(2, width / (raw.length - 1));
            }
        }
        return point;
    });

    return (
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
            noOfSections={4}
            {...(maxValue !== undefined ? { maxValue } : {})}
            xAxisColor="transparent"
            yAxisColor="transparent"
            rulesColor={COLORS.light.borderSoft}
            rulesType="solid"
            backgroundColor="transparent"
            initialSpacing={10}
            endSpacing={10}
        />
    );
}
