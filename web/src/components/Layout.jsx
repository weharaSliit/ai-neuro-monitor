import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from './ui';
import OnboardingPrompt from './OnboardingPrompt';

export default function Layout() {
  const { user, logout } = useAuth();
  return (
    <>
      <header className="topbar">
        <div className="brandmark"><img src="/icon.png" alt="" /><span>MindPulse</span></div>
        <nav className="navlinks">
          <NavLink to="/" end>My wellbeing</NavLink>
          <NavLink to="/phone">Phone habits</NavLink>
          <NavLink to="/relax">Relax</NavLink>
          <NavLink to="/setup">Calibrate</NavLink>
          <NavLink to="/clinical">Clinical</NavLink>
        </nav>
        <div className="spacer" />
        <div className="row">
          <Avatar name={user?.name || user?.userId} />
          <button className="btn ghost sm" onClick={logout}>Sign out</button>
        </div>
      </header>
      <main className="page"><Outlet /></main>
      <OnboardingPrompt />
    </>
  );
}
