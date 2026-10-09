import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Card } from '../components/ui';

export default function LoginPage() {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login');
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user && !busy) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!userId.trim() || !password || (mode === 'register' && !name.trim())) {
      setError('Please fill in every field.');
      return;
    }
    setBusy(true);
    const res = mode === 'login'
      ? await login(userId.trim(), password)
      : await register(userId.trim(), password, name.trim());
    // New accounts go straight to calibration, like the app's AccountSetupScreen.
    if (res.success) {
      navigate(mode === 'register' ? '/setup' : '/', { replace: true });
      return;
    }
    setBusy(false);
    setError(res.error);
  };

  return (
    <div className="auth-wrap">
      <Card className="auth-card">
        <img className="logo" src="/icon.png" alt="" />
        <h1 className="display" style={{ marginTop: 18 }}>
          {mode === 'login' ? 'Welcome back' : 'Create your account'}
        </h1>
        <p className="body" style={{ margin: '6px 0 24px' }}>
          {mode === 'login'
            ? 'Sign in with the same account you use in the MindPulse app.'
            : 'Use this same account later in the MindPulse app.'}
        </p>

        {error && <div className="error">{error}</div>}

        <form onSubmit={submit}>
          {mode === 'register' && (
            <div className="field">
              <label htmlFor="name">Your name</label>
              <input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </div>
          )}
          <div className="field">
            <label htmlFor="uid">User ID</label>
            <input id="uid" value={userId} onChange={(e) => setUserId(e.target.value)} autoComplete="username" />
          </div>
          <div className="field">
            <label htmlFor="pw">Password</label>
            <input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          </div>
          <button className="btn" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'Please wait… (the server may take a moment to wake up)' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="body" style={{ marginTop: 18, textAlign: 'center' }}>
          {mode === 'login' ? 'New here? ' : 'Already have an account? '}
          <a href="#" onClick={(e) => { e.preventDefault(); setError(''); setMode(mode === 'login' ? 'register' : 'login'); }}>
            {mode === 'login' ? 'Create an account' : 'Sign in'}
          </a>
        </p>
      </Card>
    </div>
  );
}
