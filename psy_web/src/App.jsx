import { useCallback, useEffect, useState } from 'react';
import useRawStream from './hooks/useRawStream';
import { useFirebaseValue, useHealth, useNow, useSessionData, useSessionPicker } from './hooks/useData';
import TechView from './components/TechView';
import FusionView from './components/FusionView';
import PhysioView from './components/PhysioView';
import CalibrationDashboard from './components/CalibrationDashboard';
import StimulatorBanner from './components/StimulatorBanner';
import { useFusionData, useFusionPicker } from './hooks/useFusion';
import {
  Breathing, CalibrateScreen, HomeScreen, NavBar, ProfileScreen, ProgressScreen, TABS, WavesScreen, Welcome,
} from './components/friendly/Screens';
import './friendly.css';

const VIEWS = new Set([...TABS.map((t) => t.key), 'tech', 'fusion', 'physio', 'calibration']);
const WELCOME_KEY = 'psy_web_welcomed';

function readHash() {
  const h = window.location.hash.replace('#', '');
  return VIEWS.has(h) ? h : 'home';
}

function seenWelcome() {
  try { return window.localStorage.getItem(WELCOME_KEY) === '1'; } catch { return false; }
}

export default function App() {
  const now = useNow(1000);
  const raw = useRawStream();
  const health = useHealth();
  const picker = useSessionPicker();
  const sessionData = useSessionData(picker.userId, picker.sessionId);
  const profile = useFirebaseValue(picker.userId ? `user_profiles/${picker.userId}/eeg` : null) || null;

  const [view, setView] = useState(readHash);
  // Fusion windows are only subscribed to while that page is open.
  const fusionPicker = useFusionPicker();
  const fusionData = useFusionData(view === 'fusion' ? fusionPicker.userId : null, fusionPicker.sessionId);
  const [welcome, setWelcome] = useState(() => !seenWelcome());
  const [breathing, setBreathing] = useState(false);

  useEffect(() => {
    const onHash = () => setView(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((v) => {
    window.location.hash = v;
    setView(v);
    window.scrollTo({ top: 0 });
  }, []);

  const closeWelcome = () => {
    try { window.localStorage.setItem(WELCOME_KEY, '1'); } catch { /* private mode: just show it again next time */ }
    setWelcome(false);
  };
  const closeBreathing = useCallback(() => setBreathing(false), []);

  // Live stimulator controls live on the Calibration page (#stimulator).
  const openStimulator = () => {
    go('calibration');
    setTimeout(() => document.getElementById('stimulator')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  };
  const banner = <StimulatorBanner now={now} openControls={openStimulator} />;
  if (view === 'tech') {
    return <>{banner}<TechView raw={raw} health={health} picker={picker} sessionData={sessionData} profile={profile} now={now}
      onBack={() => go('profile')} openFusion={() => go('fusion')} openPhysio={() => go('physio')} openCalibration={() => go('calibration')}
      openStimulator={openStimulator} /></>;
  }
  if (view === 'fusion') {
    return <>{banner}<FusionView picker={fusionPicker} data={fusionData} now={now} onBack={() => go('tech')} /></>;
  }
  if (view === 'calibration') {
    return <>{banner}<CalibrationDashboard now={now} onBack={() => go('tech')} /></>;
  }
  if (view === 'physio') {
    // Mounted only here, so the ring's MQTT/Firebase subscriptions run only while it's open.
    return <>{banner}<PhysioView now={now} onBack={() => go('tech')} openFusion={() => go('fusion')} /></>;
  }

  const shared = { raw, now, sessionData, profile, picker };
  return (
    <div className="friendly">
      <main className="fpage">
        {view === 'home' && <HomeScreen {...shared} go={go} openBreathing={() => setBreathing(true)} />}
        {view === 'progress' && <ProgressScreen {...shared} />}
        {view === 'waves' && <WavesScreen {...shared} />}
        {view === 'calibrate' && <CalibrateScreen {...shared} />}
        {view === 'profile' && (
          <ProfileScreen {...shared} openTech={() => go('tech')} openWelcome={() => setWelcome(true)} openBreathing={() => setBreathing(true)} />
        )}
      </main>
      <NavBar tab={view} setTab={go} />
      {welcome && <Welcome onStart={closeWelcome} />}
      {breathing && <Breathing onClose={closeBreathing} />}
    </div>
  );
}
