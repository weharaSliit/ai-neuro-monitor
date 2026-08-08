import { useEffect, useRef, useState } from 'react';
import type { Config, Status, EpochResult, RawBatch, WsMessage } from '../types';

const RING_SECONDS = 8;
const DEFAULT_FS = 256;
const MAX_EPOCH_HISTORY = 240; // 2 minutes at 0.5s stride

export interface RingBuffer {
  t: Float64Array;
  ch1: Float32Array;
  ch2: Float32Array;
  clipped: Uint8Array;
  writeIdx: number;
  filled: boolean;
  capacity: number;
  fs: number;
}

function makeRing(fs: number, seconds = RING_SECONDS): RingBuffer {
  const capacity = Math.max(2, Math.round(fs * seconds));
  return {
    t: new Float64Array(capacity),
    ch1: new Float32Array(capacity),
    ch2: new Float32Array(capacity),
    clipped: new Uint8Array(capacity),
    writeIdx: 0,
    filled: false,
    capacity,
    fs,
  };
}

export function useEegSocket(url: string) {
  const [config, setConfig] = useState<Config | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [latestEpoch, setLatestEpoch] = useState<EpochResult | null>(null);
  const [epochHistory, setEpochHistory] = useState<EpochResult[]>([]);
  const [connected, setConnected] = useState(false);

  const ringRef = useRef<RingBuffer>(makeRing(DEFAULT_FS));
  const versionRef = useRef(0);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closedByUs = false;
    let reconnectTimer: number | undefined;

    function connect() {
      ws = new WebSocket(url);

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!closedByUs) {
          reconnectTimer = window.setTimeout(connect, 1500);
        }
      };
      ws.onerror = () => ws?.close();

      ws.onmessage = (ev: MessageEvent<string>) => {
        const msg: WsMessage = JSON.parse(ev.data);

        switch (msg.type) {
          case 'config': {
            setConfig(msg as Config);
            ringRef.current = makeRing((msg as Config).sampling_rate_hz);
            break;
          }
          case 'status': {
            setStatus(msg as Status);
            break;
          }
          case 'epoch': {
            const e = msg as EpochResult;
            setLatestEpoch(e);
            setEpochHistory((prev) => {
              const next = prev.concat(e);
              return next.length > MAX_EPOCH_HISTORY
                ? next.slice(next.length - MAX_EPOCH_HISTORY)
                : next;
            });
            break;
          }
          case 'raw_batch': {
            const ring = ringRef.current;
            for (const s of (msg as RawBatch).samples) {
              const i = ring.writeIdx;
              ring.t[i] = s.t;
              ring.ch1[i] = s.ch1;
              ring.ch2[i] = s.ch2;
              ring.clipped[i] = s.clipped ? 1 : 0;
              ring.writeIdx = (i + 1) % ring.capacity;
              if (ring.writeIdx === 0) ring.filled = true;
            }
            versionRef.current += 1;
            break;
          }
        }
      };
    }

    connect();
    return () => {
      closedByUs = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [url]);

  return { config, status, latestEpoch, epochHistory, connected, ringRef, versionRef };
}
