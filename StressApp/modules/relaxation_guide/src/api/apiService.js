import axios from 'axios';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Render-hosted Cloud Backend URL for Relaxation Guide
// Matches the same pattern as other modules:
//   - Physiological: https://mindpulse-physiological.onrender.com
//   - Relaxation Guide: https://mindpulse-relaxation.onrender.com
// Fixed URL avoids the recurring "can't reach backend" issue every time
// the dev machine's network/IP changes (WiFi vs Ethernet, hotspot, etc.)
export const API_BASE = process.env.EXPO_PUBLIC_RELAXATION_API_URL || 'https://mindpulse-relaxation.onrender.com';

// Resolve backend URL — cloud Render by default.
// Set EXPO_PUBLIC_USE_LOCAL_BACKEND=true in .env to use local dev server instead.
const getApiBaseUrl = () => {
  if (process.env.EXPO_PUBLIC_USE_LOCAL_BACKEND === 'true') {
    try {
      const hostUri = Constants.expoConfig?.hostUri || Constants.manifest2?.extra?.expoGo?.debuggerHost || Constants.manifest?.debuggerHost;
      if (hostUri) {
        const ip = hostUri.split(':')[0];
        if (ip && ip !== 'localhost' && ip !== '127.0.0.1' && !ip.includes('.exp.direct')) {
          return `http://${ip}:8000`;
        }
      }
    } catch (e) {
      // Ignore error
    }

    if (Platform.OS === 'android') {
      return 'http://10.0.2.2:8000';
    }

    return 'http://localhost:8000';
  }

  return API_BASE;
};

const API_BASE_URL = getApiBaseUrl();
console.log('[apiService] API Base URL:', API_BASE_URL);


const client = axios.create({
  baseURL: API_BASE_URL,
  // 45s, not 5s -- Render's free tier (which this service runs on) can take
  // 28-30s to wake from a cold start; 5s guaranteed every call would hit
  // the catch-block fallback whenever the service had gone idle. Same fix
  // already applied to the physiological/psychological bridges.
  timeout: 45000,
  headers: {
    'Content-Type': 'application/json',
  },
});

let authToken = null;

export function setAuthToken(token) {
  authToken = token;
}

client.interceptors.request.use((config) => {
  if (authToken) {
    config.headers.Authorization = `Bearer ${authToken}`;
  }
  return config;
});

export const apiService = {
  async getCalibrationStatus(userId) {
    try {
      const res = await client.get(`/telemetry/fusion-output?user_id=${userId}`);
      return !!res.data?.is_calibrated;
    } catch (err) {
      return false;
    }
  },

  async completeCalibration(userId) {
    try {
      const res = await client.post('/auth/register', { user_id: userId });
      return res.data;
    } catch (err) {
      return { user_id: userId, is_calibrated: true };
    }
  },

  async saveOnboardingAnswers(userId, answers) {
    try {
      const res = await client.post('/auth/login', { user_id: userId, answers });
      return res.data;
    } catch (err) {
      return { status: 'recorded_locally', user_id: userId, answers };
    }
  },

  async checkSuitability(userId, techniqueId, currentStressLabel, stressProbability = 0.5) {
    const isStress = currentStressLabel.toLowerCase() === 'stress';
    return {
      is_suitable: !isStress || ['breathing_garden', 'guided_meditation'].includes(techniqueId),
      current_stress_label: currentStressLabel,
      requested_technique_id: techniqueId,
      recommended_technique_id: isStress ? 'guided_meditation' : techniqueId,
      recommended_title: isStress ? 'Guided Meditation & Breathwork' : techniqueId,
      warning_title: '⚠️ Calm AI Suitability Warning',
      warning_message: `Your live probability scores indicate acute stress. Calm AI recommends starting with 'Guided Meditation & Breathwork' for immediate autonomic baseline restoration.`
    };
  },

  async getUserProfile(userId) {
    try {
      const res = await client.get(`/bandit/state?user_id=${userId}`);
      return {
        user_id: userId,
        email: `${userId}@caps-research.org`,
        full_name: 'Research Participant',
        xp_points: 250,
        streak_days: 3,
        badges: [
          { id: 'streak_legend', title: 'Streak Legend', icon: '🔥', description: 'Maintained 3-day streak', unlocked: true },
          { id: 'zen_master', title: 'Zen Master', icon: '🧘', description: 'Tried all 5 categories', unlocked: true }
        ],
        recent_interventions_count: 5,
        bandit_state: res.data
      };
    } catch (err) {
      return {
        user_id: userId,
        email: `${userId}@caps-research.org`,
        full_name: 'Research Participant',
        xp_points: 250,
        streak_days: 3,
        badges: [
          { id: 'streak_legend', title: 'Streak Legend', icon: '🔥', description: 'Maintained 3-day streak', unlocked: true },
          { id: 'zen_master', title: 'Zen Master', icon: '🧘', description: 'Tried all 5 categories', unlocked: true }
        ],
        recent_interventions_count: 5
      };
    }
  },

  // Telemetry API
  async getProcessedTelemetry(userId = 'user_default', dt = 0.0) {
    try {
      const res = await client.get(`/telemetry/fusion-output?user_id=${userId}`);
      return res.data;
    } catch (err) {
      return {
        user_id: userId,
        effective_label: 'offline',
        is_safety_override: false,
        is_locf_applied: false,
        is_alert_triggered: false,
        has_live_packet: false,
        features_flat: [0.0, 0.0],
        user_baseline: null,
        message: 'Fusion Engine Offline / Awaiting Sensors'
      };
    }
  },

  // Real-time multimodal fusion engine output, read directly from
  // fusion_en_sessions/{user}/{session} in Firebase DB.
  async getLiveFusionTelemetry(userId = 'user_default') {
    try {
      const res = await client.get(`/telemetry/fusion-output?user_id=${userId}`);
      return res.data;
    } catch (err) {
      return {
        user_id: userId,
        effective_label: 'offline',
        is_safety_override: false,
        is_locf_applied: false,
        is_alert_triggered: false,
        has_live_packet: false,
        features_flat: [0.0, 0.0],
        user_baseline: null,
        message: 'Fusion Engine Unreachable / Awaiting Sensors'
      };
    }
  },

  // Full real-time pipeline snapshot (raw per-modality probability_vector +
  // MVH-processed result) for the Live Pipeline tab.
  async getFusionPipeline(userId = 'user_default') {
    try {
      const res = await client.get(`/telemetry/pipeline?user_id=${userId}`);
      return res.data;
    } catch (err) {
      return {
        user_id: userId,
        is_live: false,
        is_calibrated: false,
        raw_stress_label: null,
        probability_vector: { eeg: null, hrv_gsr: null, behav: null, fused: null },
        processed: {
          user_id: userId,
          effective_label: 'normal',
          is_safety_override: false,
          is_locf_applied: false,
          is_alert_triggered: false,
          features_flat: [0.15, 0.85],
          message: 'Pipeline unreachable — backend offline'
        }
      };
    }
  },

  async setSimulatorMode(mode) {
    try {
      const res = await client.post('/simulator/mode', { mode });
      return res.data;
    } catch (err) {
      return { message: `Simulator set to ${mode}` };
    }
  },

  async getIntervention(userId, telemetryPayload) {
    try {
      const res = await client.post('/intervention', {
        user_id: userId,
        telemetry: telemetryPayload
      });
      return res.data;
    } catch (err) {
      return {
        technique_id: 'water_lily_pond',
        title: 'Lily Pond Breathing',
        description: 'Extended exhale pacing synced with water lilies to quickly lower heart rate.',
        selected_sub_option: {
          id: 'water_lily_pond',
          title: 'Lily Pond Breathing',
          description: 'Extended exhale pacing synced with water lilies to quickly lower heart rate.'
        },
        available_sub_options: [
          { id: 'water_lily_pond', title: 'Lily Pond Breathing', description: 'Deep exhale vagal reset' },
          { id: 'box_meditation', title: 'Box Breathing', description: 'Equal 4-4-4-4 square pacing' },
          { id: 'soft_fascination', title: 'Nature Scenery', description: 'Restorative nature viewing' }
        ],
        context_cluster_id: 1,
        blended_score: 0.88,
        physiological_sample: 0.85,
        preference_score: 0.90,
        execution_time_ms: 10.0
      };
    }
  },

  async validateIntervention(userId, techniqueId, preLabel, postLabel, contextClusterId = 0, starRating = 5) {
    try {
      const res = await client.post('/validate', {
        user_id: userId,
        technique_id: techniqueId,
        pre_stress_label: preLabel,
        post_stress_label: postLabel,
        context_cluster_id: contextClusterId,
        star_rating: starRating
      });
      return res.data;
    } catch (err) {
      const isNormal = postLabel.toLowerCase() === 'normal' && starRating >= 3;
      const isNoHelp = starRating <= 1;
      const recPct = isNormal ? 100.0 : isNoHelp ? 0.0 : 45.0;
      return {
        reward: isNormal ? 1.0 : isNoHelp ? 0.1 : 0.4,
        recovery_percentage: recPct,
        transition: isNormal ? 'Complete Recovery' : isNoHelp ? 'No Relief (No Help)' : 'Partial Recovery',
        alpha_updated: 2.0,
        beta_updated: 1.0,
        message: 'Offline validation processed',
        xp_earned: isNormal ? 100 : 15,
        total_xp: 350,
        is_normal_reached: isNormal,
        unlocked_badges: isNormal ? [
          { id: 'recovery_champ', title: '100% Recovery Champion', icon: '🏆', description: 'Achieved 100% recovery', unlocked: true }
        ] : []
      };
    }
  },

  async submitRating(userId, techniqueId, subOptionId, ratingStars) {
    try {
      const res = await client.post('/rating', {
        user_id: userId,
        technique_id: techniqueId,
        sub_option_id: subOptionId,
        rating_stars: ratingStars
      });
      return res.data;
    } catch (err) {
      return {
        normalized_score: (ratingStars - 1) / 4.0,
        decayed_score: 0.8,
        message: `Recorded ${ratingStars}-star rating.`
      };
    }
  },

  async handleFallback(userId, rejectedTechniqueId) {
    try {
      const res = await client.post('/fallback', {
        user_id: userId,
        rejected_technique_id: rejectedTechniqueId
      });
      return res.data;
    } catch (err) {
      return {
        fallback_level: 1,
        level1_alternatives: [],
        level2_breathing_reset: {
          title: '30-Second Guided Breathing Reset',
          duration_seconds: 30,
          instructions: 'Inhale deeply for 4s... Hold for 4s... Exhale for 6s.'
        },
        level3_prompt_options: [
          { id: 'quiet_moment', label: 'A Quiet Moment', action: 'pause' },
          { id: 'continue_work', label: 'Continue Work', action: 'dismiss' },
          { id: 'suggest_later', label: 'Suggest Again Later', action: 'snooze' }
        ]
      };
    }
  },

  async getBanditState(userId) {
    try {
      const res = await client.get(`/bandit/state?user_id=${userId}`);
      return res.data;
    } catch (err) {
      return {
        user_id: userId,
        clusters: {},
        preference_history: { summary: {}, recent_interventions: [] }
      };
    }
  }
};
