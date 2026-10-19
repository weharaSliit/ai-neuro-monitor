import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useCalibration, useDeviceStatus, useFirebaseValue, useLivePointer } from '../hooks/useLive';
import { COLORS } from '../lib/levels';
import { Card, CardHead, DeviceChip, Badge } from '../components/ui';
import BreathingCalibration from '../components/BreathingCalibration';
import ThresholdTask from '../components/ThresholdTask';
import CalibrationTrend from '../components/CalibrationTrend';
import useCondition from '../hooks/useCondition';
import TakeOverBanner from '../components/TakeOverBanner';

// Same three steps as the app's AccountSetupScreen -> EegThresholdTaskScreen:
// 1) devices on, 2) calm-breathing baseline, 3) the ~8 min limit test.
// Either step can be done any time later from here too.
function Step({ n, title, done, active, children }) {
  return (
    <Card style={{ marginTop: 16, opacity: active || done ? 1 : 0.55 }}>
      <CardHead
        title={<span className="row"><span className="avatar" style={{ width: 28, height: 28, fontSize: 13 }}>{done ? '✓' : n}</span>{title}</span>}
        right={done ? <Badge color={COLORS.normal}>Done</Badge> : null}
      />
      {children}
    </Card>
  );
}

export default function SetupPage() {
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const userId = user?.userId;
  const pointer = useLivePointer();
  const { ringOnline, eegOnline, eegSessionId } = useDeviceStatus(userId);
  const cal = useCalibration(userId, token);
  const [step, setStep] = useState(null);
  const cond = useCondition(userId, eegSessionId, [], []);

  // Devices stream into whichever session the shared pointer names -- if
  // that's someone else, calibrating now would mix their signal into
  // this account's baseline.
  const otherUserLive = pointer.userId && pointer.userId !== userId;
  const baselineDone = !!cal.ring?.exists || !!cal.eeg?.exists;
  // EEG's limit test often ends 'not_separated' (rest and task too close),
  // which keeps the population limit and is never saved to the profile --
  // so "has a personal_high_load_p" alone left step 3 undone forever. A
  // finished run (ok or not_separated) for this session counts as done.
  const eegThresholdResult = useFirebaseValue(userId && eegSessionId ? `psychological/${userId}/${eegSessionId}/threshold_result` : null);
  const eegLimitDone = cal.eeg?.personal_high_load_p != null
    || ['ok', 'not_separated'].includes(eegThresholdResult?.status);
  const personalised = eegLimitDone && cal.ring?.personal_stress_threshold != null;
  const current = step || (baselineDone ? 'task' : 'baseline');
  const anyDevice = ringOnline || eegOnline;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="greet">
        <h1>Let’s get to know <b>you</b></h1>
        <p>Two short steps so MindPulse judges stress against your own body, not an average.</p>
      </div>

      {otherUserLive && (
        <TakeOverBanner holder={pointer.userId} className="banner warning" style={{ marginBottom: 16 }} />
      )}

      <Step n={1} title="Put on your devices" done={anyDevice} active>
        <div className="grid grid-2" style={{ gap: 12 }}>
          <DeviceChip icon="💍" tint={COLORS.hrv} name="Ring" online={ringOnline} detail={ringOnline ? 'Connected' : 'Turn on & wear it'} />
          <DeviceChip icon="🧠" tint={COLORS.eeg} name="Headband" online={eegOnline} detail={eegOnline ? 'Streaming' : 'Turn on & wear it'} />
        </div>
        {!anyDevice && <p className="caption" style={{ marginTop: 10 }}>At least one device needs to be on to calibrate. This updates by itself.</p>}
      </Step>

      <Step n={2} title="Calm-breathing calibration" done={baselineDone} active={current === 'baseline'}>
        {current === 'baseline' ? (
          <>
            <BreathingCalibration ringOnline={ringOnline} eegOnline={eegOnline} eegSessionId={eegSessionId} ringCal={cal.ring} eegCal={cal.eeg}
              disabled={otherUserLive} onComplete={() => { cal.refresh(); setStep('task'); }} />
          </>
        ) : (
          <div className="between">
            <span className="body">{baselineDone ? 'Your calm baseline is saved.' : 'Not done yet.'}</span>
            <button className="btn ghost sm" onClick={() => setStep('baseline')}>{baselineDone ? 'Recalibrate' : 'Start'}</button>
          </div>
        )}
      </Step>

      <Step n={3} title="Personal limit test (≈ 11 min)" done={personalised} active={current === 'task'}>
        {current === 'task' ? (
          <>
            <ThresholdTask userId={userId} eegSessionId={eegSessionId} alreadyPersonalized={personalised}
              ringCal={cal.ring} eegCal={cal.eeg} disabled={otherUserLive || cal.loading} autoStart={step === 'task'}
              onFinish={() => navigate('/', { replace: true })} />
          </>
        ) : (
          <p className="body">Unlocks after step 2 — it needs your calm baseline to compare against.</p>
        )}
      </Step>

      {(current === 'task' || baselineDone) && <CalibrationTrend phases={cond.phases} />}

      <p style={{ textAlign: 'center', marginTop: 20 }}>
        <a href="#" onClick={(e) => { e.preventDefault(); navigate('/'); }}>Skip for now →</a>
      </p>
    </div>
  );
}
