import json
from dataclasses import dataclass, replace
from pathlib import Path

import os

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class DecisionThresholds:
    """Probability thresholds updated 2026-08-28 from the 2026-08-18
    "sensitivity-optimized" set (threshold_set_C, 0.758/0.775/0.725) to the
    nested-LOSO-selected set (threshold_set_B, from
    scripts/nested_threshold_selection.py): outer LOSO x inner grouped CV,
    leakage-free Platt-calibrated inner scores, candidate thresholds =
    percentiles of that inner distribution, each scored against a
    false-alert-rate-capped sensitivity objective (high_load/break) or
    minimized false-recovery rate (cooldown), locked per outer fold and
    applied unchanged to the held-out subject. Values below are the mean
    locked threshold across all 40 outer folds (std < 0.006 on each --
    stable selection); see nested_threshold_per_fold.csv /
    nested_threshold_outer_predictions.csv in results/final_analysis/.

    KNOWN TRADEOFF, evaluated deliberately: this set was tried once before
    (2026-08-18) and reverted in favor of threshold_set_C specifically
    because pooled OUTER (truly held-out) sensitivity is only 29.4%
    (high_load) / 19.7% (break) at the target false-alert-rate cap -- i.e.
    it misses 70-80% of real high-load blocks in a subject the model
    wasn't tuned on. Re-adopted anyway as of 2026-08-28, prioritizing the
    lower false-alert rate / higher specificity this set buys over
    catching more true high-load blocks. If that tradeoff turns out wrong
    in practice, threshold_set_C (0.758 / 0.775 / cooldown_high 0.758 /
    cooldown_low 0.725) is the documented fallback.

    cooldown_high_p is not itself an output of the nested selection (that
    script only tunes cooldown_low_p, i.e. cooldown_t) -- kept equal to
    high_load_p here, same coupling threshold_set_C used ("was previously
    in a high-load state" = the same bar as the high-load alert itself).
    """
    high_load_p: float = 0.7933008189294708
    high_load_persistence_blocks: int = 3          # spec: ">=3 consecutive blocks"
    break_p: float = 0.8104568085102677
    break_persistence_blocks: int = 20              # spec: "sustained over 10 min"; blocks, not minutes -- see module docstring
    fatigue_theta_ratio_p75: float = None            # filled in per-series (75th percentile) if None
    fatigue_persistence_blocks: int = 60             # spec: "over 30 min"; blocks, not minutes -- see module docstring
    cooldown_high_p: float = 0.7933008189294708
    cooldown_low_p: float = 0.6962175275425009

# Lives INSIDE backend/psychological/ (not the separate psycological/
# research tree, 3 parents up) so it deploys with this service regardless
# of Render root-directory scoping -- a monorepo service configured with
# root=backend/psychological would never see the research tree at all,
# and this constant is loaded at import time, so that would crash the
# whole service on startup rather than just this one calculation. Same
# reasoning as firebase_service.py's FIREBASE_CRED_JSON pattern (avoid
# runtime dependencies on files outside this service's own directory).
_PERCENTILES_JSON = Path(__file__).resolve().parent / "population_percentiles.json"


def _load_population_percentiles(json_path: Path = _PERCENTILES_JSON) -> tuple[float, float, float]:
    try:
        with open(json_path) as f:
            data = json.load(f)
        return float(data["P5"]), float(data["P50"]), float(data["P95"])
    except (FileNotFoundError, KeyError, json.JSONDecodeError) as e:
        raise RuntimeError(
            f"Could not load population calibrated_p percentiles from {json_path} "
            f"(expected JSON keys P5/P50/P95) -- this file is required to compute "
            f"personalized baseline shifts; if the SAM40 LOSO analysis pipeline was "
            f"rerun (see results/CURRENT_SYSTEM.md Section 6 in the psycological/ "
            f"research tree), copy its new percentiles into this file rather than "
            f"hardcoding a replacement value here."
        ) from e


POPULATION_P5, POPULATION_MEDIAN_P, POPULATION_P95 = _load_population_percentiles()
# high_load_p (DecisionThresholds above) is chosen independently of this
# population median -- see that dataclass's own docstring for how it's
# actually derived (nested-LOSO threshold selection, not a percentile of
# this same distribution). The two happened to sit close together back
# when high_load_p was threshold_set_C (~0.76); that's no longer true now
# that it's threshold_set_B (~0.79), and was never a derived relationship
# either way.
MAX_THRESHOLD_SHIFT = (POPULATION_P95 - POPULATION_P5) / 2  # ~0.11, from the loaded percentiles


def compute_baseline_shift(resting_scores: list[float]) -> float | None:
    if len(resting_scores) < 2:
        return None  # variance needs at least 2 points to exist at all

    resting_mean = float(np.mean(resting_scores))
    resting_sem = float(np.std(resting_scores, ddof=1)) / np.sqrt(len(resting_scores))
    if resting_sem > MAX_THRESHOLD_SHIFT:
        return None

    shift = resting_mean - POPULATION_MEDIAN_P
    return max(-MAX_THRESHOLD_SHIFT, min(MAX_THRESHOLD_SHIFT, shift))


def compute_personal_threshold(resting_scores: list[float], task_scores: list[float]) -> float | None:
    """Personal high_load_p from a deliberate onboarding task: a short,
    known-high-load period (e.g. a timed mental-arithmetic quiz) captured
    right after resting-baseline calibration. threshold = the midpoint
    between this user's own resting mean and their own task mean -- a
    personal Rest-vs-Task cut, same spirit as the population nested-LOSO
    threshold selection (scripts/nested_threshold_selection.py) but n=this
    user's own blocks instead of 40 SAM40 subjects.

    Returns None (caller should keep the population threshold_set_B
    default) if the two groups aren't separated by at least
    MAX_THRESHOLD_SHIFT (~0.11) -- reusing that existing, already-derived
    constant as the noise floor here too, rather than inventing a second
    arbitrary one: if a user's task-induced rise is smaller than the
    largest shift compute_baseline_shift() would ever apply for baseline
    personalization, it's not clearly distinguishable from resting noise
    (e.g. a task block failed to actually induce load, or the model
    doesn't discriminate well for this individual -- see this project's
    own LOSO finding that per-subject AUC ranges 0.07-1.00).

    Clamped to [POPULATION_P5, POPULATION_P95] so one wild task score
    can't produce a threshold outside the range this project has ever
    actually observed."""
    if len(resting_scores) < 1 or len(task_scores) < 1:
        return None

    resting_mean = float(np.mean(resting_scores))
    task_mean = float(np.mean(task_scores))
    if task_mean - resting_mean < MAX_THRESHOLD_SHIFT:
        return None

    midpoint = (resting_mean + task_mean) / 2.0
    return max(POPULATION_P5, min(POPULATION_P95, midpoint))


# ═══════════════════════════════════════════════════════════════════
#  PERSONAL SCALE -- the deployed decision rule (paper Sect. "Personal EEG
#  Threshold"; same constants as fushion engin/personal_scale.py).
#
#  Every raw model output s is judged against the person's OWN rest, in
#  units of normal resting noise:  z = (s - mu_rest) / sigma.  mu_rest is
#  re-measured from this session's own rest blocks (electrode contact
#  changes every time the device is worn), and the alert is z >= K, i.e. a
#  personal threshold mu_rest + K*sigma. No population threshold and no
#  probability shift (compute_baseline_shift()/compute_personal_threshold()
#  above are no longer called by the live pipeline).
#
#  Why this rule: on SAM40 (LOSO, deployed T7-T8 bipolar model, 2 rest + 2
#  task onboarding) it gave balanced accuracy 0.619 vs 0.550 for the fixed
#  population threshold (+0.069, CI lower bound 0.018 --
#  paper/analysis/results/Z1_personal_scale_sam40.csv), while the old
#  fixed 0.111 separation margin accepted only 2 of 40 people (and 0 of 5
#  live onboarding runs).
#
#  SIGMA_PRIOR: RMS deviation of later rest scores from the person's own
#  onboarding-rest mean, from inner out-of-fold scores of the SAM40
#  training people (paper/analysis/personalization.py::inner_stats(),
#  design 2+2, mean over the three onboarding-trial pairs: 0.160/0.150/
#  0.172). Recompute if the model is retrained.
# ═══════════════════════════════════════════════════════════════════
PERSONAL_SIGMA_PRIOR = 0.161
PERSONAL_K_ALERT = 0.84        # ~20% of rest blocks flagged (paper k)
PERSONAL_K_BREAK = 1.28        # ~10% of rest blocks -- stricter, for the sustained micro-break flag
MIN_TASK_RESPONSE_Z = 0.5      # onboarding task must sit >= 0.5 sigma above own rest

# Personal scale in LOG-ODDS, used to align EEG with HRV/GSR in fusion.
# The probability-space sigma above stops working when a device's scores sit
# near 0 (wearable02: 0.0005-0.0014, all at the same distance below a 0.136
# limit), because probabilities compress there; log-odds don't, and they are
# the logistic model's own linear output. Within-person SD of SAM40 rest-block
# log-odds (out-of-fold, final_analysis/bipolar_block_level_scores.csv) is
# 0.547; at z_logit >= PERSONAL_K_ALERT that flags 15.8% of rest blocks and
# 46.9% of task blocks (vs 16.7% / 40.6% for the probability-space rule).
PERSONAL_SIGMA_LOGIT = 0.55
_LOGIT_EPS = 1e-9


def _logit(p: float) -> float:
    p = min(max(float(p), _LOGIT_EPS), 1.0 - _LOGIT_EPS)
    return float(np.log(p / (1.0 - p)))


# Which scale the Personal Scale runs on. 'logit' (default): resting level,
# z, responsiveness and alert limits all in log-odds (sigma 0.55). On SAM40
# it matches the probability scale (responsiveness: same 8/8 below-chance
# people caught, Spearman 0.84 with held-out AUC both ways; alerts: 15.8%
# rest / 46.9% task blocks flagged vs 16.7% / 40.6%), and unlike it, it
# survives a device whose scores all sit near 0 (wearable02: 1e-9..1e-3):
# shifting every SAM40 score to ~1e-3 leaves 24/40 people responsive in
# log-odds but 0/40 in probability -- there, mu_rest + 0.84 x 0.161 can
# never be reached. 'probability' restores the original rule.
PERSONAL_SCALE = os.environ.get('EEG_PERSONAL_SCALE', 'logit').strip().lower()


def logit(p: float) -> float:
    return _logit(p)


def inv_logit(x: float) -> float:
    return float(1.0 / (1.0 + np.exp(-x)))


def rest_level_logit(rest_scores: list[float]) -> float | None:
    """Resting level on the log-odds scale: mean log-odds of the rest blocks."""
    return float(np.mean([_logit(s) for s in rest_scores])) if rest_scores else None


def personal_z_level(score: float | None, level_logit: float | None,
                     sigma: float = None) -> float | None:
    """z of a score against a log-odds resting level, in log-odds sigmas."""
    if score is None or level_logit is None:
        return None
    return float((_logit(score) - level_logit) / (sigma or PERSONAL_SIGMA_LOGIT))


def personal_decision_thresholds_logit(base: DecisionThresholds, level_logit: float,
                                       sigma: float = None) -> DecisionThresholds:
    """personal_decision_thresholds() on the log-odds scale: every limit is
    sigmoid(level + k x sigma_logit), so it sits the same number of spreads
    above rest whatever the device's absolute score range."""
    s = sigma or PERSONAL_SIGMA_LOGIT
    alert = inv_logit(level_logit + PERSONAL_K_ALERT * s)
    brk = inv_logit(level_logit + PERSONAL_K_BREAK * s)
    return replace(base, high_load_p=alert, cooldown_high_p=alert, break_p=brk,
                   cooldown_low_p=min(alert, inv_logit(level_logit)))


def task_response_z_logit(level_logit: float | None, task_scores: list[float],
                          sigma: float = None) -> float | None:
    """Onboarding responsiveness on the log-odds scale: mean task log-odds
    above the resting level, in log-odds sigmas."""
    if level_logit is None or not task_scores:
        return None
    return float((np.mean([_logit(s) for s in task_scores]) - level_logit) / (sigma or PERSONAL_SIGMA_LOGIT))


def personal_z_logit(score: float | None, mu_rest: float | None,
                     sigma: float = PERSONAL_SIGMA_LOGIT) -> float | None:
    """Distance of `score` above this person's own rest, in log-odds sigmas."""
    if score is None or mu_rest is None:
        return None
    return float((_logit(score) - _logit(mu_rest)) / sigma)


def personal_decision_thresholds(base: DecisionThresholds, mu_rest: float,
                                 sigma: float = PERSONAL_SIGMA_PRIOR) -> DecisionThresholds:
    """All decision-state thresholds on the personal scale: high-load alert
    (and "was high" for cooldown) at z >= PERSONAL_K_ALERT, micro-break at
    z >= PERSONAL_K_BREAK, cooldown complete back at z <= 0 (own rest).
    Persistence settings are unchanged from `base`."""
    alert = min(1.0, mu_rest + PERSONAL_K_ALERT * sigma)
    brk = min(1.0, mu_rest + PERSONAL_K_BREAK * sigma)
    return replace(base, high_load_p=alert, cooldown_high_p=alert, break_p=brk,
                   cooldown_low_p=min(alert, mu_rest))


def personal_z(score: float | None, mu_rest: float | None, sigma: float = PERSONAL_SIGMA_PRIOR) -> float | None:
    if score is None or mu_rest is None:
        return None
    return float((score - mu_rest) / sigma)


def task_response_z(resting_scores: list[float], task_scores: list[float],
                    sigma: float = PERSONAL_SIGMA_PRIOR) -> float | None:
    """Onboarding responsiveness: how far the task blocks sit above own
    rest, in sigma units. Below MIN_TASK_RESPONSE_Z the model is not
    tracking load for this person/wearing -- on SAM40 such people had
    chance-level EEG (eval AUC 0.53 vs 0.81; 9 of 10 below-chance people
    caught -- paper/analysis/results/Z2_responsiveness_check.csv)."""
    if not resting_scores or not task_scores:
        return None
    return float((np.mean(task_scores) - np.mean(resting_scores)) / sigma)


def compute_states(series: pd.DataFrame, thresholds: DecisionThresholds = DecisionThresholds()) -> pd.DataFrame:
    """series: rows ordered by time, columns calibrated_p, spectral_slope, theta_ratio.
    Returns series with added boolean/flag columns for each trigger condition.
    """
    df = series.reset_index(drop=True).copy()
    p = df.calibrated_p.to_numpy()

    # 1. High Load Alert: P >= high_load_p for >= N consecutive blocks
    above = p >= thresholds.high_load_p
    run = np.zeros(len(p), dtype=int)
    for i in range(len(p)):
        run[i] = (run[i - 1] + 1) if (i > 0 and above[i]) else int(above[i])
    df['high_load_alert'] = run >= thresholds.high_load_persistence_blocks

    # 2. Micro-Break Recommendation: P >= break_p sustained for >= N blocks
    above_break = p >= thresholds.break_p
    run_break = np.zeros(len(p), dtype=int)
    for i in range(len(p)):
        run_break[i] = (run_break[i - 1] + 1) if (i > 0 and above_break[i]) else int(above_break[i])
    df['micro_break_recommended'] = run_break >= thresholds.break_persistence_blocks

    # 3. Fatigue Warning: spectral slope steepening (more negative, trending down)
    #    + high theta ratio (above this series' own 75th percentile), sustained.
    if 'spectral_slope' in df.columns and 'theta_ratio' in df.columns:
        slope_steepening = df.spectral_slope.diff().fillna(0) < 0
        theta_thresh = thresholds.fatigue_theta_ratio_p75 or df.theta_ratio.quantile(0.75)
        high_theta = df.theta_ratio >= theta_thresh
        fatigue_raw = (slope_steepening & high_theta).to_numpy()
        run_fatigue = np.zeros(len(p), dtype=int)
        for i in range(len(p)):
            run_fatigue[i] = (run_fatigue[i - 1] + 1) if (i > 0 and fatigue_raw[i]) else int(fatigue_raw[i])
        df['fatigue_warning'] = run_fatigue >= thresholds.fatigue_persistence_blocks
    else:
        df['fatigue_warning'] = False

    # 4. Task Completion / Cooldown: shift from P>=cooldown_high_p to P<=cooldown_low_p
    was_high = pd.Series(p).shift(1) >= thresholds.cooldown_high_p
    df['cooldown_logged'] = was_high.to_numpy() & (p <= thresholds.cooldown_low_p)

    return df
