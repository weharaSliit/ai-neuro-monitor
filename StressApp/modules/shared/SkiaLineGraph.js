import React from 'react';
import { LineGraph } from 'react-native-graph';

// Kept in its own module, separate from any screen file, so this is the
// ONLY place `react-native-graph` (and therefore @shopify/react-native-skia)
// gets imported -- WithSkiaWeb (see callers in the eeg/fusion screens)
// reaches this file exclusively via a dynamic import(), which is what defers
// Skia's web module from being evaluated until AFTER its CanvasKit WASM
// backend has loaded. A static top-level import here would defeat that: on
// web, @shopify/react-native-skia's Skia.web.ts builds its API object from
// `global.CanvasKit` the instant its module is first evaluated, not lazily
// per-render, so if that happens before CanvasKit finishes loading the API
// object is permanently broken ("Cannot read properties of undefined
// (reading 'Path')") even once CanvasKit shows up later.
export default function SkiaLineGraph({ points, color, width, height }) {
    return (
        <LineGraph
            style={{ width, height }}
            points={points}
            animated={false}
            color={color}
            lineThickness={2}
        />
    );
}
