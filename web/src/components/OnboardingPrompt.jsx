import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useCalibration } from '../hooks/useLive';

// Pops up straight after sign-up (and on any later visit) while the
// account has no calibration yet -- the web twin of the app routing a new
// user into AccountSetupScreen. "Later" hides it for this browser session.
const DISMISS_KEY = 'mindpulse.web.onboarding.dismissed';

export default function OnboardingPrompt() {
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const cal = useCalibration(user?.userId, token);
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === user?.userId; } catch { return false; }
  });

  // Only when the server has actually answered "no baseline" (a failed
  // request is null, not exists:false, and must not trigger this).
  const uncalibrated = !cal.loading && cal.ring && cal.ring.exists === false && !cal.eeg?.exists;
  if (!user || dismissed || !uncalibrated || pathname === '/setup') return null;

  const later = () => {
    try { sessionStorage.setItem(DISMISS_KEY, user.userId); } catch { /* ignore */ }
    setDismissed(true);
  };

  return (
    <div className="modal-bg">
      <div className="modal" role="dialog" aria-modal="true">
        <img src="/icon.png" alt="" style={{ width: 64, height: 64, borderRadius: 18 }} />
        <h2 className="display" style={{ marginTop: 14 }}>Welcome, {user.name || user.userId}!</h2>
        <p className="body" style={{ marginTop: 8 }}>
          Before we start, let’s learn what calm looks like for <b>you</b>: about 3½ minutes of slow breathing,
          then a short limit test. Put on your ring and headband first.
        </p>
        <button className="btn" style={{ width: '100%', marginTop: 22 }} onClick={() => navigate('/setup')}>
          Start calibration
        </button>
        <button className="btn ghost" style={{ width: '100%', marginTop: 10 }} onClick={later}>
          Later
        </button>
      </div>
    </div>
  );
}
