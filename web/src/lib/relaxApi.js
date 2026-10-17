import axios from 'axios';

// Same Render-hosted Relaxation Guide service the mobile app calls
// (StressApp/modules/relaxation_guide/src/api/apiService.js). CORS is open.
export const RELAX_API_BASE = 'https://mindpulse-relaxation.onrender.com';

const client = axios.create({ baseURL: RELAX_API_BASE, timeout: 45000 });

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Local rule used when the service is asleep or offline -- mirrors the
// app's own fallback so the page always has a sensible suggestion.
export function localRecommendation(prob = 0.5, label = 'normal') {
  if (label === 'stress' || prob >= 0.85) return { technique_id: 'box_meditation', source: 'local' };
  if (prob >= 0.7) return { technique_id: 'pmr_crystal_squeeze', source: 'local' };
  if (prob >= 0.5) return { technique_id: 'flower_meadow', source: 'local' };
  return { technique_id: 'water_lily_pond', source: 'local' };
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
    }, { headers: authHeaders(token) });
    return res.data;
  } catch { return null; }
}

export async function validateIntervention(userId, token, { techniqueId, preLabel, postLabel, contextClusterId = 0, stars }) {
  try {
    const res = await client.post('/validate', {
      user_id: userId,
      technique_id: techniqueId,
      pre_stress_label: preLabel,
      post_stress_label: postLabel,
      context_cluster_id: contextClusterId,
      star_rating: stars,
    }, { headers: authHeaders(token) });
    return res.data;
  } catch { return null; }
}

export async function getBanditState(userId, token) {
  try {
    const res = await client.get('/bandit/state', { params: { user_id: userId }, headers: authHeaders(token) });
    return res.data;
  } catch { return null; }
}
