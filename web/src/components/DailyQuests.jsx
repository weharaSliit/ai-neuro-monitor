import { QUESTS, readQuests } from '../lib/quests';

// "Daily Quests": the app's DailyTasksModal. onOpenChest claims the chest,
// onStart opens the game a quest belongs to.
export default function DailyQuests({ userId, onClose, onStart, onOpenChest }) {
  const q = readQuests(userId);
  const status = QUESTS.map((t) => ({ ...t, progress: Math.min(t.target, q[t.counter] || 0) }));
  const complete = status.filter((t) => t.progress >= t.target).length;
  const pct = Math.round((complete / QUESTS.length) * 100);

  return (
    <div className="rg-quest-bg" onClick={onClose}>
      <div className="rg-quest" onClick={(e) => e.stopPropagation()}>
        <div className="between" style={{ alignItems: 'flex-start' }}>
          <div>
            <h3>📜 Daily Quests</h3>
            <p>Complete tasks to unlock relaxation rewards</p>
          </div>
          <button type="button" className="rg-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="rg-quest-progress">
          <div className="between">
            <b>✨ {complete} of {QUESTS.length} Quests Completed</b>
            {onOpenChest && <button type="button" className="rg-link" onClick={onOpenChest}>🎁 Claim Chest</button>}
          </div>
          <span className="rg-quest-track"><i style={{ width: `${pct}%` }} /></span>
        </div>

        <div className="rg-quest-list">
          {status.map((t) => {
            const done = t.progress >= t.target;
            return (
              <div key={t.id} className="rg-quest-item" style={{ borderColor: `${t.color}55` }}>
                <span className="rg-quest-icon" style={{ background: `${t.color}22` }}>{t.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{t.title}</b>
                  <span className="rg-quest-bar"><i style={{ width: `${(t.progress / t.target) * 100}%`, background: t.color }} /></span>
                  <small>{t.progress}/{t.target} {t.unit} · Reward: {t.reward}</small>
                </div>
                <button type="button" className="rg-quest-go" disabled={done}
                  style={{ background: done ? '#94A3B8' : t.color }} onClick={() => onStart(t.gameId)}>
                  {done ? 'Done' : 'Start'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
