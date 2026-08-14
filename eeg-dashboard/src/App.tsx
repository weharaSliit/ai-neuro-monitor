import { useEegSocket } from './hooks/useEegSocket';
import Waveform from './components/Waveform';
import StageBanner from './components/StageBanner';
import RiskGauge from './components/RiskGauge';
import TrendGauge from './components/TrendGauge';
import ProbabilityChart from './components/ProbabilityChart';
import ChannelBaselineChart from './components/ChannelBaselineChart';
import FeatureBaselineChart from './components/FeatureBaselineChart';
import StatusBar from './components/StatusBar';
import './App.css';

const WS_URL = import.meta.env.VITE_WS_URL ?? `ws://${window.location.hostname}:8000/ws`;

export default function App() {
  const { config, status, latestEpoch, epochHistory, connected, ringRef } = useEegSocket(WS_URL);

  return (
    <div className="app">
      <header className="app-header">
        <h1>AI NeuroMonitor</h1>
        <p>Live EEG — T7 / T8 dry electrodes (REF-referenced) — pre-stage stress detection</p>
      </header>

      <div className="prototype-disclaimer" role="note">
        <b>Research prototype — not validated for clinical or medical use.</b> Stress
        classification AUC&nbsp;≈&nbsp;0.63 (moderate, meaningfully above chance but not
        strong); early-warning timing has not been validated against real onset-timestamped
        data. Treat every alert as a prompt to check in with yourself, not a diagnosis.
      </div>

      <StatusBar connected={connected} status={status} config={config} />

      <main className="app-grid">
        <Waveform ringRef={ringRef} windowSeconds={4} />

        <div className="app-grid__side">
          <StageBanner epoch={latestEpoch} config={config} />
          <TrendGauge
            trendScore={latestEpoch?.trend_score ?? null}
            trendAlarm={latestEpoch?.trend_alarm ?? false}
            calibrating={latestEpoch?.calibrating ?? null}
            skipped={latestEpoch?.skipped ?? false}
          />
          <RiskGauge
            risk={latestEpoch?.risk ?? null}
            alertThresh={config?.alert_thresh ?? 0.45}
            skipped={latestEpoch?.skipped ?? false}
            confidence={latestEpoch?.confidence ?? null}
          />
        </div>

        <ProbabilityChart history={epochHistory} config={config} />
        <ChannelBaselineChart history={epochHistory} />
        <FeatureBaselineChart history={epochHistory} />
      </main>
    </div>
  );
}
