import axios from 'axios';

// Same Render-hosted Relaxation Guide service the mobile app calls
// (StressApp/modules/relaxation_guide/src/api/apiService.js). CORS is open.
export const RELAX_API_BASE = 'https://mindpulse-relaxation.onrender.com';

const client = axios.create({ baseURL: RELAX_API_BASE, timeout: 45000 });
const SUBMIT_TIMEOUT_MS = 15000;   // saving a session should not keep the user waiting a minute

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Local rule used when the service is asleep or offline -- the same bands as the app's own
// fallback (apiService.js getIntervention), so the page always has a sensible suggestion.
export function localRecommendation(prob = 0.5, label = 'normal') {
  const l = String(label || '').toLowerCase();
  let id = 'diaphragmatic_pace';
  if (l === 'high_stress' || l === 'extreme_stress' || prob >= 0.8) id = 'box_meditation';
  else if (l === 'stress' || l === 'high_confidence_stress' || (prob >= 0.6 && prob < 0.8)) id = 'pmr_crystal_squeeze';
  else if (l === 'moderate_stress' || (prob >= 0.45 && prob < 0.6)) id = 'flower_meadow';
  else if (prob >= 0.3 && prob < 0.45) id = 'water_lily_pond';
  return { technique_id: id, source: 'local' };
}

// Which web game a service recommendation means. Same rule as the app (GamePlayerScreen.getTechKey):
// the game comes from the recommended SUB-OPTION (selected_sub_option), not from the technique family.
export function webTechniqueIdFromRecommendation(rec) {
  const target = rec?.selected_sub_option || rec;
  let raw = '';
  if (typeof target === 'string') raw = target;
  else if (target && typeof target === 'object') raw = target.id || target.technique_id || target.key || target.title || '';
  const s = String(raw).toLowerCase();

  if (s.includes('pmr') || s.includes('crystal') || s.includes('somatic') || s.includes('squeeze')) return 'pmr_crystal_squeeze';
  if (s.includes('emdr') || s.includes('saccadic') || s.includes('trace') || s.includes('cosmic')) return 'emdr_saccadic_trace';
  if (s.includes('gsr') || s.includes('galvanic') || s.includes('fluid') || s.includes('pool')) return 'galvanic_biofeedback_flow';
  if (s.includes('pattern') || s.includes('match') || s.includes('alignment')) return 'pattern_alignment';
  if (s.includes('autogenic') || s.includes('warmth') || s.includes('warm')) return 'autogenic_warmth';
  if (s.includes('stroop') || s.includes('clash') || s.includes('decoupler')) return 'stroop_decoupler';
  if (s.includes('flower') || s.includes('meadow')) return 'flower_meadow';
  if (s.includes('lily') || s.includes('pond') || s.includes('water')) return 'water_lily_pond';
  if (s.includes('box') || s.includes('meditation')) return 'box_meditation';
  if (s.includes('diaphragmatic') || s.includes('belly') || s.includes('deep')) return 'diaphragmatic_pace';
  if (s.includes('body') || s.includes('scan') || s.includes('sweep') || s.includes('mindful')) return 'body_scan_mindful';
  return 'flower_meadow';
}

export async function getIntervention(userId, token, { label, probability }) {
  try {
    const res = await client.post('/intervention', {
      user_id: userId,
      telemetry: {
        fused_stress_label: label,
        stress_probability: probability,
        seconds_since_last_packet: 0,
        timestamp: Date.now() / 1000,
      },
    }, { headers: authHeaders(token) });
    if (res.data?.technique_id) return { ...res.data, source: 'service' };
  } catch { /* fall through to the local rule */ }
  return localRecommendation(probability, label);
}

export async function submitRating(userId, token, techniqueId, stars) {
  try {
    const res = await client.post('/rating', {
      user_id: userId, technique_id: techniqueId, sub_option_id: techniqueId, rating_stars: stars,
    }, { headers: authHeaders(token), timeout: SUBMIT_TIMEOUT_MS });
    return res.data;
  } catch { return null; }
}

// sessionId / stressTrajectory / durationSeconds let the service score the session from the measured
// stress curve (reward beyond natural recovery) exactly as it does for the app.
export async function validateIntervention(userId, token, {
  techniqueId, preLabel, postLabel, contextClusterId = 0, stars, sessionId, stressTrajectory, durationSeconds,
}) {
  try {
    const res = await client.post('/validate', {
      user_id: userId,
      technique_id: techniqueId,
      pre_stress_label: preLabel,
      post_stress_label: postLabel,
      context_cluster_id: contextClusterId,
      star_rating: stars,
      session_id: sessionId,
      stress_trajectory: stressTrajectory,
      duration_seconds: durationSeconds,
    }, { headers: authHeaders(token), timeout: SUBMIT_TIMEOUT_MS });
    return res.data;
  } catch { return null; }
}

// Mid-session check: continue / switch / stop from the filtered stress level and its slope.
export async function loopStep(userId, token, { techniqueId, elapsedSeconds, tried = [] }) {
  try {
    const res = await client.post('/loop/step', {
      user_id: userId, technique_id: techniqueId, elapsed_seconds: elapsedSeconds, tried_techniques: tried,
    }, { headers: authHeaders(token), timeout: SUBMIT_TIMEOUT_MS });
    return res.data;
  } catch { return { action: 'continue', reason: '' }; }
}

export async function getBanditState(userId, token) {
  try {
    const res = await client.get('/bandit/state', { params: { user_id: userId }, headers: authHeaders(token) });
    return res.data;
  } catch { return null; }
}
