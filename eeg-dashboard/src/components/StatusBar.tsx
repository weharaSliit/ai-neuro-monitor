import type { Status, Config } from '../types';

interface Props {
  connected: boolean;
  status: Status | null;
  config: Config | null;
}

function fmtElapsed(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function StatusBar({ connected, status, config }: Props) {
  return (
    <div className="status-bar">
      <div className={`status-pill ${connected ? 'status-pill--ok' : 'status-pill--bad'}`}>
        {connected ? 'BRIDGE CONNECTED' : 'BRIDGE OFFLINE'}
      </div>
      <div className={`status-pill ${status?.mqtt_connected ? 'status-pill--ok' : 'status-pill--bad'}`}>
        {status?.mqtt_connected ? 'EEG LINK UP' : 'EEG LINK DOWN'}
      </div>
      <div className={`status-pill ${config?.models_available ? 'status-pill--ok' : 'status-pill--warn'}`}>
        {config?.models_available ? 'MODELS LOADED' : 'RAW-ONLY MODE'}
      </div>
      <div className="status-stat">Session {status ? fmtElapsed(status.elapsed_s) : '0:00'}</div>
      <div className="status-stat">Epochs {status?.n_epochs ?? 0}</div>
      <div className="status-stat">Alerts {status?.n_alerts ?? 0}</div>
      <div className="status-stat">Skipped {status?.n_skipped ?? 0}</div>
    </div>
  );
}
