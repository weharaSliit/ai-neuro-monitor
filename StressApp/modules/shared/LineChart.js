import React from 'react';
import { LineChart as GiftedLineChart } from 'react-native-gifted-charts';

// Pure-JS/SVG chart (react-native-gifted-charts) -- works inside plain
// Expo Go on every platform with no custom native build required, unlike
// @shopify/react-native-skia, which needs Skia's native module compiled
// into the app binary and was crashing with "installTurboModule" errors
// on a stock Expo Go client (no android/ dir, no expo-dev-client).
//
// `points` keeps the same {value, date}[] shape every caller already
// produces (originally for react-native-graph's GraphPoint) -- only
// `value` is used here, `date` is ignored since gifted-charts positions
// points by index/spacing rather than by timestamp.
export default function LineChart({ points, color, width, height, fallback }) {
    const data = (points || []).map((p) => ({ value: p.value }));
    if (data.length === 0) {
        return fallback || null;
    }
    const spacing = data.length > 1 ? Math.max(2, width / (data.length - 1)) : width;
    return (
        <GiftedLineChart
            data={data}
            width={width}
            height={height}
            color={color}
            thickness={2}
            curved
            hideDataPoints
            hideRules
            hideYAxisText
            xAxisColor="transparent"
            yAxisColor="transparent"
            backgroundColor="transparent"
            initialSpacing={0}
            endSpacing={0}
            spacing={spacing}
        />
    );
}
