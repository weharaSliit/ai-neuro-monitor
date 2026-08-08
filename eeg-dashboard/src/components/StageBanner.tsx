import type { EpochResult, Config } from '../types';
import { STAGE_COLORS, STAGE_LABELS } from '../types';

interface Props {
  epoch: EpochResult | null;
  config: Config | null;
}

export default function StageBanner({ epoch, config }: Props) {
  const skipped = epoch?.skipped ?? false;
  const calibrating = !skipped && !!epoch?.calibrating;
  const stage = !skipped ? epoch?.stage ?? null : null;

  const color = calibrating
    ? '#5a6673'
    : stage !== null
      ? STAGE_COLORS[stage]
      : skipped
        ? '#888'
        : '#555';

  const label = skipped
    ? 'SIGNAL UNRELIABLE'
    : calibrating
      ? 'CALIBRATING BASELINE'
      : stage !== null
        ? STAGE_LABELS[stage]
        : 'WAITING FOR SIGNAL';

  const isAlert = !!epoch?.alert && !skipped;
  const isTrendAlarm = !!epoch?.trend_alarm && !skipped;
  const isPreStage = !skipped && !calibrating && stage === 1;

  return (
    <div
      className={`panel stage-banner ${isAlert || isTrendAlarm ? 'stage-banner--alert' : ''}`}
      style={{ borderColor: color }}
    >
      <div className="stage-banner__label" style={{ color }}>
        {label}
      </div>
      {isPreStage ? (
        <div className="stage-banner__alert">
          ⚠ EARLY WARNING —{' '}
          {isTrendAlarm
            ? 'sustained rise from your personal baseline detected (minutes-scale)'
            : `short-term risk detected, ~${config?.lead_time_s ?? 10}s ahead`}
        </div>
      ) : skipped ? (
        <div className="stage-banner__note">
          Epoch excluded from inference (electrode clipping or connection dropout)
        </div>
      ) : calibrating ? (
        <div className="stage-banner__note">
          Learning your resting baseline — early warning available once calibrated
        </div>
      ) : (
        <div className="stage-banner__note">
          p_emo {epoch?.p_emo != null ? epoch.p_emo.toFixed(3) : '—'}
        </div>
      )}
    </div>
  );
}
