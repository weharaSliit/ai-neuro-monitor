// Daily Quests, same four as the app's DailyTasksModal. Progress is counted
// from real play and kept on this device, reset each day.

export const QUESTS = [
  { id: 'zen_breathing', gameId: 'water_lily_pond', icon: '🪷', title: 'Breathe 3 mins in Zen Lily Pond', counter: 'lily_min', target: 3, reward: 'Serenity Elixir', color: '#10B981', unit: 'min' },
  { id: 'garden_bloom', gameId: 'flower_meadow', icon: '🌸', title: 'Bloom 5 Lotus Flowers in Calm Meadow', counter: 'flowers', target: 5, reward: 'Lotus Gem', color: '#EC4899', unit: 'flowers' },
  { id: 'focus_rhythm', gameId: 'box_meditation', icon: '🧊', title: 'Complete 1 Box Breathing session', counter: 'box', target: 1, reward: '+100 Zen XP', color: '#3B82F6', unit: 'session' },
  { id: 'calm_elixir', gameId: 'diaphragmatic_pace', icon: '🧪', title: 'Activate 1 Serenity Elixir in game', counter: 'elixir', target: 1, reward: 'Chest Key', color: '#F59E0B', unit: 'item' },
];

const key = (uid) => `mindpulse.relax.quests.${uid}`;
const today = () => new Date().toISOString().slice(0, 10);

export function readQuests(uid) {
  try {
    const v = JSON.parse(localStorage.getItem(key(uid)) || 'null');
    if (v && v.date === today()) return v;
  } catch { /* storage blocked */ }
  return { date: today(), lily_min: 0, flowers: 0, box: 0, elixir: 0 };
}

export function bumpQuest(uid, counter, n = 1) {
  const q = readQuests(uid);
  q[counter] = (q[counter] || 0) + n;
  try { localStorage.setItem(key(uid), JSON.stringify(q)); } catch { /* storage blocked */ }
  return q;
}
