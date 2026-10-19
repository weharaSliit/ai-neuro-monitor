import { useCallback, useEffect, useState } from 'react';
import useRawStream from './hooks/useRawStream';
import { useFirebaseValue, useHealth, useNow, useSessionData, useSessionPicker } from './hooks/useData';
import TechView from './components/TechView';
import CalibrationDashboard from './components/CalibrationDashboard';
import StimulatorBanner from './components/StimulatorBanner';
import LiveMonitor from './components/LiveMonitor';
import RingCheck from './components/RingCheck';
import useCalibratedLimits from './hooks/useCalibratedLimits';
import {
  Breathing, CalibrateScreen, HomeScreen, NavBar, ProfileScreen, ProgressScreen, TABS, WavesScreen, Welcome,
} from './components/friendly/Screens';
import './friendly.css';

// Technical pages: Live monitor (#concept), Calibration, Devices (#tech). Older
// page addresses lead to the Live monitor, which now holds what they showed.
const TECH = new Set(['concept', 'calibration', 'tech', 'ringcheck']);
const OLD = { fusion: 'concept', physio: 'tech', simdemo: 'concept' };
const VIEWS = new Set([...TABS.map((t) => t.key), ...TECH, ...Object.keys(OLD)]);
const WELCOME_KEY = 'psy_web_welcomed';

function readHash() {
  const h = window.location.hash.replace('#', '');
  return VIEWS.has(h) ? OLD[h] || h : 'home';
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
  // Calibrated baseline / threshold for mind, body and fused: the same values on every dashboard.
  const limits = useCalibratedLimits(picker.userId, picker.sessionId);

  const [view, setView] = useState(readHash);
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
  const banner = <StimulatorBanner now={now} openControls={openStimulator} openDemo={() => go('concept')} />;
  if (view === 'concept') return <>{banner}<LiveMonitor now={now} go={go} /></>;
  if (view === 'ringcheck') return <>{banner}<RingCheck now={now} go={go} /></>;
  if (view === 'calibration') return <>{banner}<CalibrationDashboard now={now} go={go} /></>;
  if (view === 'tech') {
    return <>{banner}<TechView raw={raw} health={health} picker={picker} sessionData={sessionData} limits={limits} now={now} go={go} /></>;
  }

  const shared = { raw, now, sessionData, profile, picker, limits };
  return (
    <div className="friendly">
      {banner}
      <main className="fpage">
        {view === 'home' && <HomeScreen {...shared} go={go} openBreathing={() => setBreathing(true)} />}
        {view === 'progress' && <ProgressScreen {...shared} />}
        {view === 'waves' && <WavesScreen {...shared} />}
        {view === 'calibrate' && <CalibrateScreen {...shared} />}
        {view === 'profile' && (
          <ProfileScreen {...shared} openTech={() => go('concept')} openWelcome={() => setWelcome(true)} openBreathing={() => setBreathing(true)} />
        )}
      </main>
      <NavBar tab={view} setTab={go} />
      {welcome && <Welcome onStart={closeWelcome} />}
      {breathing && <Breathing onClose={closeBreathing} />}
    </div>
  );
}
