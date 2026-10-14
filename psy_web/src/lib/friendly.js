// Plain-language layer for non-technical viewers. Every word here maps
// back to one technical quantity, so the simple view and the technical
// view can never disagree:
//   "mind load"     = task_state_score × 100
//   mood            = score vs the effective threshold, with the same 0.12
//                     "Focused" band web/src/lib/levels.js uses; the
//                     relaxed and overloaded sides are each split in two
//                     for a five-face scale
//   "signal"        = eeg_quality_flag / eeg_quality_score
//   "headband"      = MQTT packets arriving from wearable02
import { POPULATION_HIGH_LOAD_P } from './config';

const BAND = 0.12;

export const MOODS = {
  very_relaxed: {
    key: 'very_relaxed', word: 'Very relaxed', short: 'Very relaxed', color: 'var(--m-very-relaxed)', soft: 'var(--m-very-relaxed-soft)',
    desc: 'Your mind is resting. This is a good moment to recharge.',
  },
  relaxed: {
    key: 'relaxed', word: 'Relaxed', short: 'Relaxed', color: 'var(--m-relaxed)', soft: 'var(--m-relaxed-soft)',
    desc: 'You are calm and comfortable. Your mind is not working hard.',
  },
  focused: {
    key: 'focused', word: 'Focused', short: 'Focused', color: 'var(--m-focused)', soft: 'var(--m-focused-soft)',
    desc: 'Your mind is busy with something. That is normal while thinking or working.',
  },
  busy: {
    key: 'busy', word: 'Busy mind', short: 'Busy', color: 'var(--m-busy)', soft: 'var(--m-busy-soft)',
    desc: 'You are working hard. Plan a short pause soon.',
  },
  overloaded: {
    key: 'overloaded', word: 'Overloaded', short: 'Overloaded', color: 'var(--m-overloaded)', soft: 'var(--m-overloaded-soft)',
    desc: 'Your mind is under heavy load. Take a break now.',
  },
  unknown: {
    key: 'unknown', word: 'No reading yet', short: '—', color: 'var(--m-unknown)', soft: 'var(--m-unknown-soft)',
    desc: 'Waiting for a clear reading from the headband.',
  },
};
export const MOOD_ORDER = ['very_relaxed', 'relaxed', 'focused', 'busy', 'overloaded'];

export function moodOf(p, threshold) {
  if (p == null || Number.isNaN(p)) return MOODS.unknown;
  const t = threshold ?? POPULATION_HIGH_LOAD_P;
  const lo = Math.max(0.01, t - BAND);
  if (p < lo / 2) return MOODS.very_relaxed;
  if (p < lo) return MOODS.relaxed;
  if (p < t) return MOODS.focused;
  if (p < t + (1 - t) / 2) return MOODS.busy;
  return MOODS.overloaded;
}

export const load = (p) => (p == null ? null : Math.round(p * 100));

export function signalOf(block) {
  if (!block) return { word: 'Unknown', kind: 'idle', tip: 'No reading yet.' };
  if (!block.eeg_quality_flag) {
    return { word: 'Weak', kind: 'warning', tip: 'Press the sensors gently onto your temples and keep still.' };
  }
  if ((block.eeg_quality_score ?? 0) >= 80) return { word: 'Clear', kind: 'good', tip: 'The sensors have good contact.' };
  return { word: 'Okay', kind: 'good', tip: 'Usable, but not perfect. Check the sensor contact.' };
}

export function headbandOf(raw, now) {
  const fresh = raw.stats.lastPacketAt && now - raw.stats.lastPacketAt < 5000;
  if (fresh) return { word: 'Connected', kind: 'good', tip: 'Live data is coming in.' };
  if (raw.conn.state === 'connected') {
    return { word: 'Not detected', kind: 'warning', tip: 'Switch the headband on and check it has WiFi.' };
  }
  return { word: 'Connecting…', kind: 'idle', tip: 'Reaching the data service.' };
}

export function friendlyAgo(ms, now) {
  if (ms == null) return 'never';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s} seconds ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

export const clockShort = (sec) => (sec == null ? '' : new Date(sec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

// "session_20261008T223755" / "wearable02_20261008T223755" -> "8 Oct, 22:37"
export function sessionLabel(sid) {
  const m = /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(sid || '');
  if (!m) return sid || '';
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export const RHYTHMS = [
  { key: 'delta', name: 'Delta', plain: 'Deep rest', icon: '🌙', meaning: 'Strongest during deep sleep and deep relaxation' },
  { key: 'theta', name: 'Theta', plain: 'Daydreaming', icon: '☁️', meaning: 'Drowsy, dreamy or creative moments' },
  { key: 'alpha', name: 'Alpha', plain: 'Calm', icon: '🍃', meaning: 'Relaxed but awake, like resting with your eyes closed' },
  { key: 'beta', name: 'Beta', plain: 'Thinking', icon: '💡', meaning: 'Active thinking, problem solving, concentrating' },
  { key: 'gamma', name: 'Gamma', plain: 'Intense focus', icon: '⚡', meaning: 'Very high mental effort. Muscle tension also shows up here.' },
];
