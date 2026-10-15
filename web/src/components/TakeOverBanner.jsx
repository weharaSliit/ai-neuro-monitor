import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';

// Shown when another account holds the shared device pointer. Taking over is
// explicit: it ends that account's live session and starts ours, so the ring
// and headband are attributed to us from then on.
export default function TakeOverBanner({ holder, className = 'banner info', style }) {
  const { takeOver } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const go = async () => {
    const ok = window.confirm(
      `${holder ? `“${holder}”` : 'Another account'} is signed in on the devices (it may only be tracking phone habits).

`
      + 'Take over so the ring and headband are used for YOUR account? Their live session will end.',
    );
    if (!ok) return;
    setBusy(true); setError('');
    const r = await takeOver();
    setBusy(false);
    if (!r.success) setError(r.error || 'Could not take over.');
  };

  return (
    <div className={className} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', ...style }}>
      <span style={{ flex: 1, minWidth: 220 }}>
        👀 {holder ? <b>{holder}</b> : 'Another account'} is holding the devices right now, so you’re seeing your own past readings.
        {error && <span style={{ color: '#E56B4E' }}> {error}</span>}
      </span>
      <button className="btn sm" disabled={busy} onClick={go}>{busy ? 'Taking over…' : 'Use the devices as me'}</button>
    </div>
  );
}
