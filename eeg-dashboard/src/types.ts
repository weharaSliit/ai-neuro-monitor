export interface Config {
  type: 'config';
  sampling_rate_hz: number;
  epoch_stride_s: number;
  epoch_samples: number;
  alert_thresh: number;
  lead_time_s: number;
  stage_names: string[];
  models_available: boolean;
}

export interface Status {
  type: 'status';
  mqtt_connected: boolean;
  models_available: boolean;
  n_epochs: number;
  n_alerts: number;
  n_skipped: number;
  elapsed_s: number;
}

export interface EpochResult {
  type: 'epoch';
  epoch: number;
  time_s: number;
  p_emo: number | null;
  risk: number | null;
  alert: boolean;
  stage: number | null;
  skipped: boolean;
  /** Personal-baseline CUSUM trend score, in sigma units above the user's
   * own resting baseline. See eeg/trend_detector.py — this is the
   * minutes-scale early-warning signal, independent of `risk` (which is
   * SpiralLSTM's ~10s-horizon signal). */
  trend_score: number | null;
  /** Sustained drift from personal baseline — fires well before `alert`. */
  trend_alarm: boolean;
  /** True while the personal baseline is still warming up (first ~90s);
   * trend_alarm cannot fire during this window. */
  calibrating: boolean | null;
  /** MC-Dropout std-dev of SpiralLSTM's risk estimate across 15 stochastic
   * forward passes — higher means the model itself is uncertain about this
   * risk score, not just that the score is high or low. */
  risk_std: number | null;
  /** Derived from risk_std: max(0, 1 - 2*risk_std), in [0,1]. Confidence in
   * the `risk` estimate specifically — NOT overall system accuracy, which
   * is separately modest (AUC ~0.63) regardless of this value. */
  confidence: number | null;
  /** Per-epoch signal level (std) of the raw T7 / T8 channels, DC-offset-free. */
  ch1_level: number | null;
  ch2_level: number | null;
  /** Each channel's own fixed ~30s resting-level baseline (median/MAD of
   * ch*_level), frozen once — same design as trend_detector.FixedBaseline,
   * applied per-channel instead of to p_emo. Null until frozen. */
  ch1_baseline_mu: number | null;
  ch1_baseline_sigma: number | null;
  ch2_baseline_mu: number | null;
  ch2_baseline_sigma: number | null;
  /** True while either channel's baseline is still warming up. */
  channel_calibrating: boolean | null;
  /** Mahalanobis distance of this epoch's full 76-dim feature vector from
   * this user's own frozen feature-space baseline (median/LOO-corrected
   * mean+covariance over the first ~30-60s). See eeg/trend_detector.py
   * FeatureSpaceBaseline/FeatureTrendMonitor — a second, independent
   * signal alongside trend_score, since a real EEG shift can move features
   * p_emo's single output neuron under-weights without moving p_emo much.
   * Null until the feature-space baseline is frozen. */
  feature_dist: number | null;
  feature_dist_mu: number | null;
  feature_dist_sigma: number | null;
  /** CUSUM score (sigma units) on feature_dist — same design as trend_score,
   * applied to the multivariate distance instead of p_emo. */
  feature_trend_score: number | null;
  /** Sustained multivariate deviation. By design this is CORROBORATING
   * only — it does not gate `stage`/`alert` (unlike trend_alarm). */
  feature_trend_alarm: boolean;
  /** Fast dual-signal detector: fires when p_emo AND feature_dist both
   * cross a high bar within ~3s of each other (abrupt shift, not gradual
   * drift). Unlike feature_trend_alarm, this DOES gate `stage`. */
  shock_alarm: boolean;
  /** Which mechanism caused `stage` to rise this epoch, if any:
   * "PRE-STAGE" | "SUDDEN-SHIFT" | "PRE-STAGE+SUDDEN-SHIFT" | null.
   * Informational only. */
  alert_type: string | null;
  p_shock_z: number | null;
  feature_shock_z: number | null;
}

export interface RawSample {
  t: number;
  ch1: number;
  ch2: number;
  clipped: boolean;
}

export interface RawBatch {
  type: 'raw_batch';
  samples: RawSample[];
}

export type WsMessage = Config | Status | EpochResult | RawBatch;

export const STAGE_COLORS = ['#2ecc71', '#f5a623', '#ff4d4f'];
export const STAGE_LABELS = ['CALM', 'PRE-STAGE', 'STRESSED'];
