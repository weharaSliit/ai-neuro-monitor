import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { RingBuffer } from '../hooks/useEegSocket';

const T7_COLOR = '#4fc3f7';
const T8_COLOR = '#ff8a65';
const CLIP_COLOR = '#ff5252';

interface Props {
  ringRef: RefObject<RingBuffer>;
  windowSeconds?: number;
}

export default function Waveform({ ringRef, windowSeconds = 4 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    let raf = 0;

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      canvas!.width = Math.max(1, rect.width * dpr);
      canvas!.height = Math.max(1, rect.height * dpr);
    }
    resize();
    window.addEventListener('resize', resize);

    function plotChannel(
      arr: Float32Array,
      clipArr: Uint8Array,
      startIdx: number,
      nShow: number,
      capacity: number,
      w: number,
      h: number,
      color: string,
    ) {
      let mn = Infinity;
      let mx = -Infinity;
      for (let k = 0; k < nShow; k++) {
        const idx = (startIdx + k) % capacity;
        const v = arr[idx];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      if (!Number.isFinite(mn) || !Number.isFinite(mx)) return;
      if (mn === mx) {
        mn -= 1;
        mx += 1;
      }
      const pad = (mx - mn) * 0.1;
      mn -= pad;
      mx += pad;

      ctx!.strokeStyle = color;
      ctx!.lineWidth = 1.4 * dpr;
      ctx!.beginPath();
      for (let k = 0; k < nShow; k++) {
        const idx = (startIdx + k) % capacity;
        const x = (k / nShow) * w;
        const y = h - ((arr[idx] - mn) / (mx - mn)) * h;
        if (k === 0) ctx!.moveTo(x, y);
        else ctx!.lineTo(x, y);
      }
      ctx!.stroke();

      ctx!.fillStyle = CLIP_COLOR;
      for (let k = 0; k < nShow; k++) {
        const idx = (startIdx + k) % capacity;
        if (clipArr[idx]) {
          const x = (k / nShow) * w;
          const y = h - ((arr[idx] - mn) / (mx - mn)) * h;
          ctx!.fillRect(x - 2, y - 2, 4, 4);
        }
      }
    }

    function draw() {
      const ring = ringRef.current;
      const w = canvas!.width;
      const h = canvas!.height;

      ctx!.fillStyle = '#0a1420';
      ctx!.fillRect(0, 0, w, h);

      ctx!.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx!.lineWidth = 1;
      const gridX = 12;
      const gridY = 6;
      for (let i = 1; i < gridX; i++) {
        const x = (w / gridX) * i;
        ctx!.beginPath();
        ctx!.moveTo(x, 0);
        ctx!.lineTo(x, h);
        ctx!.stroke();
      }
      for (let i = 1; i < gridY; i++) {
        const y = (h / gridY) * i;
        ctx!.beginPath();
        ctx!.moveTo(0, y);
        ctx!.lineTo(w, y);
        ctx!.stroke();
      }

      const n = ring.filled ? ring.capacity : ring.writeIdx;
      if (n >= 2) {
        const nShow = Math.min(n, Math.round(ring.fs * windowSeconds));
        const startIdx = (ring.writeIdx - nShow + ring.capacity) % ring.capacity;
        plotChannel(ring.ch1, ring.clipped, startIdx, nShow, ring.capacity, w, h, T7_COLOR);
        plotChannel(ring.ch2, ring.clipped, startIdx, nShow, ring.capacity, w, h, T8_COLOR);
      } else {
        ctx!.fillStyle = 'rgba(255,255,255,0.35)';
        ctx!.font = `${14 * dpr}px monospace`;
        ctx!.fillText('waiting for EEG stream...', 16 * dpr, h / 2);
      }

      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [ringRef, windowSeconds]);

  return (
    <div className="panel waveform-panel">
      <div className="panel__header">
        <span>Raw EEG — T7 / T8 (dry electrodes, REF-referenced)</span>
        <div className="waveform-legend">
          <span className="legend-dot" style={{ background: T7_COLOR }} /> T7
          <span className="legend-dot" style={{ background: T8_COLOR }} /> T8
          <span className="legend-dot" style={{ background: CLIP_COLOR }} /> clipped
        </div>
      </div>
      <canvas ref={canvasRef} className="waveform-canvas" />
    </div>
  );
}
